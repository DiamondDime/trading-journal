"""Matcher I/O models.

`MatcherPosition` is a position subset with only fields the matcher needs —
keeps test fixtures small and decouples matcher from full DB schema.

`SpreadProposal` is the matcher's output, written to `spread_candidates` table.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from csj_worker.types import (
    CanonicalInstrument,
    Exchange,
    ExchangeKind,
    PositionSide,
    PositionStatus,
    SpreadType,
)


class MatcherPosition(BaseModel):
    """Position projection — only fields the matcher needs."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    position_id: str
    user_id: str
    connection_id: str
    exchange: Exchange
    exchange_kind: ExchangeKind
    instrument: CanonicalInstrument
    side: PositionSide
    qty_total: Decimal
    avg_entry_price: Decimal
    opened_at: datetime
    closed_at: datetime | None = None
    status: PositionStatus = PositionStatus.OPEN

    # Optional context for funding-capture rule
    funding_pnl_quote: Decimal = Decimal(0)
    hold_duration_seconds: int = 0

    @property
    def notional(self) -> Decimal:
        return self.qty_total * self.avg_entry_price


class ProposedLeg(BaseModel):
    """One leg of a matcher-proposed spread (mirrors SpreadCandidate.proposed_legs[])."""

    model_config = ConfigDict(extra="forbid")

    connection_id: str
    instrument: CanonicalInstrument
    side: PositionSide
    position_ids: list[str]
    qty_total: Decimal
    avg_entry_price: Decimal
    opened_at: datetime


class SpreadProposal(BaseModel):
    """Matcher output. Becomes a `spread_candidates` row when persisted."""

    model_config = ConfigDict(extra="forbid")

    user_id: str
    suggested_type: SpreadType
    match_confidence: float = Field(ge=0.0, le=1.0)
    match_reasons: list[str]
    proposed_legs: list[ProposedLeg]
    primary_base: str
    earliest_fill_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)
