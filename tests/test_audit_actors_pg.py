"""F25: the audit log's Who filter is open to view audit: GET /audit/actors gives the people in the tenant's log,
ids and names only, and the log filters by one of them."""
from __future__ import annotations

import os

import pytest
from sqlalchemy import text

from tests import workflow_seed as seed
from tests.m2_client import make_client

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


def _h(role: str) -> dict:
    return {"X-User-Role": role, "Authorization": "Bearer test-token"}


@pytest.fixture
def tenants():
    eng = seed.engine()
    a, b = seed.seed_tenant(eng), seed.seed_tenant(eng)
    for w, who in ((a, ("alice", "bob")), (b, ("carol",))):
        with seed.tenant_conn(eng, w["tid"]) as c:
            for k in who:
                c.execute(text("INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, method, path, "
                               "status_code) VALUES (:t, :u, :e, 'update', 'POST', '/x', 200)"),
                          {"t": w["tid"], "u": w[k], "e": f"{k}@example.com"})
    yield eng, a, b
    for w in (a, b):
        seed.drop_tenant(eng, w["tid"])
    eng.dispose()


@pytest.mark.anyio
async def test_an_auditor_lists_the_actors_of_their_tenant_only(tenants, monkeypatch):
    eng, a, b = tenants
    deps, client = make_client(monkeypatch, a["tid"], a["dave"])
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/audit/actors", headers=_h("auditor"))
        assert r.status_code == 200, r.text
        assert r.json() == {"actors": [{"id": a["alice"], "name": "Alice"}, {"id": a["bob"], "name": "Bob"}]}
        assert "email" not in r.text and "example.com" not in r.text
        log = await client.get(f"/api/v1/audit?actor_user_id={a['bob']}", headers=_h("auditor"))
        assert log.status_code == 200 and log.json()["total"] == 1
        # a role without view audit is refused
        assert (await client.get("/api/v1/audit/actors", headers=_h("viewer"))).status_code == 403
