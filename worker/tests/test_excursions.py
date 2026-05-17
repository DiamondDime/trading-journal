"""Unit tests for csj_worker.excursions — MAE/MFE backfill.

We test in two layers:

1. Pure functions (no DB, no network):
   - `select_bucket_interval` — duration thresholds
   - `_compute_excursion_from_klines` — long vs short direction (the easy-
     to-bug bit)

2. Orchestration (`backfill_excursion`) — DB calls and adapter `fetch_klines`
   are stubbed via AsyncMock. We never hit a real exchange or a real Postgres.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from csj_worker.excursions import (
    ExcursionResult,
    _compute_excursion_from_klines,
    backfill_excursion,
    select_bucket_interval,
)
from csj_worker.types import PositionSide


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_kline(
    *, ts_ms: int, open: str, high: str, low: str, close: str, volume: str = "1.0"
) -> dict[str, Any]:
    """Build one canonical kline dict."""
    return {
        "ts_ms": ts_ms,
        "open": Decimal(open),
        "high": Decimal(high),
        "low": Decimal(low),
        "close": Decimal(close),
        "volume": Decimal(volume),
    }


# ============================================================================
# Bucket-size selection
# ============================================================================


class TestSelectBucketInterval:
    """Boundary tests for the bucket-size selector.

    Thresholds (inclusive on the upper bound):
        duration ≤ 7 days  → "1m"
        duration ≤ 30 days → "5m"
        duration > 30 days → "15m"
    """

    def _delta(self, *, days: float = 0, hours: float = 0, minutes: float = 0) -> tuple[datetime, datetime]:
        opened = datetime(2026, 5, 1, tzinfo=timezone.utc)
        closed = opened + timedelta(days=days, hours=hours, minutes=minutes)
        return opened, closed

    def test_zero_duration_defaults_to_one_minute(self) -> None:
        o, c = self._delta(minutes=0)
        assert select_bucket_interval(o, c) == "1m"

    def test_one_hour_uses_one_minute(self) -> None:
        o, c = self._delta(hours=1)
        assert select_bucket_interval(o, c) == "1m"

    def test_one_day_uses_one_minute(self) -> None:
        o, c = self._delta(days=1)
        assert select_bucket_interval(o, c) == "1m"

    def test_seven_days_exact_uses_one_minute(self) -> None:
        """Boundary: 7 days exact stays on 1m (≤ threshold)."""
        o, c = self._delta(days=7)
        assert select_bucket_interval(o, c) == "1m"

    def test_seven_days_one_minute_over_switches_to_five_minute(self) -> None:
        """Boundary: 7 days + 1 minute crosses into the 5m bucket."""
        o, c = self._delta(days=7, minutes=1)
        assert select_bucket_interval(o, c) == "5m"

    def test_eight_days_uses_five_minute(self) -> None:
        o, c = self._delta(days=8)
        assert select_bucket_interval(o, c) == "5m"

    def test_thirty_days_exact_uses_five_minute(self) -> None:
        """Boundary: 30 days exact stays on 5m."""
        o, c = self._delta(days=30)
        assert select_bucket_interval(o, c) == "5m"

    def test_thirty_days_one_minute_over_switches_to_fifteen_minute(self) -> None:
        """Boundary: 30 days + 1 minute crosses into the 15m bucket."""
        o, c = self._delta(days=30, minutes=1)
        assert select_bucket_interval(o, c) == "15m"

    def test_sixty_days_uses_fifteen_minute(self) -> None:
        o, c = self._delta(days=60)
        assert select_bucket_interval(o, c) == "15m"


# ============================================================================
# MAE / MFE direction — LONG vs SHORT
# ============================================================================


class TestComputeExcursionLongTrade:
    """For a LONG trade:
        - MFE (favorable) = HIGHEST price reached = max(high)
        - MAE (adverse)   = LOWEST  price reached = min(low)
    """

    def test_long_trade_picks_max_high_for_mfe(self) -> None:
        klines = [
            _make_kline(ts_ms=1_000, open="100", high="102", low="99",  close="101"),
            _make_kline(ts_ms=2_000, open="101", high="110", low="100", close="105"),  # MFE here
            _make_kline(ts_ms=3_000, open="105", high="106", low="95",  close="100"),  # MAE here
        ]
        mae_price, mae_at, mfe_price, mfe_at = _compute_excursion_from_klines(
            klines, PositionSide.LONG
        )
        assert mfe_price == Decimal("110")
        assert mfe_at == datetime.fromtimestamp(2_000 / 1000, tz=timezone.utc)
        assert mae_price == Decimal("95")
        assert mae_at == datetime.fromtimestamp(3_000 / 1000, tz=timezone.utc)

    def test_long_trade_single_bar(self) -> None:
        klines = [
            _make_kline(ts_ms=1_000, open="100", high="105", low="98", close="103"),
        ]
        mae_price, mae_at, mfe_price, mfe_at = _compute_excursion_from_klines(
            klines, PositionSide.LONG
        )
        assert mfe_price == Decimal("105")
        assert mae_price == Decimal("98")
        assert mae_at == mfe_at  # same bar


class TestComputeExcursionShortTrade:
    """For a SHORT trade:
        - MFE (favorable) = LOWEST  price reached = min(low)
        - MAE (adverse)   = HIGHEST price reached = max(high)

    Direction is REVERSED from long — price falling = profit on a short.
    """

    def test_short_trade_picks_min_low_for_mfe(self) -> None:
        """The same kline series as the long test, but as a SHORT:
        - MFE should now be the LOW of bar at ts=3000 (95) — price fell, we win.
        - MAE should now be the HIGH of bar at ts=2000 (110) — price rose against us.
        """
        klines = [
            _make_kline(ts_ms=1_000, open="100", high="102", low="99",  close="101"),
            _make_kline(ts_ms=2_000, open="101", high="110", low="100", close="105"),  # MAE for short
            _make_kline(ts_ms=3_000, open="105", high="106", low="95",  close="100"),  # MFE for short
        ]
        mae_price, mae_at, mfe_price, mfe_at = _compute_excursion_from_klines(
            klines, PositionSide.SHORT
        )
        assert mfe_price == Decimal("95")  # lowest low = best price for short
        assert mfe_at == datetime.fromtimestamp(3_000 / 1000, tz=timezone.utc)
        assert mae_price == Decimal("110")  # highest high = worst price for short
        assert mae_at == datetime.fromtimestamp(2_000 / 1000, tz=timezone.utc)

    def test_short_trade_direction_is_inverse_of_long(self) -> None:
        """Reading the same klines twice — once long, once short — the
        roles of MAE and MFE must swap (modulo which bar holds the extreme)."""
        klines = [
            _make_kline(ts_ms=1, open="50", high="60",   low="40",   close="55"),
            _make_kline(ts_ms=2, open="55", high="70.5", low="48.2", close="65"),
        ]
        long_mae, _, long_mfe, _ = _compute_excursion_from_klines(klines, PositionSide.LONG)
        short_mae, _, short_mfe, _ = _compute_excursion_from_klines(klines, PositionSide.SHORT)

        # Long MFE (max high) should equal short MAE (max high) — same number,
        # different role.
        assert long_mfe == short_mae == Decimal("70.5")
        # Long MAE (min low) should equal short MFE (min low).
        assert long_mae == short_mfe == Decimal("40")

    def test_empty_klines_raises(self) -> None:
        with pytest.raises(ValueError, match="non-empty"):
            _compute_excursion_from_klines([], PositionSide.LONG)


# ============================================================================
# Orchestrator — backfill_excursion
# ============================================================================


class _FakeAdapter:
    """Minimal adapter stub: only fetch_klines matters for backfill."""

    def __init__(self, klines: list[dict[str, Any]]):
        self.klines = klines
        self.called_with: dict[str, Any] = {}

    async def fetch_klines(
        self, symbol: str, start_ms: int, end_ms: int, *, interval: str = "1m"
    ) -> list[dict[str, Any]]:
        self.called_with = {
            "symbol": symbol,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "interval": interval,
        }
        return self.klines


def _stub_conn_for_trade(
    *,
    activity_id: str = "11111111-1111-1111-1111-111111111111",
    user_id: str = "22222222-2222-2222-2222-222222222222",
    symbol: str = "BTC/USDT:USDT",
    exchange: str = "binance",
    side: str = "long",
    opened_at: datetime | None = None,
    closed_at: datetime | None = None,
    existing_source: str | None = None,
) -> MagicMock:
    """Build a MagicMock connection that returns scripted rows for the
    queries `backfill_excursion` runs (in order):

    1. SELECT source FROM activity_excursion (idempotency check)
    2. SELECT activity meta
    3. SELECT activity_trade row
    4. INSERT/UPDATE activity_excursion (upsert)
    """
    opened_at = opened_at or datetime(2026, 5, 1, tzinfo=timezone.utc)
    closed_at = closed_at or (opened_at + timedelta(hours=4))

    # Cursor mock: each call to `fetchone()` returns the next scripted row.
    # We use a simple iterator over the expected results.

    fetchone_results: list[Any] = [
        # 1. existence check (returns tuple or None)
        (existing_source,) if existing_source else None,
        # 2. activity meta — dict_row factory returns dicts
        {
            "id": activity_id,
            "user_id": user_id,
            "type": "trade",
            "opened_at": opened_at,
            "closed_at": closed_at,
        },
        # 3. activity_trade row
        {
            "symbol": symbol,
            "exchange": exchange,
            "side": side,
        },
        # 4. UPSERT returns nothing useful (cur.execute return value)
        None,
    ]

    cursor = AsyncMock()
    cursor.fetchone = AsyncMock(side_effect=fetchone_results)
    cursor.execute = AsyncMock()
    cursor.__aenter__.return_value = cursor
    cursor.__aexit__.return_value = None

    conn = MagicMock()
    conn.cursor = MagicMock(return_value=cursor)

    return conn


# ----- Orchestration tests -----


@pytest.mark.asyncio
async def test_backfill_writes_long_trade() -> None:
    """End-to-end happy path: a long trade, klines available, row written."""
    klines = [
        _make_kline(ts_ms=1_700_000_000_000, open="100", high="110", low="98",  close="105"),
        _make_kline(ts_ms=1_700_000_060_000, open="105", high="106", low="95",  close="100"),
    ]
    adapter = _FakeAdapter(klines)
    conn = _stub_conn_for_trade(side="long")

    result: ExcursionResult = await backfill_excursion(
        conn,
        "11111111-1111-1111-1111-111111111111",
        force=False,
        adapter_factory=lambda code: adapter,
    )

    assert result.status == "written"
    assert result.bars_fetched == 2
    assert result.mfe_price == Decimal("110")  # long: max high
    assert result.mae_price == Decimal("95")   # long: min low
    assert result.bucket_interval == "1m"
    # Confirm the adapter was asked with the trade window padded by 1 min.
    assert adapter.called_with["interval"] == "1m"


@pytest.mark.asyncio
async def test_backfill_writes_short_trade_with_inverted_direction() -> None:
    """A short trade reads the same klines but produces inverted MAE/MFE."""
    klines = [
        _make_kline(ts_ms=1_700_000_000_000, open="100", high="110", low="98",  close="105"),
        _make_kline(ts_ms=1_700_000_060_000, open="105", high="106", low="95",  close="100"),
    ]
    adapter = _FakeAdapter(klines)
    conn = _stub_conn_for_trade(side="short")

    result = await backfill_excursion(
        conn,
        "11111111-1111-1111-1111-111111111111",
        force=False,
        adapter_factory=lambda code: adapter,
    )
    assert result.status == "written"
    # Short trade: roles swap
    assert result.mfe_price == Decimal("95")   # short: min low (price fell = win)
    assert result.mae_price == Decimal("110")  # short: max high (price rose = loss)


@pytest.mark.asyncio
async def test_backfill_skips_when_kline_backfill_row_exists() -> None:
    """Idempotency: a row with source='kline_backfill' triggers a skip."""
    adapter = _FakeAdapter([])  # would return empty if called — but we shouldn't reach it
    conn = _stub_conn_for_trade(existing_source="kline_backfill")

    result = await backfill_excursion(
        conn,
        "11111111-1111-1111-1111-111111111111",
        force=False,
        adapter_factory=lambda code: adapter,
    )
    assert result.status == "skipped_exists"
    # Adapter must NOT have been called
    assert adapter.called_with == {}


@pytest.mark.asyncio
async def test_backfill_proceeds_with_force_when_row_exists() -> None:
    """`force=True` skips the idempotency check and re-fetches."""
    klines = [_make_kline(ts_ms=1_700_000_000_000, open="100", high="105", low="98", close="103")]
    adapter = _FakeAdapter(klines)
    # When force=True the idempotency cursor result is unused — but we set up
    # the cursor in the same order to keep the mock simple. The first
    # fetchone() (existence check) is bypassed by the force flag in the orch,
    # so we drop it from the scripted results.

    conn = _stub_conn_for_trade()
    # Re-script the cursor: skip the existence check (force=True)
    cursor = conn.cursor.return_value
    cursor.fetchone = AsyncMock(side_effect=[
        # 2. activity meta
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "user_id": "22222222-2222-2222-2222-222222222222",
            "type": "trade",
            "opened_at": datetime(2026, 5, 1, tzinfo=timezone.utc),
            "closed_at": datetime(2026, 5, 1, 4, tzinfo=timezone.utc),
        },
        # 3. activity_trade row
        {"symbol": "BTC/USDT:USDT", "exchange": "binance", "side": "long"},
        # 4. UPSERT
        None,
    ])

    result = await backfill_excursion(
        conn,
        "11111111-1111-1111-1111-111111111111",
        force=True,
        adapter_factory=lambda code: adapter,
    )
    assert result.status == "written"
    assert adapter.called_with["interval"] == "1m"


@pytest.mark.asyncio
async def test_backfill_skips_when_klines_empty() -> None:
    """Empty klines (delisted symbol) → no upsert, returns the no-data sentinel."""
    adapter = _FakeAdapter([])
    conn = _stub_conn_for_trade()

    result = await backfill_excursion(
        conn,
        "11111111-1111-1111-1111-111111111111",
        force=False,
        adapter_factory=lambda code: adapter,
    )
    assert result.status == "skipped_no_data"
    assert result.mae_price is None
    assert result.mfe_price is None


@pytest.mark.asyncio
async def test_backfill_skips_unknown_exchange() -> None:
    """When the adapter_factory returns None, we skip without touching klines."""
    conn = _stub_conn_for_trade(exchange="okx")  # adapter_factory returns None for okx

    result = await backfill_excursion(
        conn,
        "11111111-1111-1111-1111-111111111111",
        force=False,
        adapter_factory=lambda code: None,
    )
    assert result.status == "skipped_unsupported"


@pytest.mark.asyncio
async def test_backfill_skips_activity_not_found() -> None:
    """Activity row missing → skipped_missing, no adapter call."""
    cursor = AsyncMock()
    # 1. idempotency check → None (no existing excursion)
    # 2. activity meta → None (activity not found)
    cursor.fetchone = AsyncMock(side_effect=[None, None])
    cursor.execute = AsyncMock()
    cursor.__aenter__.return_value = cursor
    cursor.__aexit__.return_value = None
    conn = MagicMock()
    conn.cursor = MagicMock(return_value=cursor)

    adapter = _FakeAdapter([])
    result = await backfill_excursion(
        conn,
        "11111111-1111-1111-1111-111111111111",
        force=False,
        adapter_factory=lambda code: adapter,
    )
    assert result.status == "skipped_missing"
    assert adapter.called_with == {}


@pytest.mark.asyncio
async def test_backfill_picks_five_minute_bucket_for_eight_day_trade() -> None:
    """A 9-day trade window should request "5m" klines, not "1m"."""
    klines = [_make_kline(ts_ms=1_700_000_000_000, open="100", high="105", low="98", close="103")]
    adapter = _FakeAdapter(klines)

    opened_at = datetime(2026, 5, 1, tzinfo=timezone.utc)
    closed_at = opened_at + timedelta(days=9)
    conn = _stub_conn_for_trade(opened_at=opened_at, closed_at=closed_at)

    result = await backfill_excursion(
        conn,
        "11111111-1111-1111-1111-111111111111",
        force=False,
        adapter_factory=lambda code: adapter,
    )
    assert result.status == "written"
    assert adapter.called_with["interval"] == "5m"
    assert result.bucket_interval == "5m"


@pytest.mark.asyncio
async def test_backfill_picks_fifteen_minute_bucket_for_long_trade() -> None:
    """A 45-day trade window should request "15m" klines."""
    klines = [_make_kline(ts_ms=1_700_000_000_000, open="100", high="105", low="98", close="103")]
    adapter = _FakeAdapter(klines)

    opened_at = datetime(2026, 4, 1, tzinfo=timezone.utc)
    closed_at = opened_at + timedelta(days=45)
    conn = _stub_conn_for_trade(opened_at=opened_at, closed_at=closed_at)

    result = await backfill_excursion(
        conn,
        "11111111-1111-1111-1111-111111111111",
        force=False,
        adapter_factory=lambda code: adapter,
    )
    assert result.status == "written"
    assert adapter.called_with["interval"] == "15m"
    assert result.bucket_interval == "15m"
