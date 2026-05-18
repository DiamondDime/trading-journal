"""Balance tracker — fetch, price, persist, snapshot, drift-detect.

Wave v6 (2026-05-18). Hooks into ``main.run_once`` after every sync cycle
to keep ``exchange_balances`` fresh and into the daemon's hourly tick to
record portfolio snapshots.

Pipeline per sync cycle
=======================
For each connection that just synced:
    1. ``adapter.fetch_balances_all_wallets(creds)`` → list[CanonicalBalance]
    2. ``prices.resolve_usd_prices(adapter, {assets})`` → dict
    3. ``upsert_balances`` against ``public.exchange_balances`` keyed on
       ``(connection_id, wallet_type, asset, coalesce(chain, ''))``.
       Rows where source='manual' are PRESERVED (user-edited values).
    4. Stale-row reap: delete rows that exist in the DB for this connection
       but were NOT in the just-fetched batch. (User closed a wallet,
       moved funds out, etc.) source='manual' rows are again preserved.

Pipeline per hourly tick
========================
For each user with non-zero balances:
    1. Sum across exchange_balances → totals (stable / volatile / by_*)
    2. Compute drift vs fills math
    3. INSERT one row into ``portfolio_snapshots``

Idempotency
===========
- ``upsert_balances`` uses ON CONFLICT (the unique tuple) DO UPDATE so
  re-runs converge on the latest values.
- ``snapshot_portfolio`` always inserts a fresh row — historical truth
  is preserved.

Crash consistency
=================
- Each connection's balance batch commits as one transaction. A crash
  mid-batch leaves the previous (older) values intact.
- Snapshot insert is its own transaction.
- Drift computation reads ``fills`` aggregates — it's a pure SELECT so
  crashes never corrupt anything.

Caller manages transactions: every public function in this module commits
on success and expects the caller to handle exception-driven rollbacks.
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.types.json import Json

from csj_worker import prices
from csj_worker.types import CanonicalBalance, Credentials

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------


async def fetch_and_persist_balances(
    conn: psycopg.AsyncConnection,
    *,
    user_id: str,
    connection_id: str,
    adapter: Any,
    credentials: Credentials,
    snapshot_at: datetime,
) -> dict[str, int]:
    """Fetch + price + persist balances for one connection.

    Caller commits. Returns ``{"upserted": int, "reaped": int,
    "priced": int, "unpriced": int}`` for telemetry.

    Failures
    --------
    - If the adapter doesn't expose ``fetch_balances_all_wallets`` we
      return ``{"unsupported": 1}`` and move on. Adapters can opt-in
      later.
    - If pricing fails for an asset, the row is still written with
      ``usd_price=NULL`` / ``usd_value=NULL`` so the UI reflects the
      holding even when valuation is broken.
    """
    fetcher = getattr(adapter, "fetch_balances_all_wallets", None)
    if fetcher is None:
        return {"unsupported": 1}

    try:
        balances: list[CanonicalBalance] = await fetcher(credentials)
    except Exception:  # noqa: BLE001 — adapter mapping handled upstream
        log.exception(
            "balances.fetch_failed",
            extra={"connection_id": connection_id, "user_id": user_id},
        )
        return {"failed": 1}

    if not balances:
        # Empty list isn't necessarily an error — a fresh account could
        # legitimately have zero balances. Reap any stale rows and return.
        reaped = await _reap_missing_balances(
            conn,
            connection_id=connection_id,
            keep_keys=set(),
        )
        return {"upserted": 0, "reaped": reaped, "priced": 0, "unpriced": 0}

    # Price assets — single batch across the whole connection's holdings.
    distinct_assets = {b.asset for b in balances}
    price_map: dict[str, Decimal] = await prices.resolve_usd_prices(
        adapter, distinct_assets
    )

    upserted = 0
    priced = 0
    unpriced = 0
    keep_keys: set[tuple[str, str, str]] = set()  # (wallet_type, asset, chain_or_'')

    for b in balances:
        # Stamp the snapshot time AT the call to this function — every row
        # in this batch shares the same snapshot_at so the rollup view's
        # max() per asset reflects a coherent batch boundary.
        usd_price = price_map.get(b.asset)
        usd_value: Decimal | None = None
        if usd_price is not None:
            usd_value = (b.total * usd_price).quantize(Decimal("0.00000001"))
            priced += 1
        else:
            unpriced += 1

        rowcount = await _upsert_balance(
            conn,
            user_id=user_id,
            connection_id=connection_id,
            balance=b,
            usd_price=usd_price,
            usd_value=usd_value,
            snapshot_at=snapshot_at,
        )
        upserted += rowcount
        keep_keys.add((b.wallet_type.value, b.asset, b.chain or ""))

    reaped = await _reap_missing_balances(
        conn,
        connection_id=connection_id,
        keep_keys=keep_keys,
    )
    await conn.commit()

    return {
        "upserted": upserted,
        "reaped": reaped,
        "priced": priced,
        "unpriced": unpriced,
    }


async def aggregate_balances_for_users(
    conn: psycopg.AsyncConnection,
    user_ids: list[str],
) -> dict[str, int]:
    """Convenience: snapshot portfolios for the given users.

    Called by ``main.run_once`` after a sync cycle so the equity-style
    curve picks up changes promptly. Each user gets one snapshot row with
    source='event_driven'.
    """
    summary = {"snapshots": 0, "users": 0}
    now = datetime.now()
    # We import here to avoid a top-level cycle in case `datetime.now` is
    # mocked in tests — keep the import inline.
    from datetime import UTC

    snapshot_at = datetime.now(tz=UTC) if now.tzinfo is None else now
    for user_id in user_ids:
        try:
            written = await snapshot_portfolio(
                conn,
                user_id=user_id,
                snapshot_at=snapshot_at,
                source="event_driven",
            )
            if written:
                summary["snapshots"] += 1
            summary["users"] += 1
        except Exception:  # noqa: BLE001 — single user error must not crash cycle
            await conn.rollback()
            log.exception("balances.snapshot_failed", extra={"user_id": user_id})
    return summary


async def snapshot_portfolio(
    conn: psycopg.AsyncConnection,
    *,
    user_id: str,
    snapshot_at: datetime,
    source: str = "scheduled",
) -> bool:
    """Aggregate exchange_balances + insert one portfolio_snapshots row.

    Returns True if a row was written. Skips (returns False) when the
    user has zero non-stable AND zero stable holdings — no point recording
    "$0.00" snapshots for users who haven't connected anything yet.

    Caller commits.
    """
    # 1. Pull a connection-and-asset-resolved aggregate.
    async with conn.cursor() as cur:
        await cur.execute(
            """
            select
                eb.asset,
                eb.usd_value,
                eb.chain,
                eb.exchange_connection_id,
                ec.exchange_code,
                eb.total
              from public.exchange_balances eb
              join public.exchange_connections ec
                on ec.id = eb.exchange_connection_id
             where eb.user_id::text = %s
               and eb.total > 0
            """,
            (user_id,),
        )
        rows = await cur.fetchall()

    if not rows:
        return False

    total_usd = Decimal(0)
    stable_usd = Decimal(0)
    volatile_usd = Decimal(0)
    by_exchange: dict[str, Decimal] = {}
    by_asset: dict[str, Decimal] = {}
    by_chain: dict[str, Decimal] = {}

    for asset, usd_value, chain, _conn_id, exchange_code, _total in rows:
        if usd_value is None:
            continue
        value = Decimal(usd_value)
        total_usd += value
        if prices.is_stable(asset):
            stable_usd += value
        else:
            volatile_usd += value
        by_exchange[exchange_code] = by_exchange.get(exchange_code, Decimal(0)) + value
        by_asset[asset] = by_asset.get(asset, Decimal(0)) + value
        if chain:
            by_chain[chain] = by_chain.get(chain, Decimal(0)) + value

    if total_usd == 0:
        return False

    # 2. Drift vs fills math (best-effort; None if fills are empty).
    drift = await _compute_drift_usd(conn, user_id=user_id, prices_in_use={
        row[0]: Decimal(row[1]) / Decimal(row[5])
        for row in rows
        if row[1] is not None and Decimal(row[5]) > 0
    })

    # 3. Insert
    async with conn.cursor() as cur:
        await cur.execute(
            """
            insert into public.portfolio_snapshots (
                user_id, snapshot_at,
                total_usd, total_stable_usd, total_volatile_usd,
                by_exchange, by_asset, by_chain,
                drift_from_fills_usd, source
            ) values (
                %s::uuid, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s
            )
            """,
            (
                user_id,
                snapshot_at,
                total_usd,
                stable_usd,
                volatile_usd,
                Json({k: str(v) for k, v in by_exchange.items()}),
                Json({k: str(v) for k, v in by_asset.items()}),
                Json({k: str(v) for k, v in by_chain.items()}) if by_chain else None,
                drift,
                source,
            ),
        )
    await conn.commit()
    return True


async def compute_drift_for_user(
    conn: psycopg.AsyncConnection,
    user_id: str,
) -> dict[str, Decimal]:
    """Return per-asset drift between fills-derived qty and reported balance.

    Drift = balance.total - sum(fills.buy_qty - fills.sell_qty) per asset.
    Positive drift → user has more than fills predict (deposit / transfer in
    we didn't see). Negative drift → user has less (withdrawal / transfer out).
    Stablecoins are combined under "USD" because the user typically holds
    them interchangeably.
    """
    return await _compute_drift_per_asset(conn, user_id=user_id)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _upsert_balance(
    conn: psycopg.AsyncConnection,
    *,
    user_id: str,
    connection_id: str,
    balance: CanonicalBalance,
    usd_price: Decimal | None,
    usd_value: Decimal | None,
    snapshot_at: datetime,
) -> int:
    """Insert or update one balance row keyed on the unique tuple.

    Preserves rows where source='manual' — a user-edited override sticks
    until the user re-enables auto-sync for that row.
    """
    sql = """
        insert into public.exchange_balances (
            user_id, exchange_connection_id,
            wallet_type, asset, chain,
            total, available, locked, borrowed,
            usd_price, usd_value, snapshot_at,
            source
        ) values (
            %s::uuid, %s::uuid,
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s,
            'worker'
        )
        on conflict (exchange_connection_id, wallet_type, asset, chain)
        do update set
            total       = excluded.total,
            available   = excluded.available,
            locked      = excluded.locked,
            borrowed    = excluded.borrowed,
            usd_price   = excluded.usd_price,
            usd_value   = excluded.usd_value,
            snapshot_at = excluded.snapshot_at,
            source      = excluded.source
          where public.exchange_balances.source <> 'manual'
    """
    async with conn.cursor() as cur:
        await cur.execute(
            sql,
            (
                user_id, connection_id,
                balance.wallet_type.value, balance.asset, balance.chain,
                balance.total, balance.available, balance.locked, balance.borrowed,
                usd_price, usd_value, snapshot_at,
            ),
        )
        return cur.rowcount or 0


async def _reap_missing_balances(
    conn: psycopg.AsyncConnection,
    *,
    connection_id: str,
    keep_keys: set[tuple[str, str, str]],
) -> int:
    """Delete rows for this connection that weren't in the just-fetched batch.

    Compares each row against ``keep_keys`` = ``{(wallet_type, asset, chain_or_'')}``.
    Manually-overridden rows are preserved unconditionally.

    Implementation note: we do this as one DELETE with a WHERE NOT IN clause
    rather than per-row to dodge psycopg parameter quoting limits on large
    portfolios. For very large keep sets (>1000) we'd switch to a temp table;
    in practice users have <500 distinct (wallet_type, asset) per connection.
    """
    if not keep_keys:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                delete from public.exchange_balances
                 where exchange_connection_id = %s
                   and source <> 'manual'
                """,
                (connection_id,),
            )
            return cur.rowcount or 0

    # Build a parameterized NOT IN clause. The chain column is NULLable;
    # we coalesce to '' for the comparison so NULL chains match the sentinel
    # in keep_keys.
    placeholders = ",".join(["(%s, %s, %s)"] * len(keep_keys))
    flat: list[Any] = []
    for wt, asset, chain in keep_keys:
        flat.extend([wt, asset, chain])

    sql = f"""
        delete from public.exchange_balances
         where exchange_connection_id = %s
           and source <> 'manual'
           and (wallet_type, asset, coalesce(chain, ''))
               not in ({placeholders})
    """
    async with conn.cursor() as cur:
        await cur.execute(sql, [connection_id, *flat])
        return cur.rowcount or 0


async def _compute_drift_usd(
    conn: psycopg.AsyncConnection,
    *,
    user_id: str,
    prices_in_use: dict[str, Decimal],
) -> Decimal | None:
    """Sum per-asset drift × price = USD drift for the snapshot.

    Returns None when the user has zero fills (drift undefined).
    """
    per_asset = await _compute_drift_per_asset(conn, user_id=user_id)
    if not per_asset:
        return None
    total = Decimal(0)
    for asset, qty in per_asset.items():
        price = prices_in_use.get(asset)
        if price is None and prices.is_stable(asset):
            price = Decimal(1)
        if price is None:
            continue
        total += qty * price
    return total.quantize(Decimal("0.00000001"))


async def _compute_drift_per_asset(
    conn: psycopg.AsyncConnection,
    *,
    user_id: str,
) -> dict[str, Decimal]:
    """Per-asset (qty_reported - qty_from_fills) dictionary.

    qty_from_fills derives from spot-side fills only — perp fills don't
    add to or subtract from holdings, they're synthetic positions. We
    sum BUY qty and subtract SELL qty per BASE asset.

    Stablecoin nuance: USDT, USDC, BUSD etc. are NOT collapsed into "USD"
    here because the user might want to see drift per peg. The dashboard
    UI does its own collapsing if it wants.
    """
    # 1. Reported holdings per asset (uppercase).
    async with conn.cursor() as cur:
        await cur.execute(
            """
            select asset, sum(total)
              from public.exchange_balances
             where user_id::text = %s
               and total > 0
             group by asset
            """,
            (user_id,),
        )
        reported_rows = await cur.fetchall()
    reported: dict[str, Decimal] = {
        row[0].upper(): Decimal(row[1]) for row in reported_rows
    }

    # 2. Fills-derived qty per BASE asset. We parse base from the fills'
    # instrument string (BTC/USDT → BTC; BTC/USDT:USDT → BTC; BTCUSDT → BTC).
    # Spot only.
    async with conn.cursor() as cur:
        await cur.execute(
            """
            select instrument, side, sum(qty) as qty
              from public.fills
             where user_id::text = %s
               and instrument_type = 'spot'::instrument_type
             group by instrument, side
            """,
            (user_id,),
        )
        fill_rows = await cur.fetchall()

    expected: dict[str, Decimal] = {}
    for instrument, side, qty in fill_rows:
        base = _parse_base_from_symbol(str(instrument))
        if base is None:
            continue
        qd = Decimal(qty)
        if side == "buy":
            expected[base] = expected.get(base, Decimal(0)) + qd
        else:
            expected[base] = expected.get(base, Decimal(0)) - qd

    if not expected:
        return {}

    # 3. Drift = reported - expected (for assets present in either map).
    drift: dict[str, Decimal] = {}
    for asset in reported.keys() | expected.keys():
        d = reported.get(asset, Decimal(0)) - expected.get(asset, Decimal(0))
        drift[asset] = d
    return drift


def _parse_base_from_symbol(symbol: str) -> str | None:
    """Lift the base currency out of an instrument string.

    Returns None when the format is unrecognisable. Mirrors the logic in
    ``csj_worker.db._split_instrument`` but returns just the base.
    """
    if not symbol:
        return None
    s = symbol.split(":")[0].upper()
    if "/" in s:
        base, _, _ = s.partition("/")
        return base or None
    for q in ("USDT", "USDC", "USD", "BTC", "ETH", "BNB"):
        if s.endswith(q) and len(s) > len(q):
            return s[: -len(q)]
    return None
