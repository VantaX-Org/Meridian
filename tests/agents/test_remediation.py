"""Tests for the remediation sub-agent."""

import json
from unittest.mock import MagicMock, patch

from agents.remediation import remediation_node


def _make_state(findings=None, root_causes=None):
    return {
        "version_id": "v1",
        "tenant_id": "t1",
        "module_names": ["business_partner"],
        "findings_summary": findings if findings is not None else [
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
                "check_id": "BP003",
                "module": "business_partner",
                "severity": "medium",
                "dimension": "completeness",
                "affected_count": 50,
                "total_count": 1000,
                "pass_rate": 95.0,
                "message": "Email required for customer-facing BP",
            },
        ],
        "dqs_scores": {},
        "root_causes": root_causes or [
            {
                "module": "business_partner",
                "finding_ids": ["BP001"],
                "root_cause": "Missing BU_TYPE during migration",
                "business_impact": "Blocks conversion",
                "sap_context": "Transaction BP",
            }
        ],
        "remediations": {},
        "readiness_scores": {},
        "report": None,
        "error": None,
    }


VALID_RESPONSE = json.dumps({
    "cross_finding_patterns": [
        {
            "pattern_description": "847 BPs fail both BU_TYPE and email checks",
            "affected_check_ids": ["BP001", "BP003"],
            "shared_record_count": 847,
            "recommended_approach": "Fix BU_TYPE first, then validate email."
        }
    ],
    "effort_estimates": [
        {
            "check_id": "BP001",
            "affected_count": 150,
            "fix_complexity": "medium",
            "estimated_person_hours": 17,
            "estimation_basis": "150 records, manual classification needed"
        }
    ],
    "fix_sequence": [
        {
            "sequence": 1,
            "check_id": "BP001",
            "reason": "BU_TYPE drives validation rules for other fields"
        }
    ],
    "flags": []
})


@patch("agents.remediation.get_llm")
def test_remediation_valid_response(mock_get_llm):
    """Valid LLM response populates remediations dict."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=VALID_RESPONSE)
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = remediation_node(state)

    assert "remediations" in result
    rems = result["remediations"]
    assert isinstance(rems, dict)
    assert len(rems.get("cross_finding_patterns", [])) >= 1
    assert rems["effort_estimates"][0]["check_id"] == "BP001"


@patch("agents.remediation.get_llm")
def test_remediation_empty_findings_returns_empty_dict(mock_get_llm):
    """Zero findings — returns empty structure, no LLM call."""
    mock_llm = MagicMock()
    mock_get_llm.return_value = mock_llm

    state = _make_state(findings=[], root_causes=[])
    result = remediation_node(state)

    rems = result["remediations"]
    assert isinstance(rems, dict)
    assert rems["cross_finding_patterns"] == []
    assert rems["effort_estimates"] == []
    mock_llm.invoke.assert_not_called()


@patch("agents.remediation.get_llm")
def test_remediation_calls_llm_once(mock_get_llm):
    """All findings are processed in a single LLM call."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=VALID_RESPONSE)
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = remediation_node(state)

    assert mock_llm.invoke.call_count == 1
    assert "remediations" in result


@patch("agents.remediation.get_llm")
def test_remediation_only_medium_low(mock_get_llm):
    """Only medium/low findings — still processes them."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=VALID_RESPONSE)
    mock_get_llm.return_value = mock_llm

    findings = [
        {
            "check_id": "BP003",
            "module": "business_partner",
            "severity": "medium",
            "dimension": "completeness",
            "affected_count": 50,
            "total_count": 1000,
            "pass_rate": 95.0,
            "message": "Email required",
        }
    ]
    state = _make_state(findings=findings, root_causes=[])
    result = remediation_node(state)

    assert isinstance(result["remediations"], dict)
    assert mock_llm.invoke.call_count == 1
