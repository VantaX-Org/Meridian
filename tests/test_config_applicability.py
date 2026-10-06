"""Config-aware DQ score: applicability from loaded config, score = passes / applicable."""

from pathlib import Path

import yaml

from api.services.config_applicability import conditions, evaluate, process_index, required_objects, score

QM_OFF = {"TQ30": {"state": "empty", "rows": []}}
QM_ON = {"TQ30": {"state": "loaded", "rows": [{"ART": "01"}]}}


def test_every_yaml_pack_is_a_real_rule_module():
    modules = set()
    for f in Path("checks/rules").rglob("*.yaml"):
        for doc in yaml.safe_load_all(f.read_text()):
            if isinstance(doc, dict) and doc.get("module"):
                modules.add(doc["module"])
    assert set(conditions()["packs"]) <= modules


def test_yaml_conditions_are_well_formed():
    for group in conditions().values():
        for cond in group.values():
            assert cond["reason"] and cond["requires"]["object"]


def test_not_applicable_when_config_read_and_condition_not_met():
    ok, reason = evaluate("quality_management", "QM-1", QM_OFF)
    assert ok is False and reason == "no QM inspection types active in TQ30"


def test_applicable_when_condition_met():
    assert evaluate("quality_management", "QM-1", QM_ON) == (True, None)


def test_never_guess_when_config_not_read():
    for state in ("failed", "not_available"):
        assert evaluate("quality_management", "QM-1", {"TQ30": {"state": state, "rows": []}})[0] is True
    assert evaluate("quality_management", "QM-1", {})[0] is True


def test_no_dependency_stays_applicable():
    assert evaluate("business_partner", "BP-1", QM_OFF) == (True, None)


def test_where_filter_counts_matching_rows_only():
    cfg = {"T003O": {"state": "loaded", "rows": [{"AUART": "OR", "AUTYP": "10"}]}}
    assert evaluate("plant_maintenance", "PM-1", cfg)[0] is False  # only a production order type
    cfg["T003O"]["rows"].append({"AUART": "PM01", "AUTYP": "30"})
    assert evaluate("plant_maintenance", "PM-1", cfg)[0] is True


def test_required_objects_cover_every_condition_object():
    objs = required_objects()
    assert "TQ30" in objs and "AUTYP" in objs["T003O"]


def _f(module, cid, affected, sev="high"):
    return {"module": module, "check_id": cid, "severity": sev, "affected_count": affected}


def test_score_is_passes_over_applicable_only_and_existing_rules_unchanged():
    rows = [_f("business_partner", "A", 0), _f("business_partner", "B", 5), _f("quality_management", "Q1", 9)]
    r = score(rows, QM_OFF)["config_aware"]
    assert (r["applicable"], r["not_applicable"], r["passes"], r["score"]) == (2, 1, 1, 50.0)
    assert r["not_applicable_reasons"] == [{"reason": "no QM inspection types active in TQ30", "count": 1}]
    assert r["top_failing"][0]["check_id"] == "B"
    assert score(rows, QM_ON)["config_aware"]["applicable"] == 3


def test_all_not_applicable_gives_no_score_not_a_division_error():
    r = score([_f("quality_management", "Q1", 1)], QM_OFF)["config_aware"]
    assert r["score"] is None and r["applicable"] == 0


def test_breakdown_per_process_l1_l2():
    idx = process_index()
    l1 = next(x for x in idx if any(l2["checks"] for l2 in x["l2"]))
    l2 = next(x for x in l1["l2"] if x["checks"])
    cid = sorted(l2["checks"])[0]
    out = score([_f("business_partner", cid, 3)], {})
    p = next(x for x in out["processes"] if x["l1"] == l1["l1"])
    assert p["l2"][0]["l2"] == l2["l2"] and p["l2"][0]["applicable"] == 1 and p["l2"][0]["score"] == 0.0
    assert out["unmapped"] is None
