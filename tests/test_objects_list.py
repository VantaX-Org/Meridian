"""tests/test_objects_list.py"""
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
def two_tenants_with_findings():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    v1, v2 = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary) VALUES "
            "(:v, :t, 'complete', :s)"
        ), {"v": v1, "t": t1, "s": '{"material_master": {"composite_score": 88.0, "dimension_scores": {}, "total_checks": 10}}'})
        conn.execute(text(
            "INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, affected_count, total_count) "
            "VALUES (gen_random_uuid(), :v, :t, 'material_master', 'mm_001', 'high', 'completeness', 5, 100)"
        ), {"v": v1, "t": t1})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary) VALUES (:v, :t, 'complete', '{}')"
        ), {"v": v2, "t": t2})
    yield t1, t2, v1, v2
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM findings WHERE version_id IN (:v1, :v2)"), {"v1": v1, "v2": v2})
        conn.execute(text("DELETE FROM analysis_versions WHERE id IN (:v1, :v2)"), {"v1": v1, "v2": v2})
        conn.execute(text("DELETE FROM tenants WHERE id IN (:t1, :t2)"), {"t1": t1, "t2": t2})


@pytest.mark.anyio
async def test_objects_list_returns_own_tenant_modules(two_tenants_with_findings, monkeypatch):
    t1, _t2, v1, _v2 = two_tenants_with_findings
    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            f"/api/v1/objects?run={v1}",
            headers={"X-User-Role": "steward", "Authorization": "Bearer test-token"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["objects"][0]["module"] == "material_master"
    assert body["objects"][0]["composite_score"] == 88.0
    assert body["objects"][0]["failing_checks"] == 1


@pytest.mark.anyio
async def test_objects_list_is_tenant_isolated(two_tenants_with_findings, monkeypatch):
    t1, t2, v1, _v2 = two_tenants_with_findings
    _patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            f"/api/v1/objects?run={v1}",
            headers={"X-User-Role": "steward", "Authorization": "Bearer test-token"},
        )
    assert resp.status_code in (404, 403)


def _patch_tenant(monkeypatch, tenant_id: str):
    """Same inline helper as tests/test_runs_steps.py's _patch_tenant (Task 4) — there is no
    shared tests/conftest.py fixture for this, so it is defined identically, inline, in each
    of this plan's route test files, following tests/test_material_360_routes.py's
    dependency-override pattern for api.deps.get_tenant plus the MERIDIAN_DEV_ROLE_HEADER
    escape hatch.

    Also bypasses LocalAuthMiddleware (api/middleware/local_auth.py), which runs ahead of
    FastAPI dependency injection whenever AUTH_MODE=local (the default) and would otherwise
    401 every request regardless of app.dependency_overrides — see Task 4's identical fix."""
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
