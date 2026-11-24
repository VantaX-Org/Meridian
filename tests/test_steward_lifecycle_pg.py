"""The steward lifecycle end to end against a real Postgres.

An administrator invites a data steward, names them in the assignment template and applies it. Apply writes
the steward assignments and routes the open items nobody holds yet to that steward right away; items found
later route the same way on the next sweep. The steward then works the queue: lists their own items, resolves
one (a second resolve is refused), escalates another, and shows up in the metrics. Nobody below administrator
can edit or apply the template, and the template refuses people who are not active users of the tenant.

Accepting the invite and setting a password is covered by
tests/test_auth_lockout_pg.py::test_accept_invite_applies_policy_and_marks_accepted.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import Engine, text

from tests.test_rbac_escalation_pg import _grant, _tenant, owner, pytestmark  # noqa: F401  (owner is a fixture)

if TYPE_CHECKING:
    from httpx import AsyncClient

SECRET = "x" * 40
MAIL: list[dict[str, Any]] = []


def _serve(owner: Engine, monkeypatch: pytest.MonkeyPatch, tid: str,
           scenario: Callable[[AsyncClient], Awaitable[None]]) -> None:
    """The users, roles, stewardship and assignment-template routers over the real database; x-test-uid is the
    caller. Invitation mail is captured in MAIL."""
    import asyncio

    from fastapi import FastAPI, Request
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from starlette.middleware.base import BaseHTTPMiddleware

    import api.middleware.cache as cache
    import api.routes.users as users_mod
    from api.deps import Tenant, get_db, get_tenant
    from api.routes.roles import router as roles_router
    from api.routes.stewardship import router as stewardship_router
    from api.routes.stewardship_template import router as template_router

    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)
    monkeypatch.setenv("MERIDIAN_APP_URL", "https://meridian.example.test")
    monkeypatch.setattr(cache, "_memo", {})  # active slices are memoised per process; each test seeds its own
    MAIL.clear()

    class _Capture:
        def delay(self, **kw: Any) -> None:
            MAIL.append(kw)

    monkeypatch.setattr(users_mod, "send_invitation_email", _Capture())
    monkeypatch.setattr("api.routes.licence.get_cached_manifest", lambda: {})
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
    for r in (roles_router, users_mod.router, stewardship_router, template_router):
        api.include_router(r)
    api.add_middleware(BaseHTTPMiddleware, dispatch=_as_user)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Stewards", [])

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


def _team(owner: Engine) -> tuple[str, dict[str, str]]:
    """A tenant with a grant-backed platform admin and one person per role below it."""
    roles = {"padmin": "platform_admin", "viewer": "viewer", "analyst": "analyst", "steward": "data_steward",
             "other": "data_steward"}
    tid, u = _tenant(owner, roles)
    for name, role in roles.items():
        _grant(owner, tid, u[name], role)
    _sql(owner, "UPDATE users SET password_hash = 'x' WHERE tenant_id = :t", t=tid)
    return tid, u


def _seed(owner: Engine, tid: str) -> tuple[str, list[str], str, str]:
    """An analysis version, three open vendor issues (company codes 1000, 2000 and none) and two open queue
    items for the same object. Returns (version, issue ids, queue item a, queue item b)."""
    vid = str(uuid.uuid4())
    _sql(owner, "INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')", v=vid, t=tid)
    issues = []
    for key in ("LIFNR=100001|BUKRS=1000", "LIFNR=100002|BUKRS=2000", "LIFNR=100003"):
        issues.append(str(_sql(owner, "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, "
                                      "grain, severity, status, first_seen_version, last_seen_version) VALUES "
                                      "(:t, 'sys', 'accounts_payable', 'AP_LFA1_STCD1_NULL', :k, 'LFA1', 'high', "
                                      "'open', :v, :v) RETURNING id", t=tid, k=key, v=vid)[0][0]))
    q = [str(_sql(owner, "INSERT INTO stewardship_queue (tenant_id, item_type, source_id, domain, priority) "
                         "VALUES (:t, 'merge_review', :s, 'accounts_payable', 2) RETURNING id",
                  t=tid, s=str(uuid.uuid4()))[0][0]) for _ in range(2)]
    return vid, issues, q[0], q[1]


def _template(u: dict[str, str], **extra: Any) -> dict[str, Any]:
    return {"objects": {"accounts_payable": {"owner_role": "data_owner", "slice": "company_code",
                                             "owner_user_id": u["padmin"], "steward_user_id": u["steward"], **extra}}}


def _audit(owner: Engine, tid: str, action: str) -> list[Any]:
    return _sql(owner, "SELECT after_json::text FROM audit_log WHERE tenant_id = :t AND action = :a", t=tid, a=action)


def test_admin_invites_a_steward_and_the_steward_cannot_administer(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _team(owner)

    async def scenario(c: AsyncClient) -> None:
        admin, steward = {"x-test-uid": u["padmin"]}, {"x-test-uid": u["steward"]}
        email = f"new-steward-{uuid.uuid4().hex[:6]}@example.test"
        r = await c.post("/api/v1/users/invite", json={"email": email, "role": "data_steward"}, headers=admin)
        assert r.status_code in (200, 201), r.text
        new_id = r.json()["id"]
        row = _sql(owner, "SELECT role, is_active, password_hash IS NULL FROM users WHERE id = :i", i=new_id)[0]
        assert tuple(row) == ("data_steward", True, True)
        assert MAIL and MAIL[-1]["invite_token"]  # the invitation mail carries the accept link's token

        # a steward cannot invite, cannot edit the template, cannot apply it
        r = await c.post("/api/v1/users/invite", json={"email": f"x-{email}", "role": "viewer"}, headers=steward)
        assert r.status_code == 403, r.text
        r = await c.put("/api/v1/admin/assignment-template", json={"template": _template(u)}, headers=steward)
        assert r.status_code == 403, r.text

    _serve(owner, monkeypatch, tid, scenario)


def test_only_an_admin_applies_the_template(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _team(owner)
    _seed(owner, tid)

    async def scenario(c: AsyncClient) -> None:
        r = await c.put("/api/v1/admin/assignment-template", json={"template": _template(u)},
                        headers={"x-test-uid": u["padmin"]})
        assert r.status_code == 200, r.text
        for who in ("viewer", "analyst", "steward"):
            r = await c.post("/api/v1/admin/assignment-template/apply", json={"dry_run": False},
                             headers={"x-test-uid": u[who]})
            assert r.status_code == 403, (who, r.text)
        assert _sql(owner, "SELECT count(*) FROM steward_assignments WHERE tenant_id = :t", t=tid)[0][0] == 0
        assert _sql(owner, "SELECT count(*) FROM record_issues WHERE tenant_id = :t AND assigned_to IS NOT NULL",
                    t=tid)[0][0] == 0

    _serve(owner, monkeypatch, tid, scenario)


def test_template_refuses_unknown_and_other_tenant_people(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _team(owner)
    _tid2, u2 = _tenant(owner, {"stranger": "data_steward"})

    async def scenario(c: AsyncClient) -> None:
        admin = {"x-test-uid": u["padmin"]}
        for bad in (str(uuid.uuid4()), u2["stranger"]):
            body = {"template": {"objects": {"accounts_payable": {"owner_role": "data_owner", "slice": "none",
                                                                  "steward_user_id": bad}}}}
            r = await c.put("/api/v1/admin/assignment-template", json=body, headers=admin)
            assert r.status_code == 422 and "not active users" in r.json()["detail"], r.text
        _sql(owner, "UPDATE users SET is_active = false WHERE id = :i", i=u["other"])
        body = {"template": {"objects": {"accounts_payable": {"owner_role": "data_owner", "slice": "none",
                                                              "steward_user_id": u["other"]}}}}
        r = await c.put("/api/v1/admin/assignment-template", json=body, headers=admin)
        assert r.status_code == 422, r.text  # a suspended user is not active either
        assert not _sql(owner, "SELECT 1 FROM assignment_templates WHERE tenant_id = :t", t=tid)

    _serve(owner, monkeypatch, tid, scenario)


def test_apply_routes_open_items_and_the_steward_works_them(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _team(owner)
    vid, issues, qa, qb = _seed(owner, tid)

    async def scenario(c: AsyncClient) -> None:
        admin, steward = {"x-test-uid": u["padmin"]}, {"x-test-uid": u["steward"]}
        # company code 2000 has its own steward; 1000 and records without a company code fall to the whole object
        tmpl = _template(u, slice_stewards={"2000": u["other"]})
        r = await c.put("/api/v1/admin/assignment-template", json={"template": tmpl}, headers=admin)
        assert r.status_code == 200 and r.json()["saved"] is True, r.text
        assert sorted(r.json()["active_slices"]["company_code"]) == ["1000", "2000"]

        r = await c.post("/api/v1/admin/assignment-template/apply", json={"dry_run": True}, headers=admin)
        assert r.status_code == 200 and r.json()["dry_run"] is True, r.text
        assert r.json()["totals"]["add"] == 3  # the owner and one steward per active company code
        assert _sql(owner, "SELECT count(*) FROM steward_assignments WHERE tenant_id = :t", t=tid)[0][0] == 0

        r = await c.post("/api/v1/admin/assignment-template/apply", json={"dry_run": False}, headers=admin)
        assert r.status_code == 200, r.text
        assert r.json()["routed"] == {"issue": 3, "queue": 2}, r.json()
        rows = _sql(owner, "SELECT slice_value, steward_user_id::text FROM steward_assignments WHERE tenant_id = :t "
                           "ORDER BY 1", t=tid)
        assert [tuple(x) for x in rows] == [("1000", u["steward"]), ("2000", u["other"])]
        held = dict(_sql(owner, "SELECT id::text, assigned_to::text FROM record_issues WHERE tenant_id = :t", t=tid))
        # the slice steward wins for its company code; the rest go to the object's owner
        assert held[issues[0]] == u["steward"] and held[issues[1]] == u["other"]
        assert held[issues[2]] == u["padmin"]
        assert _sql(owner, "SELECT count(*) FROM record_issue_events WHERE tenant_id = :t AND action = 'assign'",
                    t=tid)[0][0] == 3
        assert {r[0] for r in _sql(owner, "SELECT assigned_to::text FROM stewardship_queue WHERE tenant_id = :t",
                                   t=tid)} == {u["padmin"]}

        # the admin hands the queue items to the steward; the steward sees them in their own queue
        for q in (qa, qb):
            r = await c.put(f"/api/v1/stewardship/{q}/assign", json={"user_id": u["steward"]}, headers=admin)
            assert r.status_code == 200, r.text
        # assigning starts the work, so the items sit under in progress; "me" is the caller's own queue
        for who in (u["steward"], "me"):
            r = await c.get(f"/api/v1/stewardship?status=in_progress&assigned_to={who}", headers=steward)
            assert r.status_code == 200, r.text
            assert {i["id"] for i in r.json()["items"]} == {qa, qb}
        r = await c.get("/api/v1/stewardship?status=in_progress&assigned_to=me", headers={"x-test-uid": u["other"]})
        assert r.json()["items"] == []
        r = await c.get("/api/v1/stewardship?assigned_to=not-a-user", headers=steward)
        assert r.status_code == 422, r.text

        r = await c.put(f"/api/v1/stewardship/{qa}/resolve", json={"action": "approve", "notes": "checked"},
                        headers=steward)
        assert r.status_code == 200, r.text
        r = await c.put(f"/api/v1/stewardship/{qa}/resolve", json={"action": "approve"}, headers=steward)
        assert r.status_code == 409, r.text
        r = await c.put(f"/api/v1/stewardship/{qb}/escalate", headers=steward)
        assert r.status_code == 200 and r.json()["status"] == "escalated", r.text
        r = await c.put(f"/api/v1/stewardship/{qb}/resolve", json={"action": "approve"},
                        headers={"x-test-uid": u["viewer"]})
        assert r.status_code == 403, r.text

        r = await c.get("/api/v1/stewardship/metrics", headers=admin)
        assert r.status_code == 200, r.text
        # the shape the Stewardship screen's By steward table reads (user_id, name, open, resolved, overdue)
        mine = [s for s in r.json()["steward_breakdown"] if s["user_id"] == u["steward"]]
        assert mine, r.json()["steward_breakdown"]
        assert (mine[0]["name"], mine[0]["open"], mine[0]["resolved"], mine[0]["overdue"], mine[0]["total"]) == \
            ("steward", 1, 1, 0, 2), mine

        assert len(_audit(owner, tid, "assignment_template.update")) == 1
        applied = _audit(owner, tid, "assignment_template.apply")
        assert len(applied) == 1 and '"routed"' in applied[0][0]

    _serve(owner, monkeypatch, tid, scenario)

    # an issue found after Apply routes on the next sweep (the 5-minute SLA task calls the same function)
    from sqlalchemy.orm import Session

    from api.services.triage import auto_assign

    new = _sql(owner, "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, severity, "
                      "status, first_seen_version, last_seen_version) VALUES (:t, 'sys', 'accounts_payable', "
                      "'AP_LFA1_STCD1_NULL', 'LIFNR=100009|BUKRS=1000', 'LFA1', 'high', 'open', :v, :v) "
                      "RETURNING id", t=tid, v=vid)[0][0]
    with Session(owner) as s:
        s.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        assert auto_assign(s, tid)["issue"] == 1
        s.commit()
    assert _sql(owner, "SELECT assigned_to::text FROM record_issues WHERE id = :i", i=new)[0][0] == u["steward"]
