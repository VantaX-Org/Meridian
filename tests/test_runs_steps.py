"""tests/test_runs_steps.py"""
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
def two_tenants_with_steps():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    v1, v2 = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
        conn.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"), {"v": v1, "t": t1})
        conn.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"), {"v": v2, "t": t2})
        conn.execute(text(
            "INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name, status) "
            "VALUES (:t, :v, 1, 'Uploading and validating file', 'complete')"
        ), {"t": t1, "v": v1})
    yield t1, t2, v1, v2
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM analysis_versions WHERE id IN (:v1, :v2)"), {"v1": v1, "v2": v2})
        conn.execute(text("DELETE FROM tenants WHERE id IN (:t1, :t2)"), {"t1": t1, "t2": t2})


@pytest.mark.anyio
async def test_runs_steps_returns_own_tenant_steps(two_tenants_with_steps, monkeypatch):
    t1, _t2, v1, _v2 = two_tenants_with_steps
    patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            f"/api/v1/runs/{v1}/steps",
            headers=HEADERS,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["version_id"] == v1
    assert len(body["steps"]) == 1
    assert body["steps"][0]["step_name"] == "Uploading and validating file"


@pytest.mark.anyio
async def test_runs_steps_is_tenant_isolated(two_tenants_with_steps, monkeypatch):
    """Tenant 2 must never see tenant 1's run steps, even by guessing tenant 1's version id."""
    t1, t2, v1, _v2 = two_tenants_with_steps
    patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            f"/api/v1/runs/{v1}/steps",
            headers=HEADERS,
        )
    assert resp.status_code == 404

