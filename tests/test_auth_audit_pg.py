"""Sign-in, lockout, sign-out and password change are written to audit_log (D-14).

AuditMiddleware skips /api/v1/auth/, so api/routes/auth.py writes these rows itself: auth.login,
auth.login_failed (the email as typed and the client address, never the password), auth.lockout,
auth.logout and auth.password_change.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import Engine, text

from tests.test_auth_lockout_pg import client  # noqa: F401  (fixture: auth router without the IP limiter)
from tests.test_rbac_escalation_pg import owner, pytestmark  # noqa: F401  (owner is a module-scoped fixture)
from tests.test_session_revocation_pg import DEV, OLD_PW, dev_user  # noqa: F401  (dev_user is a fixture)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

WRONG_PW = "wrong-password-typed-here"
NEW_PW = "a-brand-new-long-passphrase-7"


def _rows(owner: Engine, *, email: str | None = None, user_id: str | None = None) -> list[dict[str, Any]]:
    with owner.connect() as c:
        rows = c.execute(text(
            "SELECT action, actor_user_id::text AS actor_user_id, actor_email, entity_id, status_code, ip, "
            "user_agent, before_json, after_json, path FROM audit_log "
            "WHERE tenant_id = :t AND action LIKE 'auth.%' "
            "AND (actor_email = :e OR actor_user_id::text = :u) ORDER BY created_at, id"),
            {"t": DEV, "e": email, "u": user_id}).mappings().all()
    return [dict(r) for r in rows]


def _login(client: TestClient, email: str, password: str) -> Any:
    client.cookies.clear()
    return client.post("/api/v1/auth/login", json={"email": email, "password": password},
                       headers={"X-Forwarded-For": "198.51.100.7", "User-Agent": "audit-test"})


def test_success_and_failure_are_audited_without_the_password(owner: Engine, dev_user: tuple[str, str, str],
                                                              client: TestClient) -> None:
    uid, email, _ = dev_user
    assert _login(client, email, WRONG_PW).status_code == 401
    assert _login(client, email, OLD_PW).status_code == 200

    rows = _rows(owner, email=email, user_id=uid)
    assert [r["action"] for r in rows] == ["auth.login_failed", "auth.login"]
    failed, ok = rows
    assert failed["status_code"] == 401 and failed["actor_user_id"] == uid
    assert failed["after_json"] == {"email": email, "reason": "wrong_password"}
    assert failed["ip"] == "198.51.100.7" and failed["user_agent"] == "audit-test"
    assert failed["path"] == "/api/v1/auth/login"
    assert ok["status_code"] == 200 and ok["actor_user_id"] == uid and ok["entity_id"] == uid
    for r in rows:
        dumped = json.dumps(r, default=str)
        assert WRONG_PW not in dumped and OLD_PW not in dumped


def test_unknown_email_is_audited_with_what_was_typed(owner: Engine, client: TestClient) -> None:
    email = f"nobody-{uuid.uuid4().hex[:8]}@example.test"
    assert _login(client, email, WRONG_PW).status_code == 401
    rows = _rows(owner, email=email)
    assert len(rows) == 1
    assert rows[0]["action"] == "auth.login_failed" and rows[0]["actor_user_id"] is None
    assert rows[0]["after_json"] == {"email": email, "reason": "unknown_or_inactive"}
    assert WRONG_PW not in json.dumps(rows[0], default=str)


def test_the_failure_that_locks_the_account_writes_a_lockout_row(owner: Engine, dev_user: tuple[str, str, str],
                                                                client: TestClient) -> None:
    from api.routes.auth import LOCKOUT_THRESHOLD

    uid, email, _ = dev_user
    for _ in range(LOCKOUT_THRESHOLD):
        assert _login(client, email, WRONG_PW).status_code == 401
    assert _login(client, email, OLD_PW).status_code == 423

    rows = _rows(owner, email=email, user_id=uid)
    actions = [r["action"] for r in rows]
    assert actions.count("auth.lockout") == 1
    assert actions.count("auth.login_failed") == LOCKOUT_THRESHOLD + 1
    lockout = next(r for r in rows if r["action"] == "auth.lockout")
    assert lockout["actor_user_id"] == uid  # written with the threshold-th failure
    assert lockout["after_json"]["failed_login_count"] == LOCKOUT_THRESHOLD
    locked = [r for r in rows if r["status_code"] == 423]
    assert len(locked) == 1 and locked[0]["after_json"]["reason"] == "locked"


@pytest.mark.session_revocation
def test_logout_and_password_change_are_audited(owner: Engine, dev_user: tuple[str, str, str],
                                                client: TestClient) -> None:
    uid, email, _ = dev_user
    token = _login(client, email, OLD_PW).json()["token"]
    client.cookies.clear()
    r = client.post("/api/v1/auth/change-password", json={"current_password": OLD_PW, "new_password": NEW_PW},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    new_token = r.json()["token"]
    client.cookies.clear()
    r = client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {new_token}"})
    assert r.status_code == 204, r.text
    assert "mn_auth_token" in r.headers.get("set-cookie", "")

    rows = _rows(owner, email=email, user_id=uid)
    assert [r["action"] for r in rows] == ["auth.login", "auth.password_change", "auth.logout"]
    assert all(r["actor_user_id"] == uid for r in rows)
    for r in rows:
        dumped = json.dumps(r, default=str)
        assert OLD_PW not in dumped and NEW_PW not in dumped


def test_logout_needs_a_session(client: TestClient) -> None:
    client.cookies.clear()
    assert client.post("/api/v1/auth/logout").status_code == 401
