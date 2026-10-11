"""RBAC wave 13 against a real Postgres: migration 077 backfill/downgrade and the escalation guards on
the grant, role, user and access-request routes.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from typing import TYPE_CHECKING
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator

import pytest
from sqlalchemy import Engine

if TYPE_CHECKING:
    from httpx import AsyncClient

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(*args: str) -> None:
    import subprocess

    r = subprocess.run(["alembic", *args], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def owner() -> Iterator[Engine]:
    from sqlalchemy import create_engine

    _alembic("upgrade", "head")
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def _tenant(owner: Engine, roles: dict[str, str]) -> tuple[str, dict[str, str]]:
    """Tenant + users {name: users.role}. Returns (tid, {name: id})."""
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    ids = {n: str(uuid.uuid4()) for n in roles}
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Rbac')"), {"t": tid})
        for n, i in ids.items():
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active) "
                           "VALUES (:i, :t, :e, :n, :r, true)"),
                      {"i": i, "t": tid, "e": f"{n}-{i[:8]}@example.test", "n": n, "r": roles[n]})
    return tid, ids


def _unscoped(owner: Engine, tid: str) -> list[tuple[str, str]]:
    from sqlalchemy import text

    with owner.connect() as c:
        return sorted((str(r[0]), r[1]) for r in c.execute(
            text("SELECT user_id, role_key FROM user_role_scopes "
                 "WHERE tenant_id = :t AND system_id IS NULL AND module IS NULL"), {"t": tid}))


def test_migration_077_backfill_idempotent_and_downgrade(owner: Engine) -> None:
    from sqlalchemy import text

    from api.services.rbac import PERMISSIONS, PERSONA_ROLES

    import importlib.util
    spec = importlib.util.spec_from_file_location("m077", os.path.join(ROOT, "db/migrations/versions/077_rbac_scopes.py"))
    assert spec and spec.loader
    m077 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m077)

    _alembic("downgrade", "076")
    with owner.connect() as c:
        assert c.execute(text("SELECT to_regclass('user_role_scopes')")).scalar() is None
    roles = {f"u_{r}": r for r in (*PERMISSIONS, *PERSONA_ROLES)}  # every legacy role, plus personas
    t1, ids1 = _tenant(owner, roles)
    t2, ids2 = _tenant(owner, {"solo": "admin"})
    _alembic("upgrade", "077")

    want1 = sorted((ids1[n], r) for n, r in roles.items())
    assert _unscoped(owner, t1) == want1
    assert _unscoped(owner, t2) == [(ids2["solo"], "admin")]
    with owner.begin() as c:
        c.execute(text(m077.BACKFILL_SQL))  # re-run: no duplicates
        total = c.execute(text("SELECT COUNT(*) FROM user_role_scopes WHERE tenant_id IN (:a, :b)"),
                          {"a": t1, "b": t2}).scalar()
    assert total == len(roles) + 1
    assert _unscoped(owner, t1) == want1

    _alembic("downgrade", "076")
    with owner.connect() as c:
        for t in ("roles", "role_permissions", "user_role_scopes", "access_requests"):
            assert c.execute(text(f"SELECT to_regclass('{t}')")).scalar() is None
    _alembic("upgrade", "head")
    assert _unscoped(owner, t1) == want1  # upgrade again backfills the same rows


# ── Routes ───────────────────────────────────────────────────────────────────

Call = Callable[..., Awaitable["Resp"]]


class Resp:
    def __init__(self, status: int, body: object) -> None:
        self.status = status
        self.body = body


def _seed_custom(owner: Engine, tid: str, key: str, pairs: set[tuple[str, str]]) -> None:
    from sqlalchemy import text

    with owner.begin() as c:
        rid = c.execute(text("INSERT INTO roles (tenant_id, key, name, built_in) VALUES (:t, :k, :k, false) "
                             "RETURNING id"), {"t": tid, "k": key}).scalar_one()
        for res, act in pairs:
            c.execute(text("INSERT INTO role_permissions (role_id, resource, action) VALUES (:r, :x, :a)"),
                      {"r": rid, "x": res, "a": act})


def _grant(owner: Engine, tid: str, uid: str, key: str) -> str:
    from sqlalchemy import text

    with owner.begin() as c:
        return str(c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key) "
                                  "VALUES (:t, :u, :k) RETURNING id"), {"t": tid, "u": uid, "k": key}).scalar_one())


def _audit_count(owner: Engine, tid: str) -> int:
    from sqlalchemy import text

    with owner.connect() as c:
        return int(c.execute(text("SELECT COUNT(*) FROM audit_log WHERE tenant_id = :t"), {"t": tid}).scalar_one())


def _serve(owner: Engine, monkeypatch: pytest.MonkeyPatch, tid: str,
           scenario: Callable[["AsyncClient"], Awaitable[None]]) -> None:
    """Run `scenario` against the roles, me and users routers; x-test-uid sets the caller."""
    from fastapi import FastAPI, Request
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
    from starlette.responses import Response

    import api.routes.users as users_mod
    from api.deps import Tenant, get_db, get_tenant
    from api.routes.me import router as me_router
    from api.routes.roles import router as roles_router
    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)

    class _NoMail:
        @staticmethod
        def delay(**_kw: str) -> None:
            return None

    monkeypatch.setattr(users_mod, "send_invitation_email", _NoMail)
    aeng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db() -> AsyncIterator[AsyncSession]:
        async with factory() as s:
            yield s

    async def _as_user(request: Request, call_next: RequestResponseEndpoint) -> Response:
        request.state.local_user_id = request.headers.get("x-test-uid")
        return await call_next(request)

    api = FastAPI()
    for r in (roles_router, me_router, users_mod.router):
        api.include_router(r)
    api.add_middleware(BaseHTTPMiddleware, dispatch=_as_user)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Rbac", [])

    async def main() -> None:
        try:
            async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as c:
                await scenario(c)
        finally:
            await aeng.dispose()

    asyncio.run(main())


def test_escalation_guards(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _tenant(owner, {"padmin": "platform_admin", "admin": "admin", "mgr": "viewer",
                             "target": "viewer", "steward": "data_steward"})
    for name, role in (("padmin", "platform_admin"), ("admin", "admin"), ("mgr", "viewer"),
                       ("target", "viewer"), ("steward", "data_steward")):
        _grant(owner, tid, u[name], role)  # the 077 backfill mirror
    # A user administrator by custom role only: users/admin and nothing else.
    _seed_custom(owner, tid, "custom:user-admin", {("users", "admin")})
    _grant(owner, tid, u["mgr"], "custom:user-admin")

    async def scenario(c: AsyncClient) -> None:
        def as_(who: str) -> dict[str, str]:
            return {"x-test-uid": u[who]}

        grants = f"/api/v1/users/{{}}/grants"
        # H1: no self-grant; no grant above the caller's own permissions; platform_admin only by one.
        r = await c.post(grants.format(u["mgr"]), json={"role_key": "platform_admin"}, headers=as_("mgr"))
        assert r.status_code == 403, r.text
        for key in ("platform_admin", "admin", "data_steward"):
            r = await c.post(grants.format(u["target"]), json={"role_key": key}, headers=as_("mgr"))
            assert r.status_code == 403, (key, r.text)
        r = await c.post(grants.format(u["target"]), json={"role_key": "viewer", "module": "fi_gl"},
                         headers=as_("mgr"))
        assert r.status_code == 201, r.text
        r = await c.post(grants.format(u["target"]), json={"role_key": "platform_admin"}, headers=as_("steward"))
        assert r.status_code == 403  # no manage_users at all
        r = await c.post(grants.format(u["padmin"]), json={"role_key": "auditor"}, headers=as_("padmin"))
        assert r.status_code == 403  # self, even for platform_admin
        r = await c.post(grants.format(u["target"]), json={"role_key": "sap_basis"}, headers=as_("padmin"))
        assert r.status_code == 201, r.text

        # H1 on role change: no self re-role, no promotion above the caller.
        r = await c.put(f"/api/v1/users/{u['mgr']}", json={"role": "admin"}, headers=as_("mgr"))
        assert r.status_code == 403
        r = await c.put(f"/api/v1/users/{u['padmin']}", json={"role": "viewer"}, headers=as_("padmin"))
        assert r.status_code == 403
        r = await c.put(f"/api/v1/users/{u['target']}", json={"role": "admin"}, headers=as_("mgr"))
        assert r.status_code == 403

        # H1 on invite: a custom user admin cannot invite an admin.
        r = await c.post("/api/v1/users/invite", json={"email": "x@example.test", "role": "admin"},
                         headers=as_("mgr"))
        assert r.status_code == 403, r.text

        # H2: clone and matrix edit stay under the caller.
        r = await c.post("/api/v1/roles", json={"name": "Admin copy", "cloned_from": "admin"}, headers=as_("mgr"))
        assert r.status_code == 403
        r = await c.post("/api/v1/roles", json={"name": "Viewer copy", "cloned_from": "viewer"},
                         headers=as_("mgr"))
        assert r.status_code == 201, r.text
        everything = [{"resource": res, "action": a} for res in ("users", "licence", "systems")
                      for a in ("view", "create", "edit", "admin")]
        r = await c.put("/api/v1/roles/custom:viewer-copy/permissions", json={"permissions": everything},
                        headers=as_("mgr"))
        assert r.status_code == 403
        r = await c.put("/api/v1/roles/custom:viewer-copy/permissions",
                        json={"permissions": [{"resource": "mdm", "action": "view"}]}, headers=as_("mgr"))
        assert r.status_code == 200, r.text
        r = await c.post("/api/v1/roles", json={"name": "Padmin copy", "cloned_from": "platform_admin"},
                         headers=as_("padmin"))
        assert r.status_code == 201, r.text

        # H3: no self-approval; the granted role must confer the request.
        r = await c.post("/api/v1/access-requests", json={"resource": "users", "action": "admin"},
                         headers=as_("mgr"))
        own = r.json()["id"]
        r = await c.post(f"/api/v1/access-requests/{own}/decide",
                         json={"decision": "granted", "role_key": "platform_admin"}, headers=as_("mgr"))
        assert r.status_code == 403
        r = await c.post("/api/v1/access-requests", json={"resource": "fixes", "action": "approve"},
                         headers=as_("target"))
        req = r.json()["id"]
        r = await c.post(f"/api/v1/access-requests/{req}/decide",
                         json={"decision": "granted", "role_key": "auditor"}, headers=as_("padmin"))
        assert r.status_code == 422, r.text  # auditor does not approve fixes
        r = await c.post(f"/api/v1/access-requests/{req}/decide",
                         json={"decision": "granted", "role_key": "data_owner"}, headers=as_("mgr"))
        assert r.status_code == 403  # confers it, but is above the custom user admin
        r = await c.post(f"/api/v1/access-requests/{req}/decide",
                         json={"decision": "granted", "role_key": "data_owner"}, headers=as_("padmin"))
        assert r.status_code == 200, r.text

        # M6: the users.role mirror cannot be deleted (it would revoke nothing); no audit row.
        listed = (await c.get(grants.format(u["target"]), headers=as_("padmin"))).json()
        mirror = next(g["id"] for g in listed
                      if g["role_key"] == "viewer" and g["system_id"] is None and g["module"] is None)
        before = _audit_count(owner, tid)
        r = await c.delete(f"/api/v1/users/{u['target']}/grants/{mirror}", headers=as_("padmin"))
        assert r.status_code == 409, r.text
        assert _audit_count(owner, tid) == before

        # L1: role change onto a role already granted unscoped -> no unique-index 500.
        _grant(owner, tid, u["target"], "analyst")
        r = await c.put(f"/api/v1/users/{u['target']}", json={"role": "analyst"}, headers=as_("padmin"))
        assert r.status_code == 200, r.text
        keys = [k for i, k in _unscoped(owner, tid) if i == u["target"]]
        assert keys.count("analyst") == 1 and "viewer" not in keys, keys  # old mirror dropped, no dupe

        # L2: no uid -> 401, not a 500 on a "" uuid.
        assert (await c.get("/api/v1/me/permissions")).status_code == 401

        # L5: invite with a custom first grant keeps users.role built-in; /auth/me sees the custom action.
        r = await c.post("/api/v1/users/invite",
                         json={"email": "ua@example.test", "grants": [{"role_key": "custom:user-admin"}]},
                         headers=as_("padmin"))
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "viewer"
        new_id = r.json()["id"]
        r = await c.get("/api/v1/me/permissions", headers={"x-test-uid": new_id})
        assert r.status_code == 200 and "manage_users" in r.json()["actions"]

    _serve(owner, monkeypatch, tid, scenario)

    from sqlalchemy import text

    from api.services.rbac import unscoped_actions_sync
    with owner.connect() as c:
        new_id = c.execute(text("SELECT id FROM users WHERE email = 'ua@example.test' AND tenant_id = :t"),
                           {"t": tid}).scalar_one()
        assert "manage_users" in unscoped_actions_sync(c, tid, str(new_id), "viewer")
        assert "manage_users" not in unscoped_actions_sync(c, tid, u["target"], "analyst")


def test_rereview_bypasses(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    """Each bypass the wave 13 re-review proved (N1-N6), replayed; every one must now be refused."""
    names = ("padmin", "admin", "mgr", "clone", "selfy", "target", "t2", "t3")
    roles = {"padmin": "platform_admin", "admin": "admin"}
    tid, u = _tenant(owner, {n: roles.get(n, "viewer") for n in names})
    for n in names:
        _grant(owner, tid, u[n], roles.get(n, "viewer"))  # the 077 backfill mirror
    _seed_custom(owner, tid, "custom:user-admin", {("users", "admin")})
    _grant(owner, tid, u["mgr"], "custom:user-admin")
    _grant(owner, tid, u["selfy"], "custom:user-admin")
    _grant(owner, tid, u["selfy"], "data_steward")

    async def scenario(c: AsyncClient) -> None:
        def as_(who: str) -> dict[str, str]:
            return {"x-test-uid": u[who]}

        grants = "/api/v1/users/{}/grants"
        # Setup as in the re-review: a platform admin makes an admin copy and hands it to `clone`.
        r = await c.post("/api/v1/roles", json={"name": "Admin copy", "cloned_from": "admin"}, headers=as_("padmin"))
        assert r.status_code == 201, r.text
        copy = r.json()["key"]
        r = await c.post(grants.format(u["clone"]), json={"role_key": copy}, headers=as_("padmin"))
        assert r.status_code == 201, r.text

        # N1: admin is platform-equivalent, so only an admin or platform admin confers it.
        r = await c.post(grants.format(u["target"]), json={"role_key": "admin"}, headers=as_("clone"))
        assert r.status_code == 403, ("P1b", r.text)
        r = await c.put(f"/api/v1/users/{u['t2']}", json={"role": "admin"}, headers=as_("clone"))
        assert r.status_code == 403, ("P1d", r.text)
        r = await c.post("/api/v1/users/invite", json={"email": "p7@example.test", "role": "admin"},
                         headers=as_("clone"))
        assert r.status_code == 403, ("P7", r.text)
        r = await c.post(grants.format(u["target"]), json={"role_key": copy}, headers=as_("clone"))
        assert r.status_code == 403, ("admin-equivalent custom role", r.text)
        for src in ("admin", copy):
            r = await c.post("/api/v1/roles", json={"name": f"Again {src}", "cloned_from": src},
                             headers=as_("clone"))
            assert r.status_code == 403, ("clone", src, r.text)
        r = await c.post(grants.format(u["t3"]), json={"role_key": "platform_admin"}, headers=as_("admin"))
        assert r.status_code == 201, r.text  # deviation 2: a legacy admin still may

        # N2: a non-canonical UUID does not dodge the self check.
        r = await c.put(f"/api/v1/users/{u['selfy'].upper()}", json={"role": "data_steward"},
                        headers=as_("selfy"))
        assert r.status_code == 403, ("P2a", r.text)

        # N3: deactivate, reactivate and delete are ceiling- and self-checked.
        r = await c.put(f"/api/v1/users/{u['padmin']}", json={"is_active": False}, headers=as_("mgr"))
        assert r.status_code == 403, ("P3a", r.text)
        r = await c.delete(f"/api/v1/users/{u['admin']}", headers=as_("mgr"))
        assert r.status_code == 403, ("P3c", r.text)
        r = await c.delete(f"/api/v1/users/{u['clone']}", headers=as_("mgr"))
        assert r.status_code == 403, ("delete holder of a custom admin copy", r.text)
        for active in (False, True):
            r = await c.put(f"/api/v1/users/{u['t2']}", json={"is_active": active}, headers=as_("mgr"))
            assert r.status_code == 200, r.text  # a viewer sits under the user admin

        # N4: no rewriting, renaming or deleting a role held above the caller.
        r = await c.put(f"/api/v1/roles/{copy}/permissions",
                        json={"permissions": [{"resource": "mdm", "action": "view"}]}, headers=as_("mgr"))
        assert r.status_code == 403, ("P4", r.text)
        r = await c.put(f"/api/v1/roles/{copy}", json={"name": "Renamed"}, headers=as_("mgr"))
        assert r.status_code == 403, r.text
        r = await c.delete(f"/api/v1/roles/{copy}", headers=as_("mgr"))
        assert r.status_code == 403, r.text

        # N6: a pair no role can confer is refused when asked for.
        r = await c.post("/api/v1/access-requests", json={"resource": "users", "action": "view"},
                         headers=as_("target"))
        assert r.status_code == 422, ("N6", r.text)
        r = await c.post("/api/v1/access-requests", json={"resource": "rules", "action": "view"},
                         headers=as_("target"))
        assert r.status_code == 201, r.text
        req = r.json()["id"]

        # N5: a user admin by custom role sees the queue it can decide.
        r = await c.get("/api/v1/access-requests", headers=as_("mgr"))
        assert r.status_code == 200 and req in [x["id"] for x in r.json()], ("N5", r.text)

        # Last: at base these succeed and would lock the user admin out of the probes above.
        r = await c.delete(f"/api/v1/users/{u['mgr']}", headers=as_("mgr"))
        assert r.status_code == 403, ("self delete", r.text)
        r = await c.put(f"/api/v1/users/{u['mgr'].upper()}", json={"is_active": False}, headers=as_("mgr"))
        assert r.status_code == 403, ("self deactivate", r.text)

    _serve(owner, monkeypatch, tid, scenario)


def test_decide_own_request_hyphenless_id(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _tenant(owner, {"padmin": "platform_admin"})
    _grant(owner, tid, u["padmin"], "platform_admin")

    async def scenario(c: AsyncClient) -> None:
        hdr = {"x-test-uid": u["padmin"].replace("-", "")}
        r = await c.post("/api/v1/access-requests", json={"resource": "users", "action": "admin"}, headers=hdr)
        assert r.status_code == 201, r.text
        r = await c.post(f"/api/v1/access-requests/{r.json()['id']}/decide",
                         json={"decision": "declined"}, headers=hdr)
        assert r.status_code == 403, r.text

    _serve(owner, monkeypatch, tid, scenario)
