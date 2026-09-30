"""Deterministic data-contract evaluation."""

from api.services.contract_compliance import (evaluate_quality, evaluate_schema, evaluate_volume,
                                              scope_modules)

DQS = {
    "business_partner": {"composite_score": 82.0, "dimension_scores": {"completeness": 90.0, "validity": 70.0}},
    "material_master": {"composite_score": 95.0, "dimension_scores": {"completeness": 99.0, "validity": None}},
}


def test_scope_from_producer_never_falls_back_to_other_modules():
    c = {"producer": "SAP business_partner"}
    assert scope_modules(c, ["business_partner", "material_master"]) == ["business_partner"]
    assert scope_modules(c, ["material_master"]) == []  # BP contract is not evaluated on an MM-only run
    assert scope_modules({"producer": "ECC"}, ["material_master"]) == ["material_master"]
    assert scope_modules({"volume_contract": {"modules": ["material_master"]}, "producer": "SAP business_partner"},
                         ["business_partner", "material_master"]) == ["material_master"]


def test_quality_thresholds_and_unmeasured_dimensions():
    actuals, v = evaluate_quality({"min_dqs": 85, "completeness": 85, "timeliness": 90},
                                  DQS, ["business_partner"])
    assert actuals["dqs"] == 82.0 and actuals["completeness"] == 90.0
    by = {x["dimension"]: x for x in v}
    assert by["dqs"]["gap"] == 3.0
    assert "completeness" not in by
    assert by["timeliness"]["actual"] is None and by["timeliness"]["reason"] == "not measured in this run"
    # unmeasured validity in MM is skipped, not averaged as 0
    actuals, _ = evaluate_quality({}, DQS, ["business_partner", "material_master"])
    assert actuals["validity"] == 70.0 and actuals["completeness"] == 94.5


def test_volume_and_schema():
    assert evaluate_volume({"min_records": 100}, {"business_partner": 40}, ["business_partner"])[0]["records"] == 40
    assert evaluate_volume({"max_records": 10}, {"business_partner": 5}, ["business_partner"]) == []
    assert evaluate_volume({"min_records": 1}, {}, ["business_partner"]) == []  # not counted → no conclusion
    v = evaluate_schema({"version": 2, "BU_TYPE": {"mandatory": True, "allowed_values": ["1", "2"]}},
                        [("P1", {"BU_TYPE": "1"}), ("P2", {"BU_TYPE": ""}), ("P3", {"BU_TYPE": "9"})])
    assert [(x["record"], x["reason"]) for x in v] == [("P2", "mandatory field empty"), ("P3", "value '9' not allowed")]
