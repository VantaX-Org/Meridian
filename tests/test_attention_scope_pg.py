"""GET /api/v1/attention and /attention/count: what each viewer sees (api/services/attention.py ``visible_to``).

The tenant list is built once (and cached); each caller then gets the items whose required action they hold at the
item's scope. The fixture is tests/test_attention_pg.py's "full" tenant, where every kind fires once:

  admin            everything, admin items included
  steward          users.role viewer + a steward grant on material_master: that object's actionable items only, never
                   admin items, never system items; their own fix batch is not theirs to approve. The informational
                   No-go item needs a grant covering the object, so only their own object's shows.
  scoped admin     the admin role on one object: still no admin items (those need tenant-wide manage_users)
  system manager   manager on one system: that system's connection and no-go, nothing from other systems
  viewer           read only: the informational no-go item and nothing else
"""
from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from tests.test_attention_pg import add_user, full, owner, stubs  # noqa: F401  (fixtures)

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

ADMIN_KINDS = {"access_requests", "invites_pending", "seats", "grants_expiring", "dormant_users"}
MM = "material_master"


def serve(owner, monkeypatch, tid: str, scenario: Callable[[AsyncClient], Awaitable[None]]) -> None:
    from fastapi import FastAPI, Request
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
    from starlette.responses import Response

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import attention as route

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
    api.include_router(route.router)
    api.add_middleware(BaseHTTPMiddleware, dispatch=_as_user)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Attn", [])

    async def main() -> None:
        try:
            async with AsyncClient(transport=ASGITransport(app=api), base_url="http://test") as c:
                await scenario(c)
        finally:
            await aeng.dispose()

    asyncio.run(main())


def kinds(body: dict) -> set[str]:
    return {i["kind"] for i in body["items"]}


def test_admin_sees_everything_and_the_response_shape(owner, full, monkeypatch):
    async def scenario(c: AsyncClient) -> None:
        r = await c.get("/api/v1/attention", headers={"x-test-uid": full["admin"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"items", "generated_at", "counts"}
        assert set(body["counts"]) == {"critical", "high", "medium", "low"}
        assert ADMIN_KINDS <= kinds(body) and {"connection", "regression", "approvals", "job_failed"} <= kinds(body)
        assert sum(body["counts"].values()) == len(body["items"])
        approvals = [i for i in body["items"] if i["kind"] == "approvals"]
        assert sorted(i["count"] for i in approvals) == [1, 1]  # the batch (made by the steward) and the golden request
        first = body["items"][0]
        assert set(first) == {"id", "kind", "tier", "severity", "title", "detail", "href", "action_label", "count",
                              "object", "system_id", "system_name", "module", "since", "required_action"}
        assert (first["tier"], first["severity"]) == (1, "critical")

        n = (await c.get("/api/v1/attention/count", headers={"x-test-uid": full["admin"]})).json()
        assert set(n) == {"critical", "high", "medium", "low", "top"}
        assert (n["critical"], n["high"], n["medium"], n["low"]) == tuple(body["counts"][s] for s in
                                                                         ("critical", "high", "medium", "low"))
        assert n["top"]["id"] == first["id"]

    serve(owner, monkeypatch, full["tid"], scenario)


def test_module_scoped_steward_sees_only_their_module_and_never_admin_items(owner, full, monkeypatch):
    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": full["steward"]}
        body = (await c.get("/api/v1/attention", headers=h)).json()
        # regression, overdue records and the inbox breach of Material master; no approvals (their own batch),
        # no system items (connection, jobs, schedules need a system scope), no other object's work, no admin item;
        assert kinds(body) == {"regression", "overdue_records", "sla_breach"}  # No-go is business_partner's
        assert {i["module"] for i in body["items"]} == {MM}
        assert not kinds(body) & ADMIN_KINDS
        assert body["counts"] == {"critical": 1, "high": 1, "medium": 1, "low": 0}

        n = (await c.get("/api/v1/attention/count", headers=h)).json()
        assert (n["critical"], n["high"], n["medium"], n["low"]) == (1, 1, 1, 0) and n["top"]["kind"] == "regression"

        # the cache is shared, the answer is not: the admin still sees everything afterwards
        admin = (await c.get("/api/v1/attention", headers={"x-test-uid": full["admin"]})).json()
        assert len(admin["items"]) > len(body["items"]) and ADMIN_KINDS <= kinds(admin)

    serve(owner, monkeypatch, full["tid"], scenario)


def test_admin_role_on_one_object_does_not_unlock_admin_or_system_items(owner, full, monkeypatch):
    with owner.begin() as c:
        uid = add_user(c, full["tid"], "scopedadmin", "viewer")
        c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key, module) "
                       "VALUES (:t, :u, 'admin', :m)"), {"t": full["tid"], "u": uid, "m": MM})

    async def scenario(c: AsyncClient) -> None:
        body = (await c.get("/api/v1/attention", headers={"x-test-uid": uid})).json()
        assert {i["module"] for i in body["items"]} == {MM}
        assert not kinds(body) & ADMIN_KINDS and "connection" not in kinds(body) and "job_failed" not in kinds(body)
        assert {"regression", "approvals", "sla_breach", "overdue_records"} <= kinds(body)  # approve is theirs here
        # the same module-scoped approval the steward made: the viewer is not its requester, so it shows with count 1
        assert [i["count"] for i in body["items"] if i["kind"] == "approvals"] == [1]

    serve(owner, monkeypatch, full["tid"], scenario)


def test_system_scoped_manager_sees_that_system_only(owner, full, monkeypatch):
    with owner.begin() as c:
        uid = add_user(c, full["tid"], "sysmanager", "viewer")
        c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key, system_id) "
                       "VALUES (:t, :u, 'manager', :s)"), {"t": full["tid"], "u": uid, "s": full["bad"]})

    async def scenario(c: AsyncClient) -> None:
        body = (await c.get("/api/v1/attention", headers={"x-test-uid": uid})).json()
        assert kinds(body) == {"connection", "object_no_go"}
        assert {i["system_id"] for i in body["items"]} == {full["bad"]}

    serve(owner, monkeypatch, full["tid"], scenario)


def test_viewer_sees_informational_items_only(owner, full, monkeypatch):
    with owner.begin() as c:
        uid = add_user(c, full["tid"], "plainviewer", "viewer")

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": uid}
        body = (await c.get("/api/v1/attention", headers=h)).json()
        assert kinds(body) == {"object_no_go"} and all(i["tier"] == 4 for i in body["items"])
        assert [i["module"] for i in body["items"]] == ["business_partner"]
        n = (await c.get("/api/v1/attention/count", headers=h)).json()
        assert (n["critical"], n["high"]) == (0, 0) and n["top"]["kind"] == "object_no_go"

    serve(owner, monkeypatch, full["tid"], scenario)


def test_query_filters_and_limit(owner, full, monkeypatch):
    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": full["admin"]}
        get = lambda **q: c.get("/api/v1/attention", params=q, headers=h)  # noqa: E731
        by_kind = (await get(kinds="sla_breach,regression")).json()
        assert kinds(by_kind) == {"sla_breach", "regression"} and len(by_kind["items"]) == 2
        by_object = (await get(object=MM)).json()
        assert by_object["items"] and {i["module"] for i in by_object["items"]} == {MM}
        by_system = (await get(system_id=full["bad"])).json()
        assert by_system["items"] and {i["system_id"] for i in by_system["items"]} == {full["bad"]}
        limited = (await get(limit=3)).json()
        full_list = (await get()).json()
        assert [i["id"] for i in limited["items"]] == [i["id"] for i in full_list["items"][:3]]
        assert limited["counts"] == full_list["counts"]  # counts cover every item, not the page
        assert (await get(limit=0)).status_code == 422

    serve(owner, monkeypatch, full["tid"], scenario)


def test_a_user_without_view_is_refused(owner, full, monkeypatch):
    async def scenario(c: AsyncClient) -> None:
        assert (await c.get("/api/v1/attention", headers={"x-test-uid": str(uuid.uuid4())})).status_code == 403

    serve(owner, monkeypatch, full["tid"], scenario)


def test_tenant_wide_viewer_sees_no_go_for_every_object(owner, full, monkeypatch):
    with owner.begin() as c:
        uid = add_user(c, full["tid"], "wideviewer", "viewer")
        from tests.test_attention_pg import run_version
        sid = full["mm"]
        v = run_version(c, full["tid"], __import__("datetime").datetime.now(__import__("datetime").timezone.utc), sid,
                        "fi_gl", score=30.0)
        c.execute(text("UPDATE analysis_versions SET metadata = metadata || '{\"system_id\": \"%s\"}' WHERE id = :v" % sid), {"v": v})

    async def scenario(c: AsyncClient) -> None:
        body = (await c.get("/api/v1/attention", headers={"x-test-uid": uid})).json()
        assert {i["module"] for i in body["items"] if i["kind"] == "object_no_go"} >= {"business_partner", "fi_gl"}
        assert kinds(body) == {"object_no_go"}

    serve(owner, monkeypatch, full["tid"], scenario)
