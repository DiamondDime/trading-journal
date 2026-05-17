"""MAE / MFE excursion backfill — Wave 10-1.

For each closed `activity` (type=trade or type=spread), this module:

1. Resolves a (symbol, exchange, side, opened_at, closed_at) descriptor.
2. Fetches public OHLCV klines over the trade window via the venue adapter.
3. Computes MAE (max adverse excursion) and MFE (max favorable excursion)
   prices and timestamps, with direction reversed for short positions.
4. UPSERTs the result into `public.activity_excursion` with
   `source='kline_backfill'`, preserving any trader-entered `stop_loss_price`.

Design constraints
------------------
- **Public klines only.** No credential decryption — `fetch_klines` is a
  public endpoint on every adapter.
- **Idempotent.** Running twice over the same activity is a no-op unless
  `force=True`. Detection: `activity_excursion` row exists with
  `source='kline_backfill'`.
- **Honest skip.** If klines are empty (delisted symbol, symbol mismatch,
  exchange not in the adapter registry), we log and return a sentinel
  result — never write fake data.
- **Bucket-size selection** is *deterministic* given trade duration:
    * duration ≤ 7 days   → 1m  bars  (worst case ≈ 10k bars)
    * 7 < duration ≤ 30d  → 5m  bars  (worst case ≈ 8.6k bars)
    * duration > 30 days  → 15m bars  (worst case ≈ 2.9k bars / month)

Long vs short direction (the easy-to-bug bit)
---------------------------------------------
For a **long** position the trader profits when price rises:
    * MFE (favorable) = the HIGHEST price reached → `max(high)`
    * MAE (adverse)   = the LOWEST  price reached → `min(low)`

For a **short** position the trader profits when price falls:
    * MFE (favorable) = the LOWEST  price reached → `min(low)`
    * MAE (adverse)   = the HIGHEST price reached → `max(high)`

Whenever you change `_compute_excursion_from_klines`, write a long+short
test fixture FIRST and run it locally — direction bugs here will silently
produce wrong analytics with no obvious symptom.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Literal

import psycopg

from csj_worker.adapters import ExchangeAdapter
from csj_worker.adapters.base import (
    AdapterError,
    AdapterRateLimitedError,
    AdapterUnsupportedError,
)
from csj_worker.types import PositionSide

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


ExcursionStatus = Literal[
    "written",          # row upserted with computed MAE/MFE
    "skipped_exists",   # already backfilled (idempotency)
    "skipped_no_data",  # empty klines
    "skipped_unsupported",  # adapter doesn't expose klines
    "skipped_missing",  # activity not found / not backfillable
]


@dataclass(frozen=True)
class ExcursionResult:
    """Outcome of one `backfill_excursion(activity_id)` invocation.

    `status='written'` is the only success state — every other value is a
    skip and `mae_price`/`mfe_price` will be None.
    """

    activity_id: str
    status: ExcursionStatus
    bucket_interval: str | None = None
    bars_fetched: int = 0
    mae_price: Decimal | None = None
    mfe_price: Decimal | None = None
    mae_at: datetime | None = None
    mfe_at: datetime | None = None
    reason: str | None = None


# ---------------------------------------------------------------------------
# Activity descriptor — what we need from the DB
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _ActivityForBackfill:
    """Minimal projection of an activity for kline backfill."""

    activity_id: str
    activity_type: str          # 'trade' | 'spread'
    user_id: str
    symbol: str                 # raw / canonical instrument string (passed to adapter)
    exchange: str               # lowercase exchange code
    side: PositionSide          # LONG | SHORT
    opened_at: datetime
    closed_at: datetime


# ---------------------------------------------------------------------------
# Bucket selection — see module docstring
# ---------------------------------------------------------------------------


def select_bucket_interval(opened_at: datetime, closed_at: datetime) -> str:
    """Return the kline interval string for a given trade duration.

    Thresholds (inclusive on the upper bound):
        duration ≤ 7 days  → "1m"
        duration ≤ 30 days → "5m"
        duration > 30 days → "15m"

    Negative or zero durations (data anomaly) → "1m" — we still want SOME
    bars; the caller's `start_ms - 1m / end_ms + 1m` padding makes a tiny
    window viable.
    """
    duration = closed_at - opened_at
    if duration <= timedelta(days=7):
        return "1m"
    if duration <= timedelta(days=30):
        return "5m"
    return "15m"


# ---------------------------------------------------------------------------
# Core MAE / MFE walk
# ---------------------------------------------------------------------------


def _compute_excursion_from_klines(
    klines: list[dict[str, Any]],
    side: PositionSide,
) -> tuple[Decimal, datetime, Decimal, datetime]:
    """Return (mae_price, mae_at, mfe_price, mfe_at) for a sequence of klines.

    Caller MUST guard against empty `klines` — this function assumes len >= 1.

    Direction (see module docstring):
        LONG  → MFE = max(high),  MAE = min(low)
        SHORT → MFE = min(low),   MAE = max(high)
    """
    if not klines:
        raise ValueError("_compute_excursion_from_klines requires non-empty klines")

    # Track running winners. Using > / < (strict) means the FIRST occurrence
    # wins on ties — that matches trader intuition ("the first time we hit
    # that level"). If you change this to >= / <=, update the tests.
    if side == PositionSide.LONG:
        mfe_bar = max(klines, key=lambda b: b["high"])
        mae_bar = min(klines, key=lambda b: b["low"])
        mfe_price = mfe_bar["high"]
        mae_price = mae_bar["low"]
    else:  # SHORT
        # Price falling = profit on a short
        mfe_bar = min(klines, key=lambda b: b["low"])
        mae_bar = max(klines, key=lambda b: b["high"])
        mfe_price = mfe_bar["low"]
        mae_price = mae_bar["high"]

    mfe_at = datetime.fromtimestamp(mfe_bar["ts_ms"] / 1000.0, tz=timezone.utc)
    mae_at = datetime.fromtimestamp(mae_bar["ts_ms"] / 1000.0, tz=timezone.utc)

    return mae_price, mae_at, mfe_price, mfe_at


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


async def backfill_excursion(
    conn: psycopg.AsyncConnection,
    activity_id: str,
    *,
    force: bool = False,
    adapter_factory: Any = None,  # injectable for tests; type: Callable[[str], ExchangeAdapter | None]
) -> ExcursionResult:
    """Compute and persist MAE / MFE for one activity.

    Idempotent: a second call returns ``status='skipped_exists'`` unless
    ``force=True``. The original trader-entered ``stop_loss_price`` is
    preserved across upserts.

    Args:
        conn: open async psycopg connection. Caller commits.
        activity_id: UUID string of the activity to backfill.
        force: if True, re-fetch and overwrite even if a kline_backfill row exists.
        adapter_factory: optional override for adapter lookup (used by tests).
            Signature: ``(exchange_code: str) -> ExchangeAdapter | None``.

    Returns:
        ExcursionResult with `status` describing the outcome.
    """
    # Local import to avoid a circular import in main.py registration paths.
    if adapter_factory is None:
        from csj_worker.main import _get_adapter as default_factory
        adapter_factory = default_factory

    # 1. Idempotency check
    if not force:
        existing = await _existing_excursion_source(conn, activity_id)
        if existing == "kline_backfill":
            log.info(
                "excursion.skip_exists",
                extra={"activity_id": activity_id, "source": existing},
            )
            return ExcursionResult(
                activity_id=activity_id,
                status="skipped_exists",
                reason="kline_backfill row already present",
            )

    # 2. Load activity descriptor
    descriptor = await _load_activity_for_backfill(conn, activity_id)
    if descriptor is None:
        log.warning(
            "excursion.skip_missing",
            extra={"activity_id": activity_id},
        )
        return ExcursionResult(
            activity_id=activity_id,
            status="skipped_missing",
            reason="activity not found or has no closed_at / primary leg",
        )

    # 3. Pick adapter
    adapter: ExchangeAdapter | None = adapter_factory(descriptor.exchange)
    if adapter is None:
        log.warning(
            "excursion.skip_unsupported",
            extra={"activity_id": activity_id, "exchange": descriptor.exchange},
        )
        return ExcursionResult(
            activity_id=activity_id,
            status="skipped_unsupported",
            reason=f"no adapter for exchange {descriptor.exchange!r}",
        )

    # 4. Pick bucket size, build query window with 1m padding
    interval = select_bucket_interval(descriptor.opened_at, descriptor.closed_at)
    pad = timedelta(minutes=1)
    start_ms = int((descriptor.opened_at - pad).timestamp() * 1000)
    end_ms = int((descriptor.closed_at + pad).timestamp() * 1000)

    # 5. Fetch klines (public endpoint; never decrypt credentials)
    try:
        klines = await adapter.fetch_klines(
            descriptor.symbol, start_ms, end_ms, interval=interval
        )
    except AdapterUnsupportedError as exc:
        log.warning(
            "excursion.skip_adapter_unsupported",
            extra={"activity_id": activity_id, "error": str(exc)},
        )
        return ExcursionResult(
            activity_id=activity_id,
            status="skipped_unsupported",
            bucket_interval=interval,
            reason=str(exc),
        )
    except AdapterRateLimitedError:
        # Let the caller orchestrator decide whether to back off.
        raise
    except AdapterError as exc:
        log.warning(
            "excursion.adapter_error",
            extra={
                "activity_id": activity_id,
                "exchange": descriptor.exchange,
                "error_code": exc.code.value,
                "error": str(exc)[:200],
            },
        )
        return ExcursionResult(
            activity_id=activity_id,
            status="skipped_no_data",
            bucket_interval=interval,
            reason=f"adapter error: {exc.code.value}",
        )

    if not klines:
        log.info(
            "excursion.skip_no_data",
            extra={
                "activity_id": activity_id,
                "symbol": descriptor.symbol,
                "exchange": descriptor.exchange,
                "interval": interval,
            },
        )
        return ExcursionResult(
            activity_id=activity_id,
            status="skipped_no_data",
            bucket_interval=interval,
            reason="adapter returned empty klines (symbol delisted or mismatch?)",
        )

    # 6. Compute MAE / MFE
    mae_price, mae_at, mfe_price, mfe_at = _compute_excursion_from_klines(
        klines, descriptor.side
    )

    # 7. Upsert (preserve stop_loss_price)
    await upsert_kline_excursion(
        conn,
        user_id=descriptor.user_id,
        activity_id=descriptor.activity_id,
        mae_price=mae_price,
        mae_at=mae_at,
        mfe_price=mfe_price,
        mfe_at=mfe_at,
    )

    log.info(
        "excursion.written",
        extra={
            "activity_id": activity_id,
            "exchange": descriptor.exchange,
            "symbol": descriptor.symbol,
            "side": descriptor.side.value,
            "interval": interval,
            "bars": len(klines),
            "mae_price": str(mae_price),
            "mfe_price": str(mfe_price),
        },
    )

    return ExcursionResult(
        activity_id=activity_id,
        status="written",
        bucket_interval=interval,
        bars_fetched=len(klines),
        mae_price=mae_price,
        mae_at=mae_at,
        mfe_price=mfe_price,
        mfe_at=mfe_at,
    )


# ---------------------------------------------------------------------------
# DB helpers — lightweight inline; the heavier batch SQL lives in db.py
# ---------------------------------------------------------------------------


async def _existing_excursion_source(
    conn: psycopg.AsyncConnection, activity_id: str
) -> str | None:
    """Return the `source` of an existing activity_excursion row, or None."""
    async with conn.cursor() as cur:
        await cur.execute(
            "select source from public.activity_excursion where activity_id::text = %s",
            (activity_id,),
        )
        row = await cur.fetchone()
    return row[0] if row else None


async def _load_activity_for_backfill(
    conn: psycopg.AsyncConnection, activity_id: str
) -> _ActivityForBackfill | None:
    """Resolve an activity to a (symbol, exchange, side, window) descriptor.

    Strategy by activity_type:
        * **trade** — direct join to `activity_trade`. `symbol`, `exchange`,
          `side`, `opened_at`, `closed_at` all live there.
        * **spread** — primary leg is the largest position by `total_qty`. We
          read the symbol/exchange/side from that position. (Spread
          excursions are inherently approximate; the primary leg gives the
          most representative price action.)
        * anything else (sale, airdrop) → return None — those types have no
          price-history meaning.

    Returns None for activities lacking required fields (e.g. still open).
    """
    from psycopg.rows import dict_row  # local import — avoid top-level dep ordering

    async with conn.cursor(row_factory=dict_row) as cur:
        # First load the activity type + lifecycle dates.
        await cur.execute(
            """
            select id::text         as id,
                   user_id::text    as user_id,
                   type::text       as type,
                   opened_at,
                   closed_at
              from public.activity
             where id::text = %s
               and deleted_at is null
            """,
            (activity_id,),
        )
        a = await cur.fetchone()
        if not a:
            return None
        if a["opened_at"] is None or a["closed_at"] is None:
            # Still open — no closed window to walk.
            return None

        activity_type = a["type"]

        if activity_type == "trade":
            await cur.execute(
                """
                select t.symbol,
                       t.exchange,
                       t.side::text as side
                  from public.activity_trade t
                 where t.activity_id::text = %s
                """,
                (activity_id,),
            )
            t = await cur.fetchone()
            if not t:
                return None
            return _ActivityForBackfill(
                activity_id=a["id"],
                activity_type="trade",
                user_id=a["user_id"],
                symbol=t["symbol"],
                exchange=str(t["exchange"]).lower(),
                side=PositionSide(t["side"]),
                opened_at=a["opened_at"],
                closed_at=a["closed_at"],
            )

        if activity_type == "spread":
            # Primary leg = largest qty position joined via spread_legs.
            await cur.execute(
                """
                select p.instrument,
                       p.side::text       as side,
                       ec.exchange_code   as exchange
                  from public.spread_legs sl
                  join public.positions p          on p.id = sl.position_id
                  join public.exchange_connections ec on ec.id = p.exchange_connection_id
                 where sl.activity_id::text = %s
                 order by p.total_qty desc nulls last
                 limit 1
                """,
                (activity_id,),
            )
            leg = await cur.fetchone()
            if not leg:
                return None
            return _ActivityForBackfill(
                activity_id=a["id"],
                activity_type="spread",
                user_id=a["user_id"],
                symbol=leg["instrument"],
                exchange=str(leg["exchange"]).lower(),
                side=PositionSide(leg["side"]),
                opened_at=a["opened_at"],
                closed_at=a["closed_at"],
            )

        # sale / airdrop → no kline-based excursion possible
        return None


async def upsert_kline_excursion(
    conn: psycopg.AsyncConnection,
    *,
    user_id: str,
    activity_id: str,
    mae_price: Decimal,
    mae_at: datetime,
    mfe_price: Decimal,
    mfe_at: datetime,
) -> None:
    """Upsert an excursion row with source='kline_backfill'.

    Preserves any trader-entered `stop_loss_price`: the ON CONFLICT update
    intentionally does NOT touch that column. We only overwrite the MAE/MFE
    fields plus the timestamps and bookkeeping columns.

    Caller commits.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            insert into public.activity_excursion (
                user_id, activity_id,
                mae_price, mae_at, mfe_price, mfe_at,
                source, backfilled_at
            ) values (
                %s::uuid, %s::uuid,
                %s, %s, %s, %s,
                'kline_backfill', now()
            )
            on conflict (activity_id) do update set
                mae_price     = excluded.mae_price,
                mae_at        = excluded.mae_at,
                mfe_price     = excluded.mfe_price,
                mfe_at        = excluded.mfe_at,
                source        = 'kline_backfill',
                backfilled_at = now()
            """,
            (
                user_id,
                activity_id,
                mae_price,
                mae_at,
                mfe_price,
                mfe_at,
            ),
        )


async def list_activities_missing_excursion(
    conn: psycopg.AsyncConnection,
    *,
    limit: int = 200,
) -> list[str]:
    """Return up to `limit` activity ids that are closed trade/spread rows
    with no existing `activity_excursion` row.

    Ordering: oldest closed first, so we always make progress on the backlog.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            select a.id::text as id
              from public.activity a
              left join public.activity_excursion e on e.activity_id = a.id
             where a.deleted_at is null
               and a.type in ('trade', 'spread')
               and a.opened_at is not null
               and a.closed_at is not null
               and e.activity_id is null
             order by a.closed_at asc
             limit %s
            """,
            (limit,),
        )
        rows = await cur.fetchall()
    return [r[0] for r in rows]
