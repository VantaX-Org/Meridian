"""tests/test_objects_list.py"""
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api.main import app
from api import deps as api_deps
from tests.route_auth import HEADERS, patch_tenant

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
    patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            f"/api/v1/objects?run={v1}",
            headers=HEADERS,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["objects"][0]["module"] == "material_master"
    assert body["objects"][0]["composite_score"] == 88.0
    assert body["objects"][0]["failing_checks"] == 1


@pytest.mark.anyio
async def test_objects_list_is_tenant_isolated(two_tenants_with_findings, monkeypatch):
    t1, t2, v1, _v2 = two_tenants_with_findings
    patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            f"/api/v1/objects?run={v1}",
            headers=HEADERS,
        )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_objects_list_resolves_latest(two_tenants_with_findings, monkeypatch):
    t1, _t2, v1, _v2 = two_tenants_with_findings
    patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            "/api/v1/objects?run=latest",
            headers=HEADERS,
        )
    assert resp.status_code == 200
    assert resp.json()["run_id"] == v1


@pytest.mark.anyio
async def test_objects_list_latest_includes_agents_complete_runs(two_tenants_with_findings, monkeypatch):
    """run_agents.py moves a run from 'complete' to 'agents_complete'; `latest` must still find it."""
    t1, _t2, v1, _v2 = two_tenants_with_findings
    v3 = str(uuid.uuid4())
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary, run_at) "
            "VALUES (:v, :t, 'agents_complete', '{}', now() + interval '1 minute')"
        ), {"v": v3, "t": t1})
    try:
        patch_tenant(monkeypatch, t1)
        await api_deps.engine.dispose()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/objects?run=latest", headers=HEADERS)
        assert resp.status_code == 200
        assert resp.json()["run_id"] == v3
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": v3})


@pytest.mark.anyio
async def test_objects_list_rejects_non_uuid_run(two_tenants_with_findings, monkeypatch):
    t1, _t2, _v1, _v2 = two_tenants_with_findings
    patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/v1/objects?run=garbage", headers=HEADERS)
    assert resp.status_code == 422

