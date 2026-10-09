"""tests/test_objects_detail.py"""
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
def tenant_with_material_findings():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1 = str(uuid.uuid4())
    v1 = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t1})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary) VALUES (:v, :t, 'complete', :s)"
        ), {"v": v1, "t": t1, "s": '{"material_master": {"composite_score": 72.5, "dimension_scores": {"completeness": 80.0}, "total_checks": 3}}'})
        conn.execute(text(
            "INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, affected_count, total_count, pass_rate) "
            "VALUES (gen_random_uuid(), :v, :t, 'material_master', 'mm_missing_desc', 'high', 'completeness', 12, 500, 97.6)"
        ), {"v": v1, "t": t1})
    yield t1, v1
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM findings WHERE version_id = :v"), {"v": v1})
        conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": v1})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": t1})


@pytest.mark.anyio
async def test_object_detail_returns_rules(tenant_with_material_findings, monkeypatch):
    t1, v1 = tenant_with_material_findings
    patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            f"/api/v1/objects/material_master?run={v1}",
            headers=HEADERS,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["composite_score"] == 72.5
    assert body["rules"][0]["check_id"] == "mm_missing_desc"


@pytest.mark.anyio
async def test_object_detail_is_tenant_isolated(tenant_with_material_findings, monkeypatch):
    other_tenant = str(uuid.uuid4())
    _, v1 = tenant_with_material_findings
    patch_tenant(monkeypatch, other_tenant)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            f"/api/v1/objects/material_master?run={v1}",
            headers=HEADERS,
        )
    assert resp.status_code == 404

