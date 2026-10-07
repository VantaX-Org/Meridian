import asyncio
import uuid

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import materials
from tests.material_360_fixture import A, B, tables

TID, VID = uuid.uuid4(), uuid.uuid4()


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class _Db:
    def __init__(self):
        self.calls = []

    async def execute(self, stmt, params=None):
        self.calls.append((str(stmt), params or {}))
        return _Res([])


def _app(db, monkeypatch):
    async def fake(_db, tenant, version_id, names):
        return VID, tables()
    monkeypatch.setattr(materials, "_tables", fake)
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    app = FastAPI()
    app.include_router(materials.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return app


def _get(app, url):
    async def go():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            return await c.get(url, headers={"X-User-Role": "steward"})
    return asyncio.run(go())


def test_endpoints(monkeypatch):
    db = _Db()
    app = _app(db, monkeypatch)
    assert _get(app, "/api/v1/materials/101").json()["description"].startswith("Hydraulic")
    assert _get(app, "/api/v1/materials/102/supersession").json()["plants"][0]["loop_at"] == B
    assert _get(app, "/api/v1/materials/101/duplicates").json()["threshold"] == 60
    f = _get(app, "/api/v1/materials/101/findings").json()
    assert f["rules_total"] == 678
    assert _get(app, "/api/v1/materials/999").status_code == 404
    assert _get(app, "/api/v1/materials/101?plant=1000").json()["levels_total"] < 99


def test_findings_queries_are_tenant_scoped(monkeypatch):
    db = _Db()
    _get(_app(db, monkeypatch), "/api/v1/materials/101/findings")
    sql = [(s, p) for s, p in db.calls if "finding_records" in s or "record_issues" in s]
    assert len(sql) == 2
    for s, p in sql:
        assert "tenant_id = :t" in s and p["t"] == str(TID) and p["exact"] == f"MATNR={A}"
