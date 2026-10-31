"""F29: the programme lead manages the digests (manage_digests), and a refusal can turn into an access request by
permission name, which tells the administrators and, once decided, the person who asked."""
from __future__ import annotations

import os

import pytest
from sqlalchemy import text

from api.services.rbac import has_permission, permissions_for
from tests import workflow_seed as seed
from tests.m2_client import make_client

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


def _h(role: str) -> dict:
    return {"X-User-Role": role, "Authorization": "Bearer test-token"}


def test_the_lead_holds_manage_digests_and_the_settings_stay_the_administrators():
    assert has_permission("programme_lead", "manage_digests") and not has_permission("programme_lead", "manage_settings")
    assert "manage_digests" in permissions_for("platform_admin")
    for role in ("data_owner", "data_steward", "auditor", "viewer", "manager"):
        assert not has_permission(role, "manage_digests"), role


@pytest.fixture
def tenant(monkeypatch):
    sent: list = []
    monkeypatch.setattr("api.services.handoff_notices.email_backend_name", lambda: "smtp")
    monkeypatch.setattr("api.services.handoff_notices.dispatch", lambda jobs: sent.extend(jobs) or len(sent))
    eng = seed.engine()
    w = seed.seed_tenant(eng)
    yield eng, w, sent
    with seed.tenant_conn(eng, w["tid"]) as c:
        for t in ("notification_deliveries", "access_requests", "digest_schedules"):
            if c.execute(text("SELECT to_regclass(:n)"), {"n": t}).scalar():
                c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": w["tid"]})
    seed.drop_tenant(eng, w["tid"])
    eng.dispose()


@pytest.mark.anyio
async def test_the_lead_reads_the_digests_and_an_owner_asks_for_access(tenant, monkeypatch):
    eng, w, sent = tenant
    deps, client = make_client(monkeypatch, w["tid"], w["boss"])
    await deps.engine.dispose()
    async with client:
        assert (await client.get("/api/v1/digests", headers=_h("programme_lead"))).status_code == 200
    deps, client = make_client(monkeypatch, w["tid"], w["alice"])
    await deps.engine.dispose()
    async with client:
        assert (await client.get("/api/v1/digests", headers=_h("data_owner"))).status_code == 403
        r = await client.post("/api/v1/access-requests", headers=_h("data_owner"),
                              json={"permission": "manage_digests", "reason": "I report to the committee"})
        assert r.status_code == 201, r.text
        req = r.json()
        assert (req["permission"], req["resource"], req["action"], req["status"]) == (
            "manage_digests", "reports", "edit", "open")
        again = await client.post("/api/v1/access-requests", headers=_h("data_owner"),
                                  json={"permission": "manage_digests"})
        assert again.json()["id"] == req["id"]
        bad = await client.post("/api/v1/access-requests", headers=_h("data_owner"), json={"permission": "fly"})
        assert bad.status_code == 422
        none = await client.post("/api/v1/access-requests", headers=_h("data_owner"), json={"reason": "please"})
        assert none.status_code == 422
    with seed.tenant_conn(eng, w["tid"]) as c:
        told = c.execute(text("SELECT user_id::text, title, body, link FROM notifications WHERE tenant_id = :t "
                              "AND type = 'access_request'"), {"t": w["tid"]}).fetchall()
    assert [t[0] for t in told] == [w["admin"]]
    assert told[0][1] == "Alice asks for manage_digests" and "I report to the committee" in told[0][2]
    assert told[0][3] == "/admin/users" and [j.user_id for j in sent] == [w["admin"]]

    deps, client = make_client(monkeypatch, w["tid"], w["admin"])
    await deps.engine.dispose()
    async with client:
        d = await client.post(f"/api/v1/access-requests/{req['id']}/decide", headers=_h("platform_admin"),
                              json={"decision": "granted", "role_key": "programme_lead"})
        assert d.status_code == 200, d.text
    with seed.tenant_conn(eng, w["tid"]) as c:
        back = c.execute(text("SELECT title FROM notifications WHERE tenant_id = :t AND user_id = :u "
                              "AND type = 'access_request'"), {"t": w["tid"], "u": w["alice"]}).fetchall()
    assert back == [("Your request for manage_digests was granted",)]
