"""GET and PUT /api/v1/versions/{id}/semantic-types: shape, trust parts, permission gates, audit."""
import datetime as dt
import uuid

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import semantic_types as route
from api.services.semantic_types import profile

VID = uuid.uuid4()
PROFILE = profile(pd.DataFrame({"mail": ["a@example.com"] * 30, "land": ["DE"] * 30, "code": ["X1"] * 30}))
VERSION = {"run_at": dt.datetime.now(dt.timezone.utc), "dqs_summary": {"business_partner": {"composite_score": 80}},
           "metadata": {"source": "upload", "semantic_profile": PROFILE}}


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows

    def scalar(self):
        return self.rows[0] if self.rows else None


class _DB:
    def __init__(self):
        self.overrides, self.committed = {}, False

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "FROM analysis_versions" in sql:
            return _Result([VERSION] if params["v"] == str(VID) else [])
        if "FROM tenants" in sql:
            return _Result([])
        if sql.lstrip().startswith("SELECT column_name"):
            return _Result([{"column_name": k, "semantic_type": v} for k, v in self.overrides.items()])
        self.overrides[params["c"]] = params["s"]
        return _Result([])

    async def commit(self):
        self.committed = True


@pytest.fixture
def ctx(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    audit = []

    async def _noop(*_a, **_k):
        return None

    async def _audit(*a, **_k):
        audit.append(a[3:])

    monkeypatch.setattr(route, "_rls", _noop)
    monkeypatch.setattr(route, "write_audit", _audit)
    api = FastAPI()
    api.include_router(route.router)
    db = _DB()

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api), audit, db


URL = f"/api/v1/versions/{VID}/semantic-types"


def test_get_returns_types_and_trust(ctx):
    client, *_ = ctx
    body = client.get(URL, headers={"X-User-Role": "viewer"}).json()
    assert body["profiled"] and body["origin"] == "file"
    assert {c["column"]: c["type"] for c in body["columns"]} == {"mail": "email", "land": "country", "code": None}
    parts = body["trust"]["parts"]
    assert parts["dqs"] == 80.0 and parts["conformance"] == 100.0 and parts["freshness"] == 100.0
    assert body["trust"]["score"] is not None and body["suggested_rules"] == []


def test_put_needs_upload_is_audited_and_drives_suggestions(ctx):
    client, audit, db = ctx
    assert client.put(f"{URL}/mail", json={"type": "email"}, headers={"X-User-Role": "viewer"}).status_code == 403
    assert client.put(f"{URL}/mail", json={"type": "bogus"}, headers={"X-User-Role": "admin"}).status_code == 422
    assert client.put(f"{URL}/nope", json={"type": "email"}, headers={"X-User-Role": "admin"}).status_code == 404
    r = client.put(f"{URL}/mail", json={"type": "email"}, headers={"X-User-Role": "admin"})
    assert r.status_code == 200 and db.committed and audit[0][0] == "semantic_type_set"
    body = client.get(URL, headers={"X-User-Role": "viewer"}).json()
    assert body["columns"][0]["confirmed"] and len(body["suggested_rules"]) == 2


def test_unknown_run_is_404(ctx):
    client, *_ = ctx
    assert client.get(f"/api/v1/versions/{uuid.uuid4()}/semantic-types",
                      headers={"X-User-Role": "viewer"}).status_code == 404
