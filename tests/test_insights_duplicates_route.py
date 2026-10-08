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
def tenant_a_master_record_with_match_score():
    """Tenant A has a master record with a linked match_scores pair; tenant B has
    nothing — proves /duplicates/{object}/{record_id} doesn't leak across tenants."""
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    record_id = str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        conn.execute(
            text(
                "INSERT INTO master_records (id, tenant_id, domain, sap_object_key, status) "
                "VALUES (:id, :t, 'material_master', 'MATNR-A', 'golden')"
            ),
            {"id": record_id, "t": t1},
        )
        conn.execute(
            text(
                "INSERT INTO master_records (id, tenant_id, domain, sap_object_key, status, merged_into) "
                "VALUES (:id, :t, 'material_master', 'MATNR-B', 'merged', :head)"
            ),
            {"id": str(uuid.uuid4()), "t": t1, "head": record_id},
        )
        conn.execute(
            text(
                "INSERT INTO match_scores (id, tenant_id, candidate_a_key, candidate_b_key, domain, "
                " total_score, auto_action) "
                "VALUES (:id, :t, 'MATNR-A', 'MATNR-B', 'material_master', 0.92, 'review')"
            ),
            {"id": str(uuid.uuid4()), "t": t1},
        )
    yield t1, t2, record_id
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM match_scores WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM master_records WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
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
async def test_duplicates_is_tenant_isolated(tenant_a_master_record_with_match_score, monkeypatch):
    t1, t2, record_id = tenant_a_master_record_with_match_score
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}

    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/insights/duplicates/material_master/{record_id}", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["thresholds"] == {"auto_merge": 0.95, "review_floor": 0.30}
    node_ids = {n["id"] for n in body["nodes"]}
    assert node_ids == {"MATNR-A", "MATNR-B"}
    assert body["edges"][0]["label"] == "0.92"

    _patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r2 = await client.get(f"/api/v1/insights/duplicates/material_master/{record_id}", headers=headers)
    assert r2.status_code == 404
