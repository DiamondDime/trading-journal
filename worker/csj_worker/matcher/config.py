"""Matcher tuning. Defaults documented in architecture spec."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class MatcherConfig:
    """Thresholds for the matcher rules.

    All tunable; sensible defaults documented in architecture spec.
    """

    # Cross-exchange perp arb
    cross_exchange_window_seconds: int = 60
    cross_exchange_qty_tolerance_pct: Decimal = Decimal("0.05")  # ±5%

    # Cash-and-carry
    cash_carry_window_seconds: int = 300  # ±5 min
    cash_carry_qty_tolerance_pct: Decimal = Decimal("0.02")  # ±2%

    # Calendar
    calendar_window_seconds: int = 600
    calendar_qty_tolerance_pct: Decimal = Decimal("0.02")

    # DEX/CEX arb
    dex_cex_window_seconds: int = 300
    dex_cex_qty_tolerance_pct: Decimal = Decimal("0.05")

    # Funding capture (different rule shape)
    funding_capture_min_hold_hours: int = 24
    funding_capture_min_annualized_pct: Decimal = Decimal("0.05")  # 5% APR

    # Confidence scoring weights
    weight_time_proximity: float = 0.35
    weight_qty_match: float = 0.30
    weight_exchange_diversity: float = 0.15
    weight_notional_similarity: float = 0.20
