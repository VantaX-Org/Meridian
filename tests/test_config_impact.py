"""Tests for config_impact agent node -- verify feature blocking aggregation."""

import pytest
from agents.config_impact import config_impact_node, _load_impact_rules


def _make_state(findings):
    """Create a minimal AgentState-like dict with findings."""
    return {
        "version_id": "test-version",
        "tenant_id": "test-tenant",
        "module_names": [],
        "findings_summary": findings,
        "dqs_scores": {},
        "root_causes": [],
        "remediations": {},
        "readiness_scores": {},
        "report": None,
        "config_matches": [],
        "config_match_summary": {},
        "config_impact_results": [],
        "config_impact_summary": {},
        "error": None,
    }


def test_rules_loaded():
    """Impact rules should load from YAML."""
    rules = _load_impact_rules()
    assert len(rules) > 0, "Should have loaded impact rules"
    assert "AP018" in rules, "Should have AP018 rule"


def test_no_findings_returns_empty():
    state = _make_state([])
    result = config_impact_node(state)
    assert result["config_impact_results"] == []
    assert result["config_impact_summary"]["total_features_assessed"] == 0


def test_finding_with_matching_rule_produces_results():
    """A finding matching a rule should produce impact results."""
    state = _make_state([
        {"check_id": "AP018", "module": "accounts_payable",
         "severity": "critical", "affected_count": 50, "total_count": 1000,
         "pass_rate": 95.0, "message": "Missing bank country"},
    ])
    result = config_impact_node(state)
    assert len(result["config_impact_results"]) >= 1
    assert result["config_impact_summary"]["total_features_assessed"] >= 1


def test_blocked_feature_status():
    """A full_block rule should produce blocked status in summary."""
    state = _make_state([
        {"check_id": "AP018", "module": "accounts_payable",
         "severity": "critical", "affected_count": 50, "total_count": 1000,
         "pass_rate": 95.0, "message": "Missing bank country"},
    ])
    result = config_impact_node(state)
    summary = result["config_impact_summary"]
    assert summary["features_blocked"] >= 1


def test_unknown_check_id_ignored():
    """A finding with no matching rule should not produce results."""
    state = _make_state([
        {"check_id": "NONEXISTENT_999", "module": "fake_module",
         "severity": "low", "affected_count": 1, "total_count": 100,
         "pass_rate": 99.0, "message": "Unknown check"},
    ])
    result = config_impact_node(state)
    assert len(result["config_impact_results"]) == 0


def test_multiple_findings_aggregate():
    """Multiple findings should produce multiple impact results."""
    state = _make_state([
        {"check_id": "AP017", "module": "accounts_payable",
         "severity": "high", "affected_count": 30, "total_count": 500,
         "pass_rate": 94.0, "message": "Missing payment methods"},
        {"check_id": "AP018", "module": "accounts_payable",
         "severity": "critical", "affected_count": 20, "total_count": 500,
         "pass_rate": 96.0, "message": "Missing bank country"},
    ])
    result = config_impact_node(state)
    assert len(result["config_impact_results"]) >= 2
    assert result["config_impact_summary"]["total_features_assessed"] >= 1


def test_impact_results_have_check_id():
    """Each impact result should reference the check_id."""
    state = _make_state([
        {"check_id": "AP018", "module": "accounts_payable",
         "severity": "critical", "affected_count": 10, "total_count": 100,
         "pass_rate": 90.0, "message": "Test"},
    ])
    result = config_impact_node(state)
    for r in result["config_impact_results"]:
        assert "check_id" in r
        assert r["check_id"] == "AP018"


def test_summary_counts_consistent():
    """Summary counts should add up to total_features_assessed."""
    state = _make_state([
        {"check_id": "AP018", "module": "accounts_payable",
         "severity": "critical", "affected_count": 10, "total_count": 100,
         "pass_rate": 90.0, "message": "Test"},
    ])
    result = config_impact_node(state)
    s = result["config_impact_summary"]
    total = s.get("features_blocked", 0) + s.get("features_degraded", 0) + \
            s.get("features_cosmetic", 0) + s.get("features_ok", 0)
    assert total == s["total_features_assessed"]
