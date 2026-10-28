"""manage_triage: who may edit triage teams, assignment rules and SLA policies, and who may not touch the
tenant clock (business hours, holidays, fallback owner).

programme_lead and data_steward (persona roles) hold manage_triage; admin holds it with everything else; the
legacy steward keeps the access manage_rules gave it; the legacy manager and everyone below do not have it.
PUT /triage/settings stays manage_settings, so only an admin changes business hours.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

import pytest

from api.services.rbac import LEGACY_ACTION_MAP, PERMISSIONS, PERSONA_ROLES, has_permission, legacy_actions_for_pairs
from tests.test_rbac_escalation_pg import _grant, _tenant, owner, pytestmark  # noqa: F401

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy import Engine


def test_manage_triage_belongs_to_the_two_personas_and_admin_only() -> None:
    assert LEGACY_ACTION_MAP["manage_triage"] == {("stewardship", "admin")}
    holders = {r for r in (*PERMISSIONS, *PERSONA_ROLES) if has_permission(r, "manage_triage")}
    assert holders == {"programme_lead", "data_steward", "admin", "platform_admin"}
    for legacy in ("manager", "steward"):  # legacy keys are unchanged
        assert not has_permission(legacy, "manage_triage")
    assert "manage_triage" in legacy_actions_for_pairs({("stewardship", "admin")})
    assert "manage_triage" not in legacy_actions_for_pairs({("stewardship", "edit")})


def _serve(owner: Engine, monkeypatch: pytest.MonkeyPatch, tid: str,
           scenario: Callable[[AsyncClient], Awaitable[None]]) -> None:
    import asyncio

    from fastapi import FastAPI, Request
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from starlette.middleware.base import BaseHTTPMiddleware

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.triage import router

    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)
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
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Triage", [])

    async def main() -> None:
        try:
            async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as c:
                await scenario(c)
        finally:
            await aeng.dispose()

    asyncio.run(main())


ROLES = {"lead": "programme_lead", "steward": "data_steward", "admin": "platform_admin", "old_steward": "steward",
         "old_manager": "manager", "analyst": "analyst", "viewer": "viewer", "basis": "sap_basis"}


def test_programme_lead_edits_teams_rules_and_slas_but_not_business_hours(owner: Engine,
                                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _tenant(owner, ROLES)
    for n, role in ROLES.items():
        _grant(owner, tid, u[n], role)
    settings = {"timezone": "Europe/Berlin", "work_days": [1, 2, 3], "work_start": "09:00:00",
                "work_end": "16:00:00", "holidays": ["2027-01-01"]}

    async def scenario(c: AsyncClient) -> None:
        def as_(who: str) -> dict[str, str]:
            return {"x-test-uid": u[who]}

        async def can_edit(who: str, tag: str) -> bool:
            """True when teams, rules and SLA policies all accept `who`; the three agree or the test fails."""
            team = await c.post("/api/v1/triage/teams", json={"name": f"{tag}-team"}, headers=as_(who))
            rule = await c.post("/api/v1/triage/rules", headers=as_(who), json={
                "name": f"{tag}-rule", "match": {"module": ["fi_gl"]}, "assign_user_id": u["steward"]})
            sla = await c.put("/api/v1/triage/sla-policies", headers=as_(who), json={
                "severity": "high", "module": f"{tag}-mod", "resolve_minutes": 600})
            codes = {team.status_code, rule.status_code, sla.status_code}
            assert codes <= {200, 201} or codes == {403}, (who, [team.text, rule.text, sla.text])
            return 403 not in codes

        for who in ("lead", "steward", "admin", "old_steward"):
            assert await can_edit(who, who), who
        for who in ("old_manager", "analyst", "viewer", "basis"):
            assert not await can_edit(who, who), who

        # the lead can also change and remove what they made
        team = (await c.post("/api/v1/triage/teams", json={"name": "lead-2"}, headers=as_("lead"))).json()
        assert (await c.patch(f"/api/v1/triage/teams/{team['id']}", json={"name": "lead-3"}, headers=as_("lead"))).status_code == 200
        assert (await c.put(f"/api/v1/triage/teams/{team['id']}/members", json={"user_ids": [u["steward"]]},
                            headers=as_("lead"))).status_code == 200
        rules = (await c.get("/api/v1/triage/rules", headers=as_("lead"))).json()
        assert (await c.post("/api/v1/triage/rules/reorder", json={"ids": [r["id"] for r in rules]}, headers=as_("lead"))).status_code == 200
        assert (await c.delete(f"/api/v1/triage/rules/{rules[0]['id']}", headers=as_("lead"))).status_code == 204
        policies = [p for p in (await c.get("/api/v1/triage/sla-policies", headers=as_("lead"))).json() if p["id"]]
        assert (await c.delete(f"/api/v1/triage/sla-policies/{policies[0]['id']}", headers=as_("lead"))).status_code == 204
        assert (await c.delete(f"/api/v1/triage/teams/{team['id']}", headers=as_("lead"))).status_code == 204

        # business hours, holidays and the fallback owner (the tenant clock) stay manage_settings
        for who in ("lead", "steward", "old_steward", "old_manager", "viewer"):
            r = await c.put("/api/v1/triage/settings", json=settings, headers=as_(who))
            assert r.status_code == 403, (who, r.text)
        assert (await c.put("/api/v1/triage/settings", json=settings, headers=as_("admin"))).status_code == 200
        assert (await c.get("/api/v1/triage/settings", headers=as_("lead"))).json()["timezone"] == "Europe/Berlin"

        # the unauthenticated and the unknown get nothing
        assert (await c.post("/api/v1/triage/teams", json={"name": "x"})).status_code == 403

    _serve(owner, monkeypatch, tid, scenario)


def test_a_custom_role_with_stewardship_admin_edits_triage_not_settings(owner: Engine,
                                                                        monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.test_rbac_escalation_pg import _seed_custom

    tid, u = _tenant(owner, {"ops": "viewer"})
    _seed_custom(owner, tid, "custom:triage-ops", {("stewardship", "admin"), ("findings", "view")})
    _grant(owner, tid, u["ops"], "custom:triage-ops")

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["ops"]}
        assert (await c.post("/api/v1/triage/teams", json={"name": "ops"}, headers=h)).status_code == 201
        assert (await c.put("/api/v1/triage/settings", json={}, headers=h)).status_code == 403

    _serve(owner, monkeypatch, tid, scenario)
