"""Every role can be handed out and then used: the permission matrix, role by role, and (against a real
Postgres) the whole path invite -> accept -> sign in -> the role it carries -> what it may call.

- The matrix runs everywhere: for each role in VALID_ROLES a route guarded by an action the role holds answers 2xx,
  and one guarded by an action it lacks answers 403 (api/services/rbac.py require_permission).
- The round trip needs MERIDIAN_TEST_DB_URL (a throwaway database, see tests/test_rls_integration.py). It uses the
  deployment tenant because the auth routes sign in there. Passwords are generated per run; nothing is real.
"""

from __future__ import annotations

import os
import secrets
import uuid
from typing import Any

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import LEGACY_ROLES, PERSONA_ROLES, VALID_ROLES, has_permission, permissions_for, require_permission

TID = uuid.uuid4()
ROLES = sorted(VALID_ROLES)
ALL_ACTIONS = sorted({a for r in ROLES for a in permissions_for(r)})


class _NoDB:
    """Nothing is read: the dev role header answers before any query."""

    async def execute(self, stmt: Any, params: Any = None) -> None:
        return None


def _app() -> TestClient:
    app = FastAPI()
    for action in ALL_ACTIONS:
        app.add_api_route(f"/guard/{action}", (lambda: {"ok": True}), methods=["GET"],
                          dependencies=[Depends(require_permission(action))])

    async def _db():
        yield _NoDB()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return TestClient(app)


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    return _app()


@pytest.mark.parametrize("role", ROLES)
def test_each_role_passes_what_it_holds_and_is_refused_the_rest(client: TestClient, role: str) -> None:
    held = permissions_for(role)
    assert held, f"{role} holds no permission at all, so it could sign in and use nothing"
    for action in ALL_ACTIONS:
        r = client.get(f"/guard/{action}", headers={"X-User-Role": role})
        assert r.status_code == (200 if action in held else 403), (role, action, r.status_code)
    refused = [a for a in ALL_ACTIONS if a not in held]
    if refused:
        assert not has_permission(role, refused[0])


def test_the_roles_an_administrator_can_hand_out_are_the_persona_roles_plus_the_plain_ones() -> None:
    grantable = VALID_ROLES - LEGACY_ROLES
    assert set(PERSONA_ROLES) <= grantable
    assert {"analyst", "auditor", "viewer"} <= grantable
    # admin is the legacy name of platform_admin: it is not offered, and the replacement is
    assert "admin" in LEGACY_ROLES and "platform_admin" in grantable


def test_only_user_managers_may_manage_users_and_a_viewer_is_refused(client: TestClient) -> None:
    ok = {r for r in ROLES if has_permission(r, "manage_users")}
    assert "platform_admin" in ok and "viewer" not in ok
    for role in ROLES:
        assert client.get("/guard/manage_users", headers={"X-User-Role": role}).status_code == (200 if role in ok else 403)


# ── invite -> accept -> sign in, per grantable role (real Postgres) ──────────

PG = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    from tests.test_rbac_escalation_pg import _alembic

    from sqlalchemy import create_engine

    _alembic("upgrade", "head")
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


@PG
@pytest.mark.parametrize("role", sorted(VALID_ROLES - LEGACY_ROLES))
def test_invite_accept_sign_in_round_trip(owner: Any, monkeypatch: pytest.MonkeyPatch, role: str) -> None:
    import asyncio

    import jwt
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from starlette.middleware.base import BaseHTTPMiddleware

    import api.routes.auth as auth_mod
    import api.routes.users as users_mod
    from api.routes.me import router as me_router
    from api.routes.roles import router as roles_router

    secret = secrets.token_hex(20)
    tid = auth_mod.DEV_TENANT_ID
    admin_id = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Deployment') ON CONFLICT (id) DO NOTHING"), {"t": tid})
        c.execute(text("UPDATE tenants SET jwt_secret = :s WHERE id = :t"), {"s": secret, "t": tid})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active, password_hash) "
                       "VALUES (:i, :t, :e, 'Admin', 'platform_admin', true, 'x')"),
                  {"i": admin_id, "t": tid, "e": f"admin-{admin_id[:8]}@example.com"})
        c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key) VALUES (:t, :u, 'platform_admin')"),
                  {"t": tid, "u": admin_id})

    sent: list[dict[str, Any]] = []

    class _Capture:
        def delay(self, **kw: Any) -> None:
            sent.append(kw)

    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)
    monkeypatch.setenv("MERIDIAN_APP_URL", "https://meridian.example.test")
    monkeypatch.setattr(users_mod, "send_invitation_email", _Capture())
    monkeypatch.setattr("api.routes.licence.get_cached_manifest", lambda: {})
    monkeypatch.setattr(auth_mod, "get_sync_engine_or_create", lambda: owner)

    aeng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    async def _as_user(request, call_next):
        request.state.local_user_id = request.headers.get("x-test-uid")
        return await call_next(request)

    app = FastAPI()
    for r in (auth_mod.router, roles_router, me_router, users_mod.router):
        app.include_router(r)
    app.add_middleware(BaseHTTPMiddleware, dispatch=_as_user)
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Deployment", [])
    for limiter in (auth_mod._invite_rate_limit, auth_mod._login_rate_limit):
        app.dependency_overrides[limiter] = lambda: None

    email = f"{role}-{uuid.uuid4().hex[:8]}@example.com"
    password = secrets.token_urlsafe(18)  # generated here; never a real credential

    async def scenario(c: AsyncClient) -> None:
        r = await c.post("/api/v1/users/invite", json={"email": email, "role": role}, headers={"x-test-uid": admin_id})
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        token = sent[-1]["invite_token"]
        assert jwt.decode(token, secret, algorithms=["HS256"])["purpose"] == "invite_accept"
        # the link works before it is used
        r = await c.post("/api/v1/auth/invite/preview", json={"token": token})
        assert r.status_code == 200, r.text
        # no password yet: signing in is refused, accepting sets it, the link is then spent
        assert (await c.post("/api/v1/auth/login", json={"email": email, "password": password})).status_code == 401
        r = await c.post("/api/v1/auth/accept-invite", json={"token": token, "password": password})
        assert r.status_code == 200, r.text
        assert (await c.post("/api/v1/auth/accept-invite", json={"token": token, "password": password})).status_code == 409
        # sign in: the role and the permissions it carries, and a home screen
        r = await c.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["id"] == uid and body["user"]["role"]
        assert body["user"]["home"]
        assert set(body["user"]["permissions"]) == set(permissions_for(body["user"]["role"]))
        # and the API agrees: the role's own users.role decides what it may call
        denied = await c.get("/api/v1/users", headers={"x-test-uid": uid})
        assert denied.status_code == (200 if has_permission(body["user"]["role"], "manage_users") else 403), denied.text

    async def main() -> None:
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                await scenario(c)
        finally:
            await aeng.dispose()

    asyncio.run(main())
