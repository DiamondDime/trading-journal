"""Engine deduplication tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from csj_worker.matcher.engine import match_spreads
from csj_worker.matcher.models import MatcherPosition
from csj_worker.types import (
    CanonicalInstrument,
    Exchange,
    ExchangeKind,
    InstrumentKind,
    PositionSide,
    PositionStatus,
)


def _pos(
    pid: str,
    exchange: Exchange,
    kind: InstrumentKind,
    side: PositionSide,
    *,
    base: str = "BTC",
    qty: str = "1.0",
    opened_offset_s: int = 0,
    expiry: datetime | None = None,
) -> MatcherPosition:
    kind_to_ex_kind = {
        Exchange.HYPERLIQUID: ExchangeKind.DEX,
        Exchange.ASTER: ExchangeKind.DEX,
        Exchange.OKX_DEX: ExchangeKind.DEX,
    }
    return MatcherPosition(
        position_id=pid,
        user_id="user1",
        connection_id=f"conn-{exchange.value}",
        exchange=exchange,
        exchange_kind=kind_to_ex_kind.get(exchange, ExchangeKind.CEX),
        instrument=CanonicalInstrument(
            exchange=exchange,
            kind=kind,
            base=base,
            quote="USDT",
            raw_symbol=f"{base}USDT",
            expiry=expiry,
        ),
        side=side,
        qty_total=Decimal(qty),
        avg_entry_price=Decimal("67000.0"),
        opened_at=datetime(2026, 5, 15, 14, 23, 0, tzinfo=timezone.utc) + timedelta(seconds=opened_offset_s),
        status=PositionStatus.OPEN,
    )


class TestEngine:
    def test_empty_input_returns_empty(self) -> None:
        assert match_spreads([]) == []

    def test_single_perp_proposal(self) -> None:
        positions = [
            _pos("a", Exchange.BINANCE, InstrumentKind.PERP, PositionSide.LONG),
            _pos("b", Exchange.BYBIT, InstrumentKind.PERP, PositionSide.SHORT),
        ]
        proposals = match_spreads(positions)
        assert len(proposals) == 1

    def test_position_only_in_one_spread(self) -> None:
        # Position 'a' could pair with both 'b' (cross-ex perp arb) and 'c' (cash-carry).
        # Engine should choose the higher-confidence proposal and not double-claim 'a'.
        positions = [
            _pos("a", Exchange.BINANCE, InstrumentKind.PERP, PositionSide.LONG),
            _pos(
                "b",
                Exchange.BYBIT,
                InstrumentKind.PERP,
                PositionSide.SHORT,
                opened_offset_s=10,
            ),
            _pos(
                "c",
                Exchange.BINANCE,
                InstrumentKind.SPOT,
                PositionSide.SHORT,
                opened_offset_s=30,
            ),
        ]
        proposals = match_spreads(positions)

        claimed: set[str] = set()
        for p in proposals:
            for leg in p.proposed_legs:
                for pid in leg.position_ids:
                    assert pid not in claimed, f"position {pid} claimed by multiple proposals"
                    claimed.add(pid)

    def test_higher_confidence_wins_deduplication(self) -> None:
        # Build a setup where two rules compete:
        # - cross-exchange perp arb: a (Binance perp long) + b (Bybit perp short), 50s apart
        # - cash-carry: a + c (Binance spot short), 5s apart
        # Cash-carry should win (closer in time → higher time score).
        positions = [
            _pos("a", Exchange.BINANCE, InstrumentKind.PERP, PositionSide.LONG),
            _pos(
                "b",
                Exchange.BYBIT,
                InstrumentKind.PERP,
                PositionSide.SHORT,
                opened_offset_s=50,
            ),
            _pos(
                "c",
                Exchange.BINANCE,
                InstrumentKind.SPOT,
                PositionSide.SHORT,
                opened_offset_s=5,
            ),
        ]
        proposals = match_spreads(positions)

        # Position 'a' should be in the cash-carry proposal (higher confidence)
        a_in_cash_carry = any(
            p.suggested_type.value == "cash_carry"
            and any("a" in leg.position_ids for leg in p.proposed_legs)
            for p in proposals
        )
        assert a_in_cash_carry
