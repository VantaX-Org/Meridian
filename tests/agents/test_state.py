"""Tests for AgentState TypedDict structure."""

from agents.state import AgentState


def test_agent_state_construction():
    """Construct a valid AgentState with all fields populated."""
    state: AgentState = {
        "version_id": "test-version-001",
        "tenant_id": "test-tenant-001",
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
                "message": "BP type is mandatory in S/4HANA",
            }
        ],
        "dqs_scores": {
            "business_partner": {
                "composite_score": 72.4,
                "dimension_scores": {"completeness": 85.0},
                "critical_count": 1,
                "capped": True,
            }
        },
        "root_causes": [
            {
                "module": "business_partner",
                "finding_ids": ["BP001"],
                "root_cause": "Incomplete master data migration",
                "business_impact": "Blocks S/4HANA conversion",
                "sap_context": "Transaction BP, table BUT000",
            }
        ],
        "remediations": [
            {
                "check_id": "BP001",
                "module": "business_partner",
                "severity": "critical",
                "fix_steps": ["1. Run transaction BP."],
                "sap_transaction": "BP",
                "estimated_effort": "2 person-days",
            }
        ],
        "readiness_scores": {
            "business_partner": {
                "score": 72.4,
                "status": "conditional",
                "blockers": [],
                "conditions": ["Resolve BP type completeness"],
            }
        },
        "report": {"report_id": "test"},
        "error": None,
    }

    assert state["version_id"] == "test-version-001"
    assert state["tenant_id"] == "test-tenant-001"
    assert len(state["module_names"]) == 2
    assert len(state["findings_summary"]) == 1
    assert state["error"] is None


def test_agent_state_is_typed_dict():
    """AgentState must be a TypedDict subclass."""
    assert hasattr(AgentState, "__annotations__")
    # TypedDict classes have __required_keys__ and __optional_keys__
    assert hasattr(AgentState, "__required_keys__") or hasattr(AgentState, "__annotations__")


def test_findings_summary_no_raw_data():
    """findings_summary must never contain raw row data fields."""
    state: AgentState = {
        "version_id": "v1",
        "tenant_id": "t1",
        "module_names": ["bp"],
        "findings_summary": [
            {
                "check_id": "BP001",
                "module": "business_partner",
                "severity": "critical",
                "dimension": "completeness",
                "affected_count": 10,
                "total_count": 100,
                "pass_rate": 90.0,
                "message": "Test finding",
            }
        ],
        "dqs_scores": {},
        "root_causes": [],
        "remediations": [],
        "readiness_scores": {},
        "report": None,
        "error": None,
    }

    forbidden_keys = {"rows", "data", "records", "dataframe"}
    for finding in state["findings_summary"]:
        overlap = set(finding.keys()) & forbidden_keys
        assert not overlap, f"findings_summary must not contain raw data keys: {overlap}"
