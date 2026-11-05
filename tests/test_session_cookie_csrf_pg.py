"""Browser sessions ride on the httponly cookie; a cookie-authenticated mutating request must also carry the
double-submit CSRF token. Bearer requests (API keys, SCIM, MCP, machine clients) need none.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_session_revocation_pg.py); skipped otherwise.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.test_session_revocation_pg import (  # noqa: F401  (fixtures)
    NEW_PW,
    OLD_PW,
    client,
    dev_user,
    owner,
    pytestmark,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

CHANGE = "/api/v1/auth/change-password"


def _signed_in(client: TestClient, email: str) -> str:
    client.cookies.clear()
    r = client.post("/api/v1/auth/login", json={"email": email, "password": OLD_PW})
    assert r.status_code == 200, r.text
    assert client.cookies.get("mn_auth_token") and client.cookies.get("mn_csrf")
    return client.cookies["mn_csrf"]


def _body() -> dict[str, str]:
    return {"current_password": OLD_PW, "new_password": NEW_PW}


def test_login_sets_httponly_session_and_readable_csrf_cookie(dev_user, client) -> None:
    _uid, email, _s = dev_user
    r = client.post("/api/v1/auth/login", json={"email": email, "password": OLD_PW})
    cookies = {c.split("=", 1)[0]: c.lower() for c in r.headers.get_list("set-cookie")}
    assert "httponly" in cookies["mn_auth_token"] and "samesite=lax" in cookies["mn_auth_token"]
    assert "httponly" not in cookies["mn_csrf"] and "path=/" in cookies["mn_csrf"]
    assert "secure" not in cookies["mn_auth_token"]  # plain http: a Secure cookie would never come back


def test_cookie_only_mutation_without_csrf_header_is_refused(dev_user, client) -> None:
    _signed_in(client, dev_user[1])
    r = client.post(CHANGE, json=_body())
    assert r.status_code == 403 and "could not be confirmed" in r.json()["detail"]


def test_cookie_mutation_with_wrong_csrf_header_is_refused(dev_user, client) -> None:
    _signed_in(client, dev_user[1])
    assert client.post(CHANGE, json=_body(), headers={"X-CSRF-Token": "not-the-token"}).status_code == 403


def test_cookie_mutation_with_csrf_header_passes_and_renews_the_cookie(dev_user, client) -> None:
    token = _signed_in(client, dev_user[1])
    r = client.post(CHANGE, json=_body(), headers={"X-CSRF-Token": token})
    assert r.status_code == 200, r.text
    assert client.get("/api/v1/auth/me").status_code == 200  # the renewed cookie carries on


def test_cookie_mutation_without_csrf_cookie_is_refused(dev_user, client) -> None:
    token = _signed_in(client, dev_user[1])
    client.cookies.delete("mn_csrf")
    assert client.post(CHANGE, json=_body(), headers={"X-CSRF-Token": token}).status_code == 403


def test_cookie_reads_need_no_csrf(dev_user, client) -> None:
    _signed_in(client, dev_user[1])
    assert client.get("/api/v1/auth/me").status_code == 200


def test_bearer_mutation_needs_no_csrf(dev_user, client) -> None:
    _signed_in(client, dev_user[1])
    token = client.cookies["mn_auth_token"]
    client.cookies.clear()
    r = client.post(CHANGE, json=_body(), headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text


def test_logout_clears_both_cookies_and_needs_no_csrf(dev_user, client) -> None:
    _signed_in(client, dev_user[1])
    r = client.post("/api/v1/auth/logout")
    assert r.status_code == 204
    cleared = " ".join(r.headers.get_list("set-cookie")).lower()
    assert "mn_auth_token=" in cleared and "mn_csrf=" in cleared and "max-age=0" in cleared
    assert client.get("/api/v1/auth/me").status_code == 401


def test_invalid_session_cookie_is_401_and_cookies_are_dropped(dev_user, client) -> None:
    _signed_in(client, dev_user[1])
    client.cookies.set("mn_auth_token", "garbage.not.a-jwt")
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401
    assert "mn_csrf=" in " ".join(r.headers.get_list("set-cookie"))


def test_me_with_a_legacy_bearer_token_issues_the_session_cookies(dev_user, client) -> None:
    _signed_in(client, dev_user[1])
    token = client.cookies["mn_auth_token"]
    client.cookies.clear()
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert client.cookies.get("mn_auth_token") == token and client.cookies.get("mn_csrf")


def test_me_heals_a_missing_csrf_cookie(dev_user, client) -> None:
    _signed_in(client, dev_user[1])
    client.cookies.delete("mn_csrf")
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.cookies.get("mn_csrf")
