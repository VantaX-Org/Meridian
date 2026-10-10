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
def tenant_a_version():
    """Tenant A has one analysed run; tenant B has nothing — proves GET /exec
    doesn't leak tenant A's executive report to tenant B."""
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        conn.execute(
            text(
                "INSERT INTO analysis_versions (id, tenant_id, label, status, run_at, metadata, dqs_summary) "
                "VALUES (:v, :t, 'October re-run', 'complete', now(), CAST(:m AS jsonb), CAST(:q AS jsonb))"
            ),
            {"v": version_id, "t": t1, "m": json.dumps({}), "q": json.dumps({})},
        )
    yield t1, t2, version_id
    with engine.begin() as conn:
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
async def test_get_exec_returns_report_for_latest_version(tenant_a_version, monkeypatch):
    t1, t2, version_id = tenant_a_version
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}

    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/exec", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version_id"] == version_id
    assert isinstance(body["narrative"], str) and body["narrative"]
    assert isinstance(body["readiness_cells"], list)
    assert isinstance(body["waterfall"], list)
    assert isinstance(body["impact_rows"], list)
    assert isinstance(body["owner_rows"], list)
    # No proven_cost_results rows seeded for this tenant/version — the narrative must
    # not claim a bogus "0.00 None proven lost or held", and proven_cost_total is 0.0.
    assert "proven lost or held" not in body["narrative"]
    assert body["proven_cost_total"] == 0.0


@pytest.mark.anyio
async def test_get_exec_includes_proven_cost_narrative(tenant_a_version, monkeypatch):
    t1, _t2, version_id = tenant_a_version
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}

    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO proven_cost_results "
                "(id, tenant_id, version_id, metric, amount, currency, by_currency, documents, check_ids, items) "
                "VALUES (:id, :t, :v, 'late_po', 1070, 'ZAR', CAST(:bc AS jsonb), 1, :check_ids, CAST(:items AS jsonb))"
            ),
            {
                "id": str(uuid.uuid4()), "t": t1, "v": version_id,
                "bc": json.dumps({"ZAR": 1070}), "check_ids": ["MM140"], "items": json.dumps([]),
            },
        )
    try:
        _patch_tenant(monkeypatch, t1)
        await api_deps.engine.dispose()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/v1/insights/exec", headers=headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "proven lost or held" in body["narrative"]
        assert body["proven_cost_total"] == 1070.0
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM proven_cost_results WHERE tenant_id = :t"), {"t": t1})
        engine.dispose()


@pytest.mark.anyio
async def test_get_exec_404s_for_tenant_with_no_runs(tenant_a_version, monkeypatch):
    t1, t2, version_id = tenant_a_version
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}

    _patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/exec", headers=headers)
    assert r.status_code == 404
