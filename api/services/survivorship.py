"""Deterministic survivorship rule engine.

Applies survivorship_rules to pick field-level winners from multiple source systems.
Called by golden_record_engine.py BEFORE ai_survivorship.py fallback.

Rule types:
  - most_recent: take value from source with latest extracted_at
  - most_complete: take value from source with fewest null fields
  - trusted_source: prefer values from highest-ranked system in trusted_sources list
  - manual_override: keep current golden value (skip automation)
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

logger = logging.getLogger("meridian.survivorship")


@dataclass
class FieldContribution:
    """A single source system's contribution for one field."""
    value: object
    source_system: str
    extracted_at: datetime
    confidence: float = 1.0


@dataclass
class SurvivorshipResult:
    """The winning value for a field after survivorship evaluation."""
    value: object
    source_system: str
    rule_type: str
    confidence: float


def apply_most_recent(
    contributions: list[FieldContribution],
) -> Optional[SurvivorshipResult]:
    """Pick the value from the source with the latest extracted_at timestamp."""
    if not contributions:
        return None

    # Filter out None values
    valid = [c for c in contributions if c.value is not None]
    if not valid:
        return None

    winner = max(valid, key=lambda c: c.extracted_at)
    return SurvivorshipResult(
        value=winner.value,
        source_system=winner.source_system,
        rule_type="most_recent",
        confidence=winner.confidence,
    )


def apply_most_complete(
    contributions: list[FieldContribution],
    all_field_contributions: dict[str, list[FieldContribution]] | None = None,
) -> Optional[SurvivorshipResult]:
    """Pick the value from the source system with fewest null fields overall.

    If all_field_contributions is provided, counts nulls across all fields per
    source system. Otherwise falls back to most_recent among non-null values.
    """
    if not contributions:
        return None

    valid = [c for c in contributions if c.value is not None]
    if not valid:
        return None

    if not all_field_contributions:
        # Fallback: just pick any non-null, prefer most recent
        winner = max(valid, key=lambda c: c.extracted_at)
        return SurvivorshipResult(
            value=winner.value,
            source_system=winner.source_system,
            rule_type="most_complete",
            confidence=winner.confidence,
        )

    # Count nulls per source system across all fields
    null_counts: dict[str, int] = {}
    for field_contribs in all_field_contributions.values():
        for c in field_contribs:
            if c.source_system not in null_counts:
                null_counts[c.source_system] = 0
            if c.value is None:
                null_counts[c.source_system] += 1

    # Among valid contributions, prefer the source with fewest nulls
    valid_sources = {c.source_system for c in valid}
    ranked = sorted(
        valid_sources,
        key=lambda s: null_counts.get(s, 0),
    )

    if not ranked:
        return None

    best_source = ranked[0]
    winner = next(c for c in valid if c.source_system == best_source)
    return SurvivorshipResult(
        value=winner.value,
        source_system=winner.source_system,
        rule_type="most_complete",
        confidence=winner.confidence,
    )


def apply_trusted_source(
    contributions: list[FieldContribution],
    trusted_sources: list[str],
) -> Optional[SurvivorshipResult]:
    """Pick the value from the highest-ranked system in the trusted_sources list."""
    if not contributions or not trusted_sources:
        return None

    valid = [c for c in contributions if c.value is not None]
    if not valid:
        return None

    # Build lookup: source_system -> contribution
    by_source = {c.source_system: c for c in valid}

    for source in trusted_sources:
        if source in by_source:
            winner = by_source[source]
            return SurvivorshipResult(
                value=winner.value,
                source_system=winner.source_system,
                rule_type="trusted_source",
                confidence=winner.confidence,
            )

    # None of the trusted sources have a value — no winner
    return None


def evaluate_field(
    field_name: str,
    contributions: list[FieldContribution],
    rule_type: str,
    trusted_sources: list[str] | None = None,
    all_field_contributions: dict[str, list[FieldContribution]] | None = None,
) -> Optional[SurvivorshipResult]:
    """Evaluate a single field using the specified survivorship rule.

    Returns None if no deterministic winner can be found (triggers AI fallback).
    """
    if rule_type == "manual_override":
        # Manual override means keep current value — return None to skip automation
        return None

    if rule_type == "most_recent":
        return apply_most_recent(contributions)

    if rule_type == "most_complete":
        return apply_most_complete(contributions, all_field_contributions)

    if rule_type == "trusted_source":
        if not trusted_sources:
            logger.warning(
                f"trusted_source rule for field '{field_name}' has no trusted_sources list — "
                "falling back to most_recent"
            )
            return apply_most_recent(contributions)
        return apply_trusted_source(contributions, trusted_sources)

    logger.warning(f"Unknown rule_type '{rule_type}' for field '{field_name}' — skipping")
    return None
