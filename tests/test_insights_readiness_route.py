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
def two_tenants():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
    yield t1, t2
    with engine.begin() as conn:
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
async def test_readiness_requires_waves_configured(two_tenants, monkeypatch):
    t1, _t2 = two_tenants
    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r.status_code == 409


@pytest.mark.anyio
async def test_readiness_is_tenant_isolated(two_tenants, monkeypatch):
    t1, t2 = two_tenants
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}

    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.patch("/api/v1/settings/alert-thresholds", json={
            "critical_threshold": 5, "high_threshold": 10, "dqs_drop_threshold": 10,
            "module_floors": {}, "readiness_dqs_threshold": 70,
            "readiness_waves": {"Wave 1": ["material_master"]},
        }, headers=headers)
        assert r.status_code == 200
        r = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["threshold"] == 70
    assert body["cells"] == [{"module": "material_master", "wave": "Wave 1", "verdict": "no_go",
                              "blocker_count": 0, "dqs": None}]

    _patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r2 = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r2.status_code == 409  # other tenant has no waves configured — proves no cross-tenant leak
