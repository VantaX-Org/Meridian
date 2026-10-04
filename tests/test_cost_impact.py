"""Cost of poor DQ (checks/cost.py), configurable scoring and impact ranking."""
import pandas as pd

from checks import cost


def test_resolve_precedence_tenant_rule_then_yaml_then_module_then_severity():
    rule = {"id": "PUR001", "module": "mm_purchasing", "severity": "high"}
    assert cost.resolve(rule)["field"] == "EKPO.NETWR"                       # module default
    assert cost.resolve({**rule, "cost": {"per_record": 7}})["per_record"] == 7  # rule YAML
    tenant = {"rules": {"PUR001": {"per_record": 3}}, "currency": "USD"}
    spec = cost.resolve({**rule, "cost": {"per_record": 7}}, tenant)
    assert spec["per_record"] == 3 and spec["currency"] == "USD"
    other = cost.resolve({"id": "X", "module": "fi_gl", "severity": "critical"},
                         {"severity": {"critical": {"per_record": 900}}})
    assert other["per_record"] == 900 and cost.effective({})["severity"]["low"] == {"per_record": 10}


def test_price_per_record_field_and_fallback():
    amount, formula = cost.price({"per_record": 50, "factor": 0.5, "currency": "ZAR"}, 4)
    assert amount == 100.0 and formula == "4 records × 50.00 ZAR × 0.5"

    failing = pd.DataFrame({"EKPO.NETWR": ["1,000.00", "500.00-", "2000"]})
    spec = cost.resolve({"id": "PUR001", "module": "mm_purchasing", "severity": "high"})
    amount, formula = cost.price(spec, 3, failing)
    assert amount == 125.0 and "sum(EKPO.NETWR) of 3 failing records = 2,500.00 ZAR × 0.05" == formula

    amount, formula = cost.price(spec, 3, pd.DataFrame({"EKPO.MATNR": ["A"] * 3}))
    assert amount == 450.0 and "not in the failing records" in formula   # high severity: 150 each
    assert cost.price(spec, 0) == (0.0, "no failing records")
    assert cost.price(None, 5) == (None, None)


def test_validate_spec():
    assert cost.validate_spec({"per_record": 5}) is None
    assert cost.validate_spec({"field": "MBEW.SALK3", "factor": 0.1}) is None
    assert cost.validate_spec({"per_record": 5, "field": "MBEW.SALK3"})
    assert cost.validate_spec({"per_record": -1})
    assert cost.validate_spec({"field": "SALK3"})
    assert cost.validate_spec({"per_record": 1, "factor": -2})


def test_impact_orders_by_cost_blocked_and_severity():
    assert cost.impact(100.0, 2, "critical") == 1200.0   # 100 × (1+2) × 4
    assert cost.impact(100.0, 0, "low") == 100.0
    assert cost.impact(None, 3, "high") is None
    blocked = cost.blocked_features("EC001")
    assert blocked and all(isinstance(f, str) for f in blocked)


def test_check_result_carries_cost_from_failing_records():
    from checks.runner import REGISTRY
    rule = {"id": "T1", "module": "mm_purchasing", "severity": "high", "check_class": "null_check",
            "field": "EKPO.MATNR", "dimension": "completeness"}
    rule["_cost"] = cost.resolve(rule)
    df = pd.DataFrame({"EKPO.MATNR": ["M1", None, ""], "EKPO.NETWR": ["10", "200", "300"]})
    res = REGISTRY["null_check"](rule).run(df, key_cols=[], grain="EKPO")
    assert res.affected_count == 2 and res.cost_at_risk == 25.0   # (200+300) × 0.05


def test_scoring_tier_rescore_and_module_weights():
    from api.routes.findings import composite_dqs
    from api.services.scoring import rescore, scoring_config, tier

    assert tier(92) == "pass" and tier(80) == "warn" and tier(50) == "fail"
    assert tier(80, {"warn": 85, "pass": 95}) == "fail"
    cfg = scoring_config({"completeness": 50, "accuracy": 50, "consistency": 0, "timeliness": 0,
                          "uniqueness": 0, "validity": 0, "module_weights": {"fi_gl": 3, "bad": -1},
                          "thresholds": {"pass": 95}, "notification_config": {"email": "x"}})
    assert cfg["dimension_weights"]["completeness"] == 0.5 and cfg["module_weights"] == {"fi_gl": 3.0}
    assert cfg["thresholds"] == {"pass": 95.0, "warn": 75.0}

    stored = {"composite_score": 80.0, "critical_count": 0, "total_checks": 10, "capped": False,
              "dimension_scores": {"completeness": 100.0, "accuracy": 60.0},
              "dimension_coverage": {"completeness": 2, "accuracy": 2}}
    again = rescore(stored, {"completeness": 75, "accuracy": 25, "consistency": 0, "timeliness": 0,
                             "uniqueness": 0, "validity": 0})
    assert again["composite_score"] == 90.0 and again["tier"] == "pass"
    assert rescore({**stored, "critical_count": 1}, {"completeness": 100})["composite_score"] == 85.0

    a = {"composite_score": 90.0, "total_checks": 10, "dimension_scores": {}}
    b = {"composite_score": 60.0, "total_checks": 10, "dimension_scores": {}}
    assert composite_dqs([{"fi_gl": a, "mm": b}])["composite"] == 75.0
    out = composite_dqs([{"fi_gl": a, "mm": b}], {"module_weights": {"fi_gl": 3}})
    assert out["composite"] == 82.5 and out["tier"] == "warn"
