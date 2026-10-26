"""User routes: nobody changes their own access, the last active admin is never deactivated or
removed, and a role is never set through PUT /users/{id} (roles are grants; see
tests/test_roles_from_grants.py for revoking grants).

The async DB is a fake that answers the statements update_user / delete_user make; the caller
resolution and the permission ceiling (proven in tests/test_rbac_escalation_pg.py) are stubbed so
these tests isolate the self and last-admin guards."""

from __future__ import annotations

import uuid
from typing import Any, Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import roles as roles_routes
from api.routes import users as routes
from api.routes.roles import Caller

TENANT = uuid.uuid4()
ME = str(uuid.uuid4())


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
    """users: {id: {"role", "active", "admin_grant"}}; admin_grant is an unscoped admin grant."""

    def __init__(self, users: dict[str, dict[str, Any]]) -> None:
        self.users = users
        self.writes: list[str] = []
        self.commits = 0

    def _admin(self, u: dict[str, Any], admin_roles: list[str]) -> bool:
        return u["role"] in admin_roles or bool(u.get("admin_grant"))

    async def execute(self, stmt: Any, params: Optional[dict[str, Any]] = None) -> _Result:
        sql = " ".join(str(stmt).split())
        p = params or {}
        if sql.startswith("SET app.tenant_id"):
            return _Result([])
        if sql.startswith("SELECT role FROM users WHERE id"):
            u = self.users.get(p.get("u") or p.get("uid"))
            return _Result([(u["role"],)] if u else [])
        if sql.startswith("SELECT DISTINCT role_key"):
            return _Result([])
        if sql.startswith("SELECT u.id FROM users u WHERE u.tenant_id = :t") and sql.endswith("FOR UPDATE OF u"):
            self.locks = getattr(self, "locks", 0) + 1
            return _Result([])
        if sql.startswith("SELECT 1 FROM users u WHERE u.id = :uid"):
            assert p["tid"] == str(TENANT)
            u = self.users.get(p["uid"])
            return _Result([(1,)] if u and u["active"] and self._admin(u, p["admin_roles"]) else [])
        if sql.startswith("SELECT count(*) FROM users u"):
            assert p["tid"] == str(TENANT)
            n = sum(1 for i, u in self.users.items()
                    if i != p["uid"] and u["active"] and self._admin(u, p["admin_roles"]))
            return _Result([(n,)])
        if sql.startswith("UPDATE users SET"):
            self.writes.append(sql)
            u = self.users.get(p["uid"])
            if u is None:
                return _Result([])
            if "role" in p:
                u["role"] = p["role"]
            if "is_active" in p:
                u["active"] = p["is_active"]
            return _Result([(p["uid"],)])
        if sql.startswith("SELECT 1 FROM user_role_scopes"):
            return _Result([])
        if sql.startswith(("UPDATE user_role_scopes", "DELETE FROM user_role_scopes")):
            return _Result([])
        if sql.startswith("DELETE FROM users"):
            self.writes.append(sql)
            return _Result([(p["uid"],)] if self.users.pop(p["uid"], None) else [])
        if sql.startswith("SELECT id, email, name, role, is_active"):
            return _Result([])  # the response body is not under test
        raise AssertionError(sql)

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        pass


def _client(monkeypatch: pytest.MonkeyPatch, db: _DB) -> TestClient:
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")

    async def caller(*_a: Any, **_k: Any) -> Caller:
        return Caller(ME, frozenset({"manage_users"}), True)

    async def ceiling(*_a: Any, **_k: Any) -> None:
        return None

    # The self and ceiling guards live in roles (guard_user_access_change); users calls them there.
    monkeypatch.setattr(roles_routes, "resolve_caller", caller)
    monkeypatch.setattr(roles_routes, "enforce_ceiling", ceiling)
    app = FastAPI()
    app.include_router(routes.router)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TENANT, "Acme", [])
    c = TestClient(app)
    c.headers.update({"X-User-Role": "admin"})
    return c


def _users(**extra: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {ME: {"role": "admin", "active": True}, **extra}


# ── yourself ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("own", [True, False])
def test_put_role_is_refused(monkeypatch: pytest.MonkeyPatch, own: bool) -> None:
    other = str(uuid.uuid4())
    db = _DB(_users(**{other: {"role": "viewer", "active": True}}))
    target = ME if own else other
    r = _client(monkeypatch, db).put(f"/api/v1/users/{target}", json={"role": "platform_admin"})
    assert r.status_code == 422 and r.json()["detail"] == routes.ROLE_VIA_GRANTS_DETAIL
    assert db.users[target]["role"] == ("admin" if own else "viewer") and not db.writes


def test_cannot_deactivate_yourself(monkeypatch: pytest.MonkeyPatch) -> None:
    other = str(uuid.uuid4())
    db = _DB(_users(**{other: {"role": "admin", "active": True}}))
    r = _client(monkeypatch, db).put(f"/api/v1/users/{ME}", json={"is_active": False})
    assert r.status_code == 403 and "your own access" in r.json()["detail"]
    assert db.users[ME]["active"] is True and not db.writes


def test_cannot_remove_yourself(monkeypatch: pytest.MonkeyPatch) -> None:
    other = str(uuid.uuid4())
    db = _DB(_users(**{other: {"role": "admin", "active": True}}))
    r = _client(monkeypatch, db).delete(f"/api/v1/users/{ME}")
    assert r.status_code == 403 and "your own access" in r.json()["detail"]
    assert ME in db.users and not db.writes


# ── the last active admin ────────────────────────────────────────────────────
# The caller (ME) is an admin whose own row is inactive, so the target is the only active admin.

def _last_admin_db(target_role: str = "admin", admin_grant: bool = False) -> tuple[_DB, str]:
    target = str(uuid.uuid4())
    db = _DB({ME: {"role": "admin", "active": False},
              target: {"role": target_role, "active": True, "admin_grant": admin_grant}})
    return db, target


def test_cannot_deactivate_the_last_active_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    db, target = _last_admin_db()
    r = _client(monkeypatch, db).put(f"/api/v1/users/{target}", json={"is_active": False})
    assert r.status_code == 409 and "last active admin" in r.json()["detail"]
    assert db.users[target]["active"] is True and not db.writes


def test_cannot_remove_the_last_active_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    db, target = _last_admin_db()
    r = _client(monkeypatch, db).delete(f"/api/v1/users/{target}")
    assert r.status_code == 409 and "last active admin" in r.json()["detail"]
    assert target in db.users and not db.writes


def test_an_unscoped_admin_grant_counts_as_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    db, target = _last_admin_db("analyst", admin_grant=True)
    r = _client(monkeypatch, db).delete(f"/api/v1/users/{target}")
    assert r.status_code == 409 and target in db.users


def test_another_active_admin_lets_the_change_through(monkeypatch: pytest.MonkeyPatch) -> None:
    db, target = _last_admin_db()
    db.users[str(uuid.uuid4())] = {"role": "analyst", "active": True, "admin_grant": True}
    c = _client(monkeypatch, db)
    assert c.put(f"/api/v1/users/{target}", json={"is_active": False}).status_code == 200
    assert db.users[target]["active"] is False


def test_non_admins_are_not_held_by_the_last_admin_rule(monkeypatch: pytest.MonkeyPatch) -> None:
    db, admin = _last_admin_db()
    viewer = str(uuid.uuid4())
    db.users[viewer] = {"role": "viewer", "active": True}
    c = _client(monkeypatch, db)
    assert c.put(f"/api/v1/users/{viewer}", json={"is_active": False}).status_code == 200
    assert c.delete(f"/api/v1/users/{viewer}").status_code == 200
    # reactivating is never blocked
    db.users[admin]["active"] = False
    assert c.put(f"/api/v1/users/{admin}", json={"is_active": True}).status_code == 200
