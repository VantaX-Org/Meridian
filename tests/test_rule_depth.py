"""Rule depth endpoints: coverage matrix, per-view table, by-code, ddic fields. No Postgres needed."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import rule_depth
from api.services import rbac
from api.services import rule_coverage as rc
from api.services.tenant_seed import rule_catalogue

TENANT = Tenant(uuid.uuid4(), "t", [])


def _rows(enabled=True):
    out = []
    for i, r in enumerate(rule_catalogue()):
        out.append({"id": uuid.uuid4(), "name": r["name"], "module": r["module"], "category": r["category"],
                    "enabled": enabled, "source": "yaml", "severity": r.get("severity"),
                    "conditions": r["conditions"]})
    return out


class _Res:
    def fetchone(self):
        return None


class _DB:
    async def execute(self, *a, **k):
        return _Res()


@pytest.fixture
def client(monkeypatch):
    rows, runs = _rows(), {}

    async def tr(db, tenant):
        assert tenant is TENANT
        return rows

    async def lr(db, tenant):
        return runs

    async def role(*a, **k):
        return "admin"

    monkeypatch.setattr(rule_depth, "_tenant_rules", tr)
    monkeypatch.setattr(rule_depth, "_last_runs", lr)
    monkeypatch.setattr(rbac, "_get_user_role", role)
    app = FastAPI()
    app.include_router(rule_depth.router)
    app.dependency_overrides[get_tenant] = lambda: TENANT
    app.dependency_overrides[get_db] = lambda: _DB()
    c = TestClient(app)
    c.rows, c.runs = rows, runs
    return c


def test_matrix_counts_match_catalogue(client):
    j = client.get("/api/v1/rules/coverage").json()
    assert j["totals"]["rules"] == len(client.rows) == sum(o["total"] for o in j["objects"])
    assert all(o["total"] == sum(o["by_dimension"].values()) for o in j["objects"])
    assert "lifecycle" in j["dimensions"] and "freshness" in j["dimensions"]
    assert j["totals"]["never_run"] == j["totals"]["rules"]  # nothing has run


def test_matrix_filters(client):
    all_n = client.get("/api/v1/rules/coverage").json()["totals"]["rules"]
    assert client.get("/api/v1/rules/coverage?enabled=false").json()["totals"]["rules"] == 0
    cc = client.get("/api/v1/rules/coverage").json()["check_classes"][0]["check_class"]
    n = client.get(f"/api/v1/rules/coverage?check_class={cc}").json()["totals"]["rules"]
    assert 0 < n < all_n


def test_material_master_views_sum_to_total(client):
    j = client.get("/api/v1/rules/coverage/material_master").json()
    assert j["has_view_map"]
    assert j["totals"]["rules"] == sum(v["total"] for v in j["views"])
    assert j["object"]["total"] == j["totals"]["rules"]
    assert {v["view"] for v in j["views"]} >= {"basic_data", "mrp", "accounting", "lifecycle"}
    for v in j["views"]:
        assert len(v["rules"]) == v["total"]


def test_mm317_563_view_counts_match_doc(client):
    vm = rc.view_map("material_master")
    ids = {f"MM{n:03d}" for n in range(317, 564)}
    counts = {v["id"]: len(ids & set(v["rules"])) for v in vm["views"]}
    assert counts == {"accounting": 24, "basic_data": 41, "batch": 6, "classification": 20, "lifecycle": 6,
                      "mrp": 28, "purchasing": 24, "quality": 9, "sales": 19, "storage": 24,
                      "supersession": 22, "units": 3, "work_scheduling": 21}


def test_unknown_module_404(client):
    assert client.get("/api/v1/rules/coverage/nope").status_code == 404


def test_module_without_view_map(client):
    mod = next(o["module"] for o in client.get("/api/v1/rules/coverage").json()["objects"]
               if rc.view_map(o["module"]) is None)
    j = client.get(f"/api/v1/rules/coverage/{mod}").json()
    assert j["has_view_map"] is False and j["views"] == []


def test_last_run_marks_not_never_run(client):
    r = client.rows[0]
    client.runs[(rc.rule_code(r["name"]), r["module"])] = 0.9
    j = client.get(f"/api/v1/rules/coverage/{r['module']}").json()
    assert j["object"]["never_run"] == j["object"]["total"] - 1


def test_by_code_catalogue_only_rule(client):
    j = client.get("/api/v1/rules/by-code/MM317?module=material_master").json()
    assert j["id"] == "MM317" and j["latest_finding_id"] is None and j["enabled"] is True
    assert j["message"] and j["check_class"]


def test_by_code_unknown_and_ambiguous(client):
    assert client.get("/api/v1/rules/by-code/ZZ999").status_code == 404
    by: dict = {}
    for (rid, m) in rc.shipped():
        by.setdefault(rid, set()).add(m)
    dup = next((k for k, v in by.items() if len(v) > 1), None)
    if dup:
        assert client.get(f"/api/v1/rules/by-code/{dup}").status_code == 409
        assert client.get(f"/api/v1/rules/by-code/{dup}?module={sorted(by[dup])[0]}").status_code == 200


def test_by_code_custom_rule(client):
    client.rows.append({"id": uuid.uuid4(), "name": "CUST1: my rule", "module": "material_master",
                        "category": "ecc", "enabled": True, "source": "custom", "severity": "high",
                        "conditions": {"field": "MARA.MATNR", "check_class": "required_field"}})
    j = client.get("/api/v1/rules/by-code/CUST1").json()
    assert j["rule_authority"] == "customer_configured" and j["source"] == "custom"


def test_ddic_fields(client):
    j = client.get("/api/v1/ddic/fields?fields=MARA.MATNR,mara.matkl,MARA.NOPE_X").json()["fields"]
    assert [f["field"] for f in j] == ["MATNR", "MATKL", "NOPE_X"]
    assert j[0]["missing"] is False and j[0]["description"]
    assert j[2]["missing"] is True
    assert client.get("/api/v1/ddic/fields?fields=MATNR").status_code == 400
    many = ",".join(f"MARA.F{i}" for i in range(101))
    assert client.get(f"/api/v1/ddic/fields?fields={many}").status_code == 400

