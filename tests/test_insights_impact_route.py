import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api.deps import Tenant, get_tenant
from api.main import app
from api import deps as api_deps

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def two_tenants_with_version():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    v1 = str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        conn.execute(
            text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:id, :t, 'complete')"),
            {"id": v1, "t": t1},
        )
        conn.execute(
            text(
                "INSERT INTO config_impact_results "
                "(id, version_id, tenant_id, feature, system, status, total_affected_records, blocking_findings) "
                "VALUES (:id, :vid, :t, 'three_way_match', 'ECC', 'blocked', 42, :findings)"
            ),
            {"id": str(uuid.uuid4()), "vid": v1, "t": t1, "findings": json.dumps(["MM-003"])},
        )
    yield t1, t2, v1
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM config_impact_results WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM analysis_versions WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM tenants WHERE id IN (:t1, :t2)"), {"t1": t1, "t2": t2})


def _patch_tenant(monkeypatch, tenant_id: str):
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr(
        "api.middleware.local_auth.decode_access_token",
        lambda token, secret: {
            "sub": "00000000-0000-0000-0000-000000000002",
            "email": "dev@example.com",
            "role": "admin",
        },
    )
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(
        app.dependency_overrides, get_tenant,
        lambda: Tenant(uuid.UUID(tenant_id), "T", []),
    )


@pytest.mark.anyio
async def test_impact_computes_value_at_risk_when_feature_priced(two_tenants_with_version, monkeypatch):
    t1, _t2, v1 = two_tenants_with_version
    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.put(
            "/api/v1/settings/cost-model",
            json={"features": {"three_way_match": 150.0}},
            headers=headers,
        )
        assert r.status_code == 200
        r = await client.get(f"/api/v1/insights/impact?version_id={v1}", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["version_id"] == v1
    assert body["rows"] == [{
        "feature": "three_way_match", "status": "blocked", "record_count": 42,
        "value_per_record": 150.0, "value_at_risk": 6300.0, "causing_rules": ["MM-003"],
    }]


@pytest.mark.anyio
async def test_impact_is_tenant_isolated(two_tenants_with_version, monkeypatch):
    t1, t2, v1 = two_tenants_with_version
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}

    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.put(
            "/api/v1/settings/cost-model",
            json={"features": {"three_way_match": 150.0}},
            headers=headers,
        )
        assert r.status_code == 200

    _patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # tenant 2 has no analysis version and no cost-model pricing of its own
        r = await client.get("/api/v1/insights/impact", headers=headers)
        assert r.status_code == 200
        assert r.json() == {"version_id": None, "rows": []}
        # even if tenant 2 is handed tenant 1's version_id directly, RLS/tenant_id
        # filtering on config_impact_results must keep the row list empty
        r2 = await client.get(f"/api/v1/insights/impact?version_id={v1}", headers=headers)
        assert r2.status_code == 200
        assert r2.json()["rows"] == []
