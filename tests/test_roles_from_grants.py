"""Grants are the only source of a user's role.

* migration 088 maps each users.role to its persona (unit; the real-Postgres run is in
  tests/test_roles_from_grants_pg.py);
* users.role is re-derived from the unscoped grants by ROLE_RANK (recompute_users_role);
* revoking a grant: not your own (403), never the last active admin's (409);
* legacy keys are refused for new grants and invites (422).

The async DB is a fake that answers the statements the grant routes make; resolve_caller and the
permission ceiling (proven against Postgres in tests/test_rbac_escalation_pg.py) are stubbed.
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import uuid
from types import ModuleType
from typing import Any, Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import roles as roles_routes
from api.routes.roles import Caller
from api.routes.users import InviteGrant, InviteUserBody, invite_grants, invite_users_role
from api.services.rbac import (
    LEGACY_ROLES, PERSONA_ALIAS, ROLE_RANK, VALID_ROLES, permissions_for, persona_for, recompute_users_role,
    strongest_role,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TENANT = uuid.uuid4()
ME = str(uuid.uuid4())


def _m088() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "m088", os.path.join(ROOT, "db/migrations/versions/088_roles_from_grants.py"))
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── migration mapping ────────────────────────────────────────────────────────

def test_migration_maps_legacy_roles_to_personas() -> None:
    m = _m088()
    assert m.revision == "088" and m.down_revision == "087"
    assert {k: m.persona_for(k) for k in ("admin", "manager", "steward", "approver")} == {
        "admin": "platform_admin", "manager": "programme_lead", "steward": "data_steward", "approver": "data_owner"}
    for keep in ("analyst", "auditor", "viewer", "ai_reviewer", "process_analyst", "sap_basis", "platform_admin",
                 "custom:ops"):
        assert m.persona_for(keep) == keep
    # The migration's copy agrees with the service for every built-in key.
    assert m.PERSONA_FOR == {v: k for k, v in PERSONA_ALIAS.items()}
    for k in VALID_ROLES:
        assert m.persona_for(k) == persona_for(k)


def test_migration_is_idempotent_and_null_safe() -> None:
    sql = " ".join(_m088().BACKFILL_SQL.split())
    assert "ON CONFLICT DO NOTHING" in sql  # uq_user_role_scopes_nullsafe (077) catches null-scope repeats
    assert "set_config('app.tenant_id', t::text, true)" in sql
    assert "WHEN 'admin' THEN 'platform_admin'" in sql


@pytest.mark.parametrize("legacy", sorted(PERSONA_ALIAS.values()))
def test_persona_grant_loses_nothing(legacy: str) -> None:
    before, after = set(permissions_for(legacy)), set(permissions_for(persona_for(legacy)))
    assert before <= after
    assert after - before <= {"run_process_discovery"}  # owner decision 2026-10-26


# ── ranking ──────────────────────────────────────────────────────────────────

def test_rank_covers_every_built_in_role_once() -> None:
    assert len(ROLE_RANK) == len(set(ROLE_RANK)) and set(ROLE_RANK) == VALID_ROLES


@pytest.mark.parametrize(("keys", "want"), [
    ([], "viewer"),
    (["custom:ops"], "viewer"),
    (["viewer", "auditor"], "auditor"),
    (["analyst", "data_owner"], "data_owner"),
    (["sap_basis", "data_steward"], "data_steward"),
    (["admin", "platform_admin"], "platform_admin"),
    (["manager", "data_steward", "custom:x"], "manager"),
    (["programme_lead", "manager"], "programme_lead"),
    (["process_analyst", "analyst", "ai_reviewer"], "process_analyst"),
])
def test_strongest_role(keys: list[str], want: str) -> None:
    assert strongest_role(keys) == want


class _Result:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def fetchone(self) -> Optional[tuple[Any, ...]]:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows

    def scalar(self) -> Any:
        return self._rows[0][0] if self._rows else None


class _DB:
    """users {id: {"role", "active"}} and grants [{"id", "user", "key", "system", "module"}] of one tenant."""

    def __init__(self, users: dict[str, dict[str, Any]], grants: list[dict[str, Any]]) -> None:
        self.users, self.grants = users, grants
        self.sql: list[str] = []
        self.commits = 0

    def _unscoped(self, user: str) -> list[dict[str, Any]]:
        return [g for g in self.grants if g["user"] == user and g["system"] is None and g["module"] is None]

    async def execute(self, stmt: Any, params: Optional[dict[str, Any]] = None) -> _Result:
        sql = " ".join(str(stmt).split())
        p = params or {}
        self.sql.append(sql)
        if sql.startswith("SET LOCAL app.tenant_id"):
            assert str(TENANT) in sql
            return _Result([])
        assert p.get("t") == str(TENANT), sql  # every statement is tenant-filtered
        if sql.startswith("SELECT s.role_key, s.system_id, s.module, u.role"):
            g = next((g for g in self.grants if g["id"] == p["g"] and g["user"] == p["u"]), None)
            return _Result([(g["key"], g["system"], g["module"], self.users[g["user"]]["role"])] if g else [])
        if sql.startswith("SELECT u.id FROM users u WHERE u.tenant_id = :t") and sql.endswith("FOR UPDATE OF u"):
            return _Result([])
        if sql.startswith("SELECT is_active FROM users"):
            return _Result([(self.users[p["u"]]["active"],)])
        if sql.startswith("SELECT count(*) FROM user_role_scopes g JOIN users u"):
            n = sum(1 for g in self.grants if g["id"] != p["g"] and g["system"] is None and g["module"] is None
                    and g["key"] in p["keys"] and self.users[g["user"]]["active"])
            return _Result([(n,)])
        if sql.startswith("DELETE FROM user_role_scopes"):
            self.grants = [g for g in self.grants if g["id"] != p["g"]]
            return _Result([])
        if sql.startswith("SELECT role_key FROM user_role_scopes"):
            return _Result([(g["key"],) for g in self._unscoped(p["u"])])
        if sql.startswith("UPDATE users SET role"):
            self.users[p["u"]]["role"] = p["r"]
            return _Result([])
        if sql.startswith("INSERT INTO audit_log"):
            return _Result([])
        raise AssertionError(sql)

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        pass


def test_recompute_sets_the_strongest_unscoped_built_in_grant() -> None:
    u = str(uuid.uuid4())
    db = _DB({u: {"role": "viewer", "active": True}}, [
        {"id": "1", "user": u, "key": "analyst", "system": None, "module": None},
        {"id": "2", "user": u, "key": "platform_admin", "system": uuid.uuid4(), "module": None},  # scoped: ignored
        {"id": "3", "user": u, "key": "data_owner", "system": None, "module": None},
        {"id": "4", "user": u, "key": "custom:ops", "system": None, "module": None},
    ])
    assert asyncio.run(recompute_users_role(db, TENANT, u)) == "data_owner"
    assert db.users[u]["role"] == "data_owner"
    db.grants = []
    assert asyncio.run(recompute_users_role(db, TENANT, u)) == "viewer"
    assert db.users[u]["role"] == "viewer"


# ── grant routes ─────────────────────────────────────────────────────────────

def _client(monkeypatch: pytest.MonkeyPatch, db: _DB) -> TestClient:
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")

    async def caller(*_a: Any, **_k: Any) -> Caller:
        return Caller(ME, frozenset({"manage_users"}), True)

    async def ceiling(*_a: Any, **_k: Any) -> None:
        return None

    monkeypatch.setattr(roles_routes, "resolve_caller", caller)
    monkeypatch.setattr(roles_routes, "enforce_ceiling", ceiling)
    app = FastAPI()
    app.include_router(roles_routes.router)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TENANT, "Acme", [])
    c = TestClient(app)
    c.headers.update({"X-User-Role": "platform_admin"})
    return c


def _grant(user: str, key: str, system: Optional[uuid.UUID] = None) -> dict[str, Any]:
    return {"id": str(uuid.uuid4()), "user": user, "key": key, "system": system, "module": None}


@pytest.mark.parametrize("key", ["platform_admin", "admin"])
def test_revoking_the_last_active_admins_grant_is_refused(monkeypatch: pytest.MonkeyPatch, key: str) -> None:
    target = str(uuid.uuid4())
    g = _grant(target, key)
    db = _DB({ME: {"role": "platform_admin", "active": False}, target: {"role": "platform_admin", "active": True}},
             [_grant(ME, "platform_admin"), g])
    r = _client(monkeypatch, db).delete(f"/api/v1/users/{target}/grants/{g['id']}")
    assert r.status_code == 409 and r.json()["detail"] == roles_routes.LAST_ADMIN_DETAIL
    assert g in db.grants and db.users[target]["role"] == "platform_admin" and not db.commits


def test_revoking_one_of_two_admin_grants_or_with_another_admin_goes_through(
        monkeypatch: pytest.MonkeyPatch) -> None:
    target, other = str(uuid.uuid4()), str(uuid.uuid4())
    legacy, persona = _grant(target, "admin"), _grant(target, "platform_admin")
    db = _DB({ME: {"role": "viewer", "active": True}, target: {"role": "platform_admin", "active": True},
              other: {"role": "platform_admin", "active": True}},
             [legacy, persona, _grant(other, "platform_admin")])
    c = _client(monkeypatch, db)
    assert c.delete(f"/api/v1/users/{target}/grants/{legacy['id']}").status_code == 200
    assert db.users[target]["role"] == "platform_admin"
    # The target's last admin grant: another active admin is left, so it goes, and users.role follows.
    assert c.delete(f"/api/v1/users/{target}/grants/{persona['id']}").status_code == 200
    assert db.users[target]["role"] == "viewer" and db.commits == 2


def test_revoking_a_scoped_admin_grant_is_not_held_by_the_last_admin_rule(monkeypatch: pytest.MonkeyPatch) -> None:
    target = str(uuid.uuid4())
    scoped = _grant(target, "platform_admin", system=uuid.uuid4())
    db = _DB({ME: {"role": "viewer", "active": True}, target: {"role": "analyst", "active": True}},
             [scoped, _grant(target, "analyst")])
    assert _client(monkeypatch, db).delete(f"/api/v1/users/{target}/grants/{scoped['id']}").status_code == 200
    assert db.users[target]["role"] == "analyst"


def test_revoking_from_an_inactive_admin_is_not_held(monkeypatch: pytest.MonkeyPatch) -> None:
    target = str(uuid.uuid4())
    g = _grant(target, "platform_admin")
    db = _DB({ME: {"role": "viewer", "active": True}, target: {"role": "platform_admin", "active": False}}, [g])
    assert _client(monkeypatch, db).delete(f"/api/v1/users/{target}/grants/{g['id']}").status_code == 200


def test_revoking_your_own_unscoped_grant_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    mine, other = _grant(ME, "platform_admin"), str(uuid.uuid4())
    db = _DB({ME: {"role": "platform_admin", "active": True}, other: {"role": "platform_admin", "active": True}},
             [mine, _grant(other, "platform_admin")])
    r = _client(monkeypatch, db).delete(f"/api/v1/users/{ME}/grants/{mine['id']}")
    assert r.status_code == 403 and r.json()["detail"] == "You cannot change your own access"
    assert mine in db.grants and not db.commits


def test_revoking_the_users_role_grant_is_allowed_and_rederives_it(monkeypatch: pytest.MonkeyPatch) -> None:
    """The old 409 ("this grant mirrors the user's role") is gone: users.role now follows the grants."""
    target = str(uuid.uuid4())
    g = _grant(target, "data_steward")
    db = _DB({ME: {"role": "platform_admin", "active": True}, target: {"role": "data_steward", "active": True}},
             [g, _grant(target, "auditor")])
    assert _client(monkeypatch, db).delete(f"/api/v1/users/{target}/grants/{g['id']}").status_code == 200
    assert db.users[target]["role"] == "auditor"


@pytest.mark.parametrize("key", sorted(LEGACY_ROLES))
def test_new_grant_of_a_legacy_key_is_refused(monkeypatch: pytest.MonkeyPatch, key: str) -> None:
    db = _DB({ME: {"role": "platform_admin", "active": True}}, [])
    r = _client(monkeypatch, db).post(f"/api/v1/users/{uuid.uuid4()}/grants", json={"role_key": key})
    assert r.status_code == 422 and r.json()["detail"] == roles_routes.LEGACY_GRANT_DETAIL
    assert not db.commits


def test_legacy_keys_are_exactly_the_replaced_ones() -> None:
    assert LEGACY_ROLES == {"admin", "manager", "steward", "approver", "ai_reviewer"}


# ── invites ──────────────────────────────────────────────────────────────────

def test_invite_role_is_one_unscoped_grant_and_users_role_is_derived() -> None:
    assert [g.role_key for g in invite_grants(InviteUserBody(email="x@example.test", role="sap_basis"))] == ["sap_basis"]
    body = InviteUserBody(email="x@example.test", role="platform_admin", grants=[
        InviteGrant(role_key="analyst"), InviteGrant(role_key="data_steward", system_id=uuid.uuid4()),
        InviteGrant(role_key="auditor")])
    assert [g.role_key for g in invite_grants(body)] == ["analyst", "data_steward", "auditor"]  # role ignored
    assert invite_users_role(body) == "analyst"
