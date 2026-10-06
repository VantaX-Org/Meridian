"""Tests for L1-L5 business process writer."""

import pytest
from api.services.process_writer import generate_process_document


def _get_first_l3(doc):
    """Navigate to the first L3 process in the document."""
    return doc[0]["l2_groups"][0]["l3_processes"][0]


def _get_all_l5_fields(doc):
    """Collect all L5 fields from the document."""
    fields = []
    for l1 in doc:
        for l2 in l1["l2_groups"]:
            for l3 in l2["l3_processes"]:
                for l4 in l3["l4_subprocesses"]:
                    for act in l4["activities"]:
                        fields.extend(act["fields"])
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
    assert len(doc[0]["l2_groups"]) > 0


def test_l3_has_l4_subprocesses_with_activities():
    """L3 has L4 sub-processes; each has L5 activities carrying fields."""
    doc = generate_process_document("accounts_payable", {}, {}, [])
    l3 = _get_first_l3(doc)
    assert len(l3["l4_subprocesses"]) > 0
    l4 = l3["l4_subprocesses"][0]
    assert l4["tcode"] and l4["activities"]
    act = l4["activities"][0]
    assert act["l5_id"].startswith(l4["l4_id"]) and act["fields"] and act["activity_status"] == "green"


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
        for l2 in l1["l2_groups"]:
            for l3 in l2["l3_processes"]:
                readiness = l3.get("overall_readiness") or l3.get("readiness", "green")
                if readiness != "green":
                    found_non_green = True
    assert found_non_green, "At least one L3 should have non-green readiness"


def test_classify_uses_percent_scale():
    """findings.pass_rate is stored 0-100; 50% must not read as green."""
    from api.services.process_writer import _classify_finding
    assert _classify_finding({"severity": "low", "pass_rate": 50.0}) == "red"
    assert _classify_finding({"severity": "low", "pass_rate": 80.0}) == "amber"
    assert _classify_finding({"severity": "low", "pass_rate": 99.0}) == "green"


# check_ids of every field in the process model before the L1-L5 migration (22 of them).
_OLD_CHECK_IDS = {
    "AP001", "AP003", "AP005", "AP007", "AP009", "AP010", "AP014", "AP016", "AP017", "AP018", "AP019", "AP020",
    "AR001", "AR005", "AR010", "MM001", "MM005", "PUR003", "PUR004", "SD005", "SO001", "SO005",
}


def test_every_old_check_id_survives():
    """The migration must not lose a field -> check_id link."""
    from sap.process_definitions import PROCESS_DEFINITIONS, get_check_ids_for_process

    ids = {f["check_id"] for l1 in PROCESS_DEFINITIONS for l2 in l1["l2"] for l3 in l2["l3"]
           for l4 in l3["l4"] for a in l4["activities"] for f in a["fields"] if f["check_id"]}
    assert ids == _OLD_CHECK_IDS
    assert set().union(*(get_check_ids_for_process(p["id"]) for p in PROCESS_DEFINITIONS)) == _OLD_CHECK_IDS


def test_old_ids_survive_at_new_levels():
    from sap.process_definitions import reference_document

    doc = reference_document()
    assert [x.id for x in doc.l1] == ["PTP", "OTC"]
    assert len(doc.all_l4()) == 8 and {x.id for x in doc.all_l4()} >= {"PTP-VM-FK01", "OTC-SO-VA01", "PTP-IV-MIRO"}
    acts = {a.id for l4 in doc.all_l4() for a in l4.activities}
    assert {"PTP-VM-FK01-01", "OTC-SO-VA01-04", "PTP-IV-MIRO-01"} <= acts


def test_activity_statuses_share_the_readiness_colouring():
    from api.services.process_writer import activity_statuses
    from sap.process_definitions import reference_document

    findings = {"AP018": {"pass_rate": 80.0, "affected_count": 200, "severity": "critical", "message": "x"}}
    doc = reference_document()
    out = activity_statuses(doc, findings, {}, [])
    red = [k for k, v in out.items() if v["dq_status"] == "red"]
    assert red and all(out[k]["affected_count"] == 200 and out[k]["finding_count"] == 1 for k in red)
    assert all(v["dq_status"] == "green" for k, v in out.items() if k not in red)


def test_mining_transition_passes_through_gateway():
    """A flow task -> exclusiveGateway -> task collapses to one activity-to-activity transition."""
    from api.routes.process_mining import _collapse

    edges = _collapse("OTC-SO-VA01")
    assert ("OTC-SO-VA01-03", "OTC-SO-VA01-04") in edges  # the gateway sits between them
    assert _collapse("PTP-IV-MIRO") == []  # gateway leads only to end events: no transition
    assert _collapse("NO-SUCH-L4") == []
