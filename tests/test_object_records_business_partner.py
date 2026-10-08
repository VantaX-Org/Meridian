import asyncio
import uuid

import pandas as pd
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import object_records
from api.routes.record_issues import _rls

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


def _but000_tables():
    return {"BUT000": pd.DataFrame([
        {"PARTNER": "0000100001", "TYPE": "2", "BPKIND": "0001", "BU_GROUP": "BP01"},
    ])}


def _app(db, monkeypatch, tables=None):
    async def fake(_db, tenant, version_id, names, module=None):
        return VID, (tables if tables is not None else {})
    monkeypatch.setattr(object_records, "_tables", fake)
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    app = FastAPI()
    app.include_router(object_records.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return app


def _get(app, url):
    async def go():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            return await c.get(url, headers={"X-User-Role": "steward"})
    return asyncio.run(go())


def test_business_partner_record_fix_sheet(monkeypatch):
    app = _app(_Db(), monkeypatch, tables=_but000_tables())
    resp = _get(app, "/api/v1/objects/business_partner/records/0000100001")
    assert resp.status_code == 200
    body = resp.json()
    assert body["matnr"] == "0000100001"
    assert body["mara"]["TYPE"] == "2"
    assert body["mara"]["BU_GROUP"] == "BP01"
    assert body["views"] == []
    assert body["makt"] == []


def test_business_partner_record_not_found(monkeypatch):
    app = _app(_Db(), monkeypatch, tables=_but000_tables())
    resp = _get(app, "/api/v1/objects/business_partner/records/9999999999")
    assert resp.status_code == 404


def test_business_partner_record_tenant_scoped(monkeypatch):
    # The shared _tables loader sets app.tenant_id before any query runs for this object.
    db = _Db()

    async def fake_tables(real_db, tenant, version_id, names, module=None):
        assert module == "business_partner"
        await _rls(real_db, tenant)
        return VID, _but000_tables()

    monkeypatch.setattr(object_records, "_tables", fake_tables)
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    app = FastAPI()
    app.include_router(object_records.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])

    _get(app, "/api/v1/objects/business_partner/records/0000100001")
    assert any("tenant_id" in sql and p.get("tid") == str(TID) for sql, p in db.calls)
