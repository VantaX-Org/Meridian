"""GET / PUT / DELETE /api/v1/views against a real Postgres: saved views with columns and density, plus built-ins."""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import USER, headers, make_client
from tests.m2_seed import seed_m2

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

OTHER = "00000000-0000-0000-0000-0000000000c9"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


async def start(monkeypatch, tid, sub=USER):
    deps, client = make_client(monkeypatch, tid, sub)
    await deps.engine.dispose()
    return client


@pytest.mark.anyio
async def test_builtin_views_per_route(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        for route, first in (("work", "My open work"), ("objects", "Held under 85"), ("rules", "Critical rules"),
                             ("runs", "Baseline runs"), ("people", "Approvers"), ("anything-else", "Everything")):
            r = await client.get("/api/v1/views", params={"route": route}, headers=headers())
            assert r.status_code == 200, r.text
            views = r.json()["views"]
            assert r.json()["route"] == route
            built = [v for v in views if v["builtin"]]
            assert len(built) == 3 and built[0]["name"] == first and views[:3] == built
            assert all(v["id"].startswith(f"builtin:{route}:") and v["created_at"] is None and v["columns"] is None
                       and v["density"] in ("compact", "comfortable") for v in built)
        assert (await client.get("/api/v1/views", headers=headers())).status_code == 422  # route is required


@pytest.mark.anyio
async def test_put_upserts_by_route_and_name(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        body = {"route": "work", "name": "Plant 3000", "filters": {"module": "material_master", "q": "3000"},
                "columns": ["record", "check", "current_value", "new_value"], "density": "compact"}
        a = await client.put("/api/v1/views", json=body, headers=headers())
        assert a.status_code == 200, a.text
        first = a.json()
        assert first["builtin"] is False and first["columns"] == body["columns"] and first["density"] == "compact"
        assert first["filters"] == body["filters"] and uuid.UUID(first["id"]) and first["created_at"]

        # the same route and name replaces filters, columns and density in place
        b = await client.put("/api/v1/views", json={**body, "columns": ["record"], "density": "comfortable", "filters": {}},
                             headers=headers())
        assert b.json()["id"] == first["id"] and b.json()["columns"] == ["record"] and b.json()["density"] == "comfortable"
        assert b.json()["filters"] == {}
        # a view without columns or density stores null (the page's defaults)
        c = await client.put("/api/v1/views", json={"route": "work", "name": "Defaults"}, headers=headers())
        assert c.json()["columns"] is None and c.json()["density"] is None

        listed = (await client.get("/api/v1/views", params={"route": "work"}, headers=headers())).json()["views"]
        mine = [v for v in listed if not v["builtin"]]
        assert [v["name"] for v in mine] == ["Defaults", "Plant 3000"] and len(listed) == 5
        with owner.begin() as conn:
            assert conn.execute(text("SELECT count(*) FROM saved_views WHERE tenant_id = :t AND route = 'work'"), {"t": s["tid"]}).scalar() == 2
        # the same name on another route is another view
        d = await client.put("/api/v1/views", json={**body, "route": "objects"}, headers=headers())
        assert d.json()["id"] != first["id"]

        assert (await client.put("/api/v1/views", json={**body, "density": "tiny"}, headers=headers())).status_code == 422
        assert (await client.put("/api/v1/views", json={**body, "name": "  "}, headers=headers())).status_code == 422
        clash = await client.put("/api/v1/views", json={"route": "work", "name": "my open work"}, headers=headers())
        assert clash.status_code == 409 and "built-in" in clash.json()["detail"]


@pytest.mark.anyio
async def test_delete_and_isolation(owner, monkeypatch):
    s, t2 = seed_m2(owner), seed_m2(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        v = (await client.put("/api/v1/views", json={"route": "rules", "name": "Mine", "columns": ["id"]}, headers=headers())).json()
        # another user of the same tenant neither sees nor deletes it
    other = await start(monkeypatch, s["tid"], sub=OTHER)
    async with other:
        assert [x for x in (await other.get("/api/v1/views", params={"route": "rules"}, headers=headers())).json()["views"]
                if not x["builtin"]] == []
        assert (await other.delete(f"/api/v1/views/{v['id']}", headers=headers())).status_code == 404
    # nor does another tenant
    foreign = await start(monkeypatch, t2["tid"])
    async with foreign:
        assert [x for x in (await foreign.get("/api/v1/views", params={"route": "rules"}, headers=headers())).json()["views"]
                if not x["builtin"]] == []
        assert (await foreign.delete(f"/api/v1/views/{v['id']}", headers=headers())).status_code == 404
    client = await start(monkeypatch, s["tid"])
    async with client:
        assert (await client.delete("/api/v1/views/builtin:rules:critical-rules", headers=headers())).status_code == 409
        assert (await client.delete("/api/v1/views/not-an-id", headers=headers())).status_code == 404
        assert (await client.delete(f"/api/v1/views/{v['id']}", headers=headers())).status_code == 204
        assert (await client.delete(f"/api/v1/views/{v['id']}", headers=headers())).status_code == 404
        assert [x for x in (await client.get("/api/v1/views", params={"route": "rules"}, headers=headers())).json()["views"]
                if not x["builtin"]] == []
