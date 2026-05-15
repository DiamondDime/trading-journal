"""Leg matcher — auto-detects spreads from positions."""

from csj_worker.matcher.config import MatcherConfig
from csj_worker.matcher.engine import match_spreads
from csj_worker.matcher.models import MatcherPosition, ProposedLeg, SpreadProposal

__all__ = [
    "MatcherConfig",
    "MatcherPosition",
    "ProposedLeg",
    "SpreadProposal",
    "match_spreads",
]
