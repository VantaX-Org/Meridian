"""The prescriptive planner derives every figure from findings and stated assumptions."""

from datetime import datetime, timedelta, timezone

from api.services.analytics_engine import (
    DEFAULT_PLANNER,
    PredictiveAnalytics,
    PrescriptiveAnalytics,
    planner_config,
    project_dqs,
)


def _findings():
    return [
        {"id": "f-crit", "module": "accounts_payable", "check_id": "AP001", "severity": "critical",
         "dimension": "completeness", "affected_count": 20, "total_count": 1000, "pass_rate": 98.0},
        {"id": "f-high", "module": "accounts_payable", "check_id": "AP016", "severity": "high",
         "dimension": "validity", "affected_count": 400, "total_count": 1000, "pass_rate": 60.0},
        {"id": "f-pass", "module": "accounts_payable", "check_id": "AP002", "severity": "critical",
         "dimension": "accuracy", "affected_count": 0, "total_count": 1000, "pass_rate": 100.0},
    ]


def test_actions_are_derived_and_carry_no_money_without_a_rate():
    planner = PrescriptiveAnalytics()
    actions = planner.generate_next_best_actions(_findings(), [{"id": "q1", "object_type": "vendor", "record_key": "V1"}],
                                                 [{"id": "x1", "title": "Blocked payment run", "severity": "high"}])
    by_id = {a["id"]: a for a in actions}
    assert "f-pass" not in by_id  # a passing check is not work
    crit = by_id["f-crit"]
    # 1 h investigation + 20 records × 3 min
    assert crit["effort_hours"] == 2.0 and crit["impact_points"] == 40 * 20
    assert crit["value_per_hour"] == 400.0
    assert all(a["estimated_cost"] is None for a in actions)
    assert by_id["q1"]["effort_hours"] == DEFAULT_PLANNER["cleaning_item_hours"]
    assert by_id["x1"]["effort_hours"] == DEFAULT_PLANNER["exception_hours"]
    # ranked by value per hour, highest first
    values = [a["value_per_hour"] for a in actions]
    assert values == sorted(values, reverse=True)


def test_cost_appears_only_at_the_tenants_own_rate():
    planner = PrescriptiveAnalytics({"cost_per_record": 120, "currency": "EUR", "minutes_per_record": 6})
    actions = planner.generate_next_best_actions(_findings(), [], [])
    crit = next(a for a in actions if a["id"] == "f-crit")
    assert crit["estimated_cost"] == 20 * 120 and crit["currency"] == "EUR"
    assert crit["effort_hours"] == 1.0 + 20 * 6 / 60
    assert planner_config({"minutes_per_record": None, "bogus": 1})["minutes_per_record"] == 3.0


def test_sprint_projects_dqs_through_the_scoring_engine():
    findings = _findings()
    planner = PrescriptiveAnalytics({"sprint_hours": 10})
    actions = planner.generate_next_best_actions(findings, [], [])
    sprints = planner.generate_sprints(actions, findings=findings, weights=None)
    # the 400-record high finding (21 h) and the 20-record critical (2 h) cannot share a 10 h bucket
    assert len(sprints) == 2 and all(len(s["actions"]) == 1 for s in sprints)
    with_crit = next(s for s in sprints if s["critical_cleared"] == 1)
    assert with_crit["records_fixed"] == 20 and with_crit["estimated_cost"] is None
    # one critical failure caps the module at 85; clearing it lifts the cap
    assert with_crit["dqs_now"] is not None and with_crit["dqs_projected"] is not None
    assert with_crit["dqs_projected"] > with_crit["dqs_now"]
    with_high = next(s for s in sprints if s["critical_cleared"] == 0)
    # fixing the high finding alone leaves the critical cap at 85 in place: the projection says so
    assert with_high["records_fixed"] == 400 and with_high["dqs_projected"] == with_high["dqs_now"] == 85.0


def test_project_dqs_handles_an_empty_set():
    assert project_dqs(_findings(), set(), None)["now"] == project_dqs(_findings(), set(), None)["projected"]
    assert project_dqs([], {"x"}, None) == {"now": None, "projected": None}


def test_forecast_regresses_on_calendar_days():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    # one point a week, +1 DQS per week → +1 per 7 days, so +30 days ≈ +4.3 points
    weekly = [{"module_id": "ap", "dqs_score": 70 + i, "recorded_at": t0 + timedelta(days=7 * i)} for i in range(4)]
    [f] = PredictiveAnalytics().forecast_dqs(weekly)
    assert f["points"] == 4 and f["span_days"] == 21.0
    assert abs(f["forecast_7d"] - 74.0) < 0.06 and abs(f["forecast_30d"] - (73 + 30 / 7)) < 0.06
    # the same scores a day apart project ten times faster
    daily = [{**p, "recorded_at": t0 + timedelta(days=i)} for i, p in enumerate(weekly)]
    [g] = PredictiveAnalytics().forecast_dqs(daily)
    assert g["forecast_7d"] > f["forecast_7d"]
    # missing stamps fall back to the run index without failing
    [h] = PredictiveAnalytics().forecast_dqs([{**p, "recorded_at": None} for p in weekly])
    assert h["forecast_7d"] == 80.0
