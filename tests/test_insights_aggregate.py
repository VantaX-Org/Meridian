import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app
from api.services import insights_aggregate as agg
from api.services.scoring import impact

T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)


def _f(check_id, module="material_master", affected=10, severity="high", dimension="completeness",
       rule_context=None, details=None, total=100, pass_rate=90.0, cost=None):
    return {"check_id": check_id, "module": module, "affected_count": affected, "total_count": total,
            "severity": severity, "dimension": dimension, "rule_context": rule_context, "details": details or {},
            "pass_rate": pass_rate, "cost_at_risk": cost}


def _summary(score, dims=None):
    return {"composite_score": score, "dimension_scores": dims or {"completeness": score},
            "dimension_coverage": {}, "critical_count": 0, "total_checks": 5}


# -- clustering: rule_context, details fallback, unattributed ---------------------------------

def test_cluster_three_paths():
    findings = [
        _f("A-1", rule_context={"field": "MARA.MATKL"}, affected=30),
        _f("A-2", rule_context=None, details={"field_checked": "MARA.MEINS"}, affected=20),
        _f("A-3", rule_context={}, details={}, affected=5),
    ]
    by_key = {c["key"]: c for c in agg.cluster_findings(findings, {})}
    assert by_key["material_master:MARA.MATKL"]["field"] == "MATKL"
    assert by_key["material_master:MARA.MATKL"]["table"] == "MARA"
    assert by_key["material_master:MARA.MEINS"]["rules"] == ["A-2"]
    un = by_key["material_master:unattributed"]
    assert un["kind"] == "unattributed" and un["field"] is None and un["rules"] == ["A-3"]


def test_rule_context_wins_over_details():
    f = _f("A-1", rule_context={"field": "MARA.A"}, details={"field_checked": "MARA.B"})
    assert agg.field_of(f) == "MARA.A"


def test_clusters_sorted_by_impact_and_passing_rules_ignored():
    findings = [_f("A-1", rule_context={"field": "T.X"}, affected=1, severity="low"),
                _f("A-2", rule_context={"field": "T.Y"}, affected=50, severity="critical"),
                _f("A-3", rule_context={"field": "T.Z"}, affected=0)]
    keys = [c["key"] for c in agg.cluster_findings(findings, {})]
    assert keys == ["material_master:T.Y", "material_master:T.X"]


# -- impact: grouped by L1, max not sum --------------------------------------------------------

def test_worst_l1_is_a_max_and_no_cross_l1_total():
    from api.services.insights_impact import by_l1, worst_l1

    rows = [{"feature": "a", "l1": "P2P", "value_at_risk": 100.0}, {"feature": "b", "l1": "P2P", "value_at_risk": 50.0},
            {"feature": "c", "l1": "O2C", "value_at_risk": 120.0}]
    assert worst_l1(rows) == ("P2P", 150.0)
    assert by_l1(rows) == {"P2P": 150.0, "O2C": 120.0}


def test_overview_has_no_cross_l1_total():
    data = _overview_data()
    data["impact_rows"] = [{"feature": "a", "l1": "P2P", "record_count": 3, "value_at_risk": 100.0},
                           {"feature": "c", "l1": "O2C", "record_count": 2, "value_at_risk": 120.0}]
    var = agg.overview_from(data)["value_at_risk"]
    assert set(var) == {"worst_l1", "worst_l1_amount", "currency", "features_blocked"}
    assert var["worst_l1"] == "O2C" and var["worst_l1_amount"] == 120.0  # not 220.0


# -- overview + narrative ----------------------------------------------------------------------

def _overview_data():
    v = {"id": uuid.uuid4(), "label": "run 2", "run_at": T0, "metadata": {},
         "dqs_summary": {"material_master": _summary(80.0, {"completeness": 70.0, "accuracy": 90.0}),
                         "business_partner": _summary(90.0)}}
    p = {"id": uuid.uuid4(), "label": "run 1", "run_at": T0 - timedelta(days=7), "metadata": {},
         "dqs_summary": {"material_master": _summary(70.0, {"completeness": 50.0, "accuracy": 90.0}),
                         "business_partner": _summary(90.0)}}
    findings = [_f("A-1", severity="critical", affected=40, rule_context={"field": "MARA.MATKL"}),
                _f("A-2", severity="high", affected=10, rule_context={"field": "MARA.MATKL"}),
                _f("B-1", module="business_partner", severity="low", affected=5)]
    return {"version": v, "previous": p, "module": None, "findings": findings, "previous_findings": [],
            "scoring": {}, "waves": [{"name": "Wave 1", "modules": ["material_master"]}],
            "fixes_by_check": {"A-1": 20}, "fix_records": 20, "high_confidence": 8, "impact_rows": [],
            "currency": "ZAR"}


def test_overview_shape_and_narrative_order():
    out = agg.overview_from(_overview_data())
    assert set(out) == {"version_id", "run_label", "run_at", "previous_version_id", "dqs", "blockers",
                        "auto_fixable", "value_at_risk", "narrative"}
    assert out["dqs"]["delta"] is not None and out["dqs"]["delta"] > 0
    assert out["blockers"]["count"] == 1 and out["blockers"]["waves"] == 1
    assert out["auto_fixable"]["records"] == 20 and out["auto_fixable"]["failing_records"] == 55
    texts = [n["text"] for n in out["narrative"]]
    assert len(texts) <= 4
    assert texts[0].startswith("The data quality score rose")
    assert "blocking rule fails" in texts[1] and "Wave 1" in texts[1]
    assert "proposed fix" in texts[2]
    assert "largest root cause" in texts[3]


def test_narrative_is_deterministic():
    d = _overview_data()
    assert agg.overview_from(d)["narrative"] == agg.overview_from(d)["narrative"]


def test_concentration_only_above_half():
    bl = [_f("A", module="x"), _f("B", module="x"), _f("C", module="y")]
    assert agg.concentration(bl)[0] == "x"
    assert agg.concentration([_f("A", module="x"), _f("B", module="y")]) is None


# -- rules, heatmap, cleansing steps -----------------------------------------------------------

def test_rule_rows_sorted_filtered_with_delta():
    cur = [_f("A-1", affected=10, severity="low"), _f("A-2", affected=10, severity="critical"),
           _f("A-3", affected=0)]
    prev = [_f("A-2", affected=4)]
    rows = agg.rule_rows(cur, prev, {"A-1": 5})
    assert [r["check_id"] for r in rows] == ["A-2", "A-1"]
    assert rows[0]["delta_affected"] == 6 and rows[1]["delta_affected"] is None
    assert rows[0]["impact"] == impact(10, "critical")
    assert rows[0]["pass_rate"] == 0.9
    assert [r["check_id"] for r in agg.rule_rows(cur, prev, {"A-1": 5}, auto_fixable=True)] == ["A-1"]
    assert [r["check_id"] for r in agg.rule_rows(cur, prev, {}, severity="critical")] == ["A-2"]


def test_heatmap_rows_have_tier_and_coverage_dicts():
    rows = agg.heatmap_rows({"material_master": _summary(80.0), "employee_central": _summary(60.0)}, {})
    assert {r["module"]: r["group"] for r in rows} == {"material_master": "ecc", "employee_central": "successfactors"}
    assert set(rows[0]["tier"]) >= {"composite"} and isinstance(rows[0]["coverage"], dict)


def test_cleansing_steps_order():
    assert [s["key"] for s in agg.cleansing_steps(5, 4, 3, 2, 1)] == ["failing", "proposed", "high", "approved", "applied"]


def test_origin_share_is_a_fraction():
    row = {"status": "computed", "origins": [{"origin": "interface", "username": "ZBATCH", "records": 9, "share": 90}]}
    assert agg.origin_of(row) == {"status": "computed", "top": "interface ZBATCH", "share": 0.9}
    assert agg.origin_of(None)["status"] == "not_computed"


# -- PG: routes + tenant isolation -------------------------------------------------------------

pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


@pytest.fixture
def two_tenants_with_run():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2, v1 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        conn.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, dqs_summary) "
                          "VALUES (:id, :t, 'complete', now(), CAST(:s AS jsonb))"),
                     {"id": v1, "t": t1, "s": json.dumps({"material_master": _summary(77.0)})})
        conn.execute(text(
            "INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, affected_count, "
            "total_count, pass_rate, rule_context) VALUES (:id, :v, :t, 'material_master', 'MM-001', 'high', "
            "'completeness', 12, 100, 88, CAST(:rc AS jsonb))"),
            {"id": str(uuid.uuid4()), "v": v1, "t": t1, "rc": json.dumps({"field": "MARA.MATKL"})})
    yield t1, t2, v1
    with engine.begin() as conn:
        for tbl in ("findings", "analysis_versions"):
            conn.execute(text(f"DELETE FROM {tbl} WHERE tenant_id IN (:a, :b)"), {"a": t1, "b": t2})
        conn.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": t1, "b": t2})


def _patch_tenant(monkeypatch, tenant_id: str):
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token", lambda token, secret: {
        "sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tenant_id), "T", []))


PATHS = ("overview", "rules", "root-causes", "heatmap", "trends", "cleansing")


@pg
@pytest.mark.anyio
async def test_routes_return_data_for_owner_and_404_for_other_tenant(two_tenants_with_run, monkeypatch):
    t1, t2, v1 = two_tenants_with_run
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for p in PATHS:
            r = await client.get(f"/api/v1/insights/{p}?version_id={v1}", headers=headers)
            assert r.status_code == 200, (p, r.text)
        rules = (await client.get(f"/api/v1/insights/rules?version_id={v1}", headers=headers)).json()
        assert [x["check_id"] for x in rules["rows"]] == ["MM-001"]
        rc = (await client.get(f"/api/v1/insights/root-causes?version_id={v1}", headers=headers)).json()
        assert rc["clusters"][0]["key"] == "material_master:MARA.MATKL"
    _patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for p in PATHS:
            r = await client.get(f"/api/v1/insights/{p}?version_id={v1}", headers=headers)
            assert r.status_code == 404, (p, r.text)
