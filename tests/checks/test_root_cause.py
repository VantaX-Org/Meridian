"""Tests for root-cause classification bridging DQ findings to Config Intelligence."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from checks.base import CheckResult
from checks.root_cause import (
    _extract_flagged_values,
    classify_root_cause,
    enrich_results_with_root_cause,
    load_tenant_config_values,
)


# ---------------------------------------------------------------------------
# _extract_flagged_values
# ---------------------------------------------------------------------------


def test_extract_flagged_from_domain_check():
    """domain_value_check puts invalid values in details.distinct_invalid_values."""
    finding = {
        "field": "LFA1.KTOKK",
        "details": {"distinct_invalid_values": {"0099": 5, "XYZ": 2}},
    }
    assert _extract_flagged_values(finding) == {"0099", "XYZ"}


def test_extract_flagged_from_referential_check():
    """referential_check puts missing values in details.missing_values."""
    finding = {
        "field": "LFA1.KTOKK",
        "details": {"missing_values": ["0099", "XYZ"]},
    }
    assert _extract_flagged_values(finding) == {"0099", "XYZ"}


def test_extract_flagged_from_null_check_returns_empty():
    """null_check doesn't produce enumerable flagged values."""
    finding = {"field": "LFA1.KTOKK", "details": {"null_count": 42}}
    assert _extract_flagged_values(finding) == set()


def test_extract_flagged_handles_missing_details():
    assert _extract_flagged_values({}) == set()
    assert _extract_flagged_values({"details": None}) == set()


# ---------------------------------------------------------------------------
# classify_root_cause
# ---------------------------------------------------------------------------


def test_classify_no_config_inventory():
    """No config data for tenant — cannot classify."""
    finding = {"field": "LFA1.KTOKK", "details": {"distinct_invalid_values": {"0099": 1}}}
    result = classify_root_cause(finding, config_values={})
    assert result["root_cause_type"] == "unknown"


def test_classify_bad_data_all_values_in_config():
    """Every flagged value is valid in SPRO — records are wrong, not config."""
    finding = {
        "field": "LFA1.KTOKK",
        "details": {"distinct_invalid_values": {"0001": 10, "0002": 5}},
    }
    # Tenant's config has 0001 AND 0002 as valid KTOKK entries
    config = {"KTOKK": {"0001", "0002", "0003", "0004"}}
    result = classify_root_cause(finding, config)
    assert result["root_cause_type"] == "bad_data"
    assert set(result["flagged_values_in_config"]) == {"0001", "0002"}


def test_classify_bad_config_no_values_in_config():
    """None of the flagged values exist in SPRO — rule is stricter than reality."""
    finding = {
        "field": "LFA1.KTOKK",
        "details": {"distinct_invalid_values": {"9999": 3, "ABCD": 1}},
    }
    config = {"KTOKK": {"0001", "0002"}}  # 9999/ABCD not there
    result = classify_root_cause(finding, config)
    assert result["root_cause_type"] == "bad_config"
    assert set(result["flagged_values_not_in_config"]) == {"9999", "ABCD"}


def test_classify_mixed_bad_data_and_config():
    """Some flagged values in config, some not — split remediation."""
    finding = {
        "field": "LFA1.KTOKK",
        "details": {"distinct_invalid_values": {"0001": 2, "9999": 3}},
    }
    config = {"KTOKK": {"0001", "0002"}}  # 0001 present, 9999 not
    result = classify_root_cause(finding, config)
    assert result["root_cause_type"] == "bad_data_and_config"
    assert set(result["flagged_values_in_config"]) == {"0001"}
    assert set(result["flagged_values_not_in_config"]) == {"9999"}


def test_classify_null_check_is_unknown():
    """Checks without enumerable flagged values can't be classified here."""
    finding = {"field": "LFA1.LIFNR", "details": {"null_count": 42}}
    config = {"LIFNR": {"X", "Y"}}  # irrelevant
    result = classify_root_cause(finding, config)
    assert result["root_cause_type"] == "unknown"


def test_classify_field_without_table_prefix():
    """Field stored as just 'KTOKK' (no table.field format)."""
    finding = {
        "field": "KTOKK",
        "details": {"distinct_invalid_values": {"9999": 1}},
    }
    config = {"KTOKK": {"0001", "0002"}}
    result = classify_root_cause(finding, config)
    assert result["root_cause_type"] == "bad_config"


# ---------------------------------------------------------------------------
# load_tenant_config_values (mocked SQLAlchemy)
# ---------------------------------------------------------------------------


def test_load_handles_engine_failure_gracefully():
    """If the engine is broken (missing table, bad connection, no sqlalchemy
    installed), load_tenant_config_values must return {} rather than raise —
    a DQ analysis must never fail because Config Intelligence is absent."""
    # Broken engine: any attempt to use it will raise inside the try/except,
    # which is the exact path we want to cover.
    broken_engine = None
    result = load_tenant_config_values(broken_engine, "tenant-abc")
    assert result == {}


def test_load_with_mock_session_no_runs():
    """Mock the SQLAlchemy Session (lazy-imported inside the function) and
    simulate 'tenant has no Config Intelligence runs yet'."""
    try:
        import sqlalchemy  # noqa: F401
    except ImportError:
        pytest.skip("sqlalchemy not installed; covered by graceful-failure test")

    engine = MagicMock()
    with patch("sqlalchemy.orm.Session") as mock_session_cls:
        mock_session = mock_session_cls.return_value.__enter__.return_value
        mock_session.execute.return_value.fetchone.return_value = None
        result = load_tenant_config_values(engine, "tenant-abc")
        assert result == {}


# ---------------------------------------------------------------------------
# enrich_results_with_root_cause — end-to-end behaviour
# ---------------------------------------------------------------------------


def test_enrich_attaches_root_cause_to_failing_results():
    """Failing results gain details.root_cause; passing ones are untouched."""
    failing = CheckResult(
        check_id="AP035", module="accounts_payable", field="LFA1.KTOKK",
        severity="critical", dimension="consistency",
        passed=False, affected_count=3, total_count=100, pass_rate=97.0,
        message="Invalid account group",
        details={"distinct_invalid_values": {"9999": 3}},
    )
    passing = CheckResult(
        check_id="AP036", module="accounts_payable", field="LFA1.ZTERM",
        severity="high", dimension="consistency",
        passed=True, affected_count=0, total_count=100, pass_rate=100.0,
        message="OK",
        details={},
    )

    # Fake config where 9999 is NOT present — classification should be bad_config
    with patch("checks.root_cause.load_tenant_config_values") as mock_load:
        mock_load.return_value = {"KTOKK": {"0001", "0002"}}
        results = [failing, passing]
        enrich_results_with_root_cause(engine=MagicMock(), tenant_id="t1", results=results)

    # failing was replaced with an enriched copy
    assert "root_cause" in results[0].details
    assert results[0].details["root_cause"]["root_cause_type"] == "bad_config"
    # passing wasn't touched
    assert "root_cause" not in results[1].details


def test_enrich_no_config_does_nothing():
    """Tenant without Config Intelligence: enrichment is a no-op."""
    failing = CheckResult(
        check_id="AP035", module="accounts_payable", field="LFA1.KTOKK",
        severity="critical", dimension="consistency",
        passed=False, affected_count=3, total_count=100, pass_rate=97.0,
        message="Invalid account group",
        details={"distinct_invalid_values": {"9999": 3}},
    )
    with patch("checks.root_cause.load_tenant_config_values") as mock_load:
        mock_load.return_value = {}
        results = [failing]
        enrich_results_with_root_cause(engine=MagicMock(), tenant_id="t1", results=results)

    # No root_cause attached when there's no config data
    assert "root_cause" not in (results[0].details or {})
