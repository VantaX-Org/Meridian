"""tests/test_object_records.py"""
import asyncio
import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import object_records
from tests.material_360_fixture import A, tables

TID, VID = uuid.uuid4(), uuid.uuid4()


class _Res:
    def fetchall(self):
        return []


class _Db:
    async def execute(self, stmt, params=None):
        return _Res()


def _app(monkeypatch):
    async def fake(_db, tenant, version_id, names):
        return VID, tables()
    monkeypatch.setattr(object_records, "_tables", fake)
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    app = FastAPI()
    app.include_router(object_records.router)
    app.dependency_overrides[get_db] = lambda: _Db()
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return app


def _get(app, url):
    async def go():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            return await c.get(url, headers={"X-User-Role": "steward"})
    return asyncio.run(go())


def test_unsupported_object_returns_501(monkeypatch):
    resp = _get(_app(monkeypatch), "/api/v1/objects/fi_gl/records/1000")
    assert resp.status_code == 501


def test_material_master_record_delegates_to_material_360(monkeypatch):
    """Same fixture dataset and _tables monkeypatch tests/test_material_360_routes.py uses for
    api.routes.materials.get_material — this must return the same body shape for the same key,
    since object_records.py delegates to the unchanged m360.build_material."""
    resp = _get(_app(monkeypatch), f"/api/v1/objects/material_master/records/{A}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["description"].startswith("Hydraulic")
