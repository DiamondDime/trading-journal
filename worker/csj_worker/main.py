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
from datetime import datetime, timedelta, timezone
from typing import NoReturn

import psycopg

from csj_worker import db as dbx
from csj_worker import excursions as excx
from csj_worker.adapters import ExchangeAdapter, get_adapter
from csj_worker.adapters.base import (
    AdapterAuthError,
    AdapterError,
    AdapterPermissionError,
    AdapterRateLimitedError,
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
    now = datetime.now(tz=timezone.utc)
    since = row.last_sync_at or (now - timedelta(days=lookback_days))
    until = now

    fills_added = 0
    last_fill_at: datetime | None = row.last_fill_at
    pages = 0

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

    # Success path
    await dbx.mark_connection_synced(
        conn, row.id, fills_added=fills_added, last_fill_at=last_fill_at
    )
    await conn.commit()

    log.info(
        "sync.complete",
        extra={**base_ctx, "fills_added": fills_added, "pages": pages},
    )
    return {
        "status": "ok",
        "fills_added": fills_added,
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


async def run_once(database_url: str, lookback_days: int) -> dict[str, object]:
    """Sync every eligible connection then run the matcher. Returns a summary."""
    log = logging.getLogger("csj_worker.cycle")
    summary: dict[str, object] = {"connections_synced": 0, "fills_added": 0}

    conn = await dbx.open_async_conn(database_url)
    try:
        recovered = await dbx.recover_orphaned_syncing(conn)
        await conn.commit()
        if recovered:
            log.warning("cycle.recovered_orphans", extra={"count": recovered})

        connections = await dbx.list_syncable_connections(conn)
        log.info("cycle.start", extra={"connection_count": len(connections)})

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

        # Matcher always runs — produces zero candidates if no positions yet.
        await run_matcher_for_all_users(conn)
    finally:
        await conn.close()

    log.info("cycle.complete", extra=summary)
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
) -> None:
    """Long-running daemon: ``run_once`` on an interval until shutdown.

    Shutdown:
    - SIGTERM / SIGINT set ``stop_event``. We finish the current cycle, then exit.
    - On wait, we ``asyncio.wait`` the stop_event with a timeout so we wake
      either when the interval elapses OR on signal.
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
            "lookback_days": lookback_days,
        },
    )

    while not stop_event.is_set():
        try:
            await run_once(database_url, lookback_days)
        except Exception:
            # A cycle should never crash the daemon. Log and continue.
            log.exception("daemon.cycle_crashed")
        if stop_event.is_set():
            break
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
        except asyncio.TimeoutError:
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
        elif args.once:
            asyncio.run(run_once(database_url, args.lookback_days))
            rc = 0
        else:
            poll = _env_int("WORKER_POLL_INTERVAL_SECONDS", 300)
            asyncio.run(
                run_daemon(
                    database_url,
                    poll_interval_seconds=poll,
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
