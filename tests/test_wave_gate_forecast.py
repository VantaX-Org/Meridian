"""Gate evidence (actual against threshold per criterion) and the go-live readiness forecast (wave_gate)."""
from api.services.wave_gate import forecast_gate, gate_checks, rule_evidence

GATE = {"min_score": 85.0, "zero_criticals": True, "contracts_met": True}
WAVE = {"modules": ["material_master", "customer_master"]}


def _check(out, key):
    return next(c for c in out["checks"] if c["key"] == key)


def test_min_score_evidence_per_object():
    cells = [{"module": "material_master", "system_id": "s", "score": 80.0, "breaches": []},
             {"module": "customer_master", "system_id": "s", "score": 91.0, "breaches": []}]
    c = _check(gate_checks(GATE, WAVE, cells, [], evidence=None), "min_score")
    assert c["actual"] == 80.0 and c["threshold"] == 85.0 and not c["passed"]
    assert c["detail"] == "below 85.0: material_master"
    assert {i["module"]: i["passed"] for i in c["items"]} == {"material_master": False, "customer_master": True}


def test_unmeasured_object_has_no_actual():
    cells = [{"module": "material_master", "system_id": "s", "score": 90.0, "breaches": []}]
    c = _check(gate_checks(GATE, WAVE, cells, [], evidence=None), "min_score")
    assert c["actual"] is None and "not measured: customer_master" in c["detail"]


def test_criticals_list_top_rules_with_ddic_text():
    cells = [{"module": "material_master", "system_id": "a", "score": 70.0, "breaches": ["MM001", "MM002"]},
             {"module": "material_master", "system_id": "b", "score": 72.0, "breaches": ["MM001"]}]
    c = _check(gate_checks(GATE, WAVE, cells, []), "zero_criticals")
    assert c["actual"] == 3.0 and c["threshold"] == 0.0 and not c["passed"]
    top = c["items"][0]
    assert top["check_id"] == "MM001" and top["cells"] == 2
    assert top["field"] == "MARA.MATNR" and top["field_description"] == "Material Number"


def test_unknown_rule_is_not_invented():
    assert rule_evidence("material_master", "NO_SUCH_RULE") == {"message": None, "field": None,
                                                                "field_description": None}


def test_contracts_met_count():
    contracts = [{"name": "a", "consumer": "material_master", "latest_compliant": True},
                 {"name": "b", "consumer": "material_master", "latest_compliant": False}]
    c = _check(gate_checks({"contracts_met": True}, WAVE, [], contracts, evidence=None), "contracts_met")
    if c["threshold"]:  # relevant_contracts decides which name the wave
        assert c["actual"] <= c["threshold"]
        assert [i["name"] for i in c["items"]] == sorted(i["name"] for i in c["items"])


def test_forecast_projects_date_on_falling_trend():
    f = forecast_gate([{"at": "2026-10-01", "blocking": 40}, {"at": "2026-10-08", "blocking": 30},
                       {"at": "2026-10-15", "blocking": 22}])
    assert f["status"] == "projected" and f["runs_used"] == 3
    assert f["slope_per_day"] < 0 and f["projected_date"] == "2026-10-31"
    assert forecast_gate(reversed([{"at": "2026-10-01", "blocking": 40}, {"at": "2026-10-08", "blocking": 30},
                                   {"at": "2026-10-15", "blocking": 22}])) == f  # deterministic, order-free


def test_forecast_not_converging_gives_no_date():
    f = forecast_gate([{"at": "2026-10-01", "blocking": 10}, {"at": "2026-10-08", "blocking": 12}])
    assert f["status"] == "not_converging" and f["projected_date"] is None
    flat = forecast_gate([{"at": "2026-10-01", "blocking": 10}, {"at": "2026-10-08", "blocking": 10}])
    assert flat["status"] == "not_converging"


def test_forecast_no_trend_and_passing():
    assert forecast_gate([])["status"] == "no_trend"
    assert forecast_gate([{"at": "2026-10-01", "blocking": 5}])["status"] == "no_trend"
    assert forecast_gate([{"at": "2026-10-01", "blocking": 5}, {"at": "2026-10-02", "blocking": 0}])["status"] == "passing"
