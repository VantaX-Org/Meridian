"""Tests for the report sub-agent."""

import json
from unittest.mock import MagicMock, patch

from agents.report_agent import report_node, _compute_overall_status


def _make_full_state():
    return {
        "version_id": "v1",
        "tenant_id": "t1",
        "module_names": ["business_partner", "material_master"],
        "findings_summary": [
            {
                "check_id": "BP001",
                "module": "business_partner",
                "severity": "critical",
                "dimension": "completeness",
                "affected_count": 150,
                "total_count": 1000,
                "pass_rate": 85.0,
                "message": "BP type is mandatory",
            },
            {
                "check_id": "MM001",
                "module": "material_master",
                "severity": "high",
                "dimension": "accuracy",
                "affected_count": 30,
                "total_count": 500,
                "pass_rate": 94.0,
                "message": "Material type mismatch",
            },
        ],
        "dqs_scores": {
            "business_partner": {
                "composite_score": 72.4,
                "critical_count": 1,
                "dimension_scores": {"completeness": 85.0},
                "capped": True,
            },
            "material_master": {
                "composite_score": 88.0,
                "critical_count": 0,
                "dimension_scores": {"accuracy": 94.0},
                "capped": False,
            },
        },
        "root_causes": [
            {
                "module": "business_partner",
                "finding_ids": ["BP001"],
                "root_cause": "Missing BU_TYPE during migration",
                "business_impact": "Blocks conversion",
                "sap_context": "Transaction BP",
            }
        ],
        "remediations": [
            {
                "check_id": "BP001",
                "module": "business_partner",
                "severity": "critical",
                "fix_steps": ["1. Run BP.", "2. Use LSMW."],
                "sap_transaction": "BP, LSMW",
                "estimated_effort": "2-4 person-days",
            }
        ],
        "readiness_scores": {
            "business_partner": {
                "score": 72.4,
                "status": "conditional",
                "blockers": ["BP type missing."],
                "conditions": ["Resolve email completeness."],
            },
            "material_master": {
                "score": 88.0,
                "status": "conditional",
                "blockers": [],
                "conditions": ["Review material types."],
            },
        },
        "report": None,
        "error": None,
    }


EXEC_SUMMARY = (
    "The SAP data quality assessment reveals conditional migration readiness across "
    "analysed modules. Business Partner data has critical completeness gaps that must "
    "be resolved before conversion. Immediate remediation of BP type data is recommended."
)


@patch("agents.report_agent.get_llm")
def test_report_full_state(mock_get_llm):
    """Full state → report matches schema."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=EXEC_SUMMARY)
    mock_get_llm.return_value = mock_llm

    state = _make_full_state()
    result = report_node(state)

    report = result["report"]
    assert report["version_id"] == "v1"
    assert report["tenant_id"] == "t1"
    assert "report_id" in report
    assert "generated_at" in report
    assert report["modules_analysed"] == ["business_partner", "material_master"]
    assert isinstance(report["executive_summary"], str)
    assert report["overall_dqs"]["composite"] > 0
    assert "business_partner" in report["overall_dqs"]["by_module"]
    assert report["findings_by_severity"]["critical"] == 1
    assert report["findings_by_severity"]["high"] == 1
    assert report["findings_by_severity"]["total"] == 2
    assert len(report["modules"]) == 2
    assert report["migration_readiness"]["overall_status"] in ("go", "no-go", "conditional")
    assert report["migration_readiness"]["overall_score"] > 0
    assert isinstance(report["migration_readiness"]["summary"], str)


@patch("agents.report_agent.get_llm")
def test_report_overall_status_python(mock_get_llm):
    """Overall status is computed in Python regardless of LLM output."""
    mock_llm = MagicMock()
    # LLM returns something that says "go" — but Python logic should override
    mock_llm.invoke.return_value = MagicMock(content="Everything is ready to go!")
    mock_get_llm.return_value = mock_llm

    state = _make_full_state()
    # Both modules are "conditional"
    result = report_node(state)
    assert result["report"]["migration_readiness"]["overall_status"] == "conditional"

    # Make one module "no-go"
    state["readiness_scores"]["business_partner"]["status"] = "no-go"
    result = report_node(state)
    assert result["report"]["migration_readiness"]["overall_status"] == "no-go"


@patch("agents.report_agent.get_llm")
def test_report_executive_summary_length(mock_get_llm):
    """Executive summary is between 50 and 500 characters."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=EXEC_SUMMARY)
    mock_get_llm.return_value = mock_llm

    state = _make_full_state()
    result = report_node(state)

    summary = result["report"]["executive_summary"]
    assert 50 <= len(summary) <= 500, f"Summary length {len(summary)} out of range"


def test_overall_status_logic():
    """Test _compute_overall_status deterministic logic."""
    assert _compute_overall_status({
        "a": {"status": "go"},
        "b": {"status": "go"},
    }) == "go"

    assert _compute_overall_status({
        "a": {"status": "go"},
        "b": {"status": "conditional"},
    }) == "conditional"

    assert _compute_overall_status({
        "a": {"status": "go"},
        "b": {"status": "no-go"},
    }) == "no-go"

    assert _compute_overall_status({
        "a": {"status": "conditional"},
        "b": {"status": "no-go"},
    }) == "no-go"
