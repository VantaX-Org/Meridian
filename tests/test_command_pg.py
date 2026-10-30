"""GET /api/v1/command against a real Postgres: records by key prefix, rules by id, objects, runs, people, and the
Actions group gated by what the caller may do. Seed: tests/landscape_seed.py."""
from __future__ import annotations

import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine

from tests.landscape_seed import seed

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

ADMIN = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
VIEWER = {"X-User-Role": "viewer", "Authorization": "Bearer test-token"}
USER = "00000000-0000-0000-0000-0000000000b7"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


@pytest.fixture
def seeded(owner):
    return seed(owner)


@pytest.fixture
def client_for(monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    def make(tid):
        monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
        monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                            lambda token, secret: {"sub": USER, "email": "lead@example.com", "role": "admin"})
        monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
        monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
        return api_deps, AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    return make


async def _cmd(client, q, headers=ADMIN, **params):
    r = await client.get("/api/v1/command", params={"q": q, **params}, headers=headers)
    assert r.status_code == 200, r.text
    return {g["kind"]: g for g in r.json()["groups"]}


@pytest.mark.anyio
async def test_records_rules_objects_runs_people(seeded, client_for):
    deps, client = client_for(seeded["tid"])
    await deps.engine.dispose()
    async with client:
        # a record by the start of its key, as typed with or without the leading zeros, and by name
        for q in ("MATNR=0000000000000001", "101", "hex bolt"):
            g = await _cmd(client, q)
            ids = [i["id"] for i in g["record"]["items"]]
            assert "material_master:MATNR=000000000000000101|WERKS=3000" in ids, q
        item = (await _cmd(client, "101"))["record"]["items"][0]
        assert item["title"] == "Material master 000000000000000101, Hex bolt M8 zinc"
        assert item["href"] == "/o/ecc-production/material-master?open=record:material_master:MATNR=000000000000000101|WERKS=3000"
        assert "record" not in await _cmd(client, "zzz-nothing")

        # rules by check_id prefix and by name
        g = await _cmd(client, "MM0")
        assert [i["id"] for i in g["rule"]["items"]] == ["MM014", "MM031"]
        assert g["rule"]["items"][0] == {"id": "MM014", "title": "MM014 Base unit of measure not valid", "href": "/r/MM014"}
        assert [i["id"] for i in (await _cmd(client, "group missing"))["rule"]["items"]] == ["MM031"]

        # objects by label, runs by label, people by name
        g = await _cmd(client, "material")
        assert g["object"]["items"] == [{"id": "material_master", "title": "Material master",
                                         "href": "/o/ecc-production/material-master"}]
        g = await _cmd(client, "ECC production")
        assert g["run"]["items"][0]["id"] == seeded["run"] and g["run"]["items"][0]["href"] == f"/run/{seeded['run']}"
        g = await _cmd(client, "ann")
        assert g["person"]["items"] == [{"id": seeded["user"], "title": "Ann Steward", "href": f"/people?open=person:{seeded['user']}"}]

        # limit caps the items over all groups
        total = lambda groups: sum(len(x["items"]) for x in groups.values())
        assert total(await _cmd(client, "m", limit=1)) == 1


@pytest.mark.anyio
async def test_actions_are_gated_by_permission(seeded, client_for):
    deps, client = client_for(seeded["tid"])
    await deps.engine.dispose()
    async with client:
        g = await _cmd(client, "approve")
        assert [i["title"] for i in g["action"]["items"]] == ["Approvals waiting 1"]
        assert g["action"]["items"][0]["href"] == "/work?filter=approvals"
        assert [i["title"] for i in (await _cmd(client, "export"))["action"]["items"]] == ["Export fix sheet"]
        assert [i["title"] for i in (await _cmd(client, "extract"))["action"]["items"]] == ["Extract ECC production", "Extract Spare system"]
        assert [i["title"] for i in (await _cmd(client, "extract spare"))["action"]["items"]] == ["Extract Spare system"]

        # a viewer can search, but is offered no action
        for q in ("approve", "export", "extract"):
            assert "action" not in await _cmd(client, q, headers=VIEWER)
        assert "rule" in await _cmd(client, "MM0", headers=VIEWER)
        # an analyst may export and extract, not approve
        analyst = {"X-User-Role": "analyst", "Authorization": "Bearer test-token"}
        assert "action" not in await _cmd(client, "approve", headers=analyst)
        assert "action" in await _cmd(client, "export", headers=analyst)


@pytest.mark.anyio
async def test_other_tenant_gets_none_of_it(seeded, owner, client_for):
    other = seed(owner, with_run=False)
    deps, client = client_for(other["tid"])
    await deps.engine.dispose()
    async with client:
        for q in ("101", "hex bolt", "MM0", "material", "ECC production", "ann", "MATNR="):
            g = await _cmd(client, q)
            assert not {"record", "rule", "object", "run"} & set(g), q
            assert all(i["id"] != seeded["user"] for i in g.get("person", {"items": []})["items"])
        # its own systems and people are its own
        assert [i["id"] for i in (await _cmd(client, "ann"))["person"]["items"]] == [other["user"]]
        titles = [i["title"] for i in (await _cmd(client, "extract"))["action"]["items"]]
        assert titles == ["Extract ECC production", "Extract Spare system"]
        ids = [i["href"] for i in (await _cmd(client, "extract"))["action"]["items"]]
        assert all(seeded["ecc"] not in h and seeded["spare"] not in h for h in ids)
        assert (await _cmd(client, "approve"))["action"]["items"][0]["title"] == "Approvals waiting 0"
