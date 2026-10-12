from api.services.insights_impact import value_at_risk


def test_value_at_risk_multiplies_blocked_records_by_value_per_record():
    assert value_at_risk(10, 150.0) == 1500.0


def test_value_at_risk_rounds_to_two_decimals():
    assert value_at_risk(3, 33.333) == 100.0


def test_value_at_risk_zero_blocked_is_zero():
    assert value_at_risk(0, 999.0) == 0.0


def test_every_config_impact_rule_has_an_l1():
    from pathlib import Path

    import yaml

    rules = yaml.safe_load((Path(__file__).resolve().parents[1] / "db/seeds/config_impact_rules.yaml").read_text())["rules"]
    assert rules
    assert [r["check_id"] for r in rules if not r.get("l1")] == []
