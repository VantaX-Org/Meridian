"""Grants are the only source of a user's role, against a real Postgres: migration 088 and the grant,
invite and user routes keeping users.role derived.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import importlib.util
import os
from typing import TYPE_CHECKING

from sqlalchemy import Engine

from tests.test_rbac_escalation_pg import (  # noqa: F401  (owner is a module-scoped fixture)
    ROOT, _alembic, _grant, _serve, _tenant, _unscoped, _users_role, owner, pytestmark,
)

if TYPE_CHECKING:
    import pytest
    from httpx import AsyncClient


def test_migration_088_persona_grants_and_users_role(owner: Engine) -> None:
    from sqlalchemy import text

    from api.services.rbac import PERMISSIONS, PERSONA_ROLES, persona_for

    _alembic("downgrade", "087")
    roles = {f"u_{r}": r for r in (*PERMISSIONS, *PERSONA_ROLES)}
    roles["u_custom"] = "custom:ops"
    tid, ids = _tenant(owner, roles)
    other, other_ids = _tenant(owner, {"solo": "manager"})
    _grant(owner, tid, ids["u_admin"], "admin")  # the 077 mirror: replaced by its persona
    with owner.begin() as c:  # a scoped legacy grant keeps its scope under the persona key
        c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key, module) "
                       "VALUES (:t, :u, 'approver', 'fi_gl')"), {"t": tid, "u": ids["u_viewer"]})
    _grant(owner, tid, ids["u_steward"], "data_steward")  # persona already held: no duplicate
    _alembic("upgrade", "088")

    want = {(ids[n], persona_for(r)) for n, r in roles.items()}
    assert _unscoped(owner, tid) == sorted(want)
    assert _unscoped(owner, other) == [(other_ids["solo"], "programme_lead")]
    for n, r in roles.items():
        assert _users_role(owner, tid, ids[n]) == persona_for(r), n
    assert _users_role(owner, tid, ids["u_custom"]) == "custom:ops"
    assert _users_role(owner, other, other_ids["solo"]) == "programme_lead"
    with owner.connect() as c:
        keys = {r[0] for r in c.execute(text("SELECT role_key FROM user_role_scopes WHERE tenant_id = :t"), {"t": tid})}
        scoped = c.execute(text("SELECT role_key FROM user_role_scopes WHERE tenant_id = :t AND user_id = :u "
                                "AND module = 'fi_gl'"), {"t": tid, "u": ids["u_viewer"]}).scalars().all()
    assert not keys & {"admin", "manager", "steward", "approver"}  # nobody holds a role twice
    assert scoped == ["data_owner"]

    spec = importlib.util.spec_from_file_location("m088", os.path.join(ROOT, "db/migrations/versions/088_roles_from_grants.py"))
    assert spec and spec.loader
    m088 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m088)
    with owner.begin() as c:
        c.execute(text(m088.BACKFILL_SQL))  # re-run: nothing added, nothing rewritten
    assert _unscoped(owner, tid) == sorted(want)
    _alembic("upgrade", "head")


def test_routes_keep_users_role_derived(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _tenant(owner, {"padmin": "platform_admin", "admin2": "platform_admin", "target": "viewer",
                             "boot": "platform_admin"})
    gids = {n: _grant(owner, tid, u[n], r) for n, r in
            (("padmin", "platform_admin"), ("admin2", "platform_admin"), ("target", "viewer"))}

    async def scenario(c: AsyncClient) -> None:
        def as_(who: str) -> dict[str, str]:
            return {"x-test-uid": u[who]}

        grants = "/api/v1/users/{}/grants"
        # A new grant re-derives users.role; a legacy key is refused.
        r = await c.post(grants.format(u["target"]), json={"role_key": "programme_lead"}, headers=as_("padmin"))
        assert r.status_code == 201, r.text
        assert _users_role(owner, tid, u["target"]) == "programme_lead"
        r = await c.post(grants.format(u["target"]), json={"role_key": "manager"}, headers=as_("padmin"))
        assert r.status_code == 422, r.text
        # A scoped grant never becomes users.role.
        r = await c.post(grants.format(u["target"]), json={"role_key": "platform_admin", "module": "hcm"},
                         headers=as_("padmin"))
        assert r.status_code == 201, r.text
        assert _users_role(owner, tid, u["target"]) == "programme_lead"
        # Revoking re-derives it at once, so the next request no longer sees the old role.
        r = await c.delete(f"/api/v1/users/{u['target']}/grants/{r.json()['id']}", headers=as_("padmin"))
        assert r.status_code == 200, r.text
        lead = next(g["id"] for g in (await c.get(grants.format(u["target"]), headers=as_("padmin"))).json()
                    if g["role_key"] == "programme_lead")
        r = await c.delete(f"/api/v1/users/{u['target']}/grants/{lead}", headers=as_("padmin"))
        assert r.status_code == 200, r.text
        assert _users_role(owner, tid, u["target"]) == "viewer"
        r = await c.get("/api/v1/me/permissions", headers=as_("target"))
        assert r.status_code == 200 and "assign" not in r.json()["actions"]

        # PUT never sets a role.
        r = await c.put(f"/api/v1/users/{u['target']}", json={"role": "platform_admin"}, headers=as_("padmin"))
        assert r.status_code == 422 and r.json()["detail"] == "Roles are given as grants under Roles and access"

        # Invite: the role shorthand and grants both become grants; users.role is derived; no legacy key.
        r = await c.post("/api/v1/users/invite", json={"email": "basis@example.test", "role": "sap_basis"},
                         headers=as_("padmin"))
        assert r.status_code == 200 and r.json()["role"] == "sap_basis", r.text
        r = await c.post("/api/v1/users/invite", json={"email": "st@example.test", "grants": [
            {"role_key": "data_steward", "module": "hcm"}, {"role_key": "auditor"}]}, headers=as_("padmin"))
        assert r.status_code == 200 and r.json()["role"] == "auditor", r.text
        assert _users_role(owner, tid, r.json()["id"]) == "auditor"
        r = await c.post("/api/v1/users/invite", json={"email": "old@example.test", "role": "steward"},
                         headers=as_("padmin"))
        assert r.status_code == 422, r.text

        # Your own unscoped grant: 403.
        r = await c.delete(f"/api/v1/users/{u['padmin']}/grants/{gids['padmin']}", headers=as_("padmin"))
        assert r.status_code == 403, r.text
        # Another admin's, while you remain one: allowed, and their users.role follows.
        r = await c.delete(f"/api/v1/users/{u['admin2']}/grants/{gids['admin2']}", headers=as_("padmin"))
        assert r.status_code == 200, r.text
        assert _users_role(owner, tid, u["admin2"]) == "viewer"
        # The last active admin grant: 409. `boot` is an admin by a users.role no grant backs (a row
        # written before 088), so it may act but does not count as an admin that would be left.
        r = await c.delete(f"/api/v1/users/{u['padmin']}/grants/{gids['padmin']}", headers=as_("boot"))
        assert r.status_code == 409 and "last active admin" in r.json()["detail"], r.text
        assert _users_role(owner, tid, u["padmin"]) == "platform_admin"

    _serve(owner, monkeypatch, tid, scenario)


def test_concurrent_admin_removals_cannot_remove_the_last_admin(owner: Engine) -> None:
    """Two admins removed at once (one grant revoked, the other deactivated), each check alone sees the
    other admin left. The admin rows are locked FOR UPDATE, so the second waits and then refuses (409)."""
    import asyncio
    import uuid

    from fastapi import HTTPException
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.routes.roles import forbid_last_admin_grant
    from api.routes.users import forbid_last_admin
    from api.services.rbac import recompute_users_role

    tid, u = _tenant(owner, {"a": "platform_admin", "b": "platform_admin"})
    ga = _grant(owner, tid, u["a"], "platform_admin")
    _grant(owner, tid, u["b"], "platform_admin")
    t = uuid.UUID(tid)

    async def scenario() -> None:
        eng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"))
        maker = async_sessionmaker(eng, expire_on_commit=False)
        try:
            async with maker() as s1, maker() as s2:
                # s1 revokes a's admin grant: b is still an admin, so it passes; not committed yet
                await forbid_last_admin_grant(s1, t, uuid.UUID(u["a"]), uuid.UUID(ga), "platform_admin")
                await s1.execute(text("DELETE FROM user_role_scopes WHERE id = :g"), {"g": ga})
                await recompute_users_role(s1, t, u["a"])

                async def deactivate_b() -> None:
                    await forbid_last_admin(s2, t, uuid.UUID(u["b"]))
                    await s2.execute(text("UPDATE users SET is_active = false WHERE id = :u"), {"u": u["b"]})
                    await s2.commit()

                task = asyncio.create_task(deactivate_b())
                await asyncio.sleep(0.5)
                assert not task.done()  # waiting on s1's admin-row locks
                await s1.commit()
                try:
                    await asyncio.wait_for(task, 10)
                    raise AssertionError("the last admin was deactivated")
                except HTTPException as e:
                    assert e.status_code == 409
                await s2.rollback()
        finally:
            await eng.dispose()

    asyncio.run(scenario())
    with owner.connect() as c:
        active_admins = c.execute(text(
            "SELECT count(*) FROM users WHERE tenant_id = :t AND is_active AND role = 'platform_admin'"),
            {"t": tid}).scalar()
    assert active_admins == 1
