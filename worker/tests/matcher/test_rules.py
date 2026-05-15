"""Leg matcher rule tests — TDD coverage of all 5 rules."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from csj_worker.matcher.config import MatcherConfig
from csj_worker.matcher.models import MatcherPosition
from csj_worker.matcher.rules import (
    match_calendar,
    match_cash_carry,
    match_cross_exchange_perp_arb,
    match_dex_cex_arb,
    match_funding_capture,
)
from csj_worker.types import (
    CanonicalInstrument,
    Exchange,
    ExchangeKind,
    InstrumentKind,
    PositionSide,
    PositionStatus,
)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _pos(
    *,
    pid: str = "p1",
    exchange: Exchange = Exchange.BINANCE,
    exchange_kind: ExchangeKind = ExchangeKind.CEX,
    base: str = "BTC",
    kind: InstrumentKind = InstrumentKind.PERP,
    side: PositionSide = PositionSide.LONG,
    qty: str = "1.0",
    price: str = "67000.0",
    opened: datetime | None = None,
    expiry: datetime | None = None,
    funding_pnl: str = "0",
    hold_seconds: int = 0,
    connection_id: str | None = None,
) -> MatcherPosition:
    return MatcherPosition(
        position_id=pid,
        user_id="user1",
        connection_id=connection_id or f"conn-{exchange.value}",
        exchange=exchange,
        exchange_kind=exchange_kind,
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
        avg_entry_price=Decimal(price),
        opened_at=opened or datetime(2026, 5, 15, 14, 23, 0, tzinfo=timezone.utc),
        status=PositionStatus.OPEN,
        funding_pnl_quote=Decimal(funding_pnl),
        hold_duration_seconds=hold_seconds,
    )


CFG = MatcherConfig()


# ---------------------------------------------------------------------------
# Cross-Exchange Perp Arb
# ---------------------------------------------------------------------------


class TestCrossExchangePerpArb:
    def test_matches_opposite_sides_on_different_exchanges_within_window(self) -> None:
        a = _pos(pid="a", exchange=Exchange.BINANCE, side=PositionSide.LONG, qty="5.0")
        b = _pos(
            pid="b",
            exchange=Exchange.BYBIT,
            side=PositionSide.SHORT,
            qty="5.0",
            opened=a.opened_at + timedelta(seconds=30),
        )
        proposals = match_cross_exchange_perp_arb([a, b], CFG)
        assert len(proposals) == 1
        assert proposals[0].match_confidence > 0.7

    def test_rejects_same_side(self) -> None:
        a = _pos(pid="a", exchange=Exchange.BINANCE, side=PositionSide.LONG)
        b = _pos(pid="b", exchange=Exchange.BYBIT, side=PositionSide.LONG)
        assert match_cross_exchange_perp_arb([a, b], CFG) == []

    def test_rejects_same_exchange(self) -> None:
        a = _pos(pid="a", exchange=Exchange.BINANCE, side=PositionSide.LONG)
        b = _pos(pid="b", exchange=Exchange.BINANCE, side=PositionSide.SHORT)
        assert match_cross_exchange_perp_arb([a, b], CFG) == []

    def test_rejects_different_base(self) -> None:
        a = _pos(pid="a", exchange=Exchange.BINANCE, base="BTC", side=PositionSide.LONG)
        b = _pos(pid="b", exchange=Exchange.BYBIT, base="ETH", side=PositionSide.SHORT)
        assert match_cross_exchange_perp_arb([a, b], CFG) == []

    def test_rejects_outside_window(self) -> None:
        a = _pos(pid="a", exchange=Exchange.BINANCE, side=PositionSide.LONG)
        b = _pos(
            pid="b",
            exchange=Exchange.BYBIT,
            side=PositionSide.SHORT,
            opened=a.opened_at + timedelta(seconds=120),  # > 60s default
        )
        assert match_cross_exchange_perp_arb([a, b], CFG) == []

    def test_rejects_qty_mismatch_outside_tolerance(self) -> None:
        a = _pos(pid="a", exchange=Exchange.BINANCE, side=PositionSide.LONG, qty="5.0")
        b = _pos(
            pid="b",
            exchange=Exchange.BYBIT,
            side=PositionSide.SHORT,
            qty="6.0",  # 20% bigger — outside 5% tolerance
            opened=a.opened_at + timedelta(seconds=10),
        )
        assert match_cross_exchange_perp_arb([a, b], CFG) == []

    def test_accepts_qty_within_tolerance(self) -> None:
        a = _pos(pid="a", exchange=Exchange.BINANCE, side=PositionSide.LONG, qty="5.0")
        b = _pos(
            pid="b",
            exchange=Exchange.BYBIT,
            side=PositionSide.SHORT,
            qty="5.2",  # 4% — within 5% tolerance
            opened=a.opened_at + timedelta(seconds=10),
        )
        proposals = match_cross_exchange_perp_arb([a, b], CFG)
        assert len(proposals) == 1

    def test_rejects_non_perp_instruments(self) -> None:
        a = _pos(pid="a", exchange=Exchange.BINANCE, kind=InstrumentKind.SPOT, side=PositionSide.LONG)
        b = _pos(pid="b", exchange=Exchange.BYBIT, kind=InstrumentKind.SPOT, side=PositionSide.SHORT)
        assert match_cross_exchange_perp_arb([a, b], CFG) == []


# ---------------------------------------------------------------------------
# Cash-and-Carry
# ---------------------------------------------------------------------------


class TestCashCarry:
    def test_matches_long_spot_short_perp(self) -> None:
        spot = _pos(pid="s", kind=InstrumentKind.SPOT, side=PositionSide.LONG)
        perp = _pos(
            pid="p",
            kind=InstrumentKind.PERP,
            side=PositionSide.SHORT,
            opened=spot.opened_at + timedelta(minutes=2),
        )
        proposals = match_cash_carry([spot, perp], CFG)
        assert len(proposals) == 1

    def test_matches_short_spot_long_perp_reverse_basis(self) -> None:
        spot = _pos(pid="s", kind=InstrumentKind.SPOT, side=PositionSide.SHORT)
        perp = _pos(
            pid="p",
            kind=InstrumentKind.PERP,
            side=PositionSide.LONG,
            opened=spot.opened_at + timedelta(minutes=2),
        )
        proposals = match_cash_carry([spot, perp], CFG)
        assert len(proposals) == 1

    def test_rejects_same_side(self) -> None:
        spot = _pos(pid="s", kind=InstrumentKind.SPOT, side=PositionSide.LONG)
        perp = _pos(pid="p", kind=InstrumentKind.PERP, side=PositionSide.LONG)
        assert match_cash_carry([spot, perp], CFG) == []

    def test_rejects_outside_window(self) -> None:
        spot = _pos(pid="s", kind=InstrumentKind.SPOT, side=PositionSide.LONG)
        perp = _pos(
            pid="p",
            kind=InstrumentKind.PERP,
            side=PositionSide.SHORT,
            opened=spot.opened_at + timedelta(minutes=10),  # > 5min default
        )
        assert match_cash_carry([spot, perp], CFG) == []


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------


class TestCalendar:
    def test_matches_different_expiries_opposite_sides(self) -> None:
        near = _pos(
            pid="near",
            exchange=Exchange.DERIBIT,
            kind=InstrumentKind.DATED_FUTURE,
            side=PositionSide.LONG,
            expiry=datetime(2026, 6, 27, tzinfo=timezone.utc),
        )
        far = _pos(
            pid="far",
            exchange=Exchange.DERIBIT,
            kind=InstrumentKind.DATED_FUTURE,
            side=PositionSide.SHORT,
            expiry=datetime(2026, 9, 27, tzinfo=timezone.utc),
            opened=near.opened_at + timedelta(seconds=30),
        )
        proposals = match_calendar([near, far], CFG)
        assert len(proposals) == 1

    def test_rejects_same_expiry(self) -> None:
        expiry = datetime(2026, 6, 27, tzinfo=timezone.utc)
        a = _pos(
            pid="a", kind=InstrumentKind.DATED_FUTURE, side=PositionSide.LONG, expiry=expiry
        )
        b = _pos(
            pid="b", kind=InstrumentKind.DATED_FUTURE, side=PositionSide.SHORT, expiry=expiry
        )
        assert match_calendar([a, b], CFG) == []

    def test_rejects_when_no_expiry(self) -> None:
        a = _pos(pid="a", kind=InstrumentKind.DATED_FUTURE, side=PositionSide.LONG, expiry=None)
        b = _pos(
            pid="b",
            kind=InstrumentKind.DATED_FUTURE,
            side=PositionSide.SHORT,
            expiry=datetime(2026, 9, 27, tzinfo=timezone.utc),
        )
        assert match_calendar([a, b], CFG) == []


# ---------------------------------------------------------------------------
# DEX/CEX Arb
# ---------------------------------------------------------------------------


class TestDexCexArb:
    def test_matches_hyperliquid_vs_binance(self) -> None:
        cex = _pos(
            pid="cex",
            exchange=Exchange.BINANCE,
            exchange_kind=ExchangeKind.CEX,
            side=PositionSide.LONG,
        )
        dex = _pos(
            pid="dex",
            exchange=Exchange.HYPERLIQUID,
            exchange_kind=ExchangeKind.DEX,
            side=PositionSide.SHORT,
            opened=cex.opened_at + timedelta(minutes=1),
        )
        proposals = match_dex_cex_arb([cex, dex], CFG)
        assert len(proposals) == 1

    def test_rejects_two_cex(self) -> None:
        a = _pos(pid="a", exchange=Exchange.BINANCE, exchange_kind=ExchangeKind.CEX, side=PositionSide.LONG)
        b = _pos(pid="b", exchange=Exchange.BYBIT, exchange_kind=ExchangeKind.CEX, side=PositionSide.SHORT)
        assert match_dex_cex_arb([a, b], CFG) == []

    def test_rejects_two_dex(self) -> None:
        a = _pos(pid="a", exchange=Exchange.HYPERLIQUID, exchange_kind=ExchangeKind.DEX, side=PositionSide.LONG)
        b = _pos(pid="b", exchange=Exchange.ASTER, exchange_kind=ExchangeKind.DEX, side=PositionSide.SHORT)
        assert match_dex_cex_arb([a, b], CFG) == []


# ---------------------------------------------------------------------------
# Funding Capture
# ---------------------------------------------------------------------------


class TestFundingCapture:
    def test_matches_long_held_with_significant_funding(self) -> None:
        # 7 days, $200 funding on $10K notional = ~10% annualized
        p = _pos(
            pid="fc",
            kind=InstrumentKind.PERP,
            qty="0.5",
            price="20000",  # notional $10K
            funding_pnl="200",
            hold_seconds=7 * 86400,
        )
        proposals = match_funding_capture([p], CFG)
        assert len(proposals) == 1
        assert proposals[0].match_confidence > 0

    def test_rejects_short_hold(self) -> None:
        p = _pos(
            pid="short",
            kind=InstrumentKind.PERP,
            funding_pnl="100",
            hold_seconds=3600,  # 1 hour
        )
        assert match_funding_capture([p], CFG) == []

    def test_rejects_low_annualized_funding(self) -> None:
        # $40 funding on $100K notional over 7 days = 2.08% annualized → below 5% threshold
        p = _pos(
            pid="low",
            kind=InstrumentKind.PERP,
            qty="1.0",
            price="100000",  # notional $100K
            funding_pnl="40",
            hold_seconds=7 * 86400,
        )
        assert match_funding_capture([p], CFG) == []

    def test_rejects_non_perp(self) -> None:
        p = _pos(
            pid="spot",
            kind=InstrumentKind.SPOT,
            funding_pnl="500",
            hold_seconds=30 * 86400,
        )
        assert match_funding_capture([p], CFG) == []


# ---------------------------------------------------------------------------
# Confidence scoring
# ---------------------------------------------------------------------------


class TestConfidenceScoring:
    def test_higher_confidence_for_closer_in_time(self) -> None:
        far_a = _pos(pid="a1", exchange=Exchange.BINANCE, side=PositionSide.LONG)
        far_b = _pos(
            pid="b1",
            exchange=Exchange.BYBIT,
            side=PositionSide.SHORT,
            opened=far_a.opened_at + timedelta(seconds=55),  # near edge
        )
        close_a = _pos(pid="a2", exchange=Exchange.BINANCE, side=PositionSide.LONG)
        close_b = _pos(
            pid="b2",
            exchange=Exchange.BYBIT,
            side=PositionSide.SHORT,
            opened=close_a.opened_at + timedelta(seconds=2),
        )

        far_proposals = match_cross_exchange_perp_arb([far_a, far_b], CFG)
        close_proposals = match_cross_exchange_perp_arb([close_a, close_b], CFG)

        assert close_proposals[0].match_confidence > far_proposals[0].match_confidence

    def test_confidence_bounded_zero_to_one(self) -> None:
        a = _pos(pid="a", exchange=Exchange.BINANCE, side=PositionSide.LONG, qty="5.0")
        b = _pos(
            pid="b",
            exchange=Exchange.BYBIT,
            side=PositionSide.SHORT,
            qty="5.0",
            opened=a.opened_at,
        )
        proposals = match_cross_exchange_perp_arb([a, b], CFG)
        assert 0.0 <= proposals[0].match_confidence <= 1.0
