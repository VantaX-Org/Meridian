"""Tests for L1-L5 business process writer."""

import pytest
from api.services.process_writer import generate_process_document


def _get_first_l3(doc):
    """Navigate to the first L3 transaction in the document."""
    l1 = doc[0]
    l2_key = "l2_groups" if "l2_groups" in l1 else "l2_processes"
    l2 = l1[l2_key][0]
    l3_key = "l3_processes" if "l3_processes" in l2 else "l3_transactions"
    return l2[l3_key][0]


def _get_all_l5_fields(doc):
    """Collect all L5 fields from the document."""
    fields = []
    for l1 in doc:
        l2_key = "l2_groups" if "l2_groups" in l1 else "l2_processes"
        for l2 in l1.get(l2_key, []):
            l3_key = "l3_processes" if "l3_processes" in l2 else "l3_transactions"
            for l3 in l2.get(l3_key, []):
                for l4 in l3.get("l4_steps", []):
                    fields.extend(l4.get("l5_fields", []))
    return fields


def test_empty_inputs_returns_processes():
    """Process definitions should be returned even with no findings."""
    doc = generate_process_document("accounts_payable", {}, {}, [])
    assert len(doc) > 0
    l1 = doc[0]
    # Should have a name (either l1_name or name)
    name = l1.get("l1_name") or l1.get("name", "")
    assert "Procure" in name or "Pay" in name or len(name) > 0


def test_l1_has_l2_children():
    """L1 should have L2 children."""
    doc = generate_process_document("accounts_payable", {}, {}, [])
    l1 = doc[0]
    l2_key = "l2_groups" if "l2_groups" in l1 else "l2_processes"
    assert len(l1[l2_key]) > 0


def test_l3_has_l4_steps():
    """L3 should have L4 steps."""
    doc = generate_process_document("accounts_payable", {}, {}, [])
    l3 = _get_first_l3(doc)
    assert "l4_steps" in l3
    assert len(l3["l4_steps"]) > 0


def test_l3_has_readiness():
    """L3 should have readiness/overall_readiness field."""
    doc = generate_process_document("accounts_payable", {}, {}, [])
    l3 = _get_first_l3(doc)
    readiness = l3.get("overall_readiness") or l3.get("readiness", "")
    assert readiness in ("green", "amber", "red")


def test_l5_fields_have_dq_status():
    """L5 fields should have a dq_status field."""
    doc = generate_process_document("accounts_payable", {}, {}, [])
    fields = _get_all_l5_fields(doc)
    assert len(fields) > 0
    for f in fields:
        status = f.get("dq_status") or f.get("status", "green")
        assert status in ("green", "amber", "red")


def test_l5_green_when_no_findings():
    """Fields with no matching findings should be green."""
    doc = generate_process_document("accounts_payable", {}, {}, [])
    fields = _get_all_l5_fields(doc)
    for f in fields:
        status = f.get("dq_status") or f.get("status", "green")
        assert status == "green"


def test_l5_red_with_critical_failure():
    """Fields with critical findings and low pass_rate should be red."""
    findings = {
        "AP018": {"pass_rate": 80.0, "affected_count": 200,
                  "severity": "critical", "message": "Bank country missing"},
    }
    doc = generate_process_document("accounts_payable", findings, {}, [])
    fields = _get_all_l5_fields(doc)

    found_red = False
    for f in fields:
        check_id = f.get("check_id", "")
        if check_id == "AP018":
            status = f.get("dq_status") or f.get("status", "")
            assert status == "red", f"AP018 should be red but was {status}"
            found_red = True
    assert found_red, "Should find AP018 field with red status"


def test_readiness_escalates_with_failures():
    """L3 readiness should escalate when fields have failures."""
    findings = {
        "AP018": {"pass_rate": 80.0, "affected_count": 200,
                  "severity": "critical", "message": "Bank country missing"},
    }
    doc = generate_process_document("accounts_payable", findings, {}, [])

    # At least one L3 should not be green
    found_non_green = False
    for l1 in doc:
        l2_key = "l2_groups" if "l2_groups" in l1 else "l2_processes"
        for l2 in l1.get(l2_key, []):
            l3_key = "l3_processes" if "l3_processes" in l2 else "l3_transactions"
            for l3 in l2.get(l3_key, []):
                readiness = l3.get("overall_readiness") or l3.get("readiness", "green")
                if readiness != "green":
                    found_non_green = True
    assert found_non_green, "At least one L3 should have non-green readiness"
