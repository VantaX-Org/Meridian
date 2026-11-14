"""POST /api/v1/auth/refresh slides a browser session: a fresh cookie for the same user that keeps the sign-in
time, refused without the CSRF token, after a revocation, for a deactivated user and past the absolute limit.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database); skipped otherwise. No token value is printed."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import jwt
from sqlalchemy import Engine, text

from api.middleware.local_auth import AUTH_COOKIE, CSRF_COOKIE
from api.services.local_auth import SESSION_ABSOLUTE_HOURS
from tests.test_rbac_escalation_pg import owner, pytestmark  # noqa: F401  (owner is a module-scoped fixture)
from tests.test_session_revocation_pg import DEV, OLD_PW, client, dev_user  # noqa: F401  (fixtures)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def _sign_in(client: TestClient, email: str) -> None:
    client.cookies.clear()
    assert client.post("/api/v1/auth/login", json={"email": email, "password": OLD_PW}).status_code == 200


def _refresh(client: TestClient, csrf: bool = True):
    headers = {"X-CSRF-Token": client.cookies.get(CSRF_COOKIE, "")} if csrf else {}
    return client.post("/api/v1/auth/refresh", headers=headers)


def _claims(token: str, secret: str) -> dict:
    return jwt.decode(token, secret, algorithms=["HS256"])


def test_refresh_issues_a_new_cookie_that_keeps_the_sign_in_time(dev_user, client: TestClient) -> None:
    uid, email, secret = dev_user
    _sign_in(client, email)
    before = _claims(client.cookies[AUTH_COOKIE], secret)
    csrf = client.cookies[CSRF_COOKIE]
    r = _refresh(client)
    assert r.status_code == 204, r.text
    after = _claims(client.cookies[AUTH_COOKIE], secret)
    assert after["sub"] == uid and after["auth_time"] == before["auth_time"] and after["exp"] >= before["exp"]
    assert client.cookies[CSRF_COOKIE] == csrf  # requests already in flight still match
    assert client.get("/api/v1/auth/me").status_code == 200


def test_refresh_needs_the_csrf_token(dev_user, client: TestClient) -> None:
    _sign_in(client, dev_user[1])
    assert _refresh(client, csrf=False).status_code == 403


def test_refresh_is_refused_after_revocation_or_deactivation(owner: Engine, dev_user, client: TestClient) -> None:
    uid, email, _ = dev_user
    _sign_in(client, email)
    with owner.begin() as c:
        c.execute(text("UPDATE users SET token_version = token_version + 1 WHERE id = :u"), {"u": uid})
    assert _refresh(client).status_code == 401
    _sign_in(client, email)
    with owner.begin() as c:
        c.execute(text("UPDATE users SET is_active = false WHERE id = :u"), {"u": uid})
    assert _refresh(client).status_code == 401


def test_refresh_stops_at_the_absolute_limit(dev_user, client: TestClient) -> None:
    uid, email, secret = dev_user
    now = datetime.now(timezone.utc)
    old = int((now - timedelta(hours=SESSION_ABSOLUTE_HOURS + 1)).timestamp())
    token = jwt.encode({"sub": uid, "tenant_id": DEV, "email": email, "role": "viewer", "tv": 0, "auth_time": old,
                        "iat": now, "exp": now + timedelta(hours=1)}, secret, algorithm="HS256")
    client.cookies.clear()
    client.cookies.set(AUTH_COOKIE, token)
    client.cookies.set(CSRF_COOKIE, "c")
    assert client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": "c"}).status_code == 401
