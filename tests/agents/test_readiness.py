"""Tests for the readiness sub-agent."""

import json
from unittest.mock import MagicMock, patch

from agents.readiness import compute_readiness_status, readiness_node


# --- Deterministic status tests (no LLM) ---

def test_readiness_go():
    """Score >= 90, 0 critical → go."""
    assert compute_readiness_status(92.0, 0) == "go"


def test_readiness_no_go_critical():
    """2+ critical failures → no-go regardless of score."""
    assert compute_readiness_status(95.0, 2) == "no-go"


def test_readiness_no_go_low_score():
    """Score < 60 → no-go."""
    assert compute_readiness_status(55.0, 0) == "no-go"


def test_readiness_conditional():
    """Score 75, 1 critical → conditional."""
    assert compute_readiness_status(75.0, 1) == "conditional"


def test_readiness_conditional_edge():
    """Score 89, 0 critical → conditional (not go, score < 90)."""
    assert compute_readiness_status(89.0, 0) == "conditional"


# --- Node tests with mock LLM ---

def _make_state(composite=72.4, critical_count=1):
    return {
        "version_id": "v1",
        "tenant_id": "t1",
        "module_names": ["business_partner"],
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
            }
        ],
        "dqs_scores": {
            "business_partner": {
                "composite_score": composite,
                "critical_count": critical_count,
                "dimension_scores": {"completeness": 85.0},
                "capped": True,
            }
        },
        "root_causes": [
            {
                "module": "business_partner",
                "finding_ids": ["BP001"],
                "root_cause": "Missing BU_TYPE",
                "business_impact": "Blocks conversion",
                "sap_context": "Transaction BP",
            }
        ],
        "remediations": [
            {
                "check_id": "BP001",
                "module": "business_partner",
                "severity": "critical",
                "fix_steps": ["1. Run BP."],
                "sap_transaction": "BP",
                "estimated_effort": "2 days",
            }
        ],
        "readiness_scores": {},
        "report": None,
        "error": None,
    }


VALID_RESPONSE = json.dumps({
    "module": "business_partner",
    "blockers": ["3,412 BPs missing BU_TYPE will fail conversion."],
    "conditions": ["Email completeness below 70%."],
})


@patch("agents.readiness.get_llm")
def test_readiness_node_go(mock_get_llm):
    """Score >= 90, 0 critical → status is go, LLM called for blockers/conditions."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=json.dumps({
        "module": "business_partner",
        "blockers": [],
        "conditions": [],
    }))
    mock_get_llm.return_value = mock_llm

    state = _make_state(composite=92.0, critical_count=0)
    result = readiness_node(state)

    assert result["readiness_scores"]["business_partner"]["status"] == "go"
    mock_llm.invoke.assert_called_once()


@patch("agents.readiness.get_llm")
def test_readiness_node_no_go(mock_get_llm):
    """Score < 60, 2 critical → no-go computed in Python before LLM call."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=VALID_RESPONSE)
    mock_get_llm.return_value = mock_llm

    state = _make_state(composite=55.0, critical_count=2)
    result = readiness_node(state)

    assert result["readiness_scores"]["business_partner"]["status"] == "no-go"


@patch("agents.readiness.get_llm")
def test_readiness_node_conditional(mock_get_llm):
    """Score 75, 1 critical → conditional."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=VALID_RESPONSE)
    mock_get_llm.return_value = mock_llm

    state = _make_state(composite=75.0, critical_count=1)
    result = readiness_node(state)

    assert result["readiness_scores"]["business_partner"]["status"] == "conditional"
    assert len(result["readiness_scores"]["business_partner"]["blockers"]) >= 1


def test_readiness_status_never_uses_llm():
    """The go/no-go computation is pure Python — no LLM involved."""
    # These are direct function calls, no mocking needed
    assert compute_readiness_status(92.0, 0) == "go"
    assert compute_readiness_status(55.0, 2) == "no-go"
    assert compute_readiness_status(75.0, 1) == "conditional"
    assert compute_readiness_status(60.0, 0) == "conditional"
    assert compute_readiness_status(90.0, 0) == "go"
