"""Wave CRUD and run-now (api/routes/migration.py) on Postgres, through the real app and RLS."""

import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app
from api.services.migration import object_label

pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")
H = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


def test_object_labels():
    assert object_label("material_master") == "Material"
    assert object_label("accounts_payable") == "BP supplier"
    assert object_label("sd_customer_master") == "BP customer"
    assert object_label("fi_gl") == "GL account"
    assert object_label("asset_accounting") == "Fixed asset"
    assert object_label("plant_maintenance") == "Plant Maintenance"


@pytest.fixture
def tenants():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2, prd, s4d = (str(uuid.uuid4()) for _ in range(4))
    with engine.begin() as c:
        for t in (t1, t2):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:p, :t, 'PRD'), (:s, :t, 'S4D')"),
                  {"p": prd, "s": s4d, "t": t1})
        # _as() always authenticates as this fixed user id; migration_runs.requested_by is FK-checked.
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES "
                       "('00000000-0000-0000-0000-000000000002', :t, 'dev@example.com', 'Dev', 'admin')"),
                  {"t": t1})
    yield t1, t2, prd, s4d
    with engine.begin() as c:
        c.execute(text("DELETE FROM migration_runs WHERE tenant_id IN (:a, :b)"), {"a": t1, "b": t2})
        c.execute(text("DELETE FROM migration_waves WHERE tenant_id IN (:a, :b)"), {"a": t1, "b": t2})
        c.execute(text("DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000002'"))
        c.execute(text("DELETE FROM sap_systems WHERE tenant_id = :a"), {"a": t1})
        c.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": t1, "b": t2})
    engine.dispose()


async def _as(monkeypatch, tenant_id: str) -> AsyncClient:
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": "00000000-0000-0000-0000-000000000002",
                                               "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tenant_id), "T", []))
    await api_deps.engine.dispose()
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pg
@pytest.mark.anyio
async def test_wave_crud_is_tenant_isolated(tenants, monkeypatch):
    t1, t2, prd, s4d = tenants
    async with await _as(monkeypatch, t1) as c:
        r = await c.post("/api/v1/migration/waves", headers=H, json={
            "name": "Wave 1", "source_system_id": prd, "target_system_id": s4d,
            "modules": ["material_master"], "target_date": "2027-03-01", "stage": "mock1"})
        assert r.status_code == 200, r.text
        wid = r.json()["id"]
        assert r.json()["min_readiness"] == 95.0
        assert (await c.post("/api/v1/migration/waves", headers=H, json={"name": "Wave 1"})).status_code == 409
        assert (await c.post("/api/v1/migration/waves", headers=H,
                             json={"name": "W2", "source_system_id": prd, "target_system_id": prd})).status_code == 400
        assert (await c.post("/api/v1/migration/waves", headers=H,
                             json={"name": "W3", "stage": "golive"})).status_code == 422
        r = await c.patch(f"/api/v1/migration/waves/{wid}", headers=H, json={"stage": "mock2", "min_dqs": 75})
        assert r.status_code == 200 and r.json()["stage"] == "mock2" and r.json()["min_dqs"] == 75.0
        waves = (await c.get("/api/v1/migration/waves", headers=H)).json()["waves"]
        assert [w["name"] for w in waves] == ["Wave 1"] and waves[0]["trend"] == []
    async with await _as(monkeypatch, t2) as c:
        assert (await c.get("/api/v1/migration/waves", headers=H)).json()["waves"] == []
        assert (await c.patch(f"/api/v1/migration/waves/{wid}", headers=H, json={"stage": "dress"})).status_code == 404
        assert (await c.delete(f"/api/v1/migration/waves/{wid}", headers=H)).status_code == 404
    async with await _as(monkeypatch, t1) as c:
        assert (await c.delete(f"/api/v1/migration/waves/{wid}", headers=H)).status_code == 204


@pg
@pytest.mark.anyio
async def test_update_wave_rejects_null_and_duplicate_name(tenants, monkeypatch):
    """final review: update_wave must return 422 for an explicit null on a non-nullable
    column, and 409 for a rename onto an existing wave's name — never a bare 500."""
    t1, _t2, prd, _s4d = tenants
    async with await _as(monkeypatch, t1) as c:
        w1 = (await c.post("/api/v1/migration/waves", headers=H, json={"name": "Wave A"})).json()["id"]
        (await c.post("/api/v1/migration/waves", headers=H, json={"name": "Wave B"}))
        assert (await c.patch(f"/api/v1/migration/waves/{w1}", headers=H, json={"name": None})).status_code == 422
        assert (await c.patch(f"/api/v1/migration/waves/{w1}", headers=H,
                              json={"stage": None})).status_code == 422
        r = await c.patch(f"/api/v1/migration/waves/{w1}", headers=H, json={"name": "Wave B"})
        assert r.status_code == 409, r.text
        # the failed rename must not have stuck, and the wave must remain usable afterwards
        r = await c.patch(f"/api/v1/migration/waves/{w1}", headers=H, json={"source_system_id": prd})
        assert r.status_code == 200 and r.json()["name"] == "Wave A", r.text


@pg
@pytest.mark.anyio
async def test_run_now_enqueues_a_wave_run(tenants, monkeypatch):
    t1, _t2, prd, s4d = tenants
    calls = []

    class _Task:
        id = "task-1"

    def fake_delay(*args):
        calls.append(args)
        return _Task()

    monkeypatch.setattr("workers.tasks.run_migration.run_migration.delay", fake_delay)
    async with await _as(monkeypatch, t1) as c:
        wid = (await c.post("/api/v1/migration/waves", headers=H, json={
            "name": "Wave 1", "source_system_id": prd, "target_system_id": s4d,
            "modules": ["material_master"]})).json()["id"]
        r = await c.post(f"/api/v1/migration/waves/{wid}/run", headers=H)
        assert r.status_code == 200 and r.json()["status"] == "queued"
        empty = (await c.post("/api/v1/migration/waves", headers=H, json={"name": "Empty"})).json()["id"]
        assert (await c.post(f"/api/v1/migration/waves/{empty}/run", headers=H)).status_code == 400
    assert calls == [(t1, r.json()["run_id"], "source_to_destination", prd, s4d, ["material_master"], None, "s4hana")]
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as conn:
        assert str(conn.execute(text("SELECT wave_id FROM migration_runs WHERE id = :r"),
                                {"r": r.json()["run_id"]}).scalar()) == wid
    engine.dispose()
