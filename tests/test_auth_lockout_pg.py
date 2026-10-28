"""Per-account lockout and the password policy against a real Postgres.

Ten wrong passwords in a row lock the account for 15 minutes: the tenth answers 401 like the others, the
eleventh (even with the right password) answers 423 with the minutes left. Success resets the count.
The policy (12+ characters, not the email's name, not on the bundled list, not the current password) applies
on accept-invite, reset-password and change-password; accept-invite also marks the invite accepted.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import Engine, text

from tests.test_rbac_escalation_pg import owner, pytestmark  # noqa: F401  (owner is a module-scoped fixture)
from tests.test_session_revocation_pg import DEV, OLD_PW, dev_user  # noqa: F401  (dev_user is a fixture)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The auth router behind the real LocalAuthMiddleware, without the Redis-backed IP limiter (this test
    sends more than ten logins from one address on purpose)."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import api.middleware.local_auth as mw
    from api.routes import auth

    monkeypatch.setattr(mw, "_jwt_secret_cache", {})
    monkeypatch.setattr(mw, "_token_version_cache", {})
    app = FastAPI()
    app.include_router(auth.router)
    app.add_middleware(mw.LocalAuthMiddleware)
    for dep in (auth._login_rate_limit, auth._invite_rate_limit, auth._reset_rate_limit,
                auth._change_password_rate_limit, auth._forgot_rate_limit):
        app.dependency_overrides[dep] = lambda: None
    return TestClient(app)


def _row(owner: Engine, uid: str, cols: str) -> tuple[Any, ...]:
    with owner.connect() as c:
        return tuple(c.execute(text(f"SELECT {cols} FROM users WHERE id = :u"), {"u": uid}).one())


def _login(client: TestClient, email: str, password: str) -> Any:
    client.cookies.clear()
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def test_tenth_failure_is_401_eleventh_is_423_and_success_resets(owner: Engine, dev_user: tuple[str, str, str],
                                                                 client: TestClient) -> None:
    uid, email, _ = dev_user
    for n in range(1, 10):
        assert _login(client, email, "wrong-password-here").status_code == 401, n
    assert _row(owner, uid, "failed_login_count, locked_until") == (9, None)
    assert _login(client, email, "wrong-password-here").status_code == 401  # the 10th: still a plain 401
    count, locked = _row(owner, uid, "failed_login_count, locked_until IS NOT NULL")
    assert (count, locked) == (10, True)

    r = _login(client, email, OLD_PW)  # the 11th, with the right password: locked
    assert r.status_code == 423, r.text
    assert "15 minutes" in r.json()["detail"] and "locked" in r.json()["detail"]
    assert "token" not in r.json()
    assert _login(client, email, "wrong-password-here").status_code == 423  # and a wrong one tells nothing more

    # minutes left are rounded up
    with owner.begin() as c:
        c.execute(text("UPDATE users SET locked_until = now() + interval '61 seconds' WHERE id = :u"), {"u": uid})
    assert "2 minutes" in _login(client, email, OLD_PW).json()["detail"]
    with owner.begin() as c:
        c.execute(text("UPDATE users SET locked_until = now() + interval '20 seconds' WHERE id = :u"), {"u": uid})
    assert "1 minute." in _login(client, email, OLD_PW).json()["detail"]

    # the lock runs out: the right password signs in and the count is reset
    with owner.begin() as c:
        c.execute(text("UPDATE users SET locked_until = now() - interval '1 second' WHERE id = :u"), {"u": uid})
    assert _login(client, email, OLD_PW).status_code == 200
    assert _row(owner, uid, "failed_login_count, locked_until") == (0, None)

    # nine failures, a success, nine more failures: never locked, because success reset the count
    for _ in range(9):
        assert _login(client, email, "wrong-password-here").status_code == 401
    assert _login(client, email, OLD_PW).status_code == 200
    for _ in range(9):
        assert _login(client, email, "wrong-password-here").status_code == 401
    assert _row(owner, uid, "failed_login_count, locked_until") == (9, None)


def test_a_failure_after_an_expired_lock_restarts_the_count(owner: Engine, dev_user: tuple[str, str, str],
                                                            client: TestClient) -> None:
    uid, email, _ = dev_user
    with owner.begin() as c:
        c.execute(text("UPDATE users SET failed_login_count = 10, locked_until = now() - interval '1 minute' "
                       "WHERE id = :u"), {"u": uid})
    assert _login(client, email, "wrong-password-here").status_code == 401
    assert _row(owner, uid, "failed_login_count")[0] == 1
    assert _login(client, email, OLD_PW).status_code == 200


def test_unknown_inactive_and_passwordless_accounts_stay_plain_401(owner: Engine, dev_user: tuple[str, str, str],
                                                                   client: TestClient) -> None:
    uid, email, _ = dev_user
    for _ in range(12):
        assert _login(client, f"nobody-{uuid.uuid4().hex[:6]}@example.test", "whatever-password").status_code == 401
    with owner.begin() as c:
        c.execute(text("UPDATE users SET is_active = false WHERE id = :u"), {"u": uid})
    for _ in range(12):
        assert _login(client, email, "wrong-password-here").status_code == 401
    assert _row(owner, uid, "failed_login_count")[0] == 0  # only a live account is counted


def test_lock_is_per_account_not_per_address(owner: Engine, dev_user: tuple[str, str, str], client: TestClient) -> None:
    uid, email, _ = dev_user
    other = f"other-{uuid.uuid4().hex[:8]}@example.test"
    from api.services.local_auth import hash_password

    with owner.begin() as c:
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active, password_hash) "
                       "VALUES (:i, :t, :e, 'O', 'viewer', true, :ph)"),
                  {"i": str(uuid.uuid4()), "t": DEV, "e": other, "ph": hash_password(OLD_PW)})
    for _ in range(10):
        _login(client, email, "wrong-password-here")
    assert _login(client, email, OLD_PW).status_code == 423
    assert _login(client, other, OLD_PW).status_code == 200


# ── password policy ──────────────────────────────────────────────────────────


def test_validate_password_rules() -> None:
    from api.services.local_auth import hash_password, validate_password

    assert validate_password("a fine long passphrase", "pat@example.test") is None
    assert "at least 12" in (validate_password("short-one", "pat@example.test") or "")
    assert validate_password("xx-patricia-xx-1", "patricia@example.test")  # contains the email name
    assert validate_password("XX-PATRICIA-xx-1", "patricia@example.test")  # case-insensitively
    assert validate_password("ab-ab-ab-ab-ab", "ab@example.test") is None  # a 2-letter name is too short to forbid
    for listed in ("password12345", "Password123456!", "qwertyuiop123", "iloveyou12345", "123456789012", "Welcome12345"):
        assert "too common" in (validate_password(listed, "pat@example.test") or ""), listed
    assert validate_password("a fine long passphrase", "pat@example.test", hash_password("a fine long passphrase")) \
        == "New password must differ from the current one."
    assert validate_password("a fine long passphrase", "pat@example.test", hash_password("another one entirely")) is None
    from pathlib import Path

    import api.services.local_auth as la

    assert len(la._common_passwords()) > 100 and Path(la._COMMON_PASSWORDS).is_file()  # shipped with the code


def _invitee(owner: Engine) -> tuple[str, str, str]:
    uid, email = str(uuid.uuid4()), f"invitee-{uuid.uuid4().hex[:8]}@example.test"
    with owner.begin() as c:
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active, invite_status) "
                       "VALUES (:i, :t, :e, 'I', 'viewer', true, 'sent')"), {"i": uid, "t": DEV, "e": email})
    return uid, email, email.split("@")[0]


def test_accept_invite_applies_policy_and_marks_accepted(owner: Engine, dev_user: tuple[str, str, str],
                                                         client: TestClient) -> None:
    from api.services.local_auth import create_invite_token

    _, _, secret = dev_user
    uid, email, local = _invitee(owner)
    token = create_invite_token(uid, DEV, secret)
    accept = "/api/v1/auth/accept-invite"
    for bad, why in (("short", "at least 12"), (f"{local}-then-more", "email name"), ("Password123456!", "too common")):
        r = client.post(accept, json={"token": token, "password": bad})
        assert r.status_code == 422 and why in r.json()["detail"], (bad, r.text)
    assert _row(owner, uid, "password_hash IS NULL, invite_status, password_changed_at IS NULL") == (True, "sent", True)

    r = client.post(accept, json={"token": token, "password": "a fine long passphrase"})
    assert r.status_code == 200, r.text
    assert _row(owner, uid, "password_hash IS NOT NULL, invite_status, password_changed_at IS NOT NULL") == (True, "accepted", True)
    # single use
    assert client.post(accept, json={"token": token, "password": "another fine passphrase"}).status_code == 409
    assert _login(client, email, "a fine long passphrase").status_code == 200


def test_reset_password_policy_clears_lock_and_link_works_once(owner: Engine, dev_user: tuple[str, str, str],
                                                               client: TestClient) -> None:
    from api.services.local_auth import create_password_reset_token

    uid, email, secret = dev_user
    local = email.split("@")[0]
    with owner.begin() as c:
        c.execute(text("UPDATE users SET failed_login_count = 10, locked_until = now() + interval '9 minutes', "
                       "must_change_password = true, token_version = 4 WHERE id = :u"), {"u": uid})
    token = create_password_reset_token(uid, DEV, secret, token_version=4)
    reset = "/api/v1/auth/reset-password"
    for bad, why in ((f"{local}-and-more", "email name"), ("qwertyuiop123", "too common"), (OLD_PW, "differ")):
        r = client.post(reset, json={"token": token, "password": bad})
        assert r.status_code == 422 and why in r.json()["detail"], (bad, r.text)
    assert _row(owner, uid, "token_version") == (4,)  # a rejected password changes nothing

    r = client.post(reset, json={"token": token, "password": "a fine long passphrase"})
    assert r.status_code == 200, r.text
    assert _row(owner, uid, "failed_login_count, locked_until, must_change_password, token_version, "
                            "password_changed_at IS NOT NULL") == (0, None, False, 5, True)
    # the same link again is refused: the reset moved token_version past the link's
    r = client.post(reset, json={"token": token, "password": "yet another passphrase"})
    assert r.status_code == 400, r.text
    assert _login(client, email, "a fine long passphrase").status_code == 200

    # a link without the claim (minted before this change) still works once
    legacy = create_password_reset_token(uid, DEV, secret)
    assert client.post(reset, json={"token": legacy, "password": "yet another passphrase"}).status_code == 200


def test_change_password_applies_policy(owner: Engine, dev_user: tuple[str, str, str], client: TestClient) -> None:
    uid, email, _ = dev_user
    token = _login(client, email, OLD_PW).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    change = "/api/v1/auth/change-password"
    local = email.split("@")[0]
    for bad, why in (("short", "at least 12"), (f"{local}-then-more", "email name"), ("Password123456!", "too common"),
                     (OLD_PW, "differ")):
        client.cookies.clear()
        r = client.post(change, json={"current_password": OLD_PW, "new_password": bad}, headers=h)
        assert r.status_code == 422 and why in r.json()["detail"], (bad, r.text)
    client.cookies.clear()
    r = client.post(change, json={"current_password": OLD_PW, "new_password": "a fine long passphrase"}, headers=h)
    assert r.status_code == 200, r.text
    assert _row(owner, uid, "password_changed_at IS NOT NULL, must_change_password") == (True, False)
