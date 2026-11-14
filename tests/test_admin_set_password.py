"""Admin password actions: POST /users/{id}/set-password and the guards it shares with /reset-password.

Set: a typed password (checked by local_auth.validate_password) or a generated one returned once; either way
must_change_password, every session revoked (token_version + 1), lockout cleared, and an audit row that names
who and for whom but never the password. Guards: manage_users only, never yourself (self-service instead),
another tenant's user is a 404, never the last active admin, SSO-enforced users are managed by the identity
provider (admins keep a break-glass password), and both routes are rate-limited per acting admin.

The async DB is a fake that answers the statements these routes make; the caller and the permission ceiling
are stubbed as in tests/test_users_admin_guards.py. Users and passwords are synthetic; no test prints one."""

from __future__ import annotations

import json
import uuid
from typing import Any, Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import roles as roles_routes
from api.routes import users as routes
from api.routes.roles import Caller
from api.services.local_auth import hash_password, verify_password

TENANT = uuid.uuid4()
OTHER_TENANT = uuid.uuid4()
ME = str(uuid.uuid4())
GOOD = "violet-harbour-lantern-42"


class _Result:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def fetchone(self) -> Optional[tuple[Any, ...]]:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows

    def scalar(self) -> Any:
        return self._rows[0][0] if self._rows else None

    def scalar_one(self) -> Any:
        return self._rows[0][0]


class _DB:
    def __init__(self, users: dict[str, dict[str, Any]], sso: Optional[dict[str, Any]] = None) -> None:
        self.users = users
        self.sso = sso
        self.audit: list[dict[str, Any]] = []
        self.commits = 0

    def _admin(self, u: dict[str, Any], roles: list[str]) -> bool:
        return u["role"] in roles

    def _mine(self, uid: Optional[str], tid: Optional[str]) -> Optional[dict[str, Any]]:
        u = self.users.get(uid or "")
        return u if u and str(u.get("tenant", TENANT)) == tid else None

    async def execute(self, stmt: Any, params: Optional[dict[str, Any]] = None) -> _Result:
        sql = " ".join(str(stmt).split())
        p = params or {}
        if sql.startswith("SET app.tenant_id") or "service.meridian.invalid" in sql:
            return _Result([])
        if sql.startswith("SELECT role FROM users WHERE id"):
            u = self._mine(p["u"], p["t"])
            return _Result([(u["role"],)] if u else [])
        if sql.startswith("SELECT DISTINCT role_key") or sql.startswith("SELECT u.id FROM users u"):
            return _Result([])
        if sql.startswith("SELECT email, name, is_active, password_hash FROM users"):
            u = self._mine(p["u"], p["t"])
            return _Result([(u["email"], "Test", u["active"], u.get("hash"))] if u else [])
        if sql.startswith("SELECT 1 FROM users u WHERE u.id = :uid"):
            u = self._mine(p["uid"], p["tid"])
            return _Result([(1,)] if u and u["active"] and self._admin(u, p["admin_roles"]) else [])
        if sql.startswith("SELECT count(*) FROM users u"):
            n = sum(1 for i, u in self.users.items() if i != p["uid"] and str(u.get("tenant", TENANT)) == p["tid"]
                    and u["active"] and self._admin(u, p["admin_roles"]))
            return _Result([(n,)])
        if sql.startswith("SELECT sso_config FROM tenants"):
            return _Result([(self.sso,)])
        if sql.startswith("SELECT jwt_secret FROM tenants"):
            return _Result([("s" * 40,)])
        if sql.startswith("SELECT 1 FROM users WHERE id = CAST"):
            return _Result([(1,)])
        if sql.startswith("UPDATE users SET"):
            u = self._mine(p["u"], p["t"])
            assert u is not None
            if "h" in p:
                u["hash"] = p["h"]
            u["must_change"] = True
            u["tv"] = u.get("tv", 0) + 1
            u["locked"] = False
            return _Result([(u["tv"],)])
        if sql.startswith("INSERT INTO audit_log"):
            self.audit.append(p)
            return _Result([])
        raise AssertionError(sql)

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        pass


def _user(role: str = "viewer", **kw: Any) -> dict[str, Any]:
    return {"role": role, "active": True, "email": f"{role}-{uuid.uuid4().hex[:6]}@example.test",
            "hash": hash_password("an-old-password-123"), "tv": 0, **kw}


def _client(monkeypatch: pytest.MonkeyPatch, db: _DB, actions: frozenset[str] = frozenset({"manage_users"}),
            role: str = "admin") -> TestClient:
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    forgot: list[str] = []
    monkeypatch.setattr("api.middleware.local_auth.forget_token_version", forgot.append)

    async def caller(*_a: Any, **_k: Any) -> Caller:
        return Caller(ME, actions, True)

    async def ceiling(*_a: Any, **_k: Any) -> None:
        return None

    monkeypatch.setattr(roles_routes, "resolve_caller", caller)
    monkeypatch.setattr(roles_routes, "enforce_ceiling", ceiling)
    app = FastAPI()
    app.include_router(routes.router)

    @app.middleware("http")
    async def _who(request, call_next):  # LocalAuthMiddleware sets this from the session token
        request.state.local_user_id = ME
        return await call_next(request)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TENANT, "Acme", [])
    c = TestClient(app)
    c.headers.update({"X-User-Role": role})
    c.forgot = forgot  # type: ignore[attr-defined]
    return c


def _team(**extra: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {ME: _user("admin"), **extra}


# ── set ──────────────────────────────────────────────────────────────────────

def test_set_a_typed_password(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user(locked=True)}))
    c = _client(monkeypatch, db)
    r = c.post(f"/api/v1/users/{uid}/set-password", json={"password": GOOD})
    assert r.status_code == 200
    body = r.json()
    assert body == {"id": uid, "must_change_password": True, "password": None}  # a typed one is never echoed
    u = db.users[uid]
    assert verify_password(GOOD, u["hash"]) and u["must_change"] and u["tv"] == 1 and not u["locked"]
    assert c.forgot == [uid]  # type: ignore[attr-defined]
    (audit,) = db.audit
    assert audit["a"] == "user.password_set" and audit["ei"] == uid
    assert json.loads(audit["af"]) == {"email": u["email"], "generated": False}
    assert GOOD not in json.dumps(audit)


def test_generate_returns_the_password_once(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user()}))
    r = _client(monkeypatch, db).post(f"/api/v1/users/{uid}/set-password", json={"generate": True})
    assert r.status_code == 200
    plain = r.json()["password"]
    assert isinstance(plain, str) and len(plain) >= 16
    assert verify_password(plain, db.users[uid]["hash"]) and db.users[uid]["must_change"]
    (audit,) = db.audit
    assert json.loads(audit["af"])["generated"] is True and plain not in json.dumps(audit)


@pytest.mark.parametrize("pw, needle", [
    ("short-1", "12 characters"),
    ("an-old-password-123", "differ"),
    ("password1234", ""),  # on the common list
])
def test_weak_passwords_are_422(monkeypatch: pytest.MonkeyPatch, pw: str, needle: str) -> None:
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user()}))
    r = _client(monkeypatch, db).post(f"/api/v1/users/{uid}/set-password", json={"password": pw})
    assert r.status_code == 422 and needle in r.json()["detail"]
    assert db.users[uid]["tv"] == 0 and not db.audit and not db.commits


@pytest.mark.parametrize("body", [{}, {"password": GOOD, "generate": True}, {"password": ""}])
def test_typed_or_generated_not_both_or_neither(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> None:
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user()}))
    assert _client(monkeypatch, db).post(f"/api/v1/users/{uid}/set-password", json=body).status_code == 422
    assert not db.audit


# ── guards (set and reset share them) ────────────────────────────────────────

ROUTES = [("set-password", {"generate": True}), ("reset-password", {"send_email": False})]


@pytest.mark.parametrize("path, body", ROUTES)
def test_not_your_own_password(monkeypatch: pytest.MonkeyPatch, path: str, body: dict[str, Any]) -> None:
    db = _DB(_team())
    r = _client(monkeypatch, db).post(f"/api/v1/users/{ME}/{path}", json=body)
    assert r.status_code == 403 and r.json()["detail"] == routes.SELF_PASSWORD_DETAIL
    assert db.users[ME]["tv"] == 0 and not db.audit


@pytest.mark.parametrize("path, body", ROUTES)
def test_needs_manage_users(monkeypatch: pytest.MonkeyPatch, path: str, body: dict[str, Any]) -> None:
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user()}))
    r = _client(monkeypatch, db, role="viewer").post(f"/api/v1/users/{uid}/{path}", json=body)
    assert r.status_code == 403 and db.users[uid]["tv"] == 0 and not db.audit


@pytest.mark.parametrize("path, body", ROUTES)
def test_no_cross_tenant(monkeypatch: pytest.MonkeyPatch, path: str, body: dict[str, Any]) -> None:
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user(tenant=OTHER_TENANT)}))
    r = _client(monkeypatch, db).post(f"/api/v1/users/{uid}/{path}", json=body)
    assert r.status_code == 404 and db.users[uid]["tv"] == 0 and not db.audit


@pytest.mark.parametrize("path, body", ROUTES)
def test_not_the_last_active_admin(monkeypatch: pytest.MonkeyPatch, path: str, body: dict[str, Any]) -> None:
    # The caller holds manage_users through a custom role and is no admin, so the target is the only admin.
    uid = str(uuid.uuid4())
    db = _DB({ME: _user("analyst"), uid: _user("admin")})
    r = _client(monkeypatch, db).post(f"/api/v1/users/{uid}/{path}", json=body)
    assert r.status_code == 409 and r.json()["detail"] == routes.LAST_ADMIN_DETAIL
    assert db.users[uid]["tv"] == 0 and not db.audit


SSO = {"issuer": "https://idp.example.test", "client_id": "c", "client_secret_encrypted": "x", "enforce": True}


@pytest.mark.parametrize("path, body", ROUTES)
def test_sso_enforced_is_managed_by_the_idp(monkeypatch: pytest.MonkeyPatch, path: str, body: dict[str, Any]) -> None:
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user()}), sso=SSO)
    r = _client(monkeypatch, db).post(f"/api/v1/users/{uid}/{path}", json=body)
    assert r.status_code == 409 and r.json()["detail"] == routes.SSO_MANAGED_DETAIL and not db.audit


def test_sso_enforced_admin_keeps_a_break_glass_password(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user("admin")}), sso=SSO)
    assert _client(monkeypatch, db).post(f"/api/v1/users/{uid}/set-password", json={"generate": True}).status_code == 200


def test_sso_offered_but_not_enforced_still_allows_passwords(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user()}), sso={**SSO, "enforce": False})
    assert _client(monkeypatch, db).post(f"/api/v1/users/{uid}/set-password", json={"generate": True}).status_code == 200


def test_suspended_user_is_409(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user(active=False)}))
    r = _client(monkeypatch, db).post(f"/api/v1/users/{uid}/set-password", json={"generate": True})
    assert r.status_code == 409 and "suspended" in r.json()["detail"]


def test_reset_still_returns_a_link_and_revokes_sessions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MERIDIAN_APP_URL", "https://meridian.example.test")
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user()}))
    r = _client(monkeypatch, db).post(f"/api/v1/users/{uid}/reset-password", json={"send_email": False})
    assert r.status_code == 200 and r.json()["link"].startswith("https://meridian.example.test/reset-password?token=")
    assert db.users[uid]["tv"] == 1 and db.users[uid]["must_change"]
    (audit,) = db.audit
    assert audit["a"] == "user.password_reset" and r.json()["link"].split("token=")[1] not in json.dumps(audit)


# ── rate limits ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path, body", ROUTES)
def test_rate_limited_per_acting_admin(monkeypatch: pytest.MonkeyPatch, path: str, body: dict[str, Any]) -> None:
    import api.services.rate_limiter as rl

    class _Redis:
        def __init__(self) -> None:
            self.counts: dict[str, int] = {}

        def incr(self, key: str) -> int:
            self.counts[key] = self.counts.get(key, 0) + 1
            return self.counts[key]

        def expire(self, key: str, ttl: int) -> None:
            pass

    redis = _Redis()
    monkeypatch.setattr(rl, "get_redis", lambda: redis)
    uid = str(uuid.uuid4())
    db = _DB(_team(**{uid: _user()}))
    c = _client(monkeypatch, db)
    codes = [c.post(f"/api/v1/users/{uid}/{path}", json=body).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429
    assert all(":user:" in k for k in redis.counts)
