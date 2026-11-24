"""A data steward runs a team inside Meridian, against a real Postgres.

A steward who leads a team may rename it, change who is on it and delete it; a steward who does not lead it gets
403; an administrator may change any team and name any lead. A steward creating a team leads it. The team's queue
shows the items held by its lead and members as well as the items queued to the team, and the workload route
counts each person's open, overdue and recently resolved items.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import Engine

from tests.test_rbac_escalation_pg import _grant, _tenant, owner, pytestmark  # noqa: F401  (owner is a fixture)
from tests.test_steward_lifecycle_pg import _seed, _sql

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from httpx import AsyncClient


def _serve(owner: Engine, monkeypatch: pytest.MonkeyPatch, tid: str,
           scenario: Callable[[AsyncClient], Awaitable[None]]) -> None:
    """The triage router over the real database; x-test-uid is the caller."""
    import asyncio

    from fastapi import FastAPI, Request
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from starlette.middleware.base import BaseHTTPMiddleware

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.triage import router

    import api.middleware.cache as cache

    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)
    monkeypatch.setattr(cache, "_memo", {})
    monkeypatch.setattr("api.routes.licence.get_cached_manifest", lambda: {})
    aeng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    async def _as_user(request: Request, call_next):
        request.state.local_user_id = request.headers.get("x-test-uid")
        return await call_next(request)

    api = FastAPI()
    api.include_router(router)
    api.add_middleware(BaseHTTPMiddleware, dispatch=_as_user)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Teams", [])

    async def main() -> None:
        try:
            async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as c:
                await scenario(c)
        finally:
            await aeng.dispose()

    asyncio.run(main())


def _people(owner: Engine) -> tuple[str, dict[str, str]]:
    roles = {"padmin": "platform_admin", "lead": "data_steward", "other": "data_steward", "ann": "analyst",
             "bob": "analyst"}
    tid, u = _tenant(owner, roles)
    for name, role in roles.items():
        _grant(owner, tid, u[name], role)
    return tid, u


def test_only_the_lead_or_an_admin_changes_a_team(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _people(owner)

    async def scenario(c: AsyncClient) -> None:
        admin, lead, other = ({"x-test-uid": u[k]} for k in ("padmin", "lead", "other"))
        # a steward creating a team leads it and may not name someone else
        r = await c.post("/api/v1/triage/teams", json={"name": "Vendors", "lead_user_id": u["other"]}, headers=lead)
        assert r.status_code == 403, r.text
        r = await c.post("/api/v1/triage/teams", json={"name": "Vendors", "member_ids": [u["ann"]]}, headers=lead)
        assert r.status_code == 201 and r.json()["lead_user_id"] == u["lead"], r.text
        team = r.json()["id"]

        # a steward who does not lead it is refused everything
        for call in (c.patch(f"/api/v1/triage/teams/{team}", json={"name": "Mine"}, headers=other),
                     c.put(f"/api/v1/triage/teams/{team}/members", json={"user_ids": []}, headers=other),
                     c.delete(f"/api/v1/triage/teams/{team}", headers=other)):
            r = await call
            assert r.status_code == 403, r.text
        r = await c.patch(f"/api/v1/triage/teams/{uuid.uuid4()}", json={"name": "x"}, headers=other)
        assert r.status_code == 404, r.text

        # the lead manages the people on it, but cannot hand the lead to someone else
        r = await c.put(f"/api/v1/triage/teams/{team}/members", json={"user_ids": [u["ann"], u["bob"]]}, headers=lead)
        assert r.status_code == 200 and sorted(r.json()["member_ids"]) == sorted([u["ann"], u["bob"]]), r.text
        r = await c.patch(f"/api/v1/triage/teams/{team}", json={"lead_user_id": u["other"]}, headers=lead)
        assert r.status_code == 403, r.text
        r = await c.patch(f"/api/v1/triage/teams/{team}", json={"strategy": "least_loaded"}, headers=lead)
        assert r.status_code == 200 and r.json()["strategy"] == "least_loaded", r.text

        # the admin may name any lead and change any team
        r = await c.patch(f"/api/v1/triage/teams/{team}", json={"lead_user_id": u["other"]}, headers=admin)
        assert r.status_code == 200 and r.json()["lead_user_id"] == u["other"], r.text
        r = await c.post("/api/v1/triage/teams", json={"name": "Customers", "lead_user_id": u["lead"]},
                         headers=admin)
        assert r.status_code == 201 and r.json()["lead_user_id"] == u["lead"], r.text
        r = await c.delete(f"/api/v1/triage/teams/{team}", headers=lead)  # no longer the lead
        assert r.status_code == 403, r.text
        r = await c.delete(f"/api/v1/triage/teams/{team}", headers=other)  # the new lead
        assert r.status_code == 204, r.text

    _serve(owner, monkeypatch, tid, scenario)


def test_team_queue_and_workload_cover_the_members(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _people(owner)
    _vid, issues, qa, qb = _seed(owner, tid)
    team = str(_sql(owner, "INSERT INTO triage_teams (tenant_id, name, lead_user_id) VALUES (:t, 'AP', :l) "
                           "RETURNING id", t=tid, l=u["lead"])[0][0])
    _sql(owner, "INSERT INTO triage_team_members (tenant_id, team_id, user_id) VALUES (:t, :m, :a)",
         t=tid, m=team, a=u["ann"])
    # ann holds an overdue issue and a task resolved yesterday; the lead holds one issue; one issue is queued to the
    # team; bob (not on the team) holds a task
    _sql(owner, "UPDATE record_issues SET assigned_to = :a, due_at = now() - interval '1 day' WHERE id = :i",
         a=u["ann"], i=issues[0])
    _sql(owner, "UPDATE record_issues SET assigned_to = :a WHERE id = :i", a=u["lead"], i=issues[1])
    _sql(owner, "UPDATE record_issues SET assigned_team_id = :m WHERE id = :i", m=team, i=issues[2])
    _sql(owner, "UPDATE stewardship_queue SET assigned_to = :a, status = 'resolved', resolved_at = now() - "
                "interval '1 day' WHERE id = :i", a=u["ann"], i=qa)
    _sql(owner, "UPDATE stewardship_queue SET assigned_to = :a WHERE id = :i", a=u["bob"], i=qb)

    async def scenario(c: AsyncClient) -> None:
        lead = {"x-test-uid": u["lead"]}
        r = await c.get(f"/api/v1/triage/queue?assignee=team:{team}", headers=lead)
        assert r.status_code == 200, r.text
        body = r.json()
        ids = {i["id"] for b in ("overdue", "due_today", "later") for i in body[b]["items"]}
        assert ids == set(issues), body  # bob's task and ann's resolved task are not the team's open work
        assert [i["id"] for i in body["overdue"]["items"]] == [issues[0]]

        r = await c.get(f"/api/v1/triage/teams/{team}/workload", headers=lead)
        assert r.status_code == 200, r.text
        got = {w["user_id"]: (w["is_lead"], w["open"], w["overdue"], w["resolved_7d"]) for w in r.json()}
        assert got == {u["lead"]: (True, 1, 0, 0), u["ann"]: (False, 1, 1, 1)}, r.json()
        assert r.json()[0]["user_id"] == u["lead"]  # the lead comes first
        r = await c.get(f"/api/v1/triage/teams/{uuid.uuid4()}/workload", headers=lead)
        assert r.status_code == 404, r.text

    _serve(owner, monkeypatch, tid, scenario)
