"""Semantic type detectors, profile, trust score and suggested rules. Synthetic values only."""
import datetime as dt

import pandas as pd
import pytest

from api.services import semantic_types as st

N = 40


def _frame() -> pd.DataFrame:
    return pd.DataFrame({
        "email": [f"user{i}@example.com" for i in range(N)],
        "Phone": ["+49 30 1234567", "+44 20 7946 0000", "+27 21 555 0100", "+1 212 555 0100"] * (N // 4),
        "iban": ["DE89370400440532013000", "GB82WEST12345698765432"] * (N // 2),
        "vat_no": ["ATU12345678", "NL123456789B01", "FR40303265045", "BE0123456789"] * (N // 4),
        "post_code": ["10115", "SW1A 1AA", "8001", "75001"] * (N // 4),
        "country": ["DE", "GB", "ZA", "FR"] * (N // 4),
        "created": ["2026-01-02", "2026-03-04"] * (N // 2),
        "amount": ["1,234.50", "99.90", "EUR 10", "12.00"] * (N // 4),
        "website": ["https://example.com/a", "www.example.org"] * (N // 2),
        "last_name": ["Example", "Sample", "Testperson", "Muster"] * (N // 4),
        "row_id": [str(i) for i in range(N)],
        "flag": ["X", ""] * (N // 2),
    })


def test_profile_detects_every_type():
    cols = {c["column"]: c for c in st.profile(_frame())["columns"]}
    expected = {"email": "email", "Phone": "phone", "iban": "iban", "vat_no": "eu_vat", "post_code": "postcode",
                "country": "country", "created": "date", "amount": "currency_amount", "website": "url",
                "last_name": "person_name", "row_id": None, "flag": None}
    assert {k: cols[k]["type"] for k in expected} == expected
    assert cols["email"]["confidence"] == 1.0 and cols["email"]["conformance"] == 1.0
    assert cols["flag"]["filled"] == 0.5


def test_profile_keeps_no_values():
    p = st.profile(_frame())
    assert "user1@example.com" not in repr(p) and "DE89370400440532013000" not in repr(p)


@pytest.mark.parametrize("value,ok", [("DE89370400440532013000", True), ("DE89370400440532013001", False)])
def test_iban_conformance_uses_mod97(value, ok):
    c = st.profile(pd.DataFrame({"iban": [value] * 25}))["columns"][0]
    assert c["type"] == "iban" and c["conformance"] == (1.0 if ok else 0.0)


def test_eu_vat_layout_per_state():
    assert st._vat_valid("NL123456789B01") and not st._vat_valid("NL123456789")
    assert st._vat_valid("SE123456789001") and not st._vat_valid("SE1234567890")


def test_low_sample_lowers_confidence():
    c = st.profile(pd.DataFrame({"email": ["a@example.com"] * 5}))["columns"][0]
    assert c["type"] == "email" and c["confidence"] == 0.25


def test_override_and_suggestions():
    cols = st.resolve(st.profile(_frame())["columns"],
                      {"email": "email", "country": "country", "post_code": "postcode", "row_id": "none"})
    rules = st.suggested_rules(cols)
    assert [(r["column"], r["check_class"]) for r in rules] == [
        ("email", "contact_check"), ("email", "contact_check"), ("post_code", "contact_check"),
        ("country", "domain_value_check")]
    assert rules[2]["params"] == {"kind": "postcode", "country_field": "country"}
    assert next(c for c in cols if c["column"] == "row_id")["type"] is None


def test_trust_score_reweights_missing_parts():
    assert st.trust_score({"dqs": 80, "conformance": 100, "freshness": 100, "completeness": 100}) == 92.0
    assert st.trust_score({"dqs": None, "conformance": None, "freshness": None, "completeness": None}) is None
    now = dt.datetime(2026, 11, 11, tzinfo=dt.timezone.utc)
    assert st.freshness(now - dt.timedelta(days=90), now) == 0.0
    assert st.dqs_of({"a": {"composite_score": 80}, "b": {"composite_score": 60}}) == 70.0


def test_dqs_of_is_the_tenant_weighted_composite():
    summary = {"a": {"composite_score": 80}, "b": {"composite_score": 60}, "c": {"composite_score": None}}
    # the unmeasured module does not weigh in, and the tenant's module weights do
    assert st.dqs_of(summary, {"module_weights": {"a": 3}}) == 75.0
    assert st.dqs_of({}) is None
