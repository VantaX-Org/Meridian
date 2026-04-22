"""Tests for the sap/deterministic/ package — SAP-aware canonicalisers,
field classification, and similarity bands. These are the primary
LLM-avoidance primitives at 400k-record scale."""

from __future__ import annotations

import pytest

from sap.deterministic import (
    FieldType,
    SimilarityBand,
    canonical_country,
    canonical_currency,
    canonical_email,
    canonical_phone,
    canonical_uom,
    classify_band,
    classify_field,
    collapse_whitespace,
    deterministic_similarity,
    strip_diacritics,
    uppercase_sap_code,
)
from sap.deterministic.normalize import (
    canonical_amount,
    canonical_date_iso,
    normalize_business_name,
    strip_legal_suffix,
)


# ── Canonicalisers ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value,expected",
    [
        ("USA", "US"),
        ("United States", "US"),
        ("u.s.a.", "US"),
        ("Deutschland", "DE"),
        ("GB", "GB"),
        ("unknown-land", None),
        (None, None),
    ],
)
def test_canonical_country(value, expected):
    assert canonical_country(value) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("USD", "USD"),
        ("$", "USD"),
        ("US Dollar", "USD"),
        ("eur", "EUR"),
        ("€", "EUR"),
        ("ZAR", "ZAR"),
        ("not-a-currency", None),
    ],
)
def test_canonical_currency(value, expected):
    assert canonical_currency(value) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("EA", "EA"),
        ("each", "EA"),
        ("kg", "KG"),
        ("kilogram", "KG"),
        ("liter", "L"),
        ("litre", "L"),
        ("blah", None),
    ],
)
def test_canonical_uom(value, expected):
    assert canonical_uom(value) == expected


def test_canonical_email():
    assert canonical_email("  Alice@EXAMPLE.com ") == "alice@example.com"
    assert canonical_email("not-email") is None
    assert canonical_email("") is None
    assert canonical_email(None) is None


def test_canonical_phone_keeps_e164():
    assert canonical_phone("+1 (212) 555-0000") == "+12125550000"
    assert canonical_phone("212-555-0000") == "2125550000"
    assert canonical_phone("123") is None  # too short
    assert canonical_phone(None) is None


def test_canonical_date_iso():
    assert canonical_date_iso("2024-01-15") == "2024-01-15"
    assert canonical_date_iso("20240115") == "2024-01-15"
    assert canonical_date_iso("15.01.2024") == "2024-01-15"
    assert canonical_date_iso("not-a-date") is None


def test_canonical_amount_handles_locales():
    assert canonical_amount("1,234.56") == 1234.56
    assert canonical_amount("1.234,56") == 1234.56
    assert canonical_amount("-42") == -42.0
    assert canonical_amount("abc") is None


def test_strip_legal_suffix_longest_match():
    assert strip_legal_suffix("Acme Pvt Ltd") == "Acme"
    assert strip_legal_suffix("Acme Ltd") == "Acme"
    assert strip_legal_suffix("Siemens GmbH") == "Siemens"
    assert strip_legal_suffix("No Suffix") == "No Suffix"


def test_normalize_business_name_collapses_all():
    assert normalize_business_name("  Über Corp GmbH ") == "uber corp"
    assert normalize_business_name("Acme, Inc.") == "acme"
    # "Co." is a legal suffix (alongside Inc/Ltd/GmbH) and is stripped before
    # abbreviation expansion, so we get "international business" (no "company").
    assert normalize_business_name("Intl Business Co.") == "international business"


def test_strip_diacritics_and_whitespace():
    assert strip_diacritics("Müller Åke") == "Muller Ake"
    assert collapse_whitespace("   hello   world   ") == "hello world"
    assert uppercase_sap_code("  m-001  ") == "M001"


# ── Field classifier ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "field,sample,expected",
    [
        ("BUT000.NAME1", "Acme Corp", FieldType.NAME),
        ("ADR6.SMTP_ADDR", "a@b.com", FieldType.EMAIL),
        ("ADR2.TEL_NUMBER", "+14155552671", FieldType.PHONE),
        ("LFA1.LAND1", "DE", FieldType.COUNTRY),
        ("WAERS", "USD", FieldType.CURRENCY),
        ("MEINS", "EA", FieldType.UOM),
        ("MATNR", "000000000000000001", FieldType.PRIMARY_KEY),
        ("PSTLZ", "94043", FieldType.POSTAL_CODE),
        ("ERDAT", "2024-01-15", FieldType.DATE),
    ],
)
def test_classify_field(field, sample, expected):
    assert classify_field(field, sample_value=sample) == expected


# ── Similarity ───────────────────────────────────────────────────────────────


def test_similarity_country_canonical_agreement():
    assert deterministic_similarity("LFA1.LAND1", "DE", "Germany") == 1.0
    assert deterministic_similarity("LFA1.LAND1", "DE", "US") == 0.0


def test_similarity_currency_canonical():
    assert deterministic_similarity("WAERS", "USD", "$") == 1.0
    assert deterministic_similarity("WAERS", "USD", "EUR") == 0.0


def test_similarity_email_exact_and_local_match():
    s = deterministic_similarity("ADR6.SMTP_ADDR", "A@foo.com", "a@FOO.com")
    assert s == 1.0
    partial = deterministic_similarity("ADR6.SMTP_ADDR", "a@foo.com", "a@bar.com")
    assert 0.5 < partial < 0.7


def test_similarity_phone_last_seven():
    # Strict-suffix match (US country code missing on one side) → MATCH band
    s = deterministic_similarity("ADR2.TEL_NUMBER", "+12125550000", "2125550000")
    assert s >= 0.92
    # Different country prefix but same 7-digit tail
    partial = deterministic_similarity("ADR2.TEL_NUMBER", "+14155550000", "+15155550000")
    assert partial >= 0.8


def test_similarity_name_fuzzy():
    s = deterministic_similarity("BUT000.NAME1", "Acme Inc", "Acme, Inc.")
    assert s >= 0.92  # MATCH band
    low = deterministic_similarity("BUT000.NAME1", "Acme", "Zzz Holdings")
    assert low <= 0.35  # NO_MATCH band


def test_similarity_null_short_circuit():
    assert deterministic_similarity("BUT000.NAME1", None, "Acme") == 0.0
    assert deterministic_similarity("BUT000.NAME1", "Acme", None) == 0.0


def test_band_classification():
    assert classify_band(0.99) == SimilarityBand.MATCH
    assert classify_band(0.30) == SimilarityBand.NO_MATCH
    assert classify_band(0.70) == SimilarityBand.UNCERTAIN
