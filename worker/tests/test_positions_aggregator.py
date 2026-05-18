"""Unit tests for ``csj_worker.positions_aggregator``.

We exercise the pure-Python ``_aggregate_group`` and ``_group_fills``
functions — no DB is required. DB integration is covered indirectly by
the sync-jobs handshake test which stubs the DB layer end-to-end.

Coverage:
- Open then close roundtrip (long & short)
- Partial close: fill < running qty
- Side flip: fill > running qty, opens new opposite position
- Multi-day FIFO ordering
- Spot fills (position_side NULL) bucket as long
- Idempotency: empty fills returns empty result
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from csj_worker.positions_aggregator import (
    _aggregate_group,
    _derive_position_side,
    _FillRow,
    _group_fills,
    _RunningPosition,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


_NOW = datetime(2026, 5, 18, 12, 0, 0, tzinfo=UTC)


def _fill(
    *,
    fill_id: str,
    side: str,
    qty: str,
    price: str,
    position_side: str | None = None,
    instrument: str = "BTC/USDT:USDT",
    instrument_type: str = "perp",
    minute_offset: int = 0,
) -> _FillRow:
    """Build a _FillRow with sane defaults for tests."""
    return _FillRow(
        fill_id=fill_id,
        user_id="u",
        exchange_connection_id="c",
        instrument=instrument,
        instrument_type=instrument_type,
        side=side,
        position_side=position_side,
        qty=Decimal(qty),
        price=Decimal(price),
        fee=Decimal("0"),
        executed_at=_NOW + timedelta(minutes=minute_offset),
    )


# ---------------------------------------------------------------------------
# _derive_position_side
# ---------------------------------------------------------------------------


class TestDerivePositionSide:
    def test_uses_explicit_position_side_when_present(self) -> None:
        f = _fill(fill_id="1", side="sell", qty="1", price="100", position_side="short")
        assert _derive_position_side(f) == "short"

    def test_defaults_spot_to_long(self) -> None:
        f = _fill(
            fill_id="1",
            side="buy",
            qty="1",
            price="100",
            position_side=None,
            instrument_type="spot",
        )
        assert _derive_position_side(f) == "long"


# ---------------------------------------------------------------------------
# _group_fills
# ---------------------------------------------------------------------------


class TestGroupFills:
    def test_buckets_by_connection_instrument_position_side(self) -> None:
        fills = [
            _fill(fill_id="1", side="buy", qty="1", price="100", position_side="long"),
            _fill(fill_id="2", side="sell", qty="1", price="100", position_side="short"),
            _fill(fill_id="3", side="buy", qty="1", price="100", position_side="long"),
        ]
        groups = _group_fills(fills)
        assert len(groups) == 2
        long_key = ("c", "BTC/USDT:USDT", "long")
        short_key = ("c", "BTC/USDT:USDT", "short")
        assert long_key in groups
        assert short_key in groups
        assert [f.fill_id for f in groups[long_key]] == ["1", "3"]
        assert [f.fill_id for f in groups[short_key]] == ["2"]


# ---------------------------------------------------------------------------
# _aggregate_group — core algorithm
# ---------------------------------------------------------------------------


class TestAggregateGroupOpenClose:
    def test_long_open_then_close_emits_one_closed_position(self) -> None:
        fills = [
            _fill(fill_id="1", side="buy", qty="2", price="100", position_side="long"),
            _fill(
                fill_id="2",
                side="sell",
                qty="2",
                price="110",
                position_side="long",
                minute_offset=10,
            ),
        ]
        out = _aggregate_group(fills)
        assert len(out) == 1
        position, closed_at = out[0]
        assert position.side == "long"
        assert position.qty == Decimal("0")
        assert position.vwap == Decimal("100")
        assert position.fill_ids == ["1", "2"]
        assert closed_at == fills[1].executed_at

    def test_short_open_then_close_emits_one_closed_position(self) -> None:
        fills = [
            _fill(fill_id="1", side="sell", qty="2", price="100", position_side="short"),
            _fill(
                fill_id="2",
                side="buy",
                qty="2",
                price="90",
                position_side="short",
                minute_offset=10,
            ),
        ]
        out = _aggregate_group(fills)
        assert len(out) == 1
        position, closed_at = out[0]
        assert position.side == "short"
        assert position.qty == Decimal("0")
        assert position.fill_ids == ["1", "2"]
        assert closed_at == fills[1].executed_at


class TestAggregateGroupPartialClose:
    def test_partial_close_leaves_position_open(self) -> None:
        fills = [
            _fill(fill_id="1", side="buy", qty="3", price="100", position_side="long"),
            _fill(
                fill_id="2",
                side="sell",
                qty="1",
                price="110",
                position_side="long",
                minute_offset=5,
            ),
        ]
        out = _aggregate_group(fills)
        assert len(out) == 1
        position, closed_at = out[0]
        assert closed_at is None
        assert position.qty == Decimal("2")
        assert position.side == "long"
        assert position.fill_ids == ["1", "2"]

    def test_grow_then_partial_close_vwap_correct(self) -> None:
        # Open 1 BTC at 100, add 1 BTC at 200 → vwap 150
        fills = [
            _fill(fill_id="1", side="buy", qty="1", price="100", position_side="long"),
            _fill(
                fill_id="2",
                side="buy",
                qty="1",
                price="200",
                position_side="long",
                minute_offset=5,
            ),
            _fill(
                fill_id="3",
                side="sell",
                qty="1",
                price="160",
                position_side="long",
                minute_offset=10,
            ),
        ]
        out = _aggregate_group(fills)
        assert len(out) == 1
        position, closed_at = out[0]
        assert closed_at is None
        assert position.qty == Decimal("1")
        # vwap of (1@100 + 1@200) = 150
        assert position.vwap == Decimal("150")
        assert position.fill_ids == ["1", "2", "3"]


class TestAggregateGroupSideFlip:
    def test_overshoot_closes_current_and_opens_opposite(self) -> None:
        fills = [
            _fill(fill_id="1", side="buy", qty="1", price="100", position_side="long"),
            _fill(
                fill_id="2",
                side="sell",
                qty="3",
                price="110",
                position_side="long",
                minute_offset=5,
            ),
        ]
        out = _aggregate_group(fills)
        # First: closed long. Second: new short with 2 qty at vwap 110.
        assert len(out) == 2

        long_pos, long_closed = out[0]
        assert long_pos.side == "long"
        assert long_pos.qty == Decimal("0")
        assert long_closed == fills[1].executed_at

        short_pos, short_closed = out[1]
        assert short_pos.side == "short"
        assert short_pos.qty == Decimal("2")
        assert short_pos.vwap == Decimal("110")
        assert short_closed is None  # still open


class TestAggregateGroupMultiDay:
    def test_chronological_ordering_preserved(self) -> None:
        # Roundtrip 1: day 1
        # Roundtrip 2: day 2
        fills = [
            _fill(fill_id="1", side="buy", qty="1", price="100", position_side="long", minute_offset=0),
            _fill(fill_id="2", side="sell", qty="1", price="110", position_side="long", minute_offset=60),
            _fill(fill_id="3", side="buy", qty="2", price="105", position_side="long", minute_offset=24 * 60),
            _fill(fill_id="4", side="sell", qty="2", price="120", position_side="long", minute_offset=24 * 60 + 30),
        ]
        out = _aggregate_group(fills)
        assert len(out) == 2

        first, first_closed = out[0]
        assert first.qty == Decimal("0")
        assert first.fill_ids == ["1", "2"]
        assert first_closed == fills[1].executed_at

        second, second_closed = out[1]
        assert second.qty == Decimal("0")
        assert second.fill_ids == ["3", "4"]
        assert second_closed == fills[3].executed_at


class TestAggregateGroupEdgeCases:
    def test_empty_returns_empty(self) -> None:
        assert _aggregate_group([]) == []

    def test_single_fill_opens_position(self) -> None:
        fills = [
            _fill(fill_id="1", side="buy", qty="1", price="100", position_side="long"),
        ]
        out = _aggregate_group(fills)
        assert len(out) == 1
        position, closed_at = out[0]
        assert position.qty == Decimal("1")
        assert closed_at is None

    def test_spot_fills_bucket_as_long(self) -> None:
        # Spot has no position_side; everything is long.
        fills = [
            _fill(
                fill_id="1",
                side="buy",
                qty="1",
                price="100",
                position_side=None,
                instrument_type="spot",
            ),
            _fill(
                fill_id="2",
                side="sell",
                qty="1",
                price="120",
                position_side=None,
                instrument_type="spot",
                minute_offset=10,
            ),
        ]
        out = _aggregate_group(fills)
        assert len(out) == 1
        position, closed_at = out[0]
        assert position.side == "long"
        assert position.qty == Decimal("0")
        assert closed_at == fills[1].executed_at


# ---------------------------------------------------------------------------
# _RunningPosition behaviour
# ---------------------------------------------------------------------------


class TestRunningPosition:
    def test_open_initial_state(self) -> None:
        f = _fill(fill_id="1", side="buy", qty="2", price="100", position_side="long")
        p = _RunningPosition.open(position_side="long", fill=f)
        assert p.side == "long"
        assert p.qty == Decimal("2")
        assert p.vwap == Decimal("100")
        assert p.fill_ids == ["1"]

    def test_grow_combines_vwap(self) -> None:
        f1 = _fill(fill_id="1", side="buy", qty="1", price="100", position_side="long")
        f2 = _fill(
            fill_id="2",
            side="buy",
            qty="1",
            price="200",
            position_side="long",
            minute_offset=5,
        )
        p = _RunningPosition.open(position_side="long", fill=f1)
        p.grow(f2)
        assert p.qty == Decimal("2")
        assert p.vwap == Decimal("150")
        assert p.fill_ids == ["1", "2"]


# ---------------------------------------------------------------------------
# Idempotency at the SQL boundary
# ---------------------------------------------------------------------------


class TestAggregateIdempotency:
    """Re-running the aggregator must not duplicate positions.

    We don't have a live Postgres in unit tests — we verify the QUERY shape
    instead: the loader only reads ``WHERE position_id IS NULL``, so once
    fills get a position_id stamped, a re-run sees an empty input and
    short-circuits to zero work.
    """

    def test_empty_input_returns_zero_counters(self) -> None:
        """When there are no unmatched fills, the public entry point is a no-op."""
        import asyncio
        from unittest.mock import AsyncMock, patch

        from csj_worker import positions_aggregator as pa

        async def _go() -> dict[str, int]:
            with patch.object(
                pa,
                "_load_unmatched_fills",
                new=AsyncMock(return_value=[]),
            ):
                # Pass any object — _load_unmatched_fills is fully mocked.
                return await pa.aggregate_positions(
                    object(),  # type: ignore[arg-type]
                    user_id="u",
                )

        result = asyncio.run(_go())
        assert result == {
            "positions_inserted": 0,
            "fills_attached": 0,
            "groups_processed": 0,
        }

    def test_load_query_only_reads_unmatched_fills(self) -> None:
        """The SQL the loader runs MUST filter ``position_id IS NULL``.

        Idempotency rests on this: re-runs see no input because we just
        stamped position_id on every fill we processed.
        """
        from csj_worker.positions_aggregator import _UNMATCHED_FILLS_SQL

        assert "position_id is null" in _UNMATCHED_FILLS_SQL.lower()
