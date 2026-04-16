"""Tests for the config matching sub-agent."""

import json
from unittest.mock import MagicMock, patch

from agents.config_matching import config_matching_node


def _make_state(findings=None):
    default_findings = [
        {
            "check_id": "BP001",
            "module": "business_partner",
            "severity": "critical",
            "dimension": "completeness",
            "affected_count": 150,
            "total_count": 1000,
            "pass_rate": 85.0,
            "message": "BU_TYPE must be 1, 2, or 3",
            "field": "BUT000.BU_TYPE",
            "value_fix_map": {"": "Set BU_TYPE from entity classification"},
        }
    ]
    return {
        "version_id": "v1",
        "tenant_id": "t1",
        "module_names": ["business_partner"],
        "findings_summary": default_findings if findings is None else findings,
        "dqs_scores": {
            "business_partner": {"composite_score": 72.4, "critical_count": 1}
        },
        "root_causes": [],
        "remediations": [],
        "readiness_scores": {},
        "report": None,
        "config_matches": [],
        "config_match_summary": {},
        "error": None,
    }


DATA_ERROR_RESPONSE = json.dumps({
    "classifications": [
        {
            "check_id": "BP001",
            "record_key": "1000042",
            "field": "BUT000.BU_TYPE",
            "actual_value": "",
            "std_rule_expectation": "BU_TYPE must be 1, 2, or 3",
            "classification": "data_error",
            "config_evidence": "Random nulls — no consistent pattern",
            "recommended_action": "Set BU_TYPE from entity classification",
            "sap_tcode": "BP",
            "fix_priority": 1,
        }
    ]
})

CONFIG_DEVIATION_RESPONSE = json.dumps({
    "classifications": [
        {
            "check_id": "BP001",
            "record_key": "1000042",
            "field": "BUT000.BU_TYPE",
            "actual_value": "4",
            "std_rule_expectation": "BU_TYPE must be 1, 2, or 3",
            "classification": "config_deviation",
            "config_evidence": "All records use BU_TYPE=4 — customer-specific extension",
            "recommended_action": "Confirm with business — may be valid custom config",
            "sap_tcode": "BP",
            "fix_priority": 3,
        }
    ]
})


@patch("agents.config_matching.get_llm")
def test_config_matching_returns_data_error(mock_get_llm):
    """Mock returns data_error — classification propagates correctly."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=DATA_ERROR_RESPONSE)
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = config_matching_node(state)

    assert "config_matches" in result
    assert len(result["config_matches"]) == 1
    assert result["config_matches"][0]["classification"] == "data_error"
    assert result["config_match_summary"]["data_errors"] == 1
    assert "error" not in result


@patch("agents.config_matching.get_llm")
def test_config_matching_returns_config_deviation(mock_get_llm):
    """Mock returns config_deviation — module appears in modules_with_deviations."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=CONFIG_DEVIATION_RESPONSE)
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = config_matching_node(state)

    assert result["config_matches"][0]["classification"] == "config_deviation"
    assert result["config_match_summary"]["config_deviations"] == 1
    assert "business_partner" in result["config_match_summary"]["modules_with_deviations"]
    assert "error" not in result


@patch("agents.config_matching.get_llm")
def test_config_matching_invalid_json_retry(mock_get_llm):
    """Invalid JSON on first call, valid on second — retry succeeds."""
    mock_llm = MagicMock()
    mock_llm.invoke.side_effect = [
        MagicMock(content="This is not valid JSON at all"),
        MagicMock(content=DATA_ERROR_RESPONSE),
    ]
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = config_matching_node(state)

    assert "config_matches" in result
    assert len(result["config_matches"]) >= 1
    assert mock_llm.invoke.call_count == 2
    assert "error" not in result


def test_config_matching_empty_findings():
    """Empty findings_summary returns empty config_matches without error."""
    state = _make_state(findings=[])
    result = config_matching_node(state)

    assert result["config_matches"] == []
    assert result["config_match_summary"]["total_records_assessed"] == 0
    # No exception was raised — we reach here


@patch("agents.config_matching.get_llm")
def test_config_matching_llm_total_failure_degrades_gracefully(mock_get_llm):
    """Both LLM calls return invalid JSON — all classifications become ambiguous, no error key."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content="not valid json {{")
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = config_matching_node(state)

    assert "error" not in result
    assert "config_matches" in result
    assert len(result["config_matches"]) >= 1
    for match in result["config_matches"]:
        assert match["classification"] == "ambiguous"
