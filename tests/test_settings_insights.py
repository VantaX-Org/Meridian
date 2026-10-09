"""Task 1: readiness_dqs_threshold/readiness_waves on AlertThresholds, features on CostModel."""
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
def tenant_row():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
    yield t
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM tenants WHERE id = :id"), {"id": t})


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
async def test_alert_thresholds_round_trips_readiness_fields(tenant_row, monkeypatch):
    t = tenant_row
    _patch_tenant(monkeypatch, t)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.patch(
            "/api/v1/settings/alert-thresholds",
            json={"readiness_dqs_threshold": 80, "readiness_waves": {"wave1": ["material_master"]}},
            headers=headers,
        )
        assert r.status_code == 200
        r = await client.get("/api/v1/settings", headers=headers)
    assert r.status_code == 200
    body = r.json()["alert_thresholds"]
    assert body["readiness_dqs_threshold"] == 80
    assert body["readiness_waves"] == {"wave1": ["material_master"]}
    # unset fields keep their defaults, not wiped by the partial PATCH
    assert body["critical_threshold"] == 1


@pytest.mark.anyio
async def test_cost_model_round_trips_features(tenant_row, monkeypatch):
    t = tenant_row
    _patch_tenant(monkeypatch, t)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.put(
            "/api/v1/settings/cost-model",
            json={"features": {"three_way_match": 500.0}},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["effective"]["features"] == {"three_way_match": 500.0}
        r = await client.get("/api/v1/settings/cost-model", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["tenant"]["features"] == {"three_way_match": 500.0}
    assert body["effective"]["features"] == {"three_way_match": 500.0}
