"""Tests for the analyst sub-agent."""

import json
from unittest.mock import MagicMock, patch

from agents.analyst import analyst_node


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
            "message": "BP type is mandatory",
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
        "error": None,
    }


VALID_RESPONSE = json.dumps({
    "root_causes": [
        {
            "module": "business_partner",
            "finding_ids": ["BP001"],
            "root_cause": "Missing BU_TYPE during legacy migration",
            "business_impact": "Blocks S/4HANA conversion program",
            "sap_context": "Transaction BP, table BUT000",
        }
    ]
})


@patch("agents.analyst.get_llm")
def test_analyst_valid_response(mock_get_llm):
    """Valid JSON response populates root_causes."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=VALID_RESPONSE)
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = analyst_node(state)

    assert "root_causes" in result
    assert len(result["root_causes"]) == 1
    assert result["root_causes"][0]["module"] == "business_partner"
    assert "error" not in result


@patch("agents.analyst.get_llm")
def test_analyst_retry_on_invalid_json(mock_get_llm):
    """Invalid JSON on first call, valid on retry — retry logic works."""
    mock_llm = MagicMock()
    mock_llm.invoke.side_effect = [
        MagicMock(content="This is not valid JSON at all"),
        MagicMock(content=VALID_RESPONSE),
    ]
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = analyst_node(state)

    assert "root_causes" in result
    assert len(result["root_causes"]) == 1
    assert mock_llm.invoke.call_count == 2


@patch("agents.analyst.get_llm")
def test_analyst_error_on_double_failure(mock_get_llm):
    """Invalid JSON on both calls — sets error."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content="not json")
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = analyst_node(state)

    assert "error" in result
    assert result["error"] is not None
    assert "invalid JSON" in result["error"]


@patch("agents.analyst.get_llm")
def test_analyst_empty_findings(mock_get_llm):
    """Empty findings produces empty root_causes, no LLM call."""
    mock_llm = MagicMock()
    mock_get_llm.return_value = mock_llm

    state = _make_state(findings=[])
    result = analyst_node(state)

    assert result["root_causes"] == []
    mock_llm.invoke.assert_not_called()
