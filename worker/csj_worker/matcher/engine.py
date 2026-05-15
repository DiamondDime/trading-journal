"""Matcher engine — orchestrates rules, deduplicates by position.

A position can participate in at most one spread (enforced at DB level via
`uq_position_in_one_spread`). When multiple rules propose competing spreads
involving the same position, we keep the highest-confidence proposal.
"""

from __future__ import annotations

from csj_worker.matcher.config import MatcherConfig
from csj_worker.matcher.models import MatcherPosition, SpreadProposal
from csj_worker.matcher.rules import ALL_RULES


def match_spreads(
    positions: list[MatcherPosition],
    config: MatcherConfig | None = None,
) -> list[SpreadProposal]:
    """Run all rules over positions, return deduplicated proposals."""
    cfg = config or MatcherConfig()

    all_proposals: list[SpreadProposal] = []
    for rule in ALL_RULES:
        all_proposals.extend(rule(positions, cfg))

    # Sort by confidence desc; first-seen wins for each position
    all_proposals.sort(key=lambda p: -p.match_confidence)

    claimed_positions: set[str] = set()
    deduplicated: list[SpreadProposal] = []

    for proposal in all_proposals:
        position_ids = {pid for leg in proposal.proposed_legs for pid in leg.position_ids}
        if position_ids & claimed_positions:
            continue
        claimed_positions |= position_ids
        deduplicated.append(proposal)

    return deduplicated
