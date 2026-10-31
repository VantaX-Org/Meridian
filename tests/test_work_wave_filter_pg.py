"""F14: Work narrows to a migration wave's objects (``wave``) and to the objects of a landscape verdict
(``verdict``), so the lead's "Clear the 3 no-go objects in Wave 1" opens those objects only."""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_seed import seed_m2

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def wave(owner, s, name, modules, source=None):
    with owner.begin() as c:
        return c.execute(text("INSERT INTO migration_waves (tenant_id, name, modules, source_system_id) "
                              "VALUES (:t, :n, :m, :s) RETURNING id::text"),
                         {"t": s["tid"], "n": name, "m": modules, "s": source}).scalar()


@pytest.mark.anyio
async def test_wave_and_verdict_narrow_the_records_and_the_summary(owner, monkeypatch):
    s = seed_m2(owner)
    w_mm = wave(owner, s, "Wave 1", ["material_master"], s["ecc"])
    w_gl = wave(owner, s, "Wave 2", ["fi_gl"])
    deps, client = make_client(monkeypatch, s["tid"], s["user"])
    await deps.engine.dispose()
    async with client:
        every = (await client.get("/api/v1/work/records?status=all&limit=500", headers=headers())).json()
        assert every["wave"] is None
        r = await client.get(f"/api/v1/work/records?status=all&limit=500&wave={w_mm}", headers=headers())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["items"] and {i["module"] for i in body["items"]} == {"material_master"}
        assert body["wave"]["name"] == "Wave 1" and body["wave"]["verdict"] is None
        assert body["wave"]["objects"] == [{"system_id": s["ecc"], "module": "material_master"}]
        mm_total = body["total"]
        gl = (await client.get(f"/api/v1/work/records?status=all&wave={w_gl}", headers=headers())).json()
        assert all(i["module"] == "fi_gl" for i in gl["items"]) and gl["total"] + mm_total <= every["total"]

        # the verdict is the landscape's: the wave's objects with that verdict, nothing else
        land = (await client.get("/api/v1/landscape", headers=headers())).json()
        mm_cell = next(c for c in land["cells"] if c["module"] == "material_master" and c["system_id"] == s["ecc"])
        v = mm_cell["verdict"]
        same = (await client.get(f"/api/v1/work/records?status=all&wave={w_mm}&verdict={v}", headers=headers())).json()
        assert same["total"] == mm_total and same["wave"]["verdict"] == v
        other = "go" if v != "go" else "no-go"
        none = (await client.get(f"/api/v1/work/records?status=all&wave={w_mm}&verdict={other}", headers=headers())).json()
        assert none["total"] == 0 and none["items"] == [] and none["wave"]["objects"] == []
        # verdict alone: every object of the landscape with it
        alone = (await client.get(f"/api/v1/work/records?status=all&verdict={v}&limit=500", headers=headers())).json()
        cells_v = {(c["system_id"], c["module"]) for c in land["cells"] if c["verdict"] == v}
        assert {(o["system_id"], o["module"]) for o in alone["wave"]["objects"]} == cells_v

        summ = (await client.get(f"/api/v1/work/summary?wave={w_mm}", headers=headers())).json()
        assert [o["module"] for o in summ["objects"]] == ["material_master"] and summ["wave"]["name"] == "Wave 1"
        sheet = await client.get(f"/api/v1/work/export?status=all&wave={w_gl}", headers=headers())
        assert sheet.status_code == 200

        missing = await client.get(f"/api/v1/work/records?wave={uuid.uuid4()}", headers=headers())
        assert missing.status_code == 404
        bad = await client.get("/api/v1/work/records?verdict=maybe", headers=headers())
        assert bad.status_code == 422
