"""Tests for the SurvivorshipChain deterministic rule engine."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


from api.services.survivorship import (
    FieldContribution,
    SurvivorshipChain,
    apply_canonical,
    apply_format_valid,
    apply_longest_non_null,
)
from sap.deterministic import FieldType


_NOW = datetime.now(timezone.utc)


def _c(source: str, value, *, minutes: int = 0, confidence: float = 0.9) -> FieldContribution:
    return FieldContribution(
        source_system=source,
        extracted_at=_NOW - timedelta(minutes=minutes),
        confidence=confidence,
        value=value,
    )


def test_canonical_agreement_wins_with_most_recent():
    contribs = [
        _c("ECC", "USA", minutes=30),
        _c("S4", "US", minutes=5),
        _c("SF", "United States", minutes=60),
    ]
    r = apply_canonical(contribs, FieldType.COUNTRY)
    assert r is not None
    assert r.value == "US"  # S4 is most recent and already canonical
    assert r.rule_type == "canonical"


def test_canonical_disagreement_picks_most_recent_canonicalisable():
    contribs = [
        _c("ECC", "US", minutes=30),
        _c("S4", "DE", minutes=5),
        _c("SF", "junk", minutes=1),  # can't canonicalise
    ]
    r = apply_canonical(contribs, FieldType.COUNTRY)
    assert r is not None
    assert r.value == "DE"


def test_format_valid_prunes_invalid_values():
    contribs = [
        _c("A", "not-email", minutes=1),
        _c("B", "steward@co.com", minutes=10),
        _c("C", "", minutes=5),
    ]
    r = apply_format_valid(contribs, FieldType.EMAIL)
    assert r is not None
    assert r.value == "steward@co.com"


def test_longest_non_null_for_names():
    contribs = [
        _c("A", "ACME", minutes=1),
        _c("B", "ACME Inc", minutes=5),
        _c("C", "ACME Incorporated Holdings", minutes=10),
    ]
    r = apply_longest_non_null(contribs, FieldType.NAME)
    assert r is not None
    assert r.value == "ACME Incorporated Holdings"


def test_longest_non_null_tie_returns_none():
    contribs = [
        _c("A", "ACME", minutes=1),
        _c("B", "BETA", minutes=5),
    ]
    assert apply_longest_non_null(contribs, FieldType.NAME) is None


def test_chain_prefers_trusted_source_before_canonical():
    contribs = [
        _c("ECC", "USA", minutes=5),
        _c("S4", "US", minutes=1),
    ]
    chain = SurvivorshipChain(
        field_name="LFA1.LAND1",
        field_type=FieldType.COUNTRY,
        trusted_sources=["ECC"],
    )
    r = chain.evaluate(contribs)
    assert r is not None
    assert r.source_system == "ECC"  # trusted_source wins
    assert r.rule_type == "trusted_source"


def test_chain_falls_through_to_most_recent_when_no_rule_wins():
    contribs = [
        _c("X", "gibberish-1", minutes=30),
        _c("Y", "gibberish-2", minutes=5),
    ]
    chain = SurvivorshipChain(
        field_name="FREE_TEXT",
        field_type=FieldType.TEXT,
    )
    r = chain.evaluate(contribs)
    assert r is not None
    assert r.value == "gibberish-2"  # most recent


def test_chain_returns_none_when_no_contributions():
    chain = SurvivorshipChain(field_name="X", field_type=FieldType.TEXT)
    assert chain.evaluate([]) is None
