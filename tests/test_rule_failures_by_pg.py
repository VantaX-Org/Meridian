"""GET /api/v1/rules/{check_id}/failures-by against a real Postgres.

One run, rule MM010 fails 4 plant-level records: WERKS 1000 x3, 2000 x1. The first key part (MATNR) is the record's
identity and is not a grouping."""
from __future__ import annotations

import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
USER = "00000000-0000-0000-0000-0000000000b8"


@pytest.fixture
def run():
    owner = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, vid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata) "
                       "VALUES (:v, :t, 'complete', now(), CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"modules": ["material_master"]})})
        for key in ("MATNR=1|WERKS=1000", "MATNR=2|WERKS=1000", "MATNR=3|WERKS=1000", "MATNR=4|WERKS=2000"):
            c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, "
                           "field_values) VALUES (:t, :v, 'MM010', 'material_master', 'MARC', :k, '{}'::jsonb)"),
                      {"t": tid, "v": vid, "k": key})
    yield tid, vid
    with owner.begin() as c:
        c.execute(text("DELETE FROM finding_records WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    owner.dispose()


@pytest.mark.anyio
async def test_failures_by_groups_key_parts_of_the_latest_run(run, monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    tid, vid = run
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": USER, "email": "s@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/rules/MM010/failures-by", headers=HEADERS)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["version_id"] == vid and body["total"] == 4
        assert body["groups"] == [{"field": "WERKS", "values": [
            {"value": "1000", "records": 3, "part": "WERKS=1000"},
            {"value": "2000", "records": 1, "part": "WERKS=2000"}]}]
        none = (await client.get("/api/v1/rules/NOPE/failures-by", headers=HEADERS)).json()
        assert none["groups"] == [] and none["total"] == 0
