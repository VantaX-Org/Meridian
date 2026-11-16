"""Sign-in history: every login attempt lands in audit_log and GET /api/v1/audit/sign-ins reads it back.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""
from __future__ import annotations

import os
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import Engine, text

from tests import workflow_seed as seed
from tests.m2_client import make_client
from tests.test_auth_audit_pg import WRONG_PW, _login, _rows
from tests.test_auth_lockout_pg import client  # noqa: F401  (fixture)
from tests.test_rbac_escalation_pg import owner  # noqa: F401  (fixture)
from tests.test_session_revocation_pg import OLD_PW, dev_user  # noqa: F401  (fixture)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


def test_a_broken_audit_write_never_breaks_sign_in(owner: Engine, dev_user: tuple[str, str, str],  # noqa: F811
                                                   client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    import api.routes.auth as auth

    def boom(*a, **k):  # noqa: ANN002, ANN003, ANN202
        raise RuntimeError("audit down")

    monkeypatch.setattr(auth, "write_audit_sync", boom)
    _, email, _ = dev_user
    assert _login(client, email, WRONG_PW).status_code == 401
    assert _login(client, email, OLD_PW).status_code == 200


def test_a_disabled_account_is_recorded_as_disabled(owner: Engine, dev_user: tuple[str, str, str],  # noqa: F811
                                                    client: TestClient) -> None:  # noqa: F811
    uid, email, _ = dev_user
    with owner.begin() as c:
        c.execute(text("UPDATE users SET is_active = false WHERE id = :u"), {"u": uid})
    assert _login(client, email, OLD_PW).status_code == 401
    rows = _rows(owner, email=email, user_id=uid)
    assert rows[-1]["action"] == "auth.login_failed"
    assert rows[-1]["after_json"]["reason"] == "disabled"
    assert rows[-1]["ip"] == "198.51.100.7" and rows[-1]["user_agent"] == "audit-test"


def _h(role: str) -> dict:
    return {"X-User-Role": role, "Authorization": "Bearer test-token"}


_ROW = ("INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, method, path, status_code, ip, "
        "user_agent, after_json, created_at) VALUES (:t, :u, :e, :a, 'POST', '/api/v1/auth/login', :s, "
        "'198.51.100.7', 'ua-test', CAST(:j AS jsonb), :at)")


@pytest.fixture
def tenants():
    eng = seed.engine()
    a, b = seed.seed_tenant(eng), seed.seed_tenant(eng)
    with seed.tenant_conn(eng, a["tid"]) as c:
        for u, act, s, j, at in (
            (a["alice"], "auth.login", 200, '{"email":"alice@example.com","method":"password"}', "2026-11-01T08:00Z"),
            (a["alice"], "auth.login_failed", 401, '{"email":"alice@example.com","reason":"wrong_password"}',
             "2026-11-02T08:00Z"),
            (a["alice"], "auth.lockout", 423, '{"email":"alice@example.com"}', "2026-11-02T08:01Z"),
            (a["bob"], "auth.sso_login", 200, '{"email":"bob@example.com"}', "2026-11-03T08:00Z"),
            (None, "auth.login_failed", 401, '{"email":"ghost@example.com","reason":"unknown_user"}',
             "2026-11-04T08:00Z"),
            (a["bob"], "auth.sso_refused", 403, '{"email":"bob@example.com","reason":"suspended"}',
             "2026-11-05T08:00Z"),
            (a["alice"], "update", 200, "{}", "2026-11-06T08:00Z"),
        ):
            c.execute(text(_ROW), {"t": a["tid"], "u": u, "e": "x@example.com", "a": act, "s": s, "j": j, "at": at})
    with seed.tenant_conn(eng, b["tid"]) as c:
        c.execute(text(_ROW), {"t": b["tid"], "u": b["carol"], "e": "carol@example.com", "a": "auth.login",
                               "s": 200, "j": "{}", "at": "2026-11-01T09:00Z"})
    yield eng, a, b
    for w in (a, b):
        seed.drop_tenant(eng, w["tid"])
    eng.dispose()


@pytest.mark.anyio
async def test_sign_in_history_is_tenant_scoped_filtered_and_admin_only(tenants, monkeypatch):
    eng, a, b = tenants
    deps, client = make_client(monkeypatch, a["tid"], a["admin"])
    await deps.engine.dispose()
    url = "/api/v1/audit/sign-ins"
    async with client:
        r = await client.get(url, headers=_h("auditor"))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 5  # the lockout row and the plain update are not sign-in attempts
        outcomes = [e["outcome"] for e in body["entries"]]
        assert outcomes == ["disabled", "unknown_user", "success", "bad_password", "success"]
        first = body["entries"][-1]
        assert first["user_id"] == a["alice"] and first["user_name"] == "Alice" and first["method"] == "password"
        assert first["ip"] == "198.51.100.7" and first["user_agent"] == "ua-test"
        assert all(e["user_id"] != b["carol"] for e in body["entries"])

        async def total(q: str) -> int:
            res = await client.get(f"{url}?{q}", headers=_h("auditor"))
            assert res.status_code == 200, res.text
            return res.json()["total"]

        assert await total(f"user_id={a['alice']}") == 2
        assert await total("outcome=failed") == 3
        assert await total("outcome=success") == 2
        assert await total("method=oidc") == 2
        assert await total("since=2026-11-02T00:00:00Z&until=2026-11-04T00:00:00Z") == 2
        page = (await client.get(f"{url}?limit=2&offset=2", headers=_h("auditor"))).json()
        assert len(page["entries"]) == 2 and page["total"] == 5 and page["offset"] == 2
        assert (await client.get(url, headers=_h("viewer"))).status_code == 403
