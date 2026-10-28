"""User lifecycle against a real Postgres: derived status and filters, invite resend / link / revoke,
forced password reset, bulk actions with partial results, CSV import with the seat check, seat enforcement
(invited users count), and grant expiry (an expired grant authorises nothing; the nightly purge removes it).

Every new route needs manage_users (403 for anyone else) and writes an audit row.
Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import Engine, text

from tests.test_rbac_escalation_pg import (  # noqa: F401  (owner is a module-scoped fixture)
    _grant, _tenant, _users_role, owner, pytestmark,
)

if TYPE_CHECKING:
    from httpx import AsyncClient

SECRET = "x" * 40
MAIL: dict[str, list[dict[str, Any]]] = {"invites": [], "resets": []}


def _serve(owner: Engine, monkeypatch: pytest.MonkeyPatch, tid: str,
           scenario: Callable[[AsyncClient], Awaitable[None]], seats: int | None = None) -> None:
    """The roles, me and users routers over the real database; x-test-uid is the caller. Mail is captured in
    MAIL; the licence manifest carries `seats` (None = no limit)."""
    import asyncio

    from fastapi import FastAPI, Request
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from starlette.middleware.base import BaseHTTPMiddleware

    import api.routes.users as users_mod
    from api.deps import Tenant, get_db, get_tenant
    from api.routes.me import router as me_router
    from api.routes.roles import router as roles_router

    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)
    monkeypatch.setenv("MERIDIAN_APP_URL", "https://meridian.example.test")
    MAIL["invites"].clear()
    MAIL["resets"].clear()

    class _Capture:
        def __init__(self, bucket: str) -> None:
            self.bucket = bucket

        def delay(self, **kw: Any) -> None:
            MAIL[self.bucket].append(kw)

    monkeypatch.setattr(users_mod, "send_invitation_email", _Capture("invites"))
    monkeypatch.setattr(users_mod, "send_password_reset_email", _Capture("resets"))
    monkeypatch.setattr("api.routes.licence.get_cached_manifest", lambda: {"seats": seats} if seats else {})
    with owner.begin() as c:
        c.execute(text("UPDATE tenants SET jwt_secret = :s WHERE id = :t"), {"s": SECRET, "t": tid})

    aeng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    async def _as_user(request: Request, call_next):
        request.state.local_user_id = request.headers.get("x-test-uid")
        return await call_next(request)

    api = FastAPI()
    for r in (roles_router, me_router, users_mod.router):
        api.include_router(r)
    api.add_middleware(BaseHTTPMiddleware, dispatch=_as_user)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Lifecycle", [])

    async def main() -> None:
        try:
            async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as c:
                await scenario(c)
        finally:
            await aeng.dispose()

    asyncio.run(main())


def _sql(owner: Engine, sql: str, **p: Any) -> list[Any]:
    with owner.begin() as c:
        r = c.execute(text(sql), p)
        return list(r.fetchall()) if r.returns_rows else []


def _audit(owner: Engine, tid: str, action: str) -> list[Any]:
    return _sql(owner, "SELECT entity_id, after_json::text FROM audit_log WHERE tenant_id = :t AND action = :a",
                t=tid, a=action)


def _team(owner: Engine, names: list[str]) -> tuple[str, dict[str, str]]:
    """Tenant with a platform admin `padmin` (grant-backed) and viewers `names`; everyone has a password."""
    tid, u = _tenant(owner, {"padmin": "platform_admin", "viewer": "viewer", **{n: "viewer" for n in names}})
    _grant(owner, tid, u["padmin"], "platform_admin")
    _sql(owner, "UPDATE users SET password_hash = 'x' WHERE tenant_id = :t", t=tid)
    return tid, u


# ── status ───────────────────────────────────────────────────────────────────


def test_user_status_five_cases_and_precedence() -> None:
    from api.routes.users import user_status

    now = datetime.now(timezone.utc)
    base: dict[str, Any] = {"is_active": True, "has_password": True, "locked_until": None,
                            "invite_expires_at": None, "created_at": now - timedelta(days=30)}

    def st(**kw: Any) -> str:
        return user_status({**base, **kw}, now)

    assert st() == "active"
    assert st(has_password=False, invite_expires_at=now + timedelta(days=3)) == "invited"
    assert st(has_password=False, invite_expires_at=now - timedelta(seconds=1)) == "invite_expired"
    assert st(locked_until=now + timedelta(minutes=5)) == "locked"
    assert st(locked_until=now - timedelta(minutes=5)) == "active"  # a lock that ran out is gone
    assert st(is_active=False) == "suspended"
    assert st(is_active=False, locked_until=now + timedelta(minutes=5)) == "suspended"  # suspended wins
    # Rows invited before migration 096 have no expiry: they run out 7 days after creation, like their token.
    assert st(has_password=False, created_at=now - timedelta(days=2)) == "invited"
    assert st(has_password=False, created_at=now - timedelta(days=8)) == "invite_expired"


def test_list_detail_filters_and_must_change_flag(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _team(owner, ["invited", "expired", "locked", "gone", "must"])
    sid = str(uuid.uuid4())
    _sql(owner, "INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'Prod', 'ECC')", s=sid, t=tid)
    _sql(owner, "UPDATE users SET password_hash = NULL, invite_expires_at = now() + interval '3 days' WHERE id = :u",
         u=u["invited"])
    _sql(owner, "UPDATE users SET password_hash = NULL, invite_expires_at = now() - interval '1 day' WHERE id = :u",
         u=u["expired"])
    _sql(owner, "UPDATE users SET locked_until = now() + interval '9 minutes' WHERE id = :u", u=u["locked"])
    _sql(owner, "UPDATE users SET is_active = false WHERE id = :u", u=u["gone"])
    _sql(owner, "UPDATE users SET must_change_password = true WHERE id = :u", u=u["must"])
    _sql(owner, "INSERT INTO user_role_scopes (tenant_id, user_id, role_key, system_id) "
                "VALUES (:t, :u, 'data_steward', :s)", t=tid, u=u["must"], s=sid)

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["padmin"]}
        rows = (await c.get("/api/v1/users", headers=h)).json()["users"]
        by = {r["id"]: r for r in rows}
        assert {n: by[i]["status"] for n, i in u.items()} == {
            "padmin": "active", "viewer": "active", "invited": "invited", "expired": "invite_expired",
            "locked": "locked", "gone": "suspended", "must": "active"}
        assert by[u["must"]]["must_change_password"] is True and by[u["viewer"]]["must_change_password"] is False
        assert "password_hash" not in by[u["viewer"]] and "has_password" not in by[u["viewer"]]

        async def ids(**q: str) -> set[str]:
            r = await c.get("/api/v1/users", params=q, headers=h)
            assert r.status_code == 200, r.text
            return {x["id"] for x in r.json()["users"]}

        assert await ids(status="invited") == {u["invited"]}
        assert await ids(status="invite_expired") == {u["expired"]}
        assert await ids(status="locked") == {u["locked"]}
        assert await ids(status="suspended") == {u["gone"]}
        assert await ids(q="LOCKED") == {u["locked"]}  # email contains it, case-insensitive
        assert await ids(q="%") == set()  # a wildcard is a literal
        assert await ids(role="data_steward") == {u["must"]}  # by an unexpired grant
        assert await ids(role="platform_admin") == {u["padmin"]}  # by users.role
        assert await ids(system_id=sid) == {u["must"]}
        assert await ids(system_id=sid, status="invited") == set()
        assert (await c.get("/api/v1/users", params={"status": "bogus"}, headers=h)).status_code == 422

        d = await c.get(f"/api/v1/users/{u['expired']}", headers=h)
        assert d.status_code == 200 and d.json()["status"] == "invite_expired" and d.json()["grants"] == []
        assert (await c.get(f"/api/v1/users/{uuid.uuid4()}", headers=h)).status_code == 404

    _serve(owner, monkeypatch, tid, scenario)


# ── invite lifecycle ─────────────────────────────────────────────────────────


def test_invite_sets_lifecycle_and_resend_link_revoke(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    import jwt

    tid, u = _team(owner, [])

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["padmin"]}
        r = await c.post("/api/v1/users/invite", json={"email": "New.Person@Example.test", "role": "viewer"}, headers=h)
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        (row,) = _sql(owner, "SELECT invite_status, invited_at IS NOT NULL, invite_sent_at IS NOT NULL, "
                             "invite_expires_at - invited_at, password_hash FROM users WHERE id = :u", u=uid)
        assert row[0] == "queued" and row[1] and row[2] and row[4] is None
        assert timedelta(days=6, hours=23) < row[3] <= timedelta(days=7, minutes=1)  # the JWT's 7 days
        first = MAIL["invites"][-1]
        assert jwt.decode(first["invite_token"], SECRET, algorithms=["HS256"])["purpose"] == "invite_accept"
        assert (await c.get(f"/api/v1/users/{uid}", headers=h)).json()["status"] == "invited"
        assert len(_audit(owner, tid, "user.invite")) == 1

        # resend: a new token, status queued again, the clock restarted, one more email, audited
        _sql(owner, "UPDATE users SET invite_status = 'failed', invite_expires_at = now() - interval '1 hour' "
                    "WHERE id = :u", u=uid)
        assert (await c.get(f"/api/v1/users/{uid}", headers=h)).json()["status"] == "invite_expired"
        r = await c.post(f"/api/v1/users/{uid}/invite/resend", headers=h)
        assert r.status_code == 200 and r.json()["invite_status"] == "queued", r.text
        assert len(MAIL["invites"]) == 2 and MAIL["invites"][-1]["recipient_email"] == "new.person@example.test"
        assert (await c.get(f"/api/v1/users/{uid}", headers=h)).json()["status"] == "invited"
        assert len(_audit(owner, tid, "user.invite_resend")) == 1

        # link: the accept URL for the admin, a fresh 7 days, no email, audited without the token
        before = len(MAIL["invites"])
        r = await c.post(f"/api/v1/users/{uid}/invite/link", headers=h)
        assert r.status_code == 200, r.text
        url = r.json()["url"]
        assert url.startswith("https://meridian.example.test/accept-invite?token=")
        claims = jwt.decode(url.split("token=")[1], SECRET, algorithms=["HS256"])
        assert claims["sub"] == uid and claims["purpose"] == "invite_accept"
        assert len(MAIL["invites"]) == before
        (audit,) = _audit(owner, tid, "user.invite_link_copied")
        assert audit[0] == uid and url.split("token=")[1] not in (audit[1] or "")

        # an active user cannot be resent or given a link
        for path in ("invite/resend", "invite/link"):
            r = await c.post(f"/api/v1/users/{u['viewer']}/{path}", headers=h)
            assert r.status_code == 409, path
        assert (await c.post(f"/api/v1/users/{uuid.uuid4()}/invite/resend", headers=h)).status_code == 404

        # revoke: DELETE on an invited user removes it, audited as a revoke
        r = await c.delete(f"/api/v1/users/{uid}", headers=h)
        assert r.status_code == 200, r.text
        assert _sql(owner, "SELECT 1 FROM users WHERE id = :u", u=uid) == []
        assert len(_audit(owner, tid, "user.invite_revoke")) == 1

    _serve(owner, monkeypatch, tid, scenario)


def test_worker_writes_sent_and_failed(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    from sqlalchemy.orm import Session

    import workers.tasks.send_user_invitation as task

    tid, u = _team(owner, ["invitee"])
    uid = u["invitee"]
    _sql(owner, "UPDATE users SET password_hash = NULL, invite_status = 'queued' WHERE id = :u", u=uid)
    monkeypatch.setattr(task, "get_sync_engine", lambda: owner)
    for sent, want in ((True, "sent"), (False, "failed")):
        _sql(owner, "UPDATE users SET invite_status = 'queued', invite_sent_at = NULL WHERE id = :u", u=uid)
        monkeypatch.setattr(task, "_send_invitation_email", lambda *a, _s=sent, **k: _s)
        task.send_invitation_email.run(user_id=uid, tenant_id=tid, recipient_email="a@example.test",
                                       recipient_name="A", role="viewer", invite_token="t")
        status, sent_at = _sql(owner, "SELECT invite_status, invite_sent_at FROM users WHERE id = :u", u=uid)[0]
        assert status == want and (sent_at is not None) is sent
    # an accepted invite is never rewritten by a late task
    _sql(owner, "UPDATE users SET invite_status = 'accepted' WHERE id = :u", u=uid)
    with Session(owner) as s:
        task._record_invite_status(s, tid, uid, "failed")
    assert _sql(owner, "SELECT invite_status FROM users WHERE id = :u", u=uid)[0][0] == "accepted"


# ── password reset ───────────────────────────────────────────────────────────


def test_admin_reset_password(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    import jwt

    tid, u = _team(owner, ["fresh"])
    _sql(owner, "UPDATE users SET password_hash = NULL WHERE id = :u", u=u["fresh"])
    _sql(owner, "UPDATE users SET failed_login_count = 10, locked_until = now() + interval '9 minutes' "
                "WHERE id = :u", u=u["viewer"])

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["padmin"]}
        path = f"/api/v1/users/{u['viewer']}/reset-password"
        # a link: must_change_password, sessions revoked, lock cleared, one-time (tv = the new version)
        r = await c.post(path, json={"send_email": False}, headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["emailed"] is False and body["must_change_password"] is True
        token = body["link"].split("token=")[1]
        assert body["link"].startswith("https://meridian.example.test/reset-password?token=")
        row = _sql(owner, "SELECT must_change_password, token_version, failed_login_count, locked_until "
                          "FROM users WHERE id = :u", u=u["viewer"])[0]
        assert row == (True, 1, 0, None)
        claims = jwt.decode(token, SECRET, algorithms=["HS256"])
        assert claims["purpose"] == "password_reset" and claims["tv"] == 1 and claims["sub"] == u["viewer"]
        assert MAIL["resets"] == []
        (audit,) = _audit(owner, tid, "user.password_reset")
        assert token not in (audit[1] or "")

        # an email: queued with a token, no link in the response
        r = await c.post(path, json={"send_email": True}, headers=h)
        assert r.status_code == 200 and r.json()["emailed"] is True and r.json()["link"] is None
        assert len(MAIL["resets"]) == 1 and MAIL["resets"][0]["recipient_email"].startswith("viewer-")
        assert jwt.decode(MAIL["resets"][0]["reset_token"], SECRET, algorithms=["HS256"])["tv"] == 2
        assert _sql(owner, "SELECT token_version FROM users WHERE id = :u", u=u["viewer"])[0][0] == 2

        # guards: yourself, a user with no password, an unknown user
        assert (await c.post(f"/api/v1/users/{u['padmin']}/reset-password", json={}, headers=h)).status_code == 403
        r = await c.post(f"/api/v1/users/{u['fresh']}/reset-password", json={}, headers=h)
        assert r.status_code == 409 and "Resend the invite" in r.json()["detail"]
        assert (await c.post(f"/api/v1/users/{uuid.uuid4()}/reset-password", json={}, headers=h)).status_code == 404

    _serve(owner, monkeypatch, tid, scenario)


# ── bulk ─────────────────────────────────────────────────────────────────────


def test_bulk_partial_results_and_guards(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _team(owner, ["a", "b", "waiting"])
    _sql(owner, "UPDATE users SET password_hash = NULL, invite_expires_at = now() + interval '1 day' "
                "WHERE id = :u", u=u["waiting"])

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["padmin"]}

        async def bulk(action: str, *names: str) -> dict[str, Any]:
            r = await c.post("/api/v1/users/bulk", json={"ids": [u[n] for n in names], "action": action}, headers=h)
            assert r.status_code == 200, r.text
            return r.json()

        out = await bulk("suspend", "a", "padmin", "b")  # yourself fails, the others go through
        res = {r["id"]: r for r in out["results"]}
        assert (out["succeeded"], out["failed"]) == (2, 1)
        assert res[u["padmin"]]["ok"] is False and "own access" in res[u["padmin"]]["error"]
        assert [_sql(owner, "SELECT is_active FROM users WHERE id = :u", u=u[n])[0][0] for n in ("a", "b")] == [False, False]
        assert len(_audit(owner, tid, "user.suspend")) == 2

        out = await bulk("reactivate", "a", "viewer")  # an active user reactivates fine (idempotent)
        assert out["succeeded"] == 2
        assert _sql(owner, "SELECT failed_login_count, locked_until FROM users WHERE id = :u", u=u["a"])[0] == (0, None)

        out = await bulk("resend", "waiting", "viewer")
        res = {r["id"]: r for r in out["results"]}
        assert res[u["waiting"]]["ok"] and not res[u["viewer"]]["ok"]
        assert len(MAIL["invites"]) == 1

        out = await bulk("reset", "viewer", "waiting", "padmin")
        res = {r["id"]: r for r in out["results"]}
        assert [res[u[n]]["ok"] for n in ("viewer", "waiting", "padmin")] == [True, False, False]
        assert len(MAIL["resets"]) == 1  # bulk reset emails, it never returns links
        assert "link" not in out["results"][0]

        # a plain viewer cannot run bulk at all
        r = await c.post("/api/v1/users/bulk", json={"ids": [u["padmin"]], "action": "suspend"}, headers={"x-test-uid": u["a"]})
        assert r.status_code == 403

        for bad in ({"ids": [], "action": "suspend"}, {"ids": [u["a"]], "action": "delete"}):
            assert (await c.post("/api/v1/users/bulk", json=bad, headers=h)).status_code == 422

    _serve(owner, monkeypatch, tid, scenario)


def test_bulk_last_admin_is_refused(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _tenant(owner, {"boss": "platform_admin", "other": "platform_admin"})
    for n in ("boss", "other"):
        _grant(owner, tid, u[n], "platform_admin")
    _sql(owner, "UPDATE users SET password_hash = 'x' WHERE tenant_id = :t", t=tid)

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["boss"]}
        r = await c.post("/api/v1/users/bulk", json={"ids": [u["other"]], "action": "suspend"}, headers=h)
        assert r.json()["succeeded"] == 1  # boss remains
        _sql(owner, "UPDATE users SET is_active = true WHERE id = :u", u=u["other"])
        _sql(owner, "UPDATE users SET is_active = false WHERE id = :u", u=u["boss"])
        r = await c.post("/api/v1/users/bulk", json={"ids": [u["other"]], "action": "suspend"}, headers={"x-test-uid": u["other"]})
        assert r.json()["results"][0]["ok"] is False  # yourself

    _serve(owner, monkeypatch, tid, scenario)


# ── import and seats ─────────────────────────────────────────────────────────

CSV = """email,name,role,system,module
ann@example.test,Ann,data_steward,Prod,fi_gl
bob@example.test,,,,
BOB@example.test,Bob again,viewer,,
not-an-email,X,viewer,,
cy@example.test,Cy,wizard,,
di@example.test,Di,steward,,
ed@example.test,Ed,viewer,Nowhere,
viewer-existing,Y,viewer,,
fay@example.test,Fay,Programme lead / CIO,,
"""


def test_import_preview_and_commit(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _team(owner, [])
    sid = str(uuid.uuid4())
    _sql(owner, "INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'Prod', 'ECC')", s=sid, t=tid)
    existing = _sql(owner, "SELECT email FROM users WHERE id = :u", u=u["viewer"])[0][0]
    csv_text = CSV.replace("viewer-existing", existing)

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["padmin"]}
        r = await c.post("/api/v1/users/import/preview", json={"csv": csv_text}, headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        rows = {x["line"]: x for x in body["rows"]}
        assert rows[2]["ok"] and rows[2]["role"] == "data_steward" and rows[2]["system_id"] == sid and rows[2]["module"] == "fi_gl"
        assert rows[3]["ok"] and rows[3]["role"] == "viewer" and rows[3]["name"] == "bob"  # blank role = viewer
        assert not rows[4]["ok"] and "Duplicate of line 3" in rows[4]["error"]
        assert not rows[5]["ok"] and "valid email" in rows[5]["error"]
        assert not rows[6]["ok"] and "Unknown role" in rows[6]["error"]
        assert not rows[7]["ok"] and "Legacy roles" in rows[7]["error"]
        assert not rows[8]["ok"] and "System not found" in rows[8]["error"]
        assert not rows[9]["ok"] and "already exists" in rows[9]["error"]
        assert rows[10]["ok"] and rows[10]["role"] == "programme_lead"  # a role by its name
        assert (body["accepted"], body["rejected"]) == (3, 6)
        assert body["seats"] == {"used": 2, "limit": None, "needed": 3, "available": None, "ok": True}
        assert _sql(owner, "SELECT count(*) FROM users WHERE tenant_id = :t", t=tid)[0][0] == 2  # preview wrote nothing

        r = await c.post("/api/v1/users/import", json={"csv": csv_text}, headers=h)
        assert r.status_code == 200, r.text
        out = r.json()
        assert sorted(x["email"] for x in out["created"]) == ["ann@example.test", "bob@example.test", "fay@example.test"]
        assert len(out["skipped"]) == 6
        ann = next(x["id"] for x in out["created"] if x["email"].startswith("ann"))
        assert _sql(owner, "SELECT role_key, system_id::text, module FROM user_role_scopes WHERE user_id = :u", u=ann) == [
            ("data_steward", sid, "fi_gl")]
        assert _users_role(owner, tid, ann) == "viewer"  # a scoped grant never widens users.role
        assert len(MAIL["invites"]) == 3
        assert _sql(owner, "SELECT invite_status FROM users WHERE id = :u", u=ann)[0][0] == "queued"
        assert len(_audit(owner, tid, "user.invite")) == 3 and len(_audit(owner, tid, "user.import")) == 1

        for bad in ({"csv": "name,role\nx,viewer\n"}, {"csv": "email\n" + "a@example.test\n" * 501}):
            assert (await c.post("/api/v1/users/import/preview", json=bad, headers=h)).status_code == 422

    _serve(owner, monkeypatch, tid, scenario)


def test_import_cannot_exceed_the_callers_own_permissions(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _team(owner, ["lead"])
    from tests.test_rbac_escalation_pg import _seed_custom

    _seed_custom(owner, tid, "custom:user-admin", {("users", "admin")})
    _grant(owner, tid, u["lead"], "custom:user-admin")

    async def scenario(c: AsyncClient) -> None:
        r = await c.post("/api/v1/users/import/preview", json={"csv": "email,role\nx@example.test,platform_admin\n"},
                         headers={"x-test-uid": u["lead"]})
        assert r.status_code == 200 and r.json()["rows"][0]["ok"] is False
        assert "admin" in r.json()["rows"][0]["error"].lower()
        r = await c.post("/api/v1/users/import", json={"csv": "email,role\nx@example.test,platform_admin\n"},
                         headers={"x-test-uid": u["lead"]})
        assert r.status_code == 200 and r.json()["created"] == []

    _serve(owner, monkeypatch, tid, scenario)


def test_seats_count_invited_users_and_block_invite_import_and_reactivate(owner: Engine,
                                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _team(owner, [])  # padmin + viewer: 2 seats used
    full = "Licence seats are full ({} of {}). Suspend a user or raise the licence."

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["padmin"]}
        invite = {"email": "one@example.test", "role": "viewer"}
        r = await c.post("/api/v1/users/invite", json=invite, headers=h)
        assert r.status_code == 200, r.text  # 3 of 3
        first = r.json()["id"]
        r = await c.post("/api/v1/users/invite", json={**invite, "email": "two@example.test"}, headers=h)
        assert r.status_code == 409 and r.json()["detail"] == full.format(3, 3)  # the invited user holds a seat
        assert _sql(owner, "SELECT 1 FROM users WHERE email = 'two@example.test' AND tenant_id = :t", t=tid) == []

        r = await c.post("/api/v1/users/import", json={"csv": "email,role\nx@example.test,viewer\n"}, headers=h)
        assert r.status_code == 409 and r.json()["detail"] == full.format(3, 3)
        pre = (await c.post("/api/v1/users/import/preview", json={"csv": "email,role\nx@example.test,viewer\n"},
                            headers=h)).json()
        assert pre["seats"] == {"used": 3, "limit": 3, "needed": 1, "available": 0, "ok": False}

        # a suspended user frees a seat; reactivating needs one again
        assert (await c.put(f"/api/v1/users/{u['viewer']}", json={"is_active": False}, headers=h)).status_code == 200
        assert (await c.post("/api/v1/users/invite", json={**invite, "email": "two@example.test"}, headers=h)).status_code == 200
        r = await c.put(f"/api/v1/users/{u['viewer']}", json={"is_active": True}, headers=h)
        assert r.status_code == 409 and r.json()["detail"] == full.format(3, 3)
        out = (await c.post("/api/v1/users/bulk", json={"ids": [u["viewer"]], "action": "reactivate"}, headers=h)).json()
        assert out["results"][0]["error"] == full.format(3, 3)
        # revoking an invite frees its seat
        assert (await c.delete(f"/api/v1/users/{first}", headers=h)).status_code == 200
        assert (await c.put(f"/api/v1/users/{u['viewer']}", json={"is_active": True}, headers=h)).status_code == 200

    _serve(owner, monkeypatch, tid, scenario, seats=3)


# ── permissions: every new route is manage_users only ────────────────────────


def test_new_routes_are_403_without_manage_users(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _team(owner, ["waiting"])
    _sql(owner, "UPDATE users SET password_hash = NULL WHERE id = :u", u=u["waiting"])
    w = u["waiting"]

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["viewer"]}
        calls = [
            ("get", "/api/v1/users", None), ("get", f"/api/v1/users/{w}", None),
            ("post", f"/api/v1/users/{w}/invite/resend", None), ("post", f"/api/v1/users/{w}/invite/link", None),
            ("post", f"/api/v1/users/{w}/reset-password", {"send_email": False}),
            ("post", "/api/v1/users/bulk", {"ids": [w], "action": "resend"}),
            ("post", "/api/v1/users/import/preview", {"csv": "email\na@example.test\n"}),
            ("post", "/api/v1/users/import", {"csv": "email\na@example.test\n"}),
            ("delete", f"/api/v1/users/{w}", None), ("put", f"/api/v1/users/{w}", {"is_active": False}),
            ("post", "/api/v1/users/invite", {"email": "a@example.test"}),
            ("get", "/api/v1/roles/matrix", None),
            ("get", f"/api/v1/users/{w}/effective?with_grant=viewer", None),
        ]
        for method, path, body in calls:
            r = await getattr(c, method)(path, headers=h, **({"json": body} if body is not None else {}))
            assert r.status_code == 403, (method, path, r.status_code, r.text)
        assert MAIL["invites"] == [] and MAIL["resets"] == []
        assert _sql(owner, "SELECT 1 FROM users WHERE id = :u AND is_active", u=w)  # nothing changed
        assert _sql(owner, "SELECT 1 FROM audit_log WHERE tenant_id = :t", t=tid) == []

    _serve(owner, monkeypatch, tid, scenario)


# ── grant expiry ─────────────────────────────────────────────────────────────


def test_expired_grant_does_not_authorise_and_purge_removes_it(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    from sqlalchemy.orm import Session

    from workers.tasks.purge_expired import purge_expired_grants

    tid, u = _team(owner, ["lead", "scoped"])
    soon = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["padmin"]}
        who = {"x-test-uid": u["lead"]}
        assert (await c.get("/api/v1/users/assignable", headers=who)).status_code == 403  # a viewer cannot assign

        # a past expiry is refused; a future one is stored and listed
        g = f"/api/v1/users/{u['lead']}/grants"
        r = await c.post(g, json={"role_key": "programme_lead", "expires_at": "2020-01-01T00:00:00Z"}, headers=h)
        assert r.status_code == 422
        r = await c.post(g, json={"role_key": "programme_lead", "expires_at": soon}, headers=h)
        assert r.status_code == 201 and r.json()["expires_at"], r.text
        assert [x["expires_at"] is not None for x in (await c.get(g, headers=h)).json()] == [True]
        assert _users_role(owner, tid, u["lead"]) == "programme_lead"
        assert (await c.get("/api/v1/users/assignable", headers=who)).status_code == 200  # authorised by the grant
        assert "assign" in (await c.get("/api/v1/me/permissions", headers=who)).json()["actions"]

        # it expires: no row removed yet, but it authorises nothing, whichever path asks
        _sql(owner, "UPDATE user_role_scopes SET expires_at = now() - interval '1 second' WHERE user_id = :u", u=u["lead"])
        assert _sql(owner, "SELECT count(*) FROM user_role_scopes WHERE user_id = :u", u=u["lead"])[0][0] == 1
        assert (await c.get("/api/v1/users/assignable", headers=who)).status_code == 403
        assert "assign" not in (await c.get("/api/v1/me/permissions", headers=who)).json()["actions"]

        # a grant that never reached users.role (a custom one) is checked on the grant path too
        from tests.test_rbac_escalation_pg import _seed_custom

        _seed_custom(owner, tid, "custom:assigner", {("stewardship", "edit")})
        _grant(owner, tid, u["scoped"], "custom:assigner")
        sc = {"x-test-uid": u["scoped"]}
        assert (await c.get("/api/v1/users/assignable", headers=sc)).status_code == 200
        _sql(owner, "UPDATE user_role_scopes SET expires_at = now() - interval '1 second' WHERE user_id = :u", u=u["scoped"])
        assert (await c.get("/api/v1/users/assignable", headers=sc)).status_code == 403

        # an expired admin grant is not an admin that keeps the last-admin rule satisfied
        assert (await c.get(f"/api/v1/users/{u['lead']}", headers=h)).json()["grants"][0]["expired"] is True

    _serve(owner, monkeypatch, tid, scenario)

    # nightly purge: row deleted, one audit row each, users.role re-derived, a second run is a no-op
    with Session(owner) as s:
        assert purge_expired_grants(s, tid) == 2
        s.commit()
    assert _sql(owner, "SELECT count(*) FROM user_role_scopes WHERE user_id = ANY(CAST(:u AS uuid[]))", u=[u["lead"], u["scoped"]])[0][0] == 0
    assert sorted(a[0] for a in _audit(owner, tid, "grant.expire")) == sorted([u["lead"], u["scoped"]])
    assert _users_role(owner, tid, u["lead"]) == "viewer"
    with Session(owner) as s:
        assert purge_expired_grants(s, tid) == 0
        s.commit()
    assert len(_audit(owner, tid, "grant.expire")) == 2


def test_purge_keeps_unexpired_and_unbacked_roles(owner: Engine) -> None:
    from sqlalchemy.orm import Session

    from workers.tasks.purge_expired import purge_expired_grants

    tid, u = _tenant(owner, {"keeps": "data_steward", "legacy": "programme_lead"})
    _grant(owner, tid, u["keeps"], "data_steward")
    gid = _grant(owner, tid, u["keeps"], "viewer")
    _sql(owner, "UPDATE user_role_scopes SET expires_at = now() - interval '1 minute' WHERE id = :g", g=gid)
    # `legacy` holds users.role with no grant behind it (a row from before grants), and an expired scoped one
    _sql(owner, "INSERT INTO user_role_scopes (tenant_id, user_id, role_key, module, expires_at) "
                "VALUES (:t, :u, 'viewer', 'hcm', now() - interval '1 minute')", t=tid, u=u["legacy"])
    with Session(owner) as s:
        assert purge_expired_grants(s, tid) == 2
        s.commit()
    assert _users_role(owner, tid, u["keeps"]) == "data_steward"
    assert _users_role(owner, tid, u["legacy"]) == "programme_lead"
