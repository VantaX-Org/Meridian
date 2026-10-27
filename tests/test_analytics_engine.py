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


def test_planner_amounts_take_the_cost_model_currency():
    """The cost model's currency names planner amounts, over a planner currency left in older settings."""
    cfg = planner_config({"cost_per_record": 10, "currency": "ZAR"}, "USD")
    actions = PrescriptiveAnalytics(cfg).generate_next_best_actions(_findings(), [], [])
    assert cfg["currency"] == "USD" and all(a["currency"] == "USD" for a in actions)


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
    # the high finding's severity multiplier already pulls the score below the cap; fixing it alone
    # lifts the score until the critical cap at 85 binds: the projection says so
    assert with_high["records_fixed"] == 400 and with_high["dqs_now"] < with_high["dqs_projected"] == 85.0


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


def test_impact_defaults_keep_the_shipped_rand_values() -> None:
    """Without a tenant cost model the buckets price at the figures Meridian shipped with, in ZAR."""
    from api.services.analytics_engine import BusinessImpactAnalytics

    bia = BusinessImpactAnalytics()
    impacts = {i["category"]: i for i in bia.quantify_impact(
        [{"dimension": "uniqueness", "affected_count": 2, "module": "accounts_payable", "check_id": "AP001"},
         {"dimension": "completeness", "affected_count": 3, "module": "material_master", "check_id": "MM001"}],
        [{"type": "blocked_invoice"}, {"type": "auto_resolved"}])}
    assert impacts["duplicate_payment"]["annual_risk"] == round(2 * 8500 * 0.023 * 12, 2)
    assert impacts["duplicate_payment"]["mitigated"] == round(2 * 8500 * 0.023 * 12 * 0.7, 2)
    assert impacts["inventory_write_off"]["annual_risk"] == 3 * 8000
    assert impacts["blocked_invoice"]["annual_risk"] == 12000 * 12
    assert impacts["labour_displacement"]["annual_risk"] == 0.25 * 450 * 12
    assert all(i["currency"] == "ZAR" for i in impacts.values())
    # the historical key names carry the same amounts
    assert all(i["annual_risk_zar"] == i["annual_risk"] and i["mitigated_zar"] == i["mitigated"] for i in impacts.values())
    assert impacts["warranty_miss"]["calculation_method"] == "affected_count × 35,000 ZAR"
    assert bia.calculate_roi(list(impacts.values()))["currency"] == "ZAR"


def test_impact_and_roi_price_from_the_tenant_cost_model() -> None:
    """A tenant's unit costs, mitigation shares, currency and subscription drive every amount."""
    from api.services.analytics_engine import BusinessImpactAnalytics

    bia = BusinessImpactAnalytics({
        "currency": "EUR",
        "impact": {"duplicate_payment": {"unit_cost": 100, "factor": 2, "mitigation": 0.5},
                   "blocked_invoice": {"unit_cost": 1000}},
        "subscription_monthly": 1000,
    })
    impacts = {i["category"]: i for i in bia.quantify_impact(
        [{"dimension": "uniqueness", "affected_count": 3, "module": "accounts_payable", "check_id": "AP001"}],
        [{"type": "blocked_invoice"}])}
    assert impacts["duplicate_payment"]["annual_risk"] == 600.0 and impacts["duplicate_payment"]["mitigated"] == 300.0
    assert impacts["duplicate_payment"]["calculation_method"] == "affected_count × 100 EUR × 2"
    # a partial override keeps the default factor (12 months) and mitigation (0.9)
    assert impacts["blocked_invoice"]["annual_risk"] == 12000.0 and impacts["blocked_invoice"]["mitigated"] == 10800.0
    assert all(i["currency"] == "EUR" for i in impacts.values())
    roi = bia.calculate_roi(list(impacts.values()))
    assert roi == {"subscription_annual": 12000.0, "risk_mitigated": 11100.0, "roi_multiple": 0.9,
                   "payback_months": round(12000 / 11100 * 12, 1), "currency": "EUR"}


def test_roi_without_a_subscription_states_no_multiple_payback_or_fee() -> None:
    """With no subscription in the cost model, ROI multiple, payback and the annual subscription are None
    (never computed from an invented fee); the cost avoided is still stated."""
    import inspect

    from api.routes import analytics as analytics_routes
    from api.services.analytics_engine import BusinessImpactAnalytics

    bia = BusinessImpactAnalytics()
    impacts = [{"mitigated_zar": 540000.0}]
    for sub in (None, 0.0):
        roi = bia.calculate_roi(impacts, sub)
        assert roi["subscription_annual"] is None
        assert roi["roi_multiple"] is None
        assert roi["payback_months"] is None
        assert roi["risk_mitigated"] == 540000.0
    # A real subscription still yields the multiple and payback.
    real = bia.calculate_roi(impacts, 15000.0)
    assert real["subscription_annual"] == 180000.0 and real["roi_multiple"] == 3.0 and real["payback_months"] == 4.0
    # The routes use no hard-coded fee: the default cost model has none.
    assert BusinessImpactAnalytics().subscription_monthly is None
    assert "15000" not in inspect.getsource(analytics_routes)


def test_prescriptive_for_one_object_ranks_only_that_objects_findings(monkeypatch) -> None:
    """GET /analytics/prescriptive?module=: the object page's next best action comes from that object's findings
    of the named run, never another object's, a cleaning item or an exception."""
    import uuid

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import analytics as routes
    from db.schema import AnalysisVersion, Finding

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    tid, vid = uuid.uuid4(), uuid.uuid4()
    rows = [Finding(id=uuid.uuid4(), tenant_id=tid, version_id=vid, module=m, check_id=c, severity="high",
                    dimension="validity", affected_count=n, total_count=1000)
            for m, c, n in (("material_master", "MM003", 40), ("business_partner", "BP010", 900))]

    class Res:
        def __init__(self, items):
            self.items = items

        def first(self):
            return self.items[0] if self.items else None

        def all(self):
            return self.items

        def fetchone(self):
            return None

        def scalar(self):
            return None

    class Db:
        def __init__(self):
            self.sql: list[str] = []

        async def execute(self, stmt, params=None):
            try:
                sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
            except Exception:
                sql = str(stmt)
            self.sql.append(sql)
            if "FROM analysis_versions" in sql:
                return Res([(AnalysisVersion(id=vid, tenant_id=tid),)])
            if "FROM findings" in sql:
                return Res([(f,) for f in rows if f"findings.module = '{f.module}'" in sql
                            or "findings.module" not in sql.split("WHERE", 1)[-1]])
            if "FROM cleaning_queue" in sql:
                return Res([])
            return Res([])

    db = Db()
    app = FastAPI()
    app.include_router(routes.router)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(tid, "T", [])
    c = TestClient(app)
    h = {"X-User-Role": "viewer"}

    body = c.get(f"/api/v1/analytics/prescriptive?version_id={vid}&module=material_master&limit=1", headers=h).json()
    assert [(a["module"], a["check_id"]) for a in body["actions"]] == [("material_master", "MM003")]
    assert body["basis"] == {"version_id": str(vid), "findings": 1, "cleaning_items": 0, "exceptions": 0}
    assert not any("cleaning_queue" in s or "FROM exceptions" in s for s in db.sql)

    # without an object every object's findings rank, the larger first
    body = c.get(f"/api/v1/analytics/prescriptive?version_id={vid}", headers=h).json()
    assert [a["check_id"] for a in body["actions"]][:2] == ["BP010", "MM003"]
