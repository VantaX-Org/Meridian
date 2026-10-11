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
    from api.routes import (cleaning, connectivity, findings, master_records, migration, objects, remediation,
                            roles, stewardship, systems, versions)
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
    for r in (systems.router, connectivity.router, objects.router, versions.router, roles.router, cleaning.router,
              findings.router, master_records.router, migration.router, remediation.router, stewardship.router):
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
    tid, u = _tenant(owner, {"admin": "admin", "ua": "viewer", "t1": "steward", "t2": "viewer", "t3": "steward",
                             "t4": "steward", "t5": "steward"})
    _seed_custom(owner, tid, "custom:user-admin", {("users", "admin")})
    _grant(owner, tid, u["ua"], "custom:user-admin")
    for name, perms in (("t1", '{"material_master": {"approve": true}, "fi_gl": {"approve": false}}'),
                        ("t2", '{"material_master": {"approve": true}}'),
                        ("admin", '{"material_master": {"approve": true}}'),
                        ("t3", '{"material_master": {"approve": true}}'),
                        ("t4", '{"material_master": {"approve": true}}'),
                        ("t5", '["not", "an", "object"]')):
        with owner.begin() as c:
            c.execute(text("UPDATE users SET permissions = CAST(:p AS jsonb) WHERE id = :u"),
                      {"p": perms, "u": u[name]})

    def stored(name: str) -> object:
        with owner.connect() as c:
            return c.execute(text("SELECT permissions FROM users WHERE id = :u"), {"u": u[name]}).scalar()

    def grants(name: str) -> list[tuple[str, str | None]]:
        with owner.connect() as c:
            return sorted((r[0], r[1]) for r in c.execute(
                text("SELECT role_key, module FROM user_role_scopes WHERE user_id = :u AND module IS NOT NULL"),
                {"u": u[name]}))

    def audits() -> int:
        with owner.connect() as c:
            return int(c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t"), {"t": tid}).scalar() or 0)

    async def scenario(c: AsyncClient) -> None:
        def url(name: str) -> str:
            return f"/api/v1/users/{u[name]}/object-approvals/convert"

        as_admin, as_ua = {"x-test-uid": u["admin"]}, {"x-test-uid": u["ua"]}
        # preview changes nothing
        r = await c.post(url("t1"), json={}, headers=as_admin)
        assert r.status_code == 200 and r.json()["skipped"] == ["material_master"], r.text
        assert grants("t1") == [] and stored("t1") is not None
        # no self conversion
        r = await c.post(url("admin"), json={"confirm": True}, headers=as_admin)
        assert r.status_code == 403, r.text
        assert grants("admin") == [] and stored("admin") is not None
        # the admin gate on the dependency: a plain steward is refused
        r = await c.post(url("t4"), json={"confirm": True}, headers={"x-test-uid": u["t1"]})
        assert r.status_code == 403
        # a non-object JSONB is a 422 and is left alone
        r = await c.post(url("t5"), json={"confirm": True}, headers=as_admin)
        assert r.status_code == 422 and stored("t5") == ["not", "an", "object"]
        # confirm: approve=true is dropped, no grant is ever created
        r = await c.post(url("t4"), json={"confirm": True}, headers=as_admin)
        assert r.status_code == 200 and r.json()["cleared"] is True and r.json()["converted"] == [], r.text
        assert grants("t4") == [] and stored("t4") is None
        # re-confirm with nothing left: no UPDATE, no audit row
        before = audits()
        r = await c.post(url("t4"), json={"confirm": True}, headers=as_admin)
        assert r.status_code == 200 and r.json()["skipped"] == [], r.text
        assert audits() == before and grants("t4") == []
        # N1: a converted steward demoted to viewer gets 403 on approve, same as an unconverted control
        sys_a = _system(owner, tid)
        ver = _version(owner, tid, sys_a)
        item = str(uuid.uuid4())
        with owner.begin() as cn:
            cn.execute(text("INSERT INTO cleaning_queue (id, tenant_id, object_type, record_key, version_id) "
                            "VALUES (:i, :t, :o, 'k', :v)"), {"i": item, "t": tid, "o": MM, "v": ver})
            cn.execute(text("UPDATE users SET permissions = CAST(:p AS jsonb) WHERE id = ANY(CAST(:ids AS uuid[]))"),
                       {"p": '{"material_master": {"approve": true}}', "ids": [u["t4"], u["t3"]]})
        r = await c.post(url("t4"), json={"confirm": True}, headers=as_admin)
        assert r.status_code == 200 and grants("t4") == []
        with owner.begin() as cn:
            cn.execute(text("UPDATE users SET role = 'viewer' WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": [u["t4"], u["t3"]]})
        for who in ("t4", "t3"):
            r = await c.post(f"/api/v1/cleaning/approve/{item}", headers={"x-test-uid": u[who]})
            assert r.status_code == 403, (who, r.text)
        # a denial cannot be a grant: it stays, so the user is never widened
        r = await c.post(url("t1"), json={"confirm": True}, headers=as_admin)
        assert r.json()["kept"] == [FI] and r.json()["cleared"] is False, r.text
        assert grants("t1") == [] and stored("t1") == {FI: {"approve": False}}
        before = audits()
        r = await c.post(url("t1"), json={"confirm": True}, headers=as_admin)
        assert audits() == before and stored("t1") == {FI: {"approve": False}}

    _serve(owner, monkeypatch, tid, scenario)


def test_spoofed_hints_never_widen(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    """Query strings and bodies never decide scope: a grant on system A / module FI gets 403 on B / MM
    through every one of the ten route groups, with or without a spoofed hint."""
    tid, u = _tenant(owner, {"stw": "viewer", "mod": "viewer"})
    sys_a, sys_b = _system(owner, tid), _system(owner, tid)
    ver_a, ver_b = _version(owner, tid, sys_a), _version(owner, tid, sys_b)
    _scoped_grant(owner, tid, u["stw"], "steward", sys_a, None)
    _scoped_grant(owner, tid, u["mod"], "steward", None, FI)
    item_a, item_b, wave_a, wave_b = (str(uuid.uuid4()) for _ in range(4))
    with owner.begin() as c:
        for item, ver in ((item_a, ver_a), (item_b, ver_b)):
            c.execute(text("INSERT INTO cleaning_queue (id, tenant_id, object_type, record_key, version_id) "
                           "VALUES (:i, :t, :o, 'k', :v)"), {"i": item, "t": tid, "o": MM, "v": ver})
        for wave, sysid in ((wave_a, sys_a), (wave_b, sys_b)):
            c.execute(text("INSERT INTO migration_waves (id, tenant_id, name, source_system_id) "
                           "VALUES (:i, :t, 'w-' || :i, :s)"), {"i": wave, "t": tid, "s": sysid})
    rnd = str(uuid.uuid4())
    A = f"system_id={sys_a}"
    refused = [  # (method, path, json body) each as the system-A user, spoofing ?system_id=A
        ("POST", f"/api/v1/systems/{sys_b}/sync?{A}", None),
        ("POST", f"/api/v1/connectivity/extract?{A}", {"system_id": sys_b, "modules": [MM]}),
        ("POST", f"/api/v1/connectivity/config-load?{A}", {"system_id": sys_b}),
        ("GET", f"/api/v1/objects/{MM}/export?{A}", None),
        ("GET", f"/api/v1/findings/export?{A}&version_id={ver_b}", None),
        ("POST", f"/api/v1/versions/{ver_b}/baseline?{A}", None),
        ("POST", f"/api/v1/versions/archive?{A}", None),
        ("POST", f"/api/v1/migration/waves/{wave_b}/signoff?{A}", None),
        ("POST", f"/api/v1/cleaning/approve/{item_b}?{A}", {}),
        ("POST", f"/api/v1/remediation/batches/{rnd}/approve?{A}", None),
        ("POST", f"/api/v1/master-records/{rnd}/writeback?{A}", None),
        ("PUT", f"/api/v1/stewardship/{rnd}/resolve?{A}", {}),
    ]
    allowed = [
        ("POST", f"/api/v1/systems/{sys_a}/sync", None),
        ("POST", f"/api/v1/versions/{ver_a}/baseline", None),
        ("POST", f"/api/v1/migration/waves/{wave_a}/signoff", None),
        ("POST", f"/api/v1/cleaning/approve/{item_a}", {}),
        ("POST", f"/api/v1/connectivity/health-check/{sys_a}", None),
    ]

    async def scenario(c: AsyncClient) -> None:
        for who, rows, want_403 in (("stw", refused, True), ("stw", allowed, False)):
            for method, path, body in rows:
                r = await c.request(method, path, json=body, headers={"x-test-uid": u[who]})
                assert (r.status_code == 403) == want_403, (method, path, r.status_code, r.text[:120])
        # module grant FI: spoofed ?module=FI / ?object_type=FI on an MM item or route stays refused
        h = {"x-test-uid": u["mod"]}
        for method, path, body in (("POST", f"/api/v1/cleaning/approve/{item_a}?module={FI}&object_type={FI}", {}),
                                   ("GET", f"/api/v1/objects/{MM}/export?module={FI}", None)):
            r = await c.request(method, path, json=body, headers=h)
            assert r.status_code == 403, (path, r.status_code)
        # a version whose metadata names system B, with a hint naming A, is refused on analyse too
        r = await c.post(f"/api/v1/versions/{ver_b}/analyse?{A}", headers={"x-test-uid": u["stw"]})
        assert r.status_code == 403
        # the path wins over the query on a system route
        r = await c.post(f"/api/v1/systems/{sys_b}/sync?{A}", headers={"x-test-uid": u["stw"]})
        assert r.status_code == 403

    _serve(owner, monkeypatch, tid, scenario)


def test_version_metadata_system_id_not_client_writable(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    """The version-to-system lookup trusts metadata.system_id, so no client call may write it."""
    tid, u = _tenant(owner, {"adm": "admin"})
    sys_a, sys_b = _system(owner, tid), _system(owner, tid)
    ver = _version(owner, tid, sys_b)

    async def scenario(c: AsyncClient) -> None:
        r = await c.patch(f"/api/v1/versions/{ver}", headers={"x-test-uid": u["adm"]},
                          json={"label": "x", "metadata": {"system_id": sys_a}, "system_id": sys_a})
        assert r.status_code < 500, r.text
        with owner.connect() as cx:
            got = cx.execute(text("SELECT metadata->>'system_id' FROM analysis_versions WHERE id = :v"),
                             {"v": ver}).scalar()
        assert got == sys_b

    _serve(owner, monkeypatch, tid, scenario)


def test_body_and_path_hardening(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    """N2 wave PATCH body, N3 system PUT body/cascade, N4 unparseable path ids."""
    tid, u = _tenant(owner, {"stw": "viewer", "basis": "viewer", "admin": "admin"})
    sys_a, sys_b, sys_c = _system(owner, tid), _system(owner, tid), _system(owner, tid)
    _scoped_grant(owner, tid, u["stw"], "steward", sys_a, None)
    _scoped_grant(owner, tid, u["basis"], "sap_basis", sys_a, None)
    wave = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO migration_waves (id, tenant_id, name, source_system_id) "
                       "VALUES (:i, :t, 'w', :s)"), {"i": wave, "t": tid, "s": sys_a})
        c.execute(text("UPDATE sap_systems SET role='target' WHERE id = :s"), {"s": sys_a})
        c.execute(text("UPDATE sap_systems SET role='source', target_system_id = :a WHERE id = :b"),
                  {"a": sys_a, "b": sys_b})

    def col(table: str, c_: str, i: str) -> str | None:
        with owner.connect() as cn:
            v = cn.execute(text(f"SELECT {c_} FROM {table} WHERE id = :i"), {"i": i}).scalar()
        return str(v) if v else None

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["stw"]}
        w = f"/api/v1/migration/waves/{wave}"
        for field in ("source_system_id", "target_system_id"):
            r = await c.patch(w, json={field: sys_b}, headers=h)
            assert r.status_code == 403, (field, r.text)
        assert col("migration_waves", "source_system_id", wave) == sys_a
        assert col("migration_waves", "target_system_id", wave) is None
        r = await c.patch(w, json={"target_release": "2027"}, headers=h)
        assert r.status_code == 200, r.text
        hb = {"x-test-uid": u["basis"]}
        r = await c.put(f"/api/v1/systems/{sys_a}", json={"description": "x"}, headers=hb)
        assert r.status_code == 200, r.text
        r = await c.put(f"/api/v1/systems/{sys_a}", json={"target_system_id": sys_c}, headers=hb)
        assert r.status_code == 403, r.text
        r = await c.put(f"/api/v1/systems/{sys_a}", json={"role": "source"}, headers=hb)
        assert r.status_code == 403, r.text
        assert col("sap_systems", "target_system_id", sys_b) == sys_a  # cascade did not run
        r = await c.get("/api/v1/migration/runs/not-a-uuid", headers={"x-test-uid": u["admin"]})
        assert r.status_code == 422, r.text
        r = await c.get("/api/v1/migration/waves/not-a-uuid/cockpit", headers={"x-test-uid": u["admin"]})
        assert r.status_code == 422, r.text

    _serve(owner, monkeypatch, tid, scenario)
