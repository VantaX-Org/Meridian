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
def tenant_with_two_batches():
    """Two cleaning_queue batches for one tenant. Regression for I11: the
    fix page used to fetch one 100-item page of the whole queue and filter by
    batch_id client-side, so a batch sitting past the first page never showed
    up. The route must filter by batch_id server-side instead."""
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tenant_id = str(uuid.uuid4())
    batch_a, batch_b = str(uuid.uuid4()), str(uuid.uuid4())
    item_a, item_b = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tenant_id})
        for item_id, batch_id, record_key in ((item_a, batch_a, "REC-A"), (item_b, batch_b, "REC-B")):
            conn.execute(
                text(
                    "INSERT INTO cleaning_queue "
                    "(id, tenant_id, object_type, status, record_key, batch_id) "
                    "VALUES (:id, :t, 'material_master', 'recommended', :rk, :bid)"
                ),
                {"id": item_id, "t": tenant_id, "rk": record_key, "bid": batch_id},
            )
    yield tenant_id, batch_a, batch_b
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM cleaning_queue WHERE tenant_id = :t"), {"t": tenant_id})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})


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
async def test_queue_batch_id_filter_returns_only_that_batch(tenant_with_two_batches, monkeypatch):
    tenant_id, batch_a, batch_b = tenant_with_two_batches
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}

    _patch_tenant(monkeypatch, tenant_id)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/cleaning/queue", params={"batch_id": batch_a}, headers=headers)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["record_key"] == "REC-A"
    assert items[0]["batch_id"] == batch_a

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r2 = await client.get("/api/v1/cleaning/queue", params={"batch_id": batch_b}, headers=headers)
    assert r2.status_code == 200
    items2 = r2.json()["items"]
    assert len(items2) == 1
    assert items2[0]["record_key"] == "REC-B"
