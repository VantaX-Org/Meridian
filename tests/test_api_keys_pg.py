"""API keys / service accounts against a real Postgres (migration 099, api/routes/api_keys.py,
api/middleware/local_auth.py): the key is shown once and hashed at rest; a Bearer mk_ key authenticates as its
service user with exactly that user's grants; revoked, expired and suspended keys are 401; a key never holds
administration or more than its creator; last_used_at is throttled; service users are not seats and not dormant
or pending-invite users; audit rows never hold the secret; RLS isolates tenants; attention api_key_expiring.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""
from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import Engine, text

from tests.test_attention_pg import with_session
from tests.test_rbac_escalation_pg import (  # noqa: F401  (owner is a module-scoped fixture)
    _alembic,
    _grant,
    _seed_custom,
    owner,
    pytestmark,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

DEV = "00000000-0000-0000-0000-000000000001"
FUTURE = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()


def _secret_of(key: str) -> str:
    return key.split(".", 1)[1]


def _make_user(owner: Engine, tid: str, name: str, role: str, grant: str | None = None) -> str:
    uid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active) "
                       "VALUES (:i, :t, :e, :n, :r, true)"),
                  {"i": uid, "t": tid, "e": f"{name}-{uid[:8]}@example.test", "n": name, "r": role})
    _grant(owner, tid, uid, grant or role)
    return uid


@pytest.fixture
def env(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    """The local-auth tenant, an admin and a custom user administrator (both signed in by real JWTs), and the
    roles, me and api-keys routers behind the real LocalAuthMiddleware."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    import api.middleware.local_auth as mw
    from api.deps import get_db
    from api.middleware.audit import AuditMiddleware
    from api.routes import api_keys, me, roles, users
    from api.services.local_auth import create_access_token, generate_jwt_secret

    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Dev') ON CONFLICT (id) DO NOTHING"), {"t": DEV})
        c.execute(text("UPDATE tenants SET jwt_secret = COALESCE(jwt_secret, :s) WHERE id = :t"),
                  {"s": generate_jwt_secret(), "t": DEV})
        secret = c.execute(text("SELECT jwt_secret FROM tenants WHERE id = :t"), {"t": DEV}).scalar_one()
    admin = _make_user(owner, DEV, "admin", "platform_admin")
    if not _has_custom(owner, "custom:user-admin"):
        _seed_custom(owner, DEV, "custom:user-admin", {("users", "admin")})
    useradmin = _make_user(owner, DEV, "useradmin", "viewer", "custom:user-admin")

    monkeypatch.setattr(mw, "_jwt_secret_cache", {})
    monkeypatch.setattr(mw, "_token_version_cache", {})
    monkeypatch.setattr(mw, "_current_token_version", lambda _u, _t: 0)
    aeng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"), poolclass=NullPool)
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():  # type: ignore[no-untyped-def]
        async with factory() as s:
            yield s

    app = FastAPI()
    for r in (api_keys.router, roles.router, me.router, users.router):
        app.include_router(r)
    app.add_middleware(AuditMiddleware)
    app.add_middleware(mw.LocalAuthMiddleware)
    app.dependency_overrides[get_db] = _db

    def bearer(uid: str) -> dict[str, str]:
        return {"Authorization": "Bearer " + create_access_token(uid, DEV, "x@example.test", "admin", secret)}

    client = TestClient(app)
    yield {"client": client, "admin": bearer(admin), "admin_id": admin, "useradmin": bearer(useradmin),
           "owner": owner, "mw": mw}


def _has_custom(owner: Engine, key: str) -> bool:
    with owner.connect() as c:
        return bool(c.execute(text("SELECT 1 FROM roles WHERE tenant_id = :t AND key = :k"),
                              {"t": DEV, "k": key}).fetchone())


def _create(env: dict[str, Any], who: str = "admin", **body: Any) -> Any:
    body.setdefault("name", "Nightly extraction")
    body.setdefault("grants", [{"role_key": "viewer"}])
    return env["client"].post("/api/v1/admin/api-keys", json=body, headers=env[who])


def _use(env: dict[str, Any], key: str, path: str = "/api/v1/me/permissions") -> Any:
    return env["client"].get(path, headers={"Authorization": f"Bearer {key}"})


def _row(owner: Engine, key_id: str) -> Any:
    with owner.connect() as c:
        return c.execute(text("SELECT * FROM api_keys WHERE id = :i"), {"i": key_id}).one()


def test_create_returns_the_key_once_and_stores_only_a_hash(env: dict[str, Any]) -> None:
    r = _create(env, expires_at=FUTURE)
    assert r.status_code == 201, r.text
    body = r.json()
    key = body["key"]
    assert key.startswith("mk_") and key[3:].split(".")[0] == body["key_prefix"] and len(_secret_of(key)) >= 43
    assert r.headers["cache-control"] == "no-store"
    assert body["status"] == "active" and [g["role_key"] for g in body["grants"]] == ["viewer"]

    row = _row(env["owner"], body["id"])
    assert row.key_hash == hashlib.sha256(_secret_of(key).encode()).hexdigest()
    assert _secret_of(key) not in row.key_hash and key not in str(tuple(row))

    listed = env["client"].get("/api/v1/admin/api-keys", headers=env["admin"])
    assert listed.status_code == 200
    assert _secret_of(key) not in listed.text and "key_hash" not in listed.text and '"key"' not in listed.text
    assert body["id"] in {k["id"] for k in listed.json()}
    # the service user: no password, viewer, marked by the reserved domain
    with env["owner"].connect() as c:
        u = c.execute(text("SELECT email, password_hash, role, is_active FROM users WHERE id = :u"),
                      {"u": body["user_id"]}).one()
    assert u.email.endswith("@service.meridian.invalid") and u.password_hash is None and u.role == "viewer"
    # nobody can sign in as it
    assert env["client"].post("/api/v1/auth/login", json={"email": u.email, "password": "x" * 14}).status_code in (401, 404)


def test_bearer_key_authenticates_as_its_service_user_with_exactly_its_grants(env: dict[str, Any]) -> None:
    r = _create(env, grants=[{"role_key": "viewer"}, {"role_key": "analyst", "module": "fi_gl"}])
    key = r.json()["key"]
    mine = _use(env, key)
    assert mine.status_code == 200, mine.text
    seen = env["client"].get(f"/api/v1/users/{r.json()['user_id']}/effective", headers=env["admin"]).json()
    assert mine.json() == seen  # the same grants the admin sees on the service user, nothing added
    assert "manage_users" not in mine.json()["actions"]
    # guards read the service user's grants: no user management, no key management
    assert _use(env, key, "/api/v1/roles").status_code == 403
    assert _use(env, key, "/api/v1/admin/api-keys").status_code == 403
    # no key, wrong secret and a malformed key are 401 with a plain sentence
    assert _use(env, "mk_" + r.json()["key_prefix"] + ".wrongsecret").json() == {"detail": "Invalid API key."}
    assert _use(env, "mk_nodot").status_code == 401
    assert _use(env, "mk_000000000000." + _secret_of(key)).json() == {"detail": "Invalid API key."}


def test_revoked_expired_and_suspended_keys_are_401(env: dict[str, Any]) -> None:
    owner_eng = env["owner"]
    revoked, expired, suspended = (_create(env, name=n).json() for n in ("a", "b", "c"))
    for k in (revoked, expired, suspended):
        assert _use(env, k["key"]).status_code == 200

    r = env["client"].post(f"/api/v1/admin/api-keys/{revoked['id']}/revoke", headers=env["admin"])
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    assert env["client"].post(f"/api/v1/admin/api-keys/{revoked['id']}/revoke", headers=env["admin"]).status_code == 200
    out = _use(env, revoked["key"])
    assert out.status_code == 401 and out.json() == {"detail": "This API key has been revoked."}

    with owner_eng.begin() as c:
        c.execute(text("UPDATE api_keys SET expires_at = now() - interval '1 second' WHERE id = :i"), {"i": expired["id"]})
        c.execute(text("UPDATE users SET is_active = false WHERE id = :u"), {"u": suspended["user_id"]})
    out = _use(env, expired["key"])
    assert out.status_code == 401 and out.json() == {"detail": "This API key has expired."}
    out = _use(env, suspended["key"])
    assert out.status_code == 401 and "suspended" in out.json()["detail"]
    listed = {k["id"]: k["status"] for k in env["client"].get("/api/v1/admin/api-keys", headers=env["admin"]).json()}
    assert (listed[revoked["id"]], listed[expired["id"]], listed[suspended["id"]]) == ("revoked", "expired", "suspended")


def test_a_key_never_exceeds_its_creator_and_never_holds_admin(env: dict[str, Any]) -> None:
    # a custom user administrator (users/admin only): cannot hand a key more than its own permissions
    assert _create(env, "useradmin", grants=[{"role_key": "data_steward"}]).status_code == 403
    ok = _create(env, "useradmin", grants=[{"role_key": "viewer"}])
    assert ok.status_code == 201, ok.text
    # nobody hands out administration, even a platform admin
    for key in ("platform_admin", "admin"):
        r = _create(env, grants=[{"role_key": key}])
        assert r.status_code == 422 and "administrator" in r.json()["detail"], (key, r.text)
    if not _has_custom(env["owner"], "custom:wp10-user-admin"):
        _seed_custom(env["owner"], DEV, "custom:wp10-user-admin", {("users", "admin"), ("users", "view")})
    r = _create(env, grants=[{"role_key": "custom:wp10-user-admin"}])
    assert r.status_code == 422, r.text
    # legacy roles are never granted anew (insert_grant), no grants at all is a plain sentence, expiry must be future
    assert _create(env, name="Doomed key", grants=[{"role_key": "viewer"}, {"role_key": "steward"}]).status_code == 422
    r = _create(env, grants=[])
    assert r.status_code == 422 and r.json()["detail"] == "Choose at least one role for the key."
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert _create(env, expires_at=past).status_code == 422
    # a failed create leaves no half-made service account behind
    with env["owner"].connect() as c:
        assert c.execute(text("SELECT count(*) FROM users WHERE name = 'Doomed key'")).scalar_one() == 0
    # reusing a service account whose grants sit above the creator is refused
    strong = _create(env, grants=[{"role_key": "data_steward"}]).json()
    r = _create(env, "useradmin", grants=[], service_user_id=strong["user_id"])
    assert r.status_code == 403, r.text
    # and only service accounts can be reused
    assert _create(env, grants=[], service_user_id=env["admin_id"]).status_code == 404


def test_last_used_at_is_written_at_most_once_a_minute(env: dict[str, Any]) -> None:
    made = _create(env).json()
    assert _row(env["owner"], made["id"]).last_used_at is None
    assert _use(env, made["key"]).status_code == 200
    first = _row(env["owner"], made["id"]).last_used_at
    assert first is not None
    for _ in range(3):
        assert _use(env, made["key"]).status_code == 200
    assert _row(env["owner"], made["id"]).last_used_at == first
    with env["owner"].begin() as c:
        c.execute(text("UPDATE api_keys SET last_used_at = now() - interval '2 minutes' WHERE id = :i"), {"i": made["id"]})
    stale = _row(env["owner"], made["id"]).last_used_at
    assert _use(env, made["key"]).status_code == 200
    assert _row(env["owner"], made["id"]).last_used_at > stale


def test_each_key_has_its_own_rate_limit(env: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    import api.services.rate_limiter as rl

    counts: dict[str, int] = {}

    class FakeRedis:
        def incr(self, k: str) -> int:
            counts[k] = counts.get(k, 0) + 1
            return counts[k]

        def expire(self, *_a: Any) -> None:
            return None

    monkeypatch.setattr(rl, "get_redis", lambda: FakeRedis())
    monkeypatch.setattr(env["mw"], "_api_key_rate_limit", rl.rate_limit("api_key", limit=2, window_s=60, key_by="api_key"))
    one, two = _create(env, name="one").json(), _create(env, name="two").json()
    assert [_use(env, one["key"]).status_code for _ in range(3)] == [200, 200, 429]
    assert _use(env, two["key"]).status_code == 200  # another key has its own bucket
    r = _use(env, one["key"])
    assert r.status_code == 429 and "Retry-After" in r.headers and "key" in r.json()["detail"]


def test_service_users_are_not_seats_and_not_dormant_or_pending(env: dict[str, Any]) -> None:
    from api.deps import Tenant
    from api.routes.licence import seats_for
    from api.services import attention

    tenant = Tenant(uuid.UUID(DEV), "Dev", [])
    before, _ = with_session(env["owner"], lambda s: seats_for(s, tenant))
    made = _create(env).json()
    after, _ = with_session(env["owner"], lambda s: seats_for(s, tenant))
    assert after == before
    # looks like a stale invite and a dormant account, yet neither is raised
    with env["owner"].begin() as c:
        c.execute(text("UPDATE users SET invited_at = now() - interval '30 days', invite_status = 'failed', "
                       "last_login = now() - interval '200 days' WHERE id = :u"), {"u": made["user_id"]})
    base = with_session(env["owner"], lambda s: attention.collect(s, DEV))
    with env["owner"].begin() as c:
        c.execute(text("UPDATE users SET email = 'plain-' || id || '@example.test' WHERE id = :u"), {"u": made["user_id"]})
    plain = with_session(env["owner"], lambda s: attention.collect(s, DEV))
    count = lambda items, kind: sum(i["count"] for i in items if i["kind"] == kind)  # noqa: E731
    assert count(plain, "invites_pending") == count(base, "invites_pending") + 1
    assert count(plain, "dormant_users") == count(base, "dormant_users") + 1


def test_audit_rows_exist_and_never_hold_the_secret(env: dict[str, Any]) -> None:
    made = _create(env).json()
    secret = _secret_of(made["key"])
    _use(env, made["key"])
    env["client"].post(f"/api/v1/admin/api-keys/{made['id']}/revoke", headers=env["admin"])
    env["client"].delete(f"/api/v1/admin/api-keys/{made['id']}", headers=env["admin"])
    with env["owner"].connect() as c:
        rows = c.execute(text("SELECT action, actor_user_id, before_json::text, after_json::text, path, entity_id "
                              "FROM audit_log WHERE tenant_id = :t AND entity_type = 'api_key' AND entity_id = :e "
                              "ORDER BY created_at"), {"t": DEV, "e": made["id"]}).fetchall()
        everything = c.execute(text("SELECT coalesce(string_agg(audit_log::text, ' '), '') FROM audit_log")).scalar_one()
    assert [r.action for r in rows] == ["api_key.create", "api_key.revoke", "api_key.delete"]
    assert all(str(r.actor_user_id) == env["admin_id"] for r in rows)
    assert secret not in everything and made["key"] not in everything


def test_deleting_the_last_key_suspends_the_account_and_drops_its_grants(env: dict[str, Any]) -> None:
    made = _create(env).json()
    r = env["client"].delete(f"/api/v1/admin/api-keys/{made['id']}", headers=env["admin"])
    assert r.status_code == 200 and r.json() == {"id": made["id"], "status": "deleted"}
    assert _use(env, made["key"]).status_code == 401
    assert env["client"].delete(f"/api/v1/admin/api-keys/{made['id']}", headers=env["admin"]).status_code == 404
    with env["owner"].connect() as c:
        assert c.execute(text("SELECT is_active FROM users WHERE id = :u"), {"u": made["user_id"]}).scalar_one() is False
        assert c.execute(text("SELECT count(*) FROM user_role_scopes WHERE user_id = :u"),
                         {"u": made["user_id"]}).scalar_one() == 0


def test_routes_need_manage_users(env: dict[str, Any]) -> None:
    c = env["client"]
    assert c.get("/api/v1/admin/api-keys").status_code == 401
    viewer = _create(env).json()["key"]
    assert c.post("/api/v1/admin/api-keys", json={"name": "x", "grants": [{"role_key": "viewer"}]},
                  headers={"Authorization": f"Bearer {viewer}"}).status_code == 403


def test_rls_isolates_tenants(owner: Engine) -> None:
    other_a, other_b = str(uuid.uuid4()), str(uuid.uuid4())
    ids = {}
    with owner.begin() as c:
        for t in (other_a, other_b):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'K')"), {"t": t})
            uid = str(uuid.uuid4())
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active) "
                           "VALUES (:i, :t, :e, 'svc', 'viewer', true)"),
                      {"i": uid, "t": t, "e": f"svc-{uid[:8]}@service.meridian.invalid"})
            ids[t] = str(c.execute(text("INSERT INTO api_keys (tenant_id, user_id, name, key_prefix, key_hash) "
                                        "VALUES (:t, :u, 'k', :p, 'h') RETURNING id"),
                                   {"t": t, "u": uid, "p": uuid.uuid4().hex[:12]}).scalar_one())
        c.execute(text("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wp10_rls_app') THEN "
                       "CREATE ROLE wp10_rls_app NOSUPERUSER NOBYPASSRLS; END IF; END $$"))
        c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO wp10_rls_app"))
    with owner.connect() as conn:
        tx = conn.begin()
        conn.execute(text("SET LOCAL ROLE wp10_rls_app"))
        conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": other_a})
        seen = {str(r[0]) for r in conn.execute(text("SELECT id FROM api_keys"))}
        assert seen == {ids[other_a]}
        assert conn.execute(text("UPDATE api_keys SET name = 'x' WHERE id = :i"), {"i": ids[other_b]}).rowcount == 0
        tx.rollback()


def test_attention_flags_keys_expiring_within_14_days(env: dict[str, Any]) -> None:
    from api.services import attention

    assert attention.KINDS["api_key_expiring"] == (5, "manage_users", "Review API keys")

    def n() -> int:
        items = with_session(env["owner"], lambda s: attention.collect(s, DEV))
        hit = [i for i in items if i["kind"] == "api_key_expiring"]
        assert all(i["href"] == "/admin/roles?tab=keys" and i["severity"] == "low" and i["tier"] == 5 for i in hit)
        return sum(i["count"] for i in hit)

    start = n()
    soon = _create(env, name="soon", expires_at=(datetime.now(timezone.utc) + timedelta(days=5)).isoformat()).json()
    _create(env, name="later", expires_at=(datetime.now(timezone.utc) + timedelta(days=60)).isoformat())
    _create(env, name="never")
    assert n() == start + 1
    env["client"].post(f"/api/v1/admin/api-keys/{soon['id']}/revoke", headers=env["admin"])
    assert n() == start


def test_migration_099_up_and_down(owner: Engine) -> None:
    def exists() -> bool:
        with owner.connect() as c:
            return c.execute(text("SELECT to_regclass('api_keys')")).scalar() is not None

    _alembic("downgrade", "098")
    assert not exists()
    _alembic("upgrade", "head")
    assert exists()


SERVICE_409 = "This is a service account. Manage it under Roles and access, API keys."


def test_service_accounts_are_hidden_from_users_and_cannot_be_managed_as_people(env: dict[str, Any]) -> None:
    c, h = env["client"], env["admin"]
    made = _create(env).json()
    uid = made["user_id"]
    listed = c.get("/api/v1/users", headers=h)
    assert listed.status_code == 200 and uid not in {u["id"] for u in listed.json()["users"]}
    assert uid in {u["id"] for u in c.get("/api/v1/users?include_service=true", headers=h).json()["users"]}
    assert c.get(f"/api/v1/users/{uid}", headers=h).status_code == 404
    assert c.get(f"/api/v1/users/{uid}?include_service=true", headers=h).status_code == 200

    for method, path, body in (
        ("post", f"/api/v1/users/{uid}/invite/resend", None),
        ("post", f"/api/v1/users/{uid}/invite/link", None),
        ("post", f"/api/v1/users/{uid}/reset-password", {"send_email": False}),
        ("put", f"/api/v1/users/{uid}", {"is_active": False}),
        ("put", f"/api/v1/users/{uid}", {"is_active": True}),
        ("delete", f"/api/v1/users/{uid}", None),
    ):
        r = getattr(c, method)(path, headers=h, **({"json": body} if body is not None else {}))
        assert r.status_code == 409 and r.json()["detail"] == SERVICE_409, (method, path, r.text)
    for action in ("suspend", "reactivate", "resend", "reset"):
        r = c.post("/api/v1/users/bulk", json={"ids": [uid], "action": action}, headers=h)
        assert r.json()["results"][0] == {"id": uid, "ok": False, "error": SERVICE_409}, action
    r = c.post("/api/v1/users/invite", json={"email": "svc-x@service.meridian.invalid", "role": "viewer"}, headers=h)
    assert r.status_code == 409 and r.json()["detail"] == SERVICE_409
    csv_text = "email,role\nsvc-y@service.meridian.invalid,viewer\n"
    pre = c.post("/api/v1/users/import/preview", json={"csv": csv_text}, headers=h).json()
    assert pre["rows"][0]["ok"] is False and pre["rows"][0]["error"] == SERVICE_409
    imp = c.post("/api/v1/users/import", json={"csv": csv_text}, headers=h).json()
    assert imp["created"] == [] and imp["skipped"][0]["error"] == SERVICE_409
    # nothing changed: still active, still no password, and the key still works
    with env["owner"].connect() as conn:
        u = conn.execute(text("SELECT is_active, password_hash FROM users WHERE id = :u"), {"u": uid}).one()
    assert u.is_active is True and u.password_hash is None
    assert _use(env, made["key"]).status_code == 200


def test_the_key_never_reaches_the_audit_log_even_when_responses_are_stored(env: dict[str, Any],
                                                                            monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from api.middleware.audit import flush_pending_audits

    monkeypatch.setenv("AUDIT_STORE_RESPONSE", "true")
    r = _create(env, name="Stored response check")
    assert r.status_code == 201
    key = r.json()["key"]
    env["client"].post(f"/api/v1/admin/api-keys/{r.json()['id']}/revoke", headers=env["admin"])
    asyncio.run(flush_pending_audits())
    with env["owner"].connect() as c:
        everything = c.execute(text("SELECT coalesce(string_agg(audit_log::text, ' '), '') FROM audit_log")).scalar_one()
        actions = [a for (a,) in c.execute(text("SELECT action FROM audit_log WHERE entity_id = :e ORDER BY created_at"),
                                           {"e": r.json()["id"]})]
    assert key not in everything and _secret_of(key) not in everything
    assert actions == ["api_key.create", "api_key.revoke"]  # write_audit rows only, no generic middleware row
