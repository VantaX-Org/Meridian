"""Deterministic survivorship rule engine.

Applies survivorship_rules to pick field-level winners from multiple source systems.
Called by golden_record_engine.py BEFORE ai_survivorship.py fallback.

Rule types (in order of specificity):
  - manual_override: keep current golden value (skip automation)
  - trusted_source: prefer values from highest-ranked system in trusted_sources list
  - canonical:      canonicalise all contenders; winner is the one already in
                    canonical form (ISO country, currency, UoM, E.164 phone, ...)
  - format_valid:   drop values that fail field-type validation, then most-recent
  - longest_non_null: pick the longest non-empty value (description/name/address)
  - most_complete:  pick the source with fewest null fields overall
  - most_recent:    take value from source with latest extracted_at
  - most_frequent:  take the value most sources agree on (None on a tie)

A default `SurvivorshipChain` walks the first five deterministic rules in order
and returns the first non-None result. Call `SurvivorshipChain.evaluate()` and
only fall back to the LLM when it returns None — that is the primary LLM-avoidance
point at 400k-record scale.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Optional, Sequence, Union

from sap.deterministic import (
    FieldType,
    canonical_country,
    canonical_currency,
    canonical_email,
    canonical_phone,
    canonical_uom,
    classify_field,
)
from sap.deterministic.normalize import (
    canonical_amount,
    canonical_date_iso,
)

logger = logging.getLogger("meridian.survivorship")


@dataclass
class FieldContribution:
    """A single source system's contribution for one field."""
    value: object
    source_system: str
    extracted_at: datetime
    confidence: float = 1.0
    # The connected SAP system (sap_systems.id / .name) the value came from, when known. ``source_system``
    # is the provenance label (``upload:<version>``, ``merge:<key>``, a legacy name), which a trusted
    # system rule also matches for rules written before values carried their system.
    system_id: Optional[str] = None
    system_name: Optional[str] = None


@dataclass
class SurvivorshipResult:
    """The winning value for a field after survivorship evaluation."""
    value: object
    source_system: str
    rule_type: str
    confidence: float
    system_id: Optional[str] = None
    system_name: Optional[str] = None


def _result(winner: FieldContribution, rule_type: str, confidence: Optional[float] = None) -> SurvivorshipResult:
    return SurvivorshipResult(
        value=winner.value,
        source_system=winner.source_system,
        rule_type=rule_type,
        confidence=winner.confidence if confidence is None else confidence,
        system_id=winner.system_id,
        system_name=winner.system_name,
    )


# One rank of a trusted_sources list: a system as the rule stores it (its name), or every alias of
# one system (id, current name, stored entry) as golden_record_engine._load_survivorship_rules resolves it.
TrustedSource = Union[str, Sequence[str]]


def aliases_of(source: TrustedSource) -> tuple[str, ...]:
    return (source,) if isinstance(source, str) else tuple(source)


def matches_source(c: FieldContribution, source: TrustedSource) -> bool:
    """Whether a trusted_sources rank names this contribution's system: its id, its name or its label."""
    tags = {t for t in (c.system_id, c.system_name, c.source_system) if t}
    return any(a in tags for a in aliases_of(source))


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
    return _result(winner, "most_recent")


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
        return _result(winner, "most_complete")

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
    return _result(winner, "most_complete")


def apply_most_frequent(
    contributions: list[FieldContribution],
) -> Optional[SurvivorshipResult]:
    """Pick the value most sources agree on (trimmed, case-insensitive).

    Returns None on a tie for first place so a later rule decides.
    """
    valid = [c for c in contributions if c.value is not None and str(c.value).strip()]
    if not valid:
        return None
    counts: dict[str, int] = {}
    for c in valid:
        k = str(c.value).strip().lower()
        counts[k] = counts.get(k, 0) + 1
    ranked = sorted(counts.values(), reverse=True)
    if len(ranked) > 1 and ranked[0] == ranked[1]:
        return None
    top = max(counts, key=counts.__getitem__)
    winner = next(c for c in valid if str(c.value).strip().lower() == top)
    return _result(winner, "most_frequent")


def apply_trusted_source(
    contributions: list[FieldContribution],
    trusted_sources: Sequence[TrustedSource],
) -> Optional[SurvivorshipResult]:
    """Pick the value from the highest-ranked system in the trusted_sources list.

    A rank matches a contribution's source system id, its system name or its provenance label.
    """
    if not contributions or not trusted_sources:
        return None

    valid = [c for c in contributions if c.value is not None]
    if not valid:
        return None

    for source in trusted_sources:
        winner = next((c for c in valid if matches_source(c, source)), None)
        if winner is not None:
            return _result(winner, "trusted_source")

    # None of the trusted sources have a value — no winner
    return None


def _canonical_for_field_type(field_type: FieldType) -> Optional[Callable]:
    """Return a canonicaliser appropriate for a field type, or None."""
    if field_type == FieldType.COUNTRY:
        return canonical_country
    if field_type == FieldType.CURRENCY:
        return canonical_currency
    if field_type == FieldType.UOM:
        return canonical_uom
    if field_type == FieldType.EMAIL:
        return canonical_email
    if field_type == FieldType.PHONE:
        return canonical_phone
    if field_type in (FieldType.DATE, FieldType.DATETIME, FieldType.TIMESTAMP):
        return canonical_date_iso
    if field_type in (FieldType.AMOUNT, FieldType.QUANTITY, FieldType.NUMBER, FieldType.PERCENTAGE):
        return canonical_amount
    return None


def apply_canonical(
    contributions: list[FieldContribution],
    field_type: FieldType,
) -> Optional[SurvivorshipResult]:
    """If all contenders canonicalise to the same code, return any most-recent.

    If only some canonicalise and disagree, return the most-recent canonicalisable
    one. If none canonicalise, return None.
    """
    canonicaliser = _canonical_for_field_type(field_type)
    if canonicaliser is None:
        return None

    pairs: list[tuple[object, FieldContribution]] = []
    for c in contributions:
        if c.value is None:
            continue
        canonical = canonicaliser(c.value)
        if canonical is not None:
            pairs.append((canonical, c))

    if not pairs:
        return None

    # If every canonical agrees, return most recent
    canonical_values = {p[0] for p in pairs}
    if len(canonical_values) == 1:
        winner = max(pairs, key=lambda p: p[1].extracted_at)[1]
        return _result(winner, "canonical")

    # Disagree: pick the most recent canonicalisable one
    winner = max(pairs, key=lambda p: p[1].extracted_at)[1]
    return _result(winner, "canonical", max(0.5, winner.confidence * 0.9))


def apply_format_valid(
    contributions: list[FieldContribution],
    field_type: FieldType,
) -> Optional[SurvivorshipResult]:
    """Drop values that fail field-type validation, then pick the most recent.

    For unsupported field types this is a no-op and returns None.
    """
    canonicaliser = _canonical_for_field_type(field_type)
    if canonicaliser is None:
        return None

    non_null = [c for c in contributions if c.value is not None]
    valid = [c for c in non_null if canonicaliser(c.value) is not None]
    if not valid:
        return None
    if len(valid) == len(non_null):
        # Nothing was pruned by format validation (nulls don't count as invalid);
        # let a later rule — typically longest_non_null — decide.
        return None

    winner = max(valid, key=lambda c: c.extracted_at)
    return _result(winner, "format_valid")


def apply_longest_non_null(
    contributions: list[FieldContribution],
    field_type: FieldType,
) -> Optional[SurvivorshipResult]:
    """For text-ish fields, prefer the longest non-empty value.

    Only applied to NAME / CITY / STREET / DESCRIPTION / TEXT — longer values
    are more complete for these (e.g. full street address vs truncated).
    """
    if field_type not in (
        FieldType.NAME, FieldType.CITY, FieldType.STREET,
        FieldType.DESCRIPTION, FieldType.TEXT,
    ):
        return None

    scored: list[tuple[int, FieldContribution]] = []
    for c in contributions:
        if c.value is None:
            continue
        s = str(c.value).strip()
        if not s:
            continue
        scored.append((len(s), c))

    if not scored:
        return None

    # Only treat as a decisive rule if there's a clear length winner
    max_len = max(s[0] for s in scored)
    longest = [c for ln, c in scored if ln == max_len]
    if len(longest) > 1:
        # Tie → not decisive here, let a later rule pick
        return None
    winner = longest[0]
    return _result(winner, "longest_non_null")


@dataclass
class SurvivorshipChain:
    """Ordered chain of deterministic survivorship rules.

    Walks rules in order, returns the first non-None result. Designed so
    callers only fall back to the LLM when the whole chain returns None.
    """

    field_name: str
    field_type: FieldType
    trusted_sources: Sequence[TrustedSource] | None = None
    all_field_contributions: dict[str, list[FieldContribution]] | None = None

    def evaluate(self, contributions: list[FieldContribution]) -> Optional[SurvivorshipResult]:
        if not contributions:
            return None

        # 1. Trusted source wins outright if configured
        if self.trusted_sources:
            r = apply_trusted_source(contributions, self.trusted_sources)
            if r is not None:
                return r

        # 2. Closed-domain canonical agreement
        r = apply_canonical(contributions, self.field_type)
        if r is not None:
            return r

        # 3. Format validation (prune invalid, pick most-recent valid)
        r = apply_format_valid(contributions, self.field_type)
        if r is not None:
            return r

        # 4. Longest non-null for text-ish fields
        r = apply_longest_non_null(contributions, self.field_type)
        if r is not None:
            return r

        # 5. Most complete across sources overall
        if self.all_field_contributions:
            r = apply_most_complete(contributions, self.all_field_contributions)
            if r is not None:
                return r

        # 6. Final deterministic: most recent
        return apply_most_recent(contributions)


def evaluate_field(
    field_name: str,
    contributions: list[FieldContribution],
    rule_type: str,
    trusted_sources: Sequence[TrustedSource] | None = None,
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

    if rule_type == "most_frequent":
        return apply_most_frequent(contributions)

    if rule_type == "trusted_source":
        if not trusted_sources:
            logger.warning(
                f"trusted_source rule for field '{field_name}' has no trusted_sources list — "
                "falling back to most_recent"
            )
            return apply_most_recent(contributions)
        return apply_trusted_source(contributions, trusted_sources)

    if rule_type == "chain":
        # Explicit chain rule: walk the deterministic chain end-to-end
        field_type = classify_field(field_name, sample_value=contributions[0].value if contributions else None)
        chain = SurvivorshipChain(
            field_name=field_name,
            field_type=field_type,
            trusted_sources=trusted_sources,
            all_field_contributions=all_field_contributions,
        )
        return chain.evaluate(contributions)

    logger.warning(f"Unknown rule_type '{rule_type}' for field '{field_name}' — skipping")
    return None
