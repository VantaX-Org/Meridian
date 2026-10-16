"""GET /connectivity/config-load/{system_id}: a system that exists but never loaded its
configuration answers 200 ``never_loaded``; only an unknown system is a 404."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import connectivity


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class _Db:
    def __init__(self, answers):
        self.answers = answers

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        for needle, rows in self.answers:
            if needle in sql:
                return _Res(rows)
        return _Res([])


def _client(answers) -> TestClient:
    app = FastAPI()
    app.include_router(connectivity.router)
    db = _Db(answers)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", [])
    return TestClient(app)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


H = {"X-User-Role": "admin"}


def test_existing_system_without_a_load_is_never_loaded():
    sid = str(uuid.uuid4())
    r = _client([("FROM config_loads", []), ("FROM sap_systems", [("ecc",)])]).get(
        f"/api/v1/connectivity/config-load/{sid}", headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "never_loaded" and body["system_id"] == sid and body["system_type"] == "ecc"
    assert body["load_id"] is None and body["objects"] == [] and body["summary"] == {}
    assert body["config_status"] == "not_loaded" and body["areas"] == []


def test_unknown_system_is_still_404():
    r = _client([("FROM config_loads", []), ("FROM sap_systems", [])]).get(
        f"/api/v1/connectivity/config-load/{uuid.uuid4()}", headers=H)
    assert r.status_code == 404
