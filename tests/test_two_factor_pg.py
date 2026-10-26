"""Two-factor sign-in against a real Postgres: migration 094 up/down, set-up, the two-step login, recovery
codes spent once, turning it off, the tenant requirement, an admin reset, the audit rows, the per-user
code limit and the key rotation script.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import Engine, text

from api.services import totp
from tests.test_rbac_escalation_pg import (  # noqa: F401  (owner is a module-scoped fixture)
    _alembic,
    _grant,
    _tenant,
    owner,
    pytestmark as _needs_pg,
)
from tests.test_session_revocation_pg import client, dev_user  # noqa: F401  (fixtures)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from httpx import AsyncClient

# The real users.token_version check (tests/conftest.py stubs it for unmarked tests).
pytestmark = [_needs_pg, pytest.mark.session_revocation]

DEV = "00000000-0000-0000-0000-000000000001"
PW = "the-original-password"


@pytest.fixture(autouse=True)
def _master_key_and_clean_tenant(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY", "two-factor-pg-test-master-key")
    with owner.begin() as c:
        c.execute(text("UPDATE tenants SET require_2fa = false WHERE id = :t"), {"t": DEV})


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _post(client: TestClient, path: str, body: dict | None = None, token: str | None = None):  # noqa: F811
    client.cookies.clear()  # the Bearer header alone is the session under test
    return client.post(f"/api/v1/auth{path}", json=body or {}, headers=_bearer(token) if token else {})


def _get(client: TestClient, path: str, token: str):  # noqa: F811
    client.cookies.clear()
    return client.get(f"/api/v1/auth{path}", headers=_bearer(token))


def _now_code(secret: str, offset: int = 0) -> str:
    return totp.code_at(secret, totp.current_step() + offset)


def _audit(owner: Engine, uid: str) -> list[str]:  # noqa: F811
    with owner.connect() as c:
        return [r[0] for r in c.execute(
            text("SELECT action FROM audit_log WHERE entity_id = :u AND action LIKE 'user.2fa%' ORDER BY created_at"),
            {"u": uid})]


def _enrol(client: TestClient, email: str) -> tuple[str, str, list[str]]:  # noqa: F811
    """Sign in with the password, set up and confirm. Returns (session token, secret, recovery codes)."""
    r = _post(client, "/login", {"email": email, "password": PW})
    assert r.status_code == 200 and not r.json()["mfa_required"], r.text
    session = r.json()["token"]
    setup = _post(client, "/2fa/setup", token=session)
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    assert setup.json()["otpauth_uri"].startswith("otpauth://totp/Meridian%3A")
    done = _post(client, "/2fa/confirm", {"code": _now_code(secret)}, token=session)
    assert done.status_code == 200, done.text
    return done.json()["token"], secret, done.json()["recovery_codes"]


def _row(owner: Engine, uid: str) -> tuple:  # noqa: F811
    with owner.connect() as c:
        return c.execute(text("SELECT totp_enabled, totp_secret, token_version FROM users WHERE id = :u"),
                         {"u": uid}).one()


def test_migration_094_up_and_down(owner: Engine) -> None:  # noqa: F811
    def columns() -> set[str]:
        with owner.connect() as c:
            return {r[0] for r in c.execute(text(
                "SELECT table_name || '.' || column_name FROM information_schema.columns "
                "WHERE (table_name = 'users' AND column_name LIKE 'totp_%') "
                "OR (table_name = 'tenants' AND column_name = 'require_2fa') "
                "OR table_name = 'user_recovery_codes'"))}

    _alembic("downgrade", "093")
    assert columns() == set()
    _tid, ids = _tenant(owner, {"existing": "viewer"})
    _alembic("upgrade", "094")
    assert {"users.totp_secret", "users.totp_enabled", "users.totp_last_step", "tenants.require_2fa",
            "user_recovery_codes.code_hash", "user_recovery_codes.used_at"} <= columns()
    with owner.connect() as c:
        assert c.execute(text("SELECT totp_enabled FROM users WHERE id = :u"), {"u": ids["existing"]}).scalar_one() is False
        assert c.execute(text("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
                              "WHERE relname = 'user_recovery_codes'")).scalar_one() is True
    _alembic("upgrade", "head")


def test_set_up_then_sign_in_in_two_steps(owner: Engine, dev_user: tuple[str, str, str], client: TestClient) -> None:  # noqa: F811
    from api.services.local_auth import decode_access_token

    uid, email, jwt_secret = dev_user
    # A wrong confirmation code leaves it off and is audited.
    r = _post(client, "/login", {"email": email, "password": PW})
    session = r.json()["token"]
    secret = _post(client, "/2fa/setup", token=session).json()["secret"]
    wrong = str((int(_now_code(secret)) + 1) % 1_000_000).zfill(6)
    assert _post(client, "/2fa/confirm", {"code": wrong}, token=session).status_code == 422
    assert _row(owner, uid)[0] is False

    step0 = totp.current_step()
    used = totp.code_at(secret, step0)
    confirmed = _post(client, "/2fa/confirm", {"code": used}, token=session)
    assert confirmed.status_code == 200, confirmed.text
    codes = confirmed.json()["recovery_codes"]
    assert len(codes) == 10
    enabled, stored, _tv = _row(owner, uid)
    assert enabled is True and secret not in stored  # encrypted at rest
    with owner.connect() as c:
        hashes = [h for (h,) in c.execute(text("SELECT code_hash FROM user_recovery_codes WHERE user_id = :u"), {"u": uid})]
    assert len(hashes) == 10 and not set(codes) & set(hashes)
    assert _get(client, "/2fa", confirmed.json()["token"]).json() == {"enabled": True, "required": False, "recovery_codes_left": 10}

    # The password alone is no longer a session.
    first = _post(client, "/login", {"email": email, "password": PW})
    assert first.status_code == 200
    body = first.json()
    assert body["mfa_required"] is True and body["token"] is None and body["user"] is None
    assert "mfa_token" in body and first.cookies.get("mn_auth_token") is None
    assert _get(client, "/me", body["mfa_token"]).status_code == 401  # the pending token is not a session

    # The code used to confirm is spent: replaying it fails; the next step's code works (within the drift
    # window for the next 60 seconds, which this test does not outlast).
    replay = _post(client, "/login/2fa", {"mfa_token": body["mfa_token"], "code": used})
    assert replay.status_code == 422
    following = totp.code_at(secret, step0 + 1)
    ok = _post(client, "/login/2fa", {"mfa_token": body["mfa_token"], "code": following})
    assert ok.status_code == 200, ok.text
    assert decode_access_token(ok.json()["token"], jwt_secret)["sub"] == uid
    assert _get(client, "/me", ok.json()["token"]).status_code == 200
    # ...and replaying that one fails too.
    again = _post(client, "/login", {"email": email, "password": PW}).json()["mfa_token"]
    assert _post(client, "/login/2fa", {"mfa_token": again, "code": following}).status_code == 422

    assert _audit(owner, uid) == ["user.2fa_failed", "user.2fa_enable", "user.2fa_failed", "user.2fa_failed"]


def test_recovery_code_works_once(owner: Engine, dev_user: tuple[str, str, str], client: TestClient) -> None:  # noqa: F811
    uid, email, _ = dev_user
    _session, _secret, codes = _enrol(client, email)

    pending = _post(client, "/login", {"email": email, "password": PW}).json()["mfa_token"]
    r = _post(client, "/login/2fa", {"mfa_token": pending, "code": codes[0].lower()})
    assert r.status_code == 200, r.text
    assert _get(client, "/2fa", r.json()["token"]).json()["recovery_codes_left"] == 9

    pending = _post(client, "/login", {"email": email, "password": PW}).json()["mfa_token"]
    assert _post(client, "/login/2fa", {"mfa_token": pending, "code": codes[0]}).status_code == 422
    assert "user.2fa_recovery_used" in _audit(owner, uid)


def test_pending_sign_in_dies_with_a_reset_or_a_bad_token(owner: Engine, dev_user: tuple[str, str, str], client: TestClient) -> None:  # noqa: F811
    from api.services.local_auth import create_mfa_pending_token

    uid, email, jwt_secret = dev_user
    _session, secret, _codes = _enrol(client, email)
    pending = _post(client, "/login", {"email": email, "password": PW}).json()["mfa_token"]
    with owner.begin() as c:  # what a password change or an admin reset does
        c.execute(text("UPDATE users SET token_version = token_version + 1 WHERE id = :u"), {"u": uid})
    assert _post(client, "/login/2fa", {"mfa_token": pending, "code": _now_code(secret, 1)}).status_code == 400
    assert _post(client, "/login/2fa", {"mfa_token": "not-a-token", "code": "123456"}).status_code == 400
    expired = create_mfa_pending_token(uid, DEV, jwt_secret, 1, ttl_minutes=-1)
    assert _post(client, "/login/2fa", {"mfa_token": expired, "code": _now_code(secret, 1)}).status_code == 400


def test_code_attempts_are_limited_per_user(owner: Engine, dev_user: tuple[str, str, str], client: TestClient,  # noqa: F811
                                            monkeypatch: pytest.MonkeyPatch) -> None:
    import api.services.rate_limiter as rl
    from tests.test_two_factor import _FakeRedis

    _uid, email, _ = dev_user
    _session, secret, _codes = _enrol(client, email)
    fake = _FakeRedis()
    monkeypatch.setattr(rl, "get_redis", lambda: fake)
    statuses = []
    for _ in range(6):
        pending = _post(client, "/login", {"email": email, "password": PW}).json()["mfa_token"]
        statuses.append(_post(client, "/login/2fa", {"mfa_token": pending, "code": "000000"}).status_code)
    assert statuses[:5] == [422] * 5 and statuses[5] == 429


def test_turn_off_needs_password_and_code_and_ends_other_sessions(
    owner: Engine, dev_user: tuple[str, str, str], client: TestClient,  # noqa: F811
) -> None:
    uid, email, _ = dev_user
    session, secret, _codes = _enrol(client, email)
    _, _, tv_before = _row(owner, uid)
    assert _post(client, "/2fa/disable", {"password": "wrong-password!", "code": _now_code(secret, 1)}, session).status_code == 422
    assert _post(client, "/2fa/disable", {"password": PW, "code": "000000"}, session).status_code == 422

    with owner.begin() as c:
        c.execute(text("UPDATE tenants SET require_2fa = true WHERE id = :t"), {"t": DEV})
    assert _post(client, "/2fa/disable", {"password": PW, "code": _now_code(secret, 1)}, session).status_code == 409
    with owner.begin() as c:
        c.execute(text("UPDATE tenants SET require_2fa = false WHERE id = :t"), {"t": DEV})

    r = _post(client, "/2fa/disable", {"password": PW, "code": _now_code(secret, 1)}, session)
    assert r.status_code == 200, r.text
    enabled, stored, tv = _row(owner, uid)
    assert enabled is False and stored is None and tv == tv_before + 1
    assert _get(client, "/me", session).status_code == 401  # the old session is over
    assert _get(client, "/me", r.json()["token"]).status_code == 200  # the caller carries on
    with owner.connect() as c:
        assert c.execute(text("SELECT count(*) FROM user_recovery_codes WHERE user_id = :u"), {"u": uid}).scalar_one() == 0
    assert _post(client, "/login", {"email": email, "password": PW}).json()["mfa_required"] is False
    assert _audit(owner, uid)[-1] == "user.2fa_disable"


def test_tenant_requirement_forces_set_up(owner: Engine, dev_user: tuple[str, str, str], client: TestClient) -> None:  # noqa: F811
    from api.services.local_auth import decode_access_token

    uid, email, jwt_secret = dev_user
    with owner.begin() as c:
        c.execute(text("UPDATE tenants SET require_2fa = true WHERE id = :t"), {"t": DEV})

    r = _post(client, "/login", {"email": email, "password": PW})
    assert r.status_code == 200 and r.json()["must_enrol_2fa"] is True
    restricted = r.json()["token"]
    assert decode_access_token(restricted, jwt_secret)["mfa_enrol"] is True
    me = _get(client, "/me", restricted)
    assert me.status_code == 200 and me.json()["must_enrol_2fa"] is True
    # Anything but set-up is refused (here: the role matrix, on the same router).
    blocked = _get(client, "/roles", restricted)
    assert blocked.status_code == 403 and blocked.json()["error"] == "mfa_enrol_required"
    # A forced password change keeps the restriction on the replacement session.
    changed = _post(client, "/change-password", {"current_password": PW, "new_password": "a-brand-new-password"}, restricted)
    assert changed.status_code == 200, changed.text
    restricted = changed.json()["token"]
    assert decode_access_token(restricted, jwt_secret)["mfa_enrol"] is True

    secret = _post(client, "/2fa/setup", token=restricted).json()["secret"]
    done = _post(client, "/2fa/confirm", {"code": _now_code(secret)}, restricted)
    assert done.status_code == 200
    full = done.json()["token"]
    assert "mfa_enrol" not in decode_access_token(full, jwt_secret)
    assert _get(client, "/me", full).json()["must_enrol_2fa"] is False
    assert _get(client, "/2fa", full).json()["required"] is True


def _serve(owner: Engine, monkeypatch: pytest.MonkeyPatch, tid: str,  # noqa: F811
           scenario: Callable[[AsyncClient], Awaitable[None]]) -> None:
    """The users and settings routers for tenant `tid`; x-test-uid sets the caller."""
    from fastapi import FastAPI, Request
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
    from starlette.responses import Response

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.settings import router as settings_router
    from api.routes.users import router as users_router

    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)
    aeng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db() -> AsyncIterator[AsyncSession]:
        async with factory() as s:
            yield s

    async def _as_user(request: Request, call_next: RequestResponseEndpoint) -> Response:
        request.state.local_user_id = request.headers.get("x-test-uid")
        return await call_next(request)

    api = FastAPI()
    api.include_router(users_router)
    api.include_router(settings_router)
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


def test_admin_resets_a_users_two_factor_and_requires_it(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    tid, u = _tenant(owner, {"padmin": "platform_admin", "target": "viewer", "viewer": "viewer"})
    _grant(owner, tid, u["padmin"], "platform_admin")
    _grant(owner, tid, u["target"], "viewer")
    _grant(owner, tid, u["viewer"], "viewer")
    with owner.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("UPDATE users SET totp_enabled = true, totp_secret = 'x', totp_last_step = 5 WHERE id = :u"),
                  {"u": u["target"]})
        c.execute(text("INSERT INTO user_recovery_codes (tenant_id, user_id, code_hash) VALUES (:t, :u, 'h')"),
                  {"t": tid, "u": u["target"]})

    async def scenario(c: AsyncClient) -> None:
        admin, viewer = {"x-test-uid": u["padmin"]}, {"x-test-uid": u["viewer"]}
        listed = await c.get("/api/v1/users", headers=admin)
        assert {x["id"]: x["totp_enabled"] for x in listed.json()["users"]}[u["target"]] is True
        assert (await c.post(f"/api/v1/users/{u['target']}/2fa/reset", headers=viewer)).status_code == 403
        assert (await c.post(f"/api/v1/users/{u['padmin']}/2fa/reset", headers=admin)).status_code in (403, 409)
        r = await c.post(f"/api/v1/users/{u['target']}/2fa/reset", headers=admin)
        assert r.status_code == 200, r.text

        # Requiring it: not before the admin has it, and never for a viewer.
        assert (await c.put("/api/v1/settings/security", json={"require_2fa": True}, headers=viewer)).status_code == 403
        refused = await c.put("/api/v1/settings/security", json={"require_2fa": True}, headers=admin)
        assert refused.status_code == 409, refused.text
        with owner.begin() as conn:
            conn.execute(text("UPDATE users SET totp_enabled = true WHERE id = :u"), {"u": u["padmin"]})
        on = await c.put("/api/v1/settings/security", json={"require_2fa": True}, headers=admin)
        assert on.status_code == 200 and on.json() == {"require_2fa": True}
        assert (await c.get("/api/v1/settings/security", headers=admin)).json() == {"require_2fa": True}

    _serve(owner, monkeypatch, tid, scenario)
    with owner.connect() as c:
        enabled, secret, tv = c.execute(text("SELECT totp_enabled, totp_secret, token_version FROM users WHERE id = :u"),
                                        {"u": u["target"]}).one()
        assert enabled is False and secret is None and tv == 1
        assert c.execute(text("SELECT count(*) FROM user_recovery_codes WHERE user_id = :u"), {"u": u["target"]}).scalar_one() == 0
        assert c.execute(text("SELECT require_2fa FROM tenants WHERE id = :t"), {"t": tid}).scalar_one() is True
        actions = [r[0] for r in c.execute(text(
            "SELECT action FROM audit_log WHERE tenant_id = :t AND action IN ('user.2fa_reset', 'tenant.require_2fa')"
            " ORDER BY created_at"), {"t": tid})]
        assert actions == ["user.2fa_reset", "tenant.require_2fa"]


def test_key_rotation_re_encrypts_two_factor_secrets(owner: Engine, dev_user: tuple[str, str, str],  # noqa: F811
                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services.credential_store import decrypt_with_key, encrypt_with_key

    uid, _email, _ = dev_user
    with owner.begin() as c:
        c.execute(text("UPDATE users SET totp_secret = :s WHERE id = :u"),
                  {"s": encrypt_with_key("old-master", DEV, "JBSWY3DPEHPK3PXP"), "u": uid})
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "rotate-credential-key.py")
    spec = importlib.util.spec_from_file_location("rotate_credential_key", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, mod)  # the script's dataclass looks its module up
    spec.loader.exec_module(mod)
    with owner.begin() as c:
        result = mod.RotationResult(rotated=0, already_new=0, failed=[])
        mod._rotate_totp_secrets(c, "old-master", "new-master", False, result)
        assert f"user={uid} totp_secret" not in result.failed
        mod._rotate_totp_secrets(c, "old-master", "new-master", False, result)  # a re-run skips it
    with owner.connect() as c:
        stored = c.execute(text("SELECT totp_secret FROM users WHERE id = :u"), {"u": uid}).scalar_one()
    assert decrypt_with_key("new-master", DEV, stored) == "JBSWY3DPEHPK3PXP"
