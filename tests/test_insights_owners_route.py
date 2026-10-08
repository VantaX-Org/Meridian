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
def tenant_a_with_owner():
    """Tenant A has one owner with an open issue and a sent digest notification.
    Tenant B has nothing — proves the owners route doesn't leak across tenants."""
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        conn.execute(
            text("INSERT INTO users (id, tenant_id, email, name) VALUES (:id, :t, 'owner@example.com', 'A. Owner')"),
            {"id": user_id, "t": t1},
        )
        conn.execute(
            text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:id, :t, 'complete')"),
            {"id": version_id, "t": t1},
        )
        conn.execute(
            text(
                "INSERT INTO record_issues "
                "(id, tenant_id, scope, module, check_id, record_key, severity, status, "
                " assigned_to, first_seen_version, last_seen_version) "
                "VALUES (:id, :t, 'upload', 'material_master', 'MM-001', 'REC-1', 'high', 'open', "
                " :uid, :vid, :vid)"
            ),
            {"id": str(uuid.uuid4()), "t": t1, "uid": user_id, "vid": version_id},
        )
        conn.execute(
            text(
                "INSERT INTO notifications (id, tenant_id, user_id, type, title, body) "
                "VALUES (:id, :t, :uid, 'digest', 'Weekly digest', 'body')"
            ),
            {"id": str(uuid.uuid4()), "t": t1, "uid": user_id},
        )
    yield t1, t2
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM notifications WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM record_issues WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM analysis_versions WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM users WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
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
async def test_owners_is_tenant_isolated(tenant_a_with_owner, monkeypatch):
    t1, t2 = tenant_a_with_owner
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}

    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/owners", headers=headers)
    assert r.status_code == 200
    owners = r.json()["owners"]
    assert len(owners) == 1
    assert owners[0]["owner"] == "A. Owner"
    assert owners[0]["schedule"] == "weekly"
    assert owners[0]["last_sent"] is not None
    assert owners[0]["open_by_severity"] == {"high": 1}

    _patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r2 = await client.get("/api/v1/insights/owners", headers=headers)
    assert r2.status_code == 200
    assert r2.json()["owners"] == []
