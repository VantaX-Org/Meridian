"""RBAC wave 14 against a real Postgres: scope=scope_from_path on the ten route modules, and the
object-approval conversion endpoint. Runs with MERIDIAN_TEST_DB_URL; skipped otherwise."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest
from sqlalchemy import Engine, text
from httpx import AsyncClient

from tests.test_rbac_escalation_pg import _grant, _seed_custom, _tenant, owner  # noqa: F401

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

MM, FI = "material_master", "fi_gl"


def _system(owner: Engine, tid: str) -> str:
    sid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:i, :t, 'sys')"),
                  {"i": sid, "t": tid})
    return sid


def _version(owner: Engine, tid: str, system_id: str | None) -> str:
    vid = str(uuid.uuid4())
    meta = f'{{"system_id": "{system_id}"}}' if system_id else "{}"
    with owner.begin() as c:
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'extracted', CAST(:m AS jsonb))"), {"v": vid, "t": tid, "m": meta})
    return vid


def _scoped_grant(owner: Engine, tid: str, uid: str, key: str, system_id: str | None, module: str | None) -> None:
    with owner.begin() as c:
        c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key, system_id, module) "
                       "VALUES (:t, :u, :k, :s, :m)"), {"t": tid, "u": uid, "k": key, "s": system_id, "m": module})


def _serve(owner: Engine, monkeypatch: pytest.MonkeyPatch, tid: str,
           scenario: Callable[[AsyncClient], Awaitable[None]]) -> None:
    from fastapi import FastAPI, Request
    from httpx import ASGITransport
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
    from starlette.responses import Response

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import connectivity, objects, roles, systems, versions
    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)
    from types import SimpleNamespace

    from workers.tasks import run_health_check  # no broker in tests: the enqueue is a stub
    monkeypatch.setattr(run_health_check.run_health_check, "delay",
                        lambda *_a, **_k: SimpleNamespace(id="stub"), raising=False)
    aeng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db() -> AsyncIterator[AsyncSession]:
        async with factory() as s:
            yield s

    async def _as_user(request: Request, call_next: RequestResponseEndpoint) -> Response:
        request.state.local_user_id = request.headers.get("x-test-uid")
        return await call_next(request)

    api = FastAPI()
    for r in (systems.router, connectivity.router, objects.router, versions.router, roles.router):
        api.include_router(r)
    api.add_middleware(BaseHTTPMiddleware, dispatch=_as_user)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Rbac", [])

    async def main() -> None:
        try:
            # Past the permission check the handlers hit unseeded data; only 403 vs not-403 matters here.
            async with AsyncClient(transport=ASGITransport(app=api, raise_app_exceptions=False),
                                   base_url="http://test") as c:
                await scenario(c)
        finally:
            await aeng.dispose()

    asyncio.run(main())


def test_scoped_grant_sees_only_its_scope(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _tenant(owner, {"by_sys": "viewer", "by_mod": "viewer"})
    sys_a, sys_b = _system(owner, tid), _system(owner, tid)
    ver_a, ver_b, ver_none = (_version(owner, tid, sys_a), _version(owner, tid, sys_b), _version(owner, tid, None))
    _scoped_grant(owner, tid, u["by_sys"], "analyst", sys_a, None)   # analyst on system A only
    _scoped_grant(owner, tid, u["by_mod"], "analyst", None, MM)      # analyst on one module, any system

    async def scenario(c: AsyncClient) -> None:
        async def status(who: str, method: str, path: str) -> int:
            r = await c.request(method, path, headers={"x-test-uid": u[who]})
            if r.status_code == 403 and isinstance(r.json().get("detail"), dict):
                assert r.json()["detail"]["request_access"] is True
            return r.status_code

        # systems + connectivity: system A open, system B and unresolved scopes refused.
        assert await status("by_sys", "POST", f"/api/v1/systems/{sys_a}/sync") != 403
        assert await status("by_sys", "POST", f"/api/v1/systems/{sys_b}/sync") == 403
        assert await status("by_sys", "POST", f"/api/v1/connectivity/health-check/{sys_a}") != 403
        assert await status("by_sys", "POST", f"/api/v1/connectivity/health-check/{sys_b}") == 403
        # versions: the system comes from analysis_versions.metadata (one lookup).
        assert await status("by_sys", "POST", f"/api/v1/versions/{ver_a}/analyse") != 403
        assert await status("by_sys", "POST", f"/api/v1/versions/{ver_b}/analyse") == 403
        assert await status("by_sys", "POST", f"/api/v1/versions/{ver_none}/analyse") == 403
        # objects: module A open, module B refused; a system grant does not cover a module-only route.
        assert await status("by_mod", "GET", f"/api/v1/objects/{MM}/export") != 403
        assert await status("by_mod", "GET", f"/api/v1/objects/{FI}/export") == 403
        assert await status("by_mod", "POST", f"/api/v1/systems/{sys_a}/sync") == 403
        assert await status("by_sys", "GET", f"/api/v1/objects/{MM}/export") == 403
        # the scoped analyst gets no manage_systems anywhere
        assert await status("by_sys", "DELETE", f"/api/v1/systems/{sys_a}") == 403

    _serve(owner, monkeypatch, tid, scenario)


def test_tenant_wide_legacy_roles_unchanged(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services.rbac import PERMISSIONS, PERSONA_ROLES, has_permission

    roles = (*PERMISSIONS, *PERSONA_ROLES)
    # each role twice: bare users.role (pre-077 shape) and with its backfilled mirror grant
    tid, u = _tenant(owner, {f"{r}:{m}": r for r in roles for m in ("bare", "mirror")})
    for r in roles:
        _grant(owner, tid, u[f"{r}:mirror"], r)
    sys_a = _system(owner, tid)
    ver = _version(owner, tid, sys_a)
    routes = [("POST", f"/api/v1/systems/{sys_a}/sync", "trigger_sync"),
              ("POST", f"/api/v1/connectivity/health-check/{sys_a}", "trigger_sync"),
              ("GET", f"/api/v1/objects/{MM}/export", "export"),
              ("POST", f"/api/v1/versions/{ver}/analyse", "analyse"),
              ("DELETE", f"/api/v1/systems/{sys_a}", "manage_systems")]

    async def scenario(c: AsyncClient) -> None:
        for name, uid in u.items():
            role = name.split(":")[0]
            for method, path, action in routes:
                r = await c.request(method, path, headers={"x-test-uid": uid})
                assert (r.status_code == 403) == (not has_permission(role, action)), (name, path, r.status_code)

    _serve(owner, monkeypatch, tid, scenario)


def test_convert_object_approvals(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _tenant(owner, {"admin": "admin", "ua": "viewer", "t1": "viewer", "t2": "viewer", "t3": "viewer"})
    _seed_custom(owner, tid, "custom:user-admin", {("users", "admin")})
    _grant(owner, tid, u["ua"], "custom:user-admin")
    for name, perms in (("t1", '{"material_master": {"approve": true}, "fi_gl": {"approve": false}}'),
                        ("t2", '{"material_master": {"approve": true}}'),
                        ("admin", '{"material_master": {"approve": true}}'),
                        ("t3", '{"material_master": {"approve": true}}')):
        with owner.begin() as c:
            c.execute(text("UPDATE users SET permissions = CAST(:p AS jsonb) WHERE id = :u"),
                      {"p": perms, "u": u[name]})

    def stored(name: str) -> object:
        with owner.connect() as c:
            return c.execute(text("SELECT permissions FROM users WHERE id = :u"), {"u": u[name]}).scalar()

    def grants(name: str) -> list[tuple[str, str | None]]:
        with owner.connect() as c:
            return sorted((r[0], r[1]) for r in c.execute(
                text("SELECT role_key, module FROM user_role_scopes WHERE user_id = :u"), {"u": u[name]}))

    async def scenario(c: AsyncClient) -> None:
        def url(name: str) -> str:
            return f"/api/v1/users/{u[name]}/object-approvals/convert"

        as_admin, as_ua = {"x-test-uid": u["admin"]}, {"x-test-uid": u["ua"]}
        # preview changes nothing
        r = await c.post(url("t1"), json={}, headers=as_admin)
        assert r.status_code == 200 and r.json()["converted"] == ["material_master"], r.text
        assert grants("t1") == [] and stored("t1") is not None
        # no self conversion
        r = await c.post(url("admin"), json={"confirm": True}, headers=as_admin)
        assert r.status_code == 403, r.text
        assert grants("admin") == [] and stored("admin") is not None
        # ceiling: a users-only admin cannot hand out data_owner; nothing is written, JSONB survives
        r = await c.post(url("t3"), json={"confirm": True}, headers=as_ua)
        assert r.status_code == 403, r.text
        assert grants("t3") == [] and stored("t3") is not None
        # the admin gate on the dependency: a plain viewer is refused
        r = await c.post(url("t2"), json={"confirm": True}, headers={"x-test-uid": u["t1"]})
        assert r.status_code == 403
        # confirm: grants first, JSONB cleared once nothing is left to keep
        r = await c.post(url("t2"), json={"confirm": True}, headers=as_admin)
        assert r.status_code == 200 and r.json()["cleared"] is True, r.text
        assert grants("t2") == [("data_owner", MM)] and stored("t2") is None
        # a denial cannot be a grant: it stays, so the user is never widened
        r = await c.post(url("t1"), json={"confirm": True}, headers=as_admin)
        assert r.json()["kept"] == [FI] and r.json()["cleared"] is False, r.text
        assert grants("t1") == [("data_owner", MM)] and stored("t1") == {FI: {"approve": False}}

    _serve(owner, monkeypatch, tid, scenario)
