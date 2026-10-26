"""Session revocation against a real Postgres: migration 092 up/down, and the login, change-password,
reset-password and deactivate routes behind LocalAuthMiddleware's users.token_version check.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import Engine, text

from tests.test_rbac_escalation_pg import (  # noqa: F401  (owner is a module-scoped fixture)
    _alembic,
    _grant,
    _serve,
    _tenant,
    owner,
    pytestmark,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from httpx import AsyncClient

DEV = "00000000-0000-0000-0000-000000000001"
OLD_PW = "the-original-password"
NEW_PW = "a-brand-new-password"
RESET_PW = "the-reset-password!!"


def _token_version(owner: Engine, uid: str) -> int:
    with owner.connect() as c:
        return c.execute(text("SELECT token_version FROM users WHERE id = :u"), {"u": uid}).scalar_one()


def test_migration_092_adds_and_drops_token_version(owner: Engine) -> None:
    def has_column() -> bool:
        with owner.connect() as c:
            return bool(c.execute(text("SELECT 1 FROM information_schema.columns "
                                       "WHERE table_name = 'users' AND column_name = 'token_version'")).fetchone())

    _alembic("downgrade", "091")
    assert not has_column()
    _tid, ids = _tenant(owner, {"existing": "viewer"})
    _alembic("upgrade", "092")
    assert has_column()
    assert _token_version(owner, ids["existing"]) == 0  # existing users start at 0: nobody is signed out
    _alembic("upgrade", "head")


@pytest.fixture
def dev_user(owner: Engine) -> tuple[str, str, str]:
    """A user of the local-auth tenant with password OLD_PW. Returns (id, email, jwt_secret)."""
    from api.services.local_auth import generate_jwt_secret, hash_password

    uid, email = str(uuid.uuid4()), f"rev-{uuid.uuid4().hex[:8]}@example.test"
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Dev') ON CONFLICT (id) DO NOTHING"), {"t": DEV})
        c.execute(text("UPDATE tenants SET jwt_secret = COALESCE(jwt_secret, :s) WHERE id = :t"),
                  {"s": generate_jwt_secret(), "t": DEV})
        secret = c.execute(text("SELECT jwt_secret FROM tenants WHERE id = :t"), {"t": DEV}).scalar_one()
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active, password_hash) "
                       "VALUES (:i, :t, :e, 'Rev', 'viewer', true, :ph)"),
                  {"i": uid, "t": DEV, "e": email, "ph": hash_password(OLD_PW)})
    return uid, email, secret


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The auth router behind the real LocalAuthMiddleware and its real token_version lookup."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import api.middleware.local_auth as mw
    from api.routes import auth

    monkeypatch.setattr(mw, "_jwt_secret_cache", {})
    monkeypatch.setattr(mw, "_token_version_cache", {})
    app = FastAPI()
    app.include_router(auth.router)
    app.add_middleware(mw.LocalAuthMiddleware)
    return TestClient(app)


def _me(client: TestClient, token: str) -> int:
    client.cookies.clear()  # the Bearer header alone is the session under test
    return client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code


def _login(client: TestClient, email: str, password: str) -> str:
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _legacy(uid: str, email: str, secret: str) -> str:
    """A session token as issued before migration 092: no ``tv`` claim."""
    import jwt

    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": uid, "tenant_id": DEV, "email": email, "role": "viewer", "iat": now,
                       "exp": now + timedelta(hours=1)}, secret, algorithm="HS256")


@pytest.mark.session_revocation
def test_change_password_revokes_old_sessions_and_keeps_the_caller(
    owner: Engine, dev_user: tuple[str, str, str], client: TestClient,
) -> None:
    from api.services.local_auth import decode_access_token

    uid, email, secret = dev_user
    old = _login(client, email, OLD_PW)
    other = _login(client, email, OLD_PW)  # a second device
    legacy = _legacy(uid, email, secret)
    assert decode_access_token(old, secret)["tv"] == 0
    assert _me(client, old) == 200 and _me(client, other) == 200
    assert _me(client, legacy) == 200  # pre-upgrade tokens keep working until something revokes them

    client.cookies.clear()
    r = client.post("/api/v1/auth/change-password", json={"current_password": OLD_PW, "new_password": NEW_PW},
                    headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 200, r.text
    fresh = r.json()["token"]
    assert decode_access_token(fresh, secret)["tv"] == 1
    assert r.cookies.get("mn_auth_token") == fresh
    assert _token_version(owner, uid) == 1

    assert _me(client, old) == 401
    assert _me(client, other) == 401
    assert _me(client, legacy) == 401
    assert _me(client, fresh) == 200  # the caller carries on with the replacement token
    assert decode_access_token(_login(client, email, NEW_PW), secret)["tv"] == 1


@pytest.mark.session_revocation
def test_password_reset_revokes_sessions(owner: Engine, dev_user: tuple[str, str, str], client: TestClient) -> None:
    from api.services.local_auth import create_password_reset_token

    uid, email, secret = dev_user
    session = _login(client, email, OLD_PW)
    assert _me(client, session) == 200
    r = client.post("/api/v1/auth/reset-password",
                    json={"token": create_password_reset_token(uid, DEV, secret), "password": RESET_PW})
    assert r.status_code == 200, r.text
    assert _token_version(owner, uid) == 1
    assert _me(client, session) == 401
    assert _me(client, _login(client, email, RESET_PW)) == 200


@pytest.mark.session_revocation
def test_deactivate_revokes_sessions(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import api.middleware.local_auth as mw
    from api.services.local_auth import create_access_token

    tid, u = _tenant(owner, {"padmin": "platform_admin", "admin2": "platform_admin", "target": "viewer"})
    for n in ("padmin", "admin2"):
        _grant(owner, tid, u[n], "platform_admin")
    _grant(owner, tid, u["target"], "viewer")
    secret = "deactivate-test-secret-of-32-bytes!!"
    monkeypatch.setattr(mw, "_load_jwt_secret", lambda: secret)
    monkeypatch.setattr(mw, "_token_version_cache", {})
    session = create_access_token(u["target"], tid, "t@example.test", "viewer", secret)

    app = FastAPI()

    @app.get("/api/v1/ping")
    def ping() -> dict[str, bool]:
        return {"ok": True}

    app.add_middleware(mw.LocalAuthMiddleware)
    guarded = TestClient(app)

    def ping_status() -> int:
        return guarded.get("/api/v1/ping", headers={"Authorization": f"Bearer {session}"}).status_code

    assert ping_status() == 200

    async def scenario(c: AsyncClient) -> None:
        r = await c.put(f"/api/v1/users/{u['target']}", json={"is_active": False}, headers={"x-test-uid": u["padmin"]})
        assert r.status_code == 200, r.text

    _serve(owner, monkeypatch, tid, scenario)
    assert _token_version(owner, u["target"]) == 1
    assert ping_status() == 401
