"""Ingestion worker entry point — Wave 5C.

CLI surface (argparse, no extra deps):

    python -m csj_worker.main                            # daemon loop
    python -m csj_worker.main --once                     # one sync cycle, exit
    python -m csj_worker.main sync --connection-id <id>  # sync a single connection
    python -m csj_worker.main match                      # matcher only, no fetch

Environment:
    DATABASE_URL                  default: postgresql://skywalqr@localhost:5432/crypto_spread_journal
    CREDENTIALS_MASTER_KEY        required at startup
    WORKER_POLL_INTERVAL_SECONDS  default: 300
    WORKER_LOOKBACK_DAYS          default: 30 (cap for first sync; ignored if watermark set)
    WORKER_LOG_LEVEL              default: INFO

Crash consistency: each fill page is its own transaction. Watermark only
advances after fills commit. SIGTERM/SIGINT triggers graceful shutdown — the
current page completes; the loop exits before the next connection starts.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import signal
import sys
from datetime import UTC, datetime, timedelta
from typing import NoReturn

import psycopg
import psycopg.rows  # noqa: F401 — re-exported via psycopg in newer versions, explicit here for typecheck

from csj_worker import balances as balx
from csj_worker import db as dbx
from csj_worker import excursions as excx
from csj_worker import positions_aggregator as agg
from csj_worker.adapters import ExchangeAdapter, get_adapter
from csj_worker.adapters.base import (
    AdapterAuthError,
    AdapterError,
    AdapterPermissionError,
    AdapterRateLimitedError,
    AdapterUnsupportedError,
)
from csj_worker.crypto import get_master_key
from csj_worker.logging_config import configure_logging, mask_secret
from csj_worker.matcher import MatcherConfig, match_spreads
from csj_worker.types import ConnectionStatus, Credentials

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


DEFAULT_DATABASE_URL = "postgresql://skywalqr@localhost:5432/crypto_spread_journal"


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


# ---------------------------------------------------------------------------
# Adapter registry — string -> Adapter class
# ---------------------------------------------------------------------------


def _get_adapter(exchange_code: str) -> ExchangeAdapter | None:
    """Return an adapter instance for a given exchange code, or None if unsupported.

    Delegates to ``csj_worker.adapters.get_adapter`` which consults the
    universal-adapter registry first, then the env-var legacy override
    (``CSJ_USE_LEGACY_ADAPTER_<CODE>=1``).
    """
    return get_adapter(exchange_code)


# ---------------------------------------------------------------------------
# Per-connection sync
# ---------------------------------------------------------------------------


async def sync_one_connection(
    conn: psycopg.AsyncConnection,
    row: dbx.ConnectionRow,
    *,
    lookback_days: int,
) -> dict[str, object]:
    """Run a single sync for one connection. Returns a small result dict.

    Transaction discipline:
    - Mark ``syncing`` in its own tx (so the UI sees it).
    - Each fill page commits as its own tx (replays are no-ops via ON CONFLICT).
    - On terminal error: rollback the page, update connection to error state
      in its own tx, and return.
    - On success: final tx updates last_sync_at + counters.

    Never logs cleartext credentials, ever. The ``message`` field of any error
    we persist is the adapter's stringified exception — adapters are coded to
    avoid putting secrets in messages, but we additionally truncate to 1KB.
    """
    log = logging.getLogger("csj_worker.sync")

    base_ctx = {
        "connection_id": row.id,
        "exchange": row.exchange_code,
        "label": row.label,
        "user_id": row.user_id,
    }

    log.info("sync.start", extra=base_ctx)

    adapter = _get_adapter(row.exchange_code)
    if adapter is None:
        log.warning(
            "sync.adapter_not_implemented",
            extra={**base_ctx, "exchange_code": row.exchange_code},
        )
        return {"status": "skipped", "reason": "adapter_not_implemented"}

    credentials: Credentials | None
    try:
        credentials = dbx.decrypt_connection_credentials(row)
    except Exception as exc:
        # Decryption failures: likely a key mismatch. Mark error WITHOUT exc
        # content (which could embed nonce bytes etc).
        log.error(
            "sync.decrypt_failed",
            extra={**base_ctx, "err": type(exc).__name__},
        )
        await _mark_error_in_own_tx(
            conn,
            row.id,
            ConnectionStatus.ERROR,
            "Credential decryption failed (key mismatch?)",
        )
        return {"status": "error", "reason": "decrypt_failed"}

    if credentials is None:
        log.info(
            "sync.skip_incomplete_credentials",
            extra={**base_ctx, "connection_type": row.connection_type},
        )
        return {"status": "skipped", "reason": "incomplete_credentials"}

    # Mark syncing (independent transaction).
    await dbx.mark_connection_syncing(conn, row.id)
    await conn.commit()

    # Sync window
    now = datetime.now(tz=UTC)
    since = row.last_sync_at or (now - timedelta(days=lookback_days))
    until = now

    fills_added = 0
    funding_added = 0
    last_fill_at: datetime | None = row.last_fill_at
    last_funding_at: datetime | None = await dbx.get_last_funding_at(conn, row.id)
    pages = 0

    # Targeted-symbol scan (W3a §4): only relevant for the universal adapter.
    # We populate ``adapter.symbol_filter`` with the union of:
    #   1. ``sync_state.last_seen_symbols`` (sticky cache, only grows)
    #   2. ``discover_active_symbols()`` (currently-open positions + nonzero balances)
    # On a 30-day rotation we deliberately wipe the cache and do a full scan
    # to catch new pairs the user picked up via the venue's UI.
    sync_state = await dbx.get_sync_state(conn, row.id)
    new_symbols: set[str] = set()
    if hasattr(adapter, "symbol_filter") and hasattr(adapter, "discover_active_symbols"):
        # Cast to known type; ``symbol_filter`` is only present on
        # ``CcxtUniversalAdapter``.
        from datetime import datetime as _dt  # local alias keeps top-level clean

        full_scan_at_iso = sync_state.get("full_scan_at")
        full_scan_at: _dt | None = None
        if isinstance(full_scan_at_iso, str):
            try:
                full_scan_at = _dt.fromisoformat(full_scan_at_iso)
            except ValueError:
                full_scan_at = None

        # 30-day full-scan rotation. None == never scanned yet → always do full.
        do_full_scan = (
            full_scan_at is None
            or (now - full_scan_at) > timedelta(days=30)
        )

        sticky_list = sync_state.get("last_seen_symbols") or []
        sticky: set[str] = set(s for s in sticky_list if isinstance(s, str))

        if do_full_scan:
            adapter.symbol_filter = None  # type: ignore[attr-defined]
            log.info(
                "sync.symbol_scan.full",
                extra={**base_ctx, "sticky_size": len(sticky)},
            )
        else:
            try:
                discovered = await adapter.discover_active_symbols(credentials)
            except Exception:
                log.exception("sync.symbol_discovery.failed", extra=base_ctx)
                discovered = set()
            filter_set = sticky | discovered
            if filter_set:
                adapter.symbol_filter = filter_set  # type: ignore[attr-defined]
                log.info(
                    "sync.symbol_scan.targeted",
                    extra={
                        **base_ctx,
                        "sticky_size": len(sticky),
                        "discovered_size": len(discovered),
                        "filter_size": len(filter_set),
                    },
                )
            else:
                # Empty filter would skip everything; fall back to full scan.
                adapter.symbol_filter = None  # type: ignore[attr-defined]
                log.warning(
                    "sync.symbol_scan.empty_fallback",
                    extra=base_ctx,
                )
                do_full_scan = True

    try:
        async for page in adapter.fetch_fills(credentials, since=since, until=until):
            if not page:
                continue
            pages += 1
            inserted = await dbx.insert_fills(
                conn,
                user_id=row.user_id,
                exchange_connection_id=row.id,
                fills=page,
            )
            await conn.commit()
            fills_added += inserted
            # Track every symbol we received a fill for — feeds the sticky
            # last_seen_symbols cache.
            for f in page:
                new_symbols.add(f.instrument.raw_symbol)
            page_last = max(f.filled_at for f in page)
            if last_fill_at is None or page_last > last_fill_at:
                last_fill_at = page_last
            log.info(
                "sync.page_committed",
                extra={
                    **base_ctx,
                    "page": pages,
                    "rows": len(page),
                    "inserted": inserted,
                    "page_last": page_last.isoformat(),
                },
            )

        # Funding events — separate watermark per connection. Adapters that
        # don't support funding history raise AdapterUnsupportedError, which
        # we treat as "skip" (not a hard failure).
        funding_since = last_funding_at or since
        try:
            async for fev_page in adapter.fetch_funding_events(
                credentials, since=funding_since, until=until
            ):
                if not fev_page:
                    continue
                inserted_fev = await dbx.insert_funding_events(
                    conn,
                    user_id=row.user_id,
                    exchange_connection_id=row.id,
                    events=fev_page,
                )
                await conn.commit()
                funding_added += inserted_fev
                page_last_fev = max(e.occurred_at for e in fev_page)
                if last_funding_at is None or page_last_fev > last_funding_at:
                    last_funding_at = page_last_fev
                log.info(
                    "sync.funding_page_committed",
                    extra={
                        **base_ctx,
                        "rows": len(fev_page),
                        "inserted": inserted_fev,
                        "page_last": page_last_fev.isoformat(),
                    },
                )
        except AdapterUnsupportedError:
            # Spot-only venues, etc.
            log.info("sync.funding_unsupported", extra=base_ctx)

    except AdapterAuthError as exc:
        await conn.rollback()
        log.warning("sync.auth_failed", extra={**base_ctx, "error_msg": str(exc)[:200]})
        await _mark_error_in_own_tx(
            conn, row.id, ConnectionStatus.AUTH_FAILED, str(exc)
        )
        return {"status": "error", "reason": "auth_failed", "fills_added": fills_added}

    except AdapterPermissionError as exc:
        await conn.rollback()
        log.warning("sync.permission", extra={**base_ctx, "error_msg": str(exc)[:200]})
        await _mark_error_in_own_tx(
            conn, row.id, ConnectionStatus.AUTH_FAILED, f"Permission: {exc}"
        )
        return {"status": "error", "reason": "permission", "fills_added": fills_added}

    except AdapterRateLimitedError as exc:
        await conn.rollback()
        log.warning(
            "sync.rate_limited",
            extra={**base_ctx, "retry_after": exc.retry_after, "error_msg": str(exc)[:200]},
        )
        await _mark_error_in_own_tx(
            conn, row.id, ConnectionStatus.RATE_LIMITED, str(exc)
        )
        return {"status": "error", "reason": "rate_limited", "fills_added": fills_added}

    except AdapterError as exc:
        await conn.rollback()
        log.warning(
            "sync.adapter_error",
            extra={**base_ctx, "code": exc.code.value, "error_msg": str(exc)[:200]},
        )
        await _mark_error_in_own_tx(conn, row.id, ConnectionStatus.ERROR, str(exc))
        return {"status": "error", "reason": exc.code.value, "fills_added": fills_added}

    except Exception as exc:
        await conn.rollback()
        # Generic exception — log type + minimal context, never raw repr (might
        # contain headers, etc.).
        log.error(
            "sync.unexpected_error",
            extra={**base_ctx, "err": type(exc).__name__, "error_msg": str(exc)[:200]},
            exc_info=True,
        )
        await _mark_error_in_own_tx(
            conn, row.id, ConnectionStatus.ERROR, f"{type(exc).__name__}: {exc}"
        )
        return {"status": "error", "reason": "unexpected", "fills_added": fills_added}

    # Balance tracker (Wave v6) — fetch + price + persist before marking
    # synced. Failures are non-fatal: the connection still completes the
    # fills/funding sync; we just won't have fresh balance rows. This
    # keeps balance tracking decoupled from the journal's core data
    # pipeline.
    balance_summary: dict[str, int] | None = None
    try:
        balance_summary = await balx.fetch_and_persist_balances(
            conn,
            user_id=row.user_id,
            connection_id=row.id,
            adapter=adapter,
            credentials=credentials,
            snapshot_at=now,
        )
        if balance_summary and balance_summary.get("upserted", 0) > 0:
            log.info(
                "sync.balances_persisted",
                extra={**base_ctx, **balance_summary},
            )
    except Exception:
        await conn.rollback()
        log.exception("sync.balances_failed", extra=base_ctx)
        # Continue — balance fetching is best-effort.

    # Success path
    await dbx.mark_connection_synced(
        conn, row.id, fills_added=fills_added, last_fill_at=last_fill_at
    )
    if last_funding_at is not None:
        await dbx.update_last_funding_at(conn, row.id, last_funding_at)

    # Persist sticky last_seen_symbols + full_scan_at watermark.
    if new_symbols or (adapter.symbol_filter is None if hasattr(adapter, "symbol_filter") else False):
        existing_list = (sync_state.get("last_seen_symbols") or [])
        existing_set = {s for s in existing_list if isinstance(s, str)}
        merged = sorted(existing_set | new_symbols)
        sync_state["last_seen_symbols"] = merged
        # If we just performed a full scan, stamp the rotation watermark.
        if hasattr(adapter, "symbol_filter") and adapter.symbol_filter is None:
            sync_state["full_scan_at"] = now.isoformat()
        await dbx.update_sync_state(conn, row.id, sync_state)
    await conn.commit()

    log.info(
        "sync.complete",
        extra={
            **base_ctx,
            "fills_added": fills_added,
            "funding_added": funding_added,
            "pages": pages,
        },
    )
    return {
        "status": "ok",
        "fills_added": fills_added,
        "funding_added": funding_added,
        "pages": pages,
        "last_fill_at": last_fill_at.isoformat() if last_fill_at else None,
    }


async def _mark_error_in_own_tx(
    conn: psycopg.AsyncConnection,
    connection_id: str,
    status: ConnectionStatus,
    message: str,
) -> None:
    """Update connection state in a fresh transaction.

    Used after we've rolled back the parent transaction following an error —
    we still want the state update to commit independently.
    """
    try:
        await dbx.mark_connection_error(
            conn, connection_id, status=status, message=message
        )
        await conn.commit()
    except Exception:
        # If even the status update fails, log and roll back so the daemon
        # can move on. The connection will simply stay in 'syncing' until
        # the next attempt (where we'll re-mark it).
        await conn.rollback()
        logging.getLogger("csj_worker.sync").exception(
            "sync.status_update_failed",
            extra={"connection_id": connection_id},
        )


# ---------------------------------------------------------------------------
# Matcher orchestration
# ---------------------------------------------------------------------------


async def run_matcher_for_user(
    conn: psycopg.AsyncConnection,
    user_id: str,
) -> dict[str, int]:
    """Load positions for ``user_id``, run matcher, persist new pending candidates.

    Dedupes against existing pending candidates by the set of position-ids in
    ``proposed_legs[*].position_ids``. Returns counters.
    """
    log = logging.getLogger("csj_worker.matcher")
    positions = await dbx.load_matcher_positions(conn, user_id=user_id)
    if not positions:
        log.info("matcher.no_positions", extra={"user_id": user_id})
        return {"proposals": 0, "inserted": 0, "skipped": 0, "positions": 0}

    proposals = match_spreads(positions, MatcherConfig())
    existing = await dbx.existing_pending_candidate_position_sets(conn, user_id)

    inserted = 0
    skipped = 0
    for proposal in proposals:
        position_ids = frozenset(
            pid for leg in proposal.proposed_legs for pid in leg.position_ids
        )
        if position_ids in existing:
            skipped += 1
            continue
        ok = await dbx.insert_spread_candidate(conn, proposal)
        if ok:
            inserted += 1
            existing.append(position_ids)
    await conn.commit()

    log.info(
        "matcher.complete",
        extra={
            "user_id": user_id,
            "positions": len(positions),
            "proposals": len(proposals),
            "inserted": inserted,
            "skipped": skipped,
        },
    )
    return {
        "positions": len(positions),
        "proposals": len(proposals),
        "inserted": inserted,
        "skipped": skipped,
    }


async def run_matcher_for_all_users(conn: psycopg.AsyncConnection) -> None:
    """Run the matcher per distinct user_id in active exchange_connections."""
    log = logging.getLogger("csj_worker.matcher")
    async with conn.cursor() as cur:
        await cur.execute(
            "select distinct user_id::text"
            " from public.exchange_connections"
            " where deleted_at is null"
        )
        user_ids = [r[0] for r in await cur.fetchall()]
    if not user_ids:
        log.info("matcher.no_users")
        return
    for user_id in user_ids:
        await run_matcher_for_user(conn, user_id)


# ---------------------------------------------------------------------------
# One-shot cycle (sync all eligible connections + run matcher)
# ---------------------------------------------------------------------------


async def _aggregate_and_link_for_users(
    conn: psycopg.AsyncConnection,
    user_ids: list[str],
) -> dict[str, int]:
    """Run positions aggregator + funding-event linker for the given users.

    Aggregator builds positions rows from unmatched fills; linker then
    sets ``funding_events.position_id`` to whatever position was open at
    each funding tick. Migration 005's trigger recomputes position
    aggregates automatically once fills.position_id flips.
    """
    log = logging.getLogger("csj_worker.aggregator")
    totals: dict[str, int] = {
        "positions_inserted": 0,
        "fills_attached": 0,
        "funding_linked": 0,
    }
    for user_id in user_ids:
        try:
            agg_result = await agg.aggregate_positions(conn, user_id=user_id)
            await conn.commit()
            totals["positions_inserted"] += agg_result["positions_inserted"]
            totals["fills_attached"] += agg_result["fills_attached"]
            funding_linked = await agg.link_funding_events(conn, user_id=user_id)
            await conn.commit()
            totals["funding_linked"] += funding_linked
            log.info(
                "aggregator.user_complete",
                extra={"user_id": user_id, **agg_result, "funding_linked": funding_linked},
            )
        except Exception:
            await conn.rollback()
            log.exception(
                "aggregator.user_failed",
                extra={"user_id": user_id},
            )
    return totals


async def _distinct_user_ids(conn: psycopg.AsyncConnection) -> list[str]:
    """Distinct user ids across active connections — used to scope the
    aggregator + matcher to "users who synced this cycle"."""
    async with conn.cursor() as cur:
        await cur.execute(
            "select distinct user_id::text"
            " from public.exchange_connections"
            " where deleted_at is null"
        )
        return [r[0] for r in await cur.fetchall()]


async def _process_sync_job(
    conn: psycopg.AsyncConnection,
    job: dbx.SyncJobRow,
    *,
    lookback_days: int,
) -> dict[str, object]:
    """Run sync_one_connection for the job's connection, persist sync_jobs state.

    On success: aggregator + funding-linker for the job's user, then matcher.
    On failure: mark the sync_jobs row failed with a reason code.

    Returns the same shape ``sync_one_connection`` does for telemetry.
    """
    log = logging.getLogger("csj_worker.sync_job")
    row = await dbx.get_connection_for_job(conn, job)
    if row is None:
        await dbx.mark_sync_job_failed(
            conn,
            job_id=job.id,
            error_code="connection_missing",
            error_message="connection row not found",
        )
        await conn.commit()
        return {"status": "error", "reason": "connection_missing"}

    result = await sync_one_connection(conn, row, lookback_days=lookback_days)

    fills_added = int(result.get("fills_added", 0) or 0)
    funding_added = int(result.get("funding_added", 0) or 0)

    if result.get("status") == "ok":
        # Aggregate + link funding for this user, then run the matcher.
        await _aggregate_and_link_for_users(conn, [row.user_id])
        await run_matcher_for_user(conn, row.user_id)
        await dbx.mark_sync_job_succeeded(
            conn,
            job_id=job.id,
            fills_pulled=fills_added,
            funding_pulled=funding_added,
        )
        await conn.commit()
        log.info(
            "sync_job.succeeded",
            extra={"job_id": job.id, "fills_added": fills_added, "funding_added": funding_added},
        )
    else:
        reason = str(result.get("reason") or "unknown")
        await dbx.mark_sync_job_failed(
            conn,
            job_id=job.id,
            error_code=reason,
            error_message=reason,
            fills_pulled=fills_added,
            funding_pulled=funding_added,
        )
        await conn.commit()
        log.warning(
            "sync_job.failed",
            extra={"job_id": job.id, "reason": reason},
        )

    return result


async def drain_sync_jobs(
    database_url: str,
    lookback_days: int,
    *,
    batch_limit: int = 10,
) -> dict[str, int]:
    """Single drain of the sync_jobs queue.

    Claims up to ``batch_limit`` queued rows, runs them sequentially, and
    returns aggregate counters. Caller owns the DB connection lifecycle —
    this opens / closes its own.
    """
    log = logging.getLogger("csj_worker.queue")
    summary = {"jobs_run": 0, "jobs_failed": 0, "fills_added": 0, "funding_added": 0}

    conn = await dbx.open_async_conn(database_url)
    try:
        # Mark stuck running jobs as failed before claiming new ones.
        try:
            orphaned = await dbx.recover_orphaned_sync_jobs(conn)
            await conn.commit()
            if orphaned:
                log.warning("queue.recovered_orphans", extra={"count": orphaned})
        except Exception:
            await conn.rollback()
            log.exception("queue.recover_orphans_failed")

        try:
            jobs = await dbx.claim_queued_sync_jobs(conn, limit=batch_limit)
            await conn.commit()
        except Exception:
            await conn.rollback()
            log.exception("queue.claim_failed")
            return summary

        if not jobs:
            return summary

        log.info("queue.drain.start", extra={"job_count": len(jobs)})
        for job in jobs:
            try:
                result = await _process_sync_job(
                    conn, job, lookback_days=lookback_days
                )
            except Exception:
                # Defensive: always mark the job failed so it doesn't
                # rot in 'running' state.
                await conn.rollback()
                try:
                    await dbx.mark_sync_job_failed(
                        conn,
                        job_id=job.id,
                        error_code="worker_exception",
                        error_message="unhandled exception",
                    )
                    await conn.commit()
                except Exception:
                    await conn.rollback()
                log.exception("queue.job_crashed", extra={"job_id": job.id})
                summary["jobs_failed"] += 1
                continue

            if result.get("status") == "ok":
                summary["jobs_run"] += 1
                summary["fills_added"] += int(result.get("fills_added", 0) or 0)
                summary["funding_added"] += int(result.get("funding_added", 0) or 0)
            else:
                summary["jobs_failed"] += 1
    finally:
        await conn.close()

    log.info("queue.drain.complete", extra=summary)
    return summary


async def run_once(database_url: str, lookback_days: int) -> dict[str, object]:
    """Sync every eligible connection then run aggregator + matcher.

    "Eligible" = status in (active, rate_limited) AND not currently syncing.
    The hybrid loop (``run_daemon``) ALSO drains the sync_jobs queue on a
    tighter cadence; ``run_once`` is the cycle-level fallback that runs
    every poll_interval_seconds.
    """
    log = logging.getLogger("csj_worker.cycle")
    summary: dict[str, object] = {
        "connections_synced": 0,
        "fills_added": 0,
        "funding_added": 0,
        "positions_inserted": 0,
    }

    conn = await dbx.open_async_conn(database_url)
    try:
        recovered = await dbx.recover_orphaned_syncing(conn)
        await conn.commit()
        if recovered:
            log.warning("cycle.recovered_orphans", extra={"count": recovered})

        connections = await dbx.list_syncable_connections(conn)
        log.info("cycle.start", extra={"connection_count": len(connections)})

        synced_user_ids: set[str] = set()
        if not connections:
            log.info("cycle.no_connections")
        for row in connections:
            result = await sync_one_connection(conn, row, lookback_days=lookback_days)
            if result.get("status") == "ok":
                summary["connections_synced"] = (
                    int(summary["connections_synced"]) + 1
                )
                summary["fills_added"] = (
                    int(summary["fills_added"]) + int(result.get("fills_added", 0))
                )
                summary["funding_added"] = (
                    int(summary["funding_added"]) + int(result.get("funding_added", 0))
                )
                synced_user_ids.add(row.user_id)

        # Build positions from unmatched fills, link funding events to them.
        if synced_user_ids:
            agg_totals = await _aggregate_and_link_for_users(
                conn, sorted(synced_user_ids)
            )
            summary["positions_inserted"] = agg_totals["positions_inserted"]

            # Balance snapshots (Wave v6) — record one portfolio snapshot
            # per user that just synced. Non-fatal: balance pipeline is
            # decoupled from the matcher / aggregator path.
            try:
                bal_totals = await balx.aggregate_balances_for_users(
                    conn, sorted(synced_user_ids)
                )
                summary["balance_snapshots"] = bal_totals.get("snapshots", 0)
            except Exception:
                log.exception("cycle.balances_snapshot_failed")

        # Matcher always runs — produces zero candidates if no positions yet.
        await run_matcher_for_all_users(conn)
    finally:
        await conn.close()

    log.info("cycle.complete", extra=summary)
    return summary


# ---------------------------------------------------------------------------
# Scheduled balance snapshots — Wave v6
# ---------------------------------------------------------------------------


async def run_balance_snapshots(database_url: str) -> dict[str, int]:
    """One pass: snapshot every user with non-zero balances.

    Called by the daemon loop on its hourly tick. Independent connection
    so it can be scheduled separately from the sync cycle. Returns a
    summary dict for telemetry.

    Source is 'scheduled' so the UI can distinguish hourly cron rows from
    event-driven ones (which arrive after a sync) and manual_refresh ones
    (which come from the user clicking the refresh button).
    """
    log = logging.getLogger("csj_worker.balance_snapshot")
    summary = {"users": 0, "snapshots": 0}
    conn = await dbx.open_async_conn(database_url)
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "select distinct user_id::text"
                " from public.exchange_balances"
                " where total > 0"
            )
            user_ids = [r[0] for r in await cur.fetchall()]

        for user_id in user_ids:
            summary["users"] += 1
            try:
                wrote = await balx.snapshot_portfolio(
                    conn,
                    user_id=user_id,
                    snapshot_at=datetime.now(tz=UTC),
                    source="scheduled",
                )
                if wrote:
                    summary["snapshots"] += 1
            except Exception:
                await conn.rollback()
                log.exception(
                    "balance_snapshot.user_failed",
                    extra={"user_id": user_id},
                )
    finally:
        await conn.close()

    log.info("balance_snapshot.complete", extra=summary)
    return summary


async def run_balance_refresh(
    database_url: str,
    *,
    user_id: str,
) -> dict[str, int]:
    """User-triggered refresh: re-fetch every connection's balances + snapshot.

    Called by the HTTP bridge's POST /refresh-balances endpoint (mounted in
    ``csj_worker.http_server``). The Next.js API route invokes this after the
    user clicks the refresh button on the balances page; we re-sync each of
    that user's connections' balance tables in turn, drop the price cache so
    we get fresh quotes, then record one snapshot with source=manual_refresh.

    Returns a summary the HTTP handler echoes back to the UI so it can
    render "fetched N balances across M exchanges in T seconds".
    """
    log = logging.getLogger("csj_worker.balance_refresh")
    summary = {
        "connections": 0,
        "upserted": 0,
        "reaped": 0,
        "snapshots": 0,
        "errors": 0,
    }
    # Drop the in-memory price cache so the refresh gets brand new quotes.
    from csj_worker import prices as _prices

    _prices.clear_cache()

    conn = await dbx.open_async_conn(database_url)
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            await cur.execute(
                "select id::text as id, exchange_code, label, user_id::text as user_id"
                " from public.exchange_connections"
                " where user_id::text = %s and deleted_at is null"
                "   and status::text in ('active', 'rate_limited')",
                (user_id,),
            )
            conn_rows = await cur.fetchall()

        snapshot_at = datetime.now(tz=UTC)
        for cr in conn_rows:
            summary["connections"] += 1
            row = await dbx.get_connection(conn, cr["id"])
            if row is None:
                summary["errors"] += 1
                continue
            adapter = _get_adapter(row.exchange_code)
            if adapter is None:
                continue
            creds = dbx.decrypt_connection_credentials(row)
            if creds is None:
                continue
            try:
                result = await balx.fetch_and_persist_balances(
                    conn,
                    user_id=row.user_id,
                    connection_id=row.id,
                    adapter=adapter,
                    credentials=creds,
                    snapshot_at=snapshot_at,
                )
                summary["upserted"] += int(result.get("upserted", 0) or 0)
                summary["reaped"] += int(result.get("reaped", 0) or 0)
            except Exception:
                await conn.rollback()
                log.exception(
                    "balance_refresh.connection_failed",
                    extra={"connection_id": row.id},
                )
                summary["errors"] += 1

        # One snapshot per refresh, with source=manual_refresh.
        try:
            wrote = await balx.snapshot_portfolio(
                conn,
                user_id=user_id,
                snapshot_at=snapshot_at,
                source="manual_refresh",
            )
            if wrote:
                summary["snapshots"] = 1
        except Exception:
            await conn.rollback()
            log.exception(
                "balance_refresh.snapshot_failed", extra={"user_id": user_id}
            )
            summary["errors"] += 1
    finally:
        await conn.close()

    log.info("balance_refresh.complete", extra=summary)
    return summary


# ---------------------------------------------------------------------------
# Single-connection mode (--connection-id)
# ---------------------------------------------------------------------------


async def run_single_connection(
    database_url: str,
    connection_id: str,
    lookback_days: int,
) -> int:
    log = logging.getLogger("csj_worker.single")
    conn = await dbx.open_async_conn(database_url)
    try:
        row = await dbx.get_connection(conn, connection_id)
        if row is None:
            log.error("single.not_found", extra={"connection_id": connection_id})
            return 2
        result = await sync_one_connection(conn, row, lookback_days=lookback_days)
        return 0 if result.get("status") == "ok" else 1
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# Excursion backfill — Wave 10-1
# ---------------------------------------------------------------------------


# Rate-limit governance for backfill. Each invocation processes at most
# BACKFILL_BATCH_CAP activities and sleeps BACKFILL_SLEEP_S between them.
BACKFILL_BATCH_CAP = 200
BACKFILL_SLEEP_S = 0.2


async def run_backfill_excursions(
    database_url: str,
    *,
    activity_id: str | None,
    all_missing: bool,
    force: bool,
) -> int:
    """Backfill MAE/MFE excursions for closed trades / spreads.

    Modes:
        --activity-id <uuid>: process exactly that activity.
        --all-missing (default when no id given): scan up to
            BACKFILL_BATCH_CAP activities lacking an excursion row.

    Rate-limit posture:
        * 200ms sleep between activities (BACKFILL_SLEEP_S).
        * On AdapterRateLimitedError, sleep `retry_after` (or 60s fallback)
          and skip the activity; the next batch will pick it up.

    Returns the CLI exit code (0 on success, non-zero on fatal errors).
    """
    log = logging.getLogger("csj_worker.backfill")
    conn = await dbx.open_async_conn(database_url)
    try:
        # Build the work list
        if activity_id is not None:
            ids: list[str] = [activity_id]
        else:
            if not all_missing:
                # No id and no --all-missing → also default to scanning missing.
                # Keeps the CLI ergonomic ("just run it") but logs the choice.
                log.info("backfill.default_to_all_missing")
            ids = await excx.list_activities_missing_excursion(
                conn, limit=BACKFILL_BATCH_CAP
            )

        if not ids:
            log.info("backfill.no_activities")
            return 0

        log.info(
            "backfill.start",
            extra={
                "count": len(ids),
                "force": force,
                "batch_cap": BACKFILL_BATCH_CAP,
                "sleep_s": BACKFILL_SLEEP_S,
            },
        )

        written = 0
        skipped_exists = 0
        skipped_no_data = 0
        skipped_unsupported = 0
        skipped_missing = 0
        errored = 0

        for i, aid in enumerate(ids):
            try:
                result = await excx.backfill_excursion(conn, aid, force=force)
            except AdapterRateLimitedError as exc:
                # Exponential backoff on the first hit, then carry on.
                backoff = exc.retry_after or 60.0
                log.warning(
                    "backfill.rate_limited",
                    extra={"activity_id": aid, "backoff_s": backoff},
                )
                await asyncio.sleep(backoff)
                continue
            except Exception:
                log.exception(
                    "backfill.unexpected_error",
                    extra={"activity_id": aid},
                )
                await conn.rollback()
                errored += 1
                continue

            if result.status == "written":
                await conn.commit()
                written += 1
            elif result.status == "skipped_exists":
                skipped_exists += 1
            elif result.status == "skipped_no_data":
                skipped_no_data += 1
            elif result.status == "skipped_unsupported":
                skipped_unsupported += 1
            elif result.status == "skipped_missing":
                skipped_missing += 1

            # Respect exchange rate limits: small sleep between activities.
            if i + 1 < len(ids):
                await asyncio.sleep(BACKFILL_SLEEP_S)

        log.info(
            "backfill.complete",
            extra={
                "scanned": len(ids),
                "written": written,
                "skipped_exists": skipped_exists,
                "skipped_no_data": skipped_no_data,
                "skipped_unsupported": skipped_unsupported,
                "skipped_missing": skipped_missing,
                "errored": errored,
            },
        )
        return 0 if errored == 0 else 1
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# Connect-time validation
# ---------------------------------------------------------------------------


async def test_connection(
    database_url: str,
    connection_id: str,
) -> dict[str, object]:
    """Validate a connection's credentials by running adapter.connect().

    Returns ``{"ok": bool, "health": str, "permissions": [...], "message": str?}``.
    Does NOT persist anything — the Next.js handler decides whether to flip
    ``status`` to 'active' or reject.

    Idempotent and free of side effects (modulo a single read-only API call
    against the venue).
    """
    log = logging.getLogger("csj_worker.test_connection")
    conn = await dbx.open_async_conn(database_url)
    try:
        row = await dbx.get_connection(conn, connection_id)
        if row is None:
            return {"ok": False, "error": "connection_not_found"}

        adapter = _get_adapter(row.exchange_code)
        if adapter is None:
            return {
                "ok": False,
                "error": "adapter_not_implemented",
                "message": f"No adapter for exchange {row.exchange_code!r}",
            }

        credentials = dbx.decrypt_connection_credentials(row)
        if credentials is None:
            return {"ok": False, "error": "missing_credentials"}

        try:
            result = await adapter.connect(credentials)
        except AdapterAuthError as exc:
            log.warning(
                "test.auth_failed",
                extra={"connection_id": connection_id, "error_msg": str(exc)[:200]},
            )
            return {"ok": False, "error": "auth_failed", "message": str(exc)[:500]}
        except AdapterPermissionError as exc:
            return {"ok": False, "error": "permission", "message": str(exc)[:500]}
        except AdapterRateLimitedError as exc:
            return {"ok": False, "error": "rate_limited", "message": str(exc)[:500]}
        except AdapterError as exc:
            return {
                "ok": False,
                "error": exc.code.value,
                "message": str(exc)[:500],
            }
        except Exception as exc:
            log.exception("test.unexpected_error", extra={"connection_id": connection_id})
            return {
                "ok": False,
                "error": "unexpected",
                "message": f"{type(exc).__name__}: {exc}"[:500],
            }

        # Determine ok-ness from health.
        health = result.health.value
        ok = health == "ok"
        permissions = list(result.permissions)
        # If any permission ends with ':unverified' we surface that for the
        # UI to require user attestation.
        unverified = [p for p in permissions if p.endswith(":unverified")]
        return {
            "ok": ok,
            "health": health,
            "permissions": permissions,
            "unverified": unverified,
            "message": result.message,
        }
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# Matcher-only mode
# ---------------------------------------------------------------------------


async def run_matcher_only(database_url: str) -> int:
    log = logging.getLogger("csj_worker.match_only")
    conn = await dbx.open_async_conn(database_url)
    try:
        log.info("match_only.start")
        await run_matcher_for_all_users(conn)
        return 0
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# Daemon loop
# ---------------------------------------------------------------------------


async def run_daemon(
    database_url: str,
    *,
    poll_interval_seconds: int,
    lookback_days: int,
    queue_poll_seconds: int = 5,
) -> None:
    """Hybrid loop: drains sync_jobs queue every few seconds AND runs the
    full ``run_once`` cycle on the wider interval.

    - ``queue_poll_seconds`` (default 5s) — drain ``sync_jobs`` queue once;
      this is how "Sync now" buttons in the UI surface a result within ~30s.
    - ``poll_interval_seconds`` (default 300s) — the scheduled sync cycle
      that re-syncs every active connection and re-runs the matcher.

    Both ticks run on the same coroutine so we never have two cycles running
    at once. Shutdown:
    - SIGTERM / SIGINT set ``stop_event``. The current tick completes,
      then we exit.
    """
    log = logging.getLogger("csj_worker.daemon")
    stop_event = asyncio.Event()

    def _on_signal(signum: int) -> None:
        log.info("daemon.signal", extra={"signal": signum})
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _on_signal, sig)
        except NotImplementedError:
            # Windows: signal handlers via add_signal_handler unsupported. Fall
            # back to default Python handlers which raise KeyboardInterrupt.
            pass

    log.info(
        "daemon.start",
        extra={
            "poll_interval_seconds": poll_interval_seconds,
            "queue_poll_seconds": queue_poll_seconds,
            "lookback_days": lookback_days,
        },
    )

    last_cycle = 0.0  # asyncio loop monotonic time of last run_once
    last_snapshot = 0.0  # last hourly balance snapshot tick
    snapshot_interval_seconds = _env_int("WORKER_SNAPSHOT_INTERVAL_SECONDS", 3600)

    while not stop_event.is_set():
        now = loop.time()

        # Full cycle on the wider interval.
        if now - last_cycle >= poll_interval_seconds:
            try:
                await run_once(database_url, lookback_days)
            except Exception:
                # A cycle should never crash the daemon. Log and continue.
                log.exception("daemon.cycle_crashed")
            last_cycle = loop.time()

        # Hourly balance snapshot tick (Wave v6) — independent of the
        # sync cycle so a long backfill doesn't delay the equity curve's
        # next data point. snapshot_portfolio is cheap (~1 SELECT + INSERT
        # per user) so we run it even when nothing synced this cycle.
        if now - last_snapshot >= snapshot_interval_seconds:
            try:
                await run_balance_snapshots(database_url)
            except Exception:
                log.exception("daemon.balance_snapshot_crashed")
            last_snapshot = loop.time()

        if stop_event.is_set():
            break

        # Queue drain every queue_poll_seconds.
        try:
            await drain_sync_jobs(database_url, lookback_days)
        except Exception:
            log.exception("daemon.queue_drain_crashed")

        if stop_event.is_set():
            break

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=queue_poll_seconds)
        except TimeoutError:
            pass

    log.info("daemon.stopped")


# ---------------------------------------------------------------------------
# CLI parsing
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="csj-worker",
        description="Crypto Spread Journal ingestion worker (Wave 5C)",
    )
    p.add_argument(
        "--once",
        action="store_true",
        help="Run a single sync+match cycle then exit. Default is daemon mode.",
    )
    p.add_argument(
        "--lookback-days",
        type=int,
        default=_env_int("WORKER_LOOKBACK_DAYS", 30),
        help="Lookback window for first sync (no watermark). Default: 30.",
    )
    sub = p.add_subparsers(dest="cmd", required=False)

    p_sync = sub.add_parser("sync", help="Sync a single exchange_connection by id")
    p_sync.add_argument("--connection-id", required=True, help="UUID of the connection")

    sub.add_parser("match", help="Run the leg matcher only (no sync)")

    # Wave 10-1: kline-driven MAE/MFE backfill for closed activities.
    p_backfill = sub.add_parser(
        "backfill-excursions",
        help="Compute MAE/MFE from public klines for closed trades & spreads",
    )
    p_backfill.add_argument(
        "--activity-id",
        default=None,
        help="UUID of a single activity to backfill (default: scan missing)",
    )
    p_backfill.add_argument(
        "--all-missing",
        action="store_true",
        help="Scan up to 200 activities lacking an excursion row (the default behaviour)",
    )
    p_backfill.add_argument(
        "--force",
        action="store_true",
        help="Re-fetch and overwrite even if a kline_backfill row exists",
    )

    # W3a: connect-time validation. Called by the Next.js POST /api/exchanges
    # handler synchronously (via HTTP) or out-of-band via this CLI.
    p_test = sub.add_parser(
        "test-connection",
        help="Validate a connection's credentials (calls adapter.connect()).",
    )
    p_test.add_argument("--connection-id", required=True, help="UUID of the connection")

    # Wave v6: manual portfolio snapshot trigger.
    p_snapshot = sub.add_parser(
        "snapshot-balances",
        help="Snapshot a user's portfolio (writes one portfolio_snapshots row).",
    )
    p_snapshot.add_argument(
        "--user-id",
        required=True,
        help="UUID of the user to snapshot",
    )
    p_snapshot.add_argument(
        "--source",
        default="manual_refresh",
        choices=["scheduled", "manual_refresh", "event_driven"],
        help="Snapshot source tag (default: manual_refresh)",
    )

    p_http = sub.add_parser(
        "http-server",
        help="Run the worker HTTP server (connect-test endpoint).",
    )
    p_http.add_argument(
        "--host",
        default=os.environ.get("WORKER_HTTP_HOST", "127.0.0.1"),
        help="Bind host (default: 127.0.0.1)",
    )
    p_http.add_argument(
        "--port",
        type=int,
        default=_env_int("WORKER_HTTP_PORT", 7430),
        help="Bind port (default: 7430)",
    )

    return p


def _resolve_database_url() -> str:
    return os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL


def main(argv: list[str] | None = None) -> NoReturn:
    """CLI entry. Always calls sys.exit(rc)."""
    # Parse args FIRST so ``--help`` works even without env config.
    parser = _build_parser()
    args = parser.parse_args(argv)

    configure_logging()
    log = logging.getLogger("csj_worker.main")

    # Fail fast if the master key is missing — every code path needs it.
    try:
        get_master_key()
    except RuntimeError as exc:
        log.error("startup.no_master_key", extra={"hint": str(exc)})
        sys.exit(2)

    database_url = _resolve_database_url()
    # Log connection target with the password redacted (anything after :// up to @).
    log.info(
        "startup.config",
        extra={
            "database_url": _redact_url(database_url),
            "lookback_days": args.lookback_days,
            "cmd": args.cmd or ("once" if args.once else "daemon"),
        },
    )

    try:
        if args.cmd == "sync":
            rc = asyncio.run(
                run_single_connection(database_url, args.connection_id, args.lookback_days)
            )
        elif args.cmd == "match":
            rc = asyncio.run(run_matcher_only(database_url))
        elif args.cmd == "backfill-excursions":
            rc = asyncio.run(
                run_backfill_excursions(
                    database_url,
                    activity_id=args.activity_id,
                    all_missing=args.all_missing,
                    force=args.force,
                )
            )
        elif args.cmd == "test-connection":
            # Emit a single JSON line to stdout so callers (Next.js shell-exec
            # or other CLI consumers) can parse the result.
            import json as _json

            result = asyncio.run(test_connection(database_url, args.connection_id))
            print(_json.dumps(result), flush=True)
            rc = 0 if result.get("ok") else 1
        elif args.cmd == "snapshot-balances":
            # Wave v6 manual snapshot. Single-user, single-row.
            async def _do_snapshot() -> int:
                conn = await dbx.open_async_conn(database_url)
                try:
                    wrote = await balx.snapshot_portfolio(
                        conn,
                        user_id=args.user_id,
                        snapshot_at=datetime.now(tz=UTC),
                        source=args.source,
                    )
                    return 0 if wrote else 1
                finally:
                    await conn.close()

            rc = asyncio.run(_do_snapshot())
        elif args.cmd == "http-server":
            from csj_worker.http_server import run as run_http

            asyncio.run(run_http(database_url, host=args.host, port=args.port))
            rc = 0
        elif args.once:
            asyncio.run(run_once(database_url, args.lookback_days))
            rc = 0
        else:
            poll = _env_int("WORKER_POLL_INTERVAL_SECONDS", 300)
            queue_poll = _env_int("WORKER_QUEUE_POLL_SECONDS", 5)
            asyncio.run(
                run_daemon(
                    database_url,
                    poll_interval_seconds=poll,
                    queue_poll_seconds=queue_poll,
                    lookback_days=args.lookback_days,
                )
            )
            rc = 0
    except KeyboardInterrupt:
        log.info("startup.interrupted")
        rc = 130
    except Exception:
        log.exception("startup.crashed")
        rc = 1

    sys.exit(rc)


def _redact_url(url: str) -> str:
    """Mask the password in a postgres URL for logging.

    Handles ``postgresql://user:pass@host/db`` and ``postgres://user@host/db``.
    """
    # Find scheme separator
    try:
        scheme, _, rest = url.partition("://")
        if "@" not in rest:
            return url
        creds, _, hostpart = rest.partition("@")
        if ":" in creds:
            user, _, _pw = creds.partition(":")
            return f"{scheme}://{user}:{mask_secret(_pw)}@{hostpart}"
        return url
    except Exception:
        return "<unparseable-database-url>"


if __name__ == "__main__":
    main()
