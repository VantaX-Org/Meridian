"""GET /versions carries per-run severity counts from one grouped findings query."""
import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.main import app
from tests.route_auth import HEADERS, patch_tenant

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


@pytest.fixture
def seeded():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t, a, b = (str(uuid.uuid4()) for _ in range(3))
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": t})
        for v, i in ((a, 1), (b, 0)):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary, metadata, run_at) "
                           "VALUES (:v, :t, 'complete', '{}'::jsonb, '{}'::jsonb, now() + :i * interval '1 minute')"),
                      {"v": v, "t": t, "i": i})
        for cid, sev, aff in [("A1", "critical", 4), ("A2", "critical", 1), ("A3", "high", 2),
                              ("A4", "low", 0)]:  # affected 0 is a passing check, not counted
            c.execute(text("INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, "
                           "affected_count, total_count) VALUES (gen_random_uuid(), :v, :t, 'vendor', :c, :s, "
                           "'validity', :a, 10)"), {"v": a, "t": t, "c": cid, "s": sev, "a": aff})
    yield t, a, b
    with engine.begin() as c:
        for tbl in ("findings", "analysis_versions"):
            c.execute(text(f"DELETE FROM {tbl} WHERE tenant_id = :t"), {"t": t})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": t})


@pytest.mark.anyio
async def test_versions_list_severity_counts(seeded, monkeypatch):
    t, a, b = seeded
    patch_tenant(monkeypatch, t)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/v1/versions", headers=HEADERS)
    assert resp.status_code == 200
    by = {v["id"]: v for v in resp.json()["versions"]}
    assert by[a]["severity_counts"] == {"critical": 2, "high": 1, "medium": 0, "low": 0}
    assert by[b]["severity_counts"] == {"critical": 0, "high": 0, "medium": 0, "low": 0}
    assert resp.json()["total"] == 2


@pytest.mark.anyio
async def test_versions_total_ignores_limit(seeded, monkeypatch):
    t, a, b = seeded
    patch_tenant(monkeypatch, t)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        body = (await client.get("/api/v1/versions?limit=1", headers=HEADERS)).json()
    assert len(body["versions"]) == 1 and body["total"] == 2
