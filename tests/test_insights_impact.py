from api.services.insights_impact import value_at_risk


def test_value_at_risk_multiplies_blocked_records_by_value_per_record():
    assert value_at_risk(10, 150.0) == 1500.0


def test_value_at_risk_rounds_to_two_decimals():
    assert value_at_risk(3, 33.333) == 100.0


def test_value_at_risk_zero_blocked_is_zero():
    assert value_at_risk(0, 999.0) == 0.0
