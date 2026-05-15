"""Per-spread-type matching rules.

Each rule scans positions and yields candidate proposals. Rules are independent
and order-independent; the engine deduplicates positions across proposals.
"""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal
from typing import Callable

from csj_worker.matcher.config import MatcherConfig
from csj_worker.matcher.models import (
    MatcherPosition,
    ProposedLeg,
    SpreadProposal,
)
from csj_worker.types import (
    ExchangeKind,
    InstrumentKind,
    PositionSide,
    SpreadType,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _within_window(a: MatcherPosition, b: MatcherPosition, seconds: int) -> bool:
    delta = abs((a.opened_at - b.opened_at).total_seconds())
    return delta <= seconds


def _qty_match(a: MatcherPosition, b: MatcherPosition, tolerance_pct: Decimal) -> bool:
    if a.qty_total == 0 or b.qty_total == 0:
        return False
    diff = abs(a.qty_total - b.qty_total)
    larger = max(a.qty_total, b.qty_total)
    return (diff / larger) <= tolerance_pct


def _opposite_sides(a: MatcherPosition, b: MatcherPosition) -> bool:
    return (a.side == PositionSide.LONG and b.side == PositionSide.SHORT) or (
        a.side == PositionSide.SHORT and b.side == PositionSide.LONG
    )


def _same_base(a: MatcherPosition, b: MatcherPosition) -> bool:
    return a.instrument.base == b.instrument.base


def _make_leg(p: MatcherPosition) -> ProposedLeg:
    return ProposedLeg(
        connection_id=p.connection_id,
        instrument=p.instrument,
        side=p.side,
        position_ids=[p.position_id],
        qty_total=p.qty_total,
        avg_entry_price=p.avg_entry_price,
        opened_at=p.opened_at,
    )


def _confidence_time_proximity(
    a: MatcherPosition, b: MatcherPosition, window_seconds: int
) -> float:
    delta = abs((a.opened_at - b.opened_at).total_seconds())
    if window_seconds <= 0:
        return 1.0
    return max(0.0, 1.0 - (delta / window_seconds))


def _confidence_qty_match(
    a: MatcherPosition, b: MatcherPosition, tolerance_pct: Decimal
) -> float:
    if a.qty_total == 0 or b.qty_total == 0 or tolerance_pct == 0:
        return 0.0
    diff = abs(a.qty_total - b.qty_total)
    larger = max(a.qty_total, b.qty_total)
    pct_diff = diff / larger
    if pct_diff > tolerance_pct:
        return 0.0
    return float(1 - (pct_diff / tolerance_pct))


def _confidence_notional_similarity(a: MatcherPosition, b: MatcherPosition) -> float:
    na, nb = a.notional, b.notional
    if na == 0 or nb == 0:
        return 0.0
    ratio = min(na, nb) / max(na, nb)
    return float(ratio)


def _compute_confidence(
    cfg: MatcherConfig,
    time_score: float,
    qty_score: float,
    exchange_diversity_score: float,
    notional_score: float,
) -> float:
    return (
        cfg.weight_time_proximity * time_score
        + cfg.weight_qty_match * qty_score
        + cfg.weight_exchange_diversity * exchange_diversity_score
        + cfg.weight_notional_similarity * notional_score
    )


# ---------------------------------------------------------------------------
# Rule: Cross-Exchange Perp Arb
# ---------------------------------------------------------------------------


def match_cross_exchange_perp_arb(
    positions: list[MatcherPosition], cfg: MatcherConfig
) -> list[SpreadProposal]:
    """Long perp on Exchange A + short perp on Exchange B, same coin, close in time."""
    perps = [p for p in positions if p.instrument.kind == InstrumentKind.PERP]
    out: list[SpreadProposal] = []

    for i, a in enumerate(perps):
        for b in perps[i + 1 :]:
            if a.connection_id == b.connection_id:
                continue
            if a.exchange == b.exchange:
                continue
            if not _same_base(a, b):
                continue
            if not _opposite_sides(a, b):
                continue
            if not _within_window(a, b, cfg.cross_exchange_window_seconds):
                continue
            if not _qty_match(a, b, cfg.cross_exchange_qty_tolerance_pct):
                continue

            time_score = _confidence_time_proximity(a, b, cfg.cross_exchange_window_seconds)
            qty_score = _confidence_qty_match(a, b, cfg.cross_exchange_qty_tolerance_pct)
            diversity_score = 1.0  # different exchanges by construction
            notional_score = _confidence_notional_similarity(a, b)

            confidence = _compute_confidence(
                cfg, time_score, qty_score, diversity_score, notional_score
            )

            reasons = [
                f"opposite-side perps on same base {a.instrument.base}",
                f"different exchanges: {a.exchange.value} vs {b.exchange.value}",
                f"opened within {abs((a.opened_at - b.opened_at).total_seconds()):.0f}s",
                f"qty within tolerance: {a.qty_total} vs {b.qty_total}",
            ]

            out.append(
                SpreadProposal(
                    user_id=a.user_id,
                    suggested_type=SpreadType.CROSS_EXCHANGE_PERP_ARB,
                    match_confidence=confidence,
                    match_reasons=reasons,
                    proposed_legs=[_make_leg(a), _make_leg(b)],
                    primary_base=a.instrument.base,
                    earliest_fill_at=min(a.opened_at, b.opened_at),
                )
            )

    return out


# ---------------------------------------------------------------------------
# Rule: Cash-and-Carry (long spot + short perp, or reverse)
# ---------------------------------------------------------------------------


def match_cash_carry(
    positions: list[MatcherPosition], cfg: MatcherConfig
) -> list[SpreadProposal]:
    spots = [p for p in positions if p.instrument.kind == InstrumentKind.SPOT]
    perps = [p for p in positions if p.instrument.kind == InstrumentKind.PERP]
    out: list[SpreadProposal] = []

    for s in spots:
        for p in perps:
            if not _same_base(s, p):
                continue
            if not _opposite_sides(s, p):
                continue
            if not _within_window(s, p, cfg.cash_carry_window_seconds):
                continue
            if not _qty_match(s, p, cfg.cash_carry_qty_tolerance_pct):
                continue

            time_score = _confidence_time_proximity(s, p, cfg.cash_carry_window_seconds)
            qty_score = _confidence_qty_match(s, p, cfg.cash_carry_qty_tolerance_pct)
            diversity_score = 1.0 if s.connection_id != p.connection_id else 0.7
            notional_score = _confidence_notional_similarity(s, p)
            confidence = _compute_confidence(
                cfg, time_score, qty_score, diversity_score, notional_score
            )

            reasons = [
                f"spot + perp on same base {s.instrument.base}",
                "opposite sides",
                f"opened within {abs((s.opened_at - p.opened_at).total_seconds()):.0f}s",
            ]
            out.append(
                SpreadProposal(
                    user_id=s.user_id,
                    suggested_type=SpreadType.CASH_CARRY,
                    match_confidence=confidence,
                    match_reasons=reasons,
                    proposed_legs=[_make_leg(s), _make_leg(p)],
                    primary_base=s.instrument.base,
                    earliest_fill_at=min(s.opened_at, p.opened_at),
                )
            )
    return out


# ---------------------------------------------------------------------------
# Rule: Calendar (two dated futures, different expiries)
# ---------------------------------------------------------------------------


def match_calendar(
    positions: list[MatcherPosition], cfg: MatcherConfig
) -> list[SpreadProposal]:
    futures = [p for p in positions if p.instrument.kind == InstrumentKind.DATED_FUTURE]
    out: list[SpreadProposal] = []

    for i, a in enumerate(futures):
        for b in futures[i + 1 :]:
            if not _same_base(a, b):
                continue
            if a.instrument.expiry == b.instrument.expiry:
                continue  # same expiry isn't a calendar
            if a.instrument.expiry is None or b.instrument.expiry is None:
                continue
            if not _opposite_sides(a, b):
                continue
            if not _within_window(a, b, cfg.calendar_window_seconds):
                continue
            if not _qty_match(a, b, cfg.calendar_qty_tolerance_pct):
                continue

            time_score = _confidence_time_proximity(a, b, cfg.calendar_window_seconds)
            qty_score = _confidence_qty_match(a, b, cfg.calendar_qty_tolerance_pct)
            diversity_score = 0.5  # typically same venue
            notional_score = _confidence_notional_similarity(a, b)
            confidence = _compute_confidence(
                cfg, time_score, qty_score, diversity_score, notional_score
            )

            reasons = [
                f"calendar pair on {a.instrument.base}",
                f"expiries: {a.instrument.expiry.isoformat()} vs {b.instrument.expiry.isoformat()}",
                "opposite sides",
            ]
            out.append(
                SpreadProposal(
                    user_id=a.user_id,
                    suggested_type=SpreadType.CALENDAR,
                    match_confidence=confidence,
                    match_reasons=reasons,
                    proposed_legs=[_make_leg(a), _make_leg(b)],
                    primary_base=a.instrument.base,
                    earliest_fill_at=min(a.opened_at, b.opened_at),
                )
            )
    return out


# ---------------------------------------------------------------------------
# Rule: DEX/CEX Arb
# ---------------------------------------------------------------------------


def match_dex_cex_arb(
    positions: list[MatcherPosition], cfg: MatcherConfig
) -> list[SpreadProposal]:
    perps = [p for p in positions if p.instrument.kind == InstrumentKind.PERP]
    out: list[SpreadProposal] = []

    for i, a in enumerate(perps):
        for b in perps[i + 1 :]:
            if not _same_base(a, b):
                continue
            if not _opposite_sides(a, b):
                continue
            # One must be CEX, the other DEX
            kinds = {a.exchange_kind, b.exchange_kind}
            if kinds != {ExchangeKind.CEX, ExchangeKind.DEX}:
                continue
            if not _within_window(a, b, cfg.dex_cex_window_seconds):
                continue
            if not _qty_match(a, b, cfg.dex_cex_qty_tolerance_pct):
                continue

            time_score = _confidence_time_proximity(a, b, cfg.dex_cex_window_seconds)
            qty_score = _confidence_qty_match(a, b, cfg.dex_cex_qty_tolerance_pct)
            diversity_score = 1.0  # CEX + DEX by construction
            notional_score = _confidence_notional_similarity(a, b)
            confidence = _compute_confidence(
                cfg, time_score, qty_score, diversity_score, notional_score
            )

            reasons = [
                f"DEX/CEX pair on {a.instrument.base}",
                f"{a.exchange.value} ({a.exchange_kind.value}) vs {b.exchange.value} ({b.exchange_kind.value})",
                "opposite sides",
            ]
            out.append(
                SpreadProposal(
                    user_id=a.user_id,
                    suggested_type=SpreadType.DEX_CEX_ARB,
                    match_confidence=confidence,
                    match_reasons=reasons,
                    proposed_legs=[_make_leg(a), _make_leg(b)],
                    primary_base=a.instrument.base,
                    earliest_fill_at=min(a.opened_at, b.opened_at),
                )
            )
    return out


# ---------------------------------------------------------------------------
# Rule: Funding Capture (single position held > 24h with significant funding)
# ---------------------------------------------------------------------------


def match_funding_capture(
    positions: list[MatcherPosition], cfg: MatcherConfig
) -> list[SpreadProposal]:
    out: list[SpreadProposal] = []
    min_hold_seconds = cfg.funding_capture_min_hold_hours * 3600

    for p in positions:
        if p.instrument.kind != InstrumentKind.PERP:
            continue
        if p.hold_duration_seconds < min_hold_seconds:
            continue
        if p.notional == 0:
            continue

        # Annualized funding rate proxy: funding_pnl / notional / (hold_days/365)
        hold_days = Decimal(p.hold_duration_seconds) / Decimal(86400)
        if hold_days == 0:
            continue
        annualized = (p.funding_pnl_quote / p.notional) * (Decimal(365) / hold_days)

        if abs(annualized) < cfg.funding_capture_min_annualized_pct:
            continue

        # Confidence: based on annualized rate magnitude (higher = more obvious capture)
        confidence = min(
            1.0,
            float(abs(annualized) / cfg.funding_capture_min_annualized_pct) * 0.4,
        )

        reasons = [
            f"single perp position held {hold_days:.1f}d on {p.instrument.base}",
            f"annualized funding: {annualized * 100:.2f}%",
        ]
        out.append(
            SpreadProposal(
                user_id=p.user_id,
                suggested_type=SpreadType.FUNDING_CAPTURE,
                match_confidence=confidence,
                match_reasons=reasons,
                proposed_legs=[_make_leg(p)],
                primary_base=p.instrument.base,
                earliest_fill_at=p.opened_at,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Registry — order matters only for deduplication preference
# ---------------------------------------------------------------------------

RuleFn = Callable[[list[MatcherPosition], MatcherConfig], list[SpreadProposal]]

ALL_RULES: list[RuleFn] = [
    match_cross_exchange_perp_arb,
    match_cash_carry,
    match_calendar,
    match_dex_cex_arb,
    match_funding_capture,
]
