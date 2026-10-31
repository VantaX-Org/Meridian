"""F16: a wave has one score threshold. The Readiness grid, the wave cockpit and the gate read the same stored
number: the gate's minimum score when it sets one, else the wave's min_dqs, else the tenant's readiness threshold."""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import text

from api.services.wave_gate import wave_threshold
from tests import workflow_seed as seed
from tests.m2_client import make_client

H = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


def test_the_gate_decides_then_the_wave_then_the_tenant():
    assert wave_threshold(85.0, 70.0, 75.0) == 85.0
    assert wave_threshold(None, 70.0, 75.0) == 70.0
    assert wave_threshold(None, None, 75.0) == 75.0
    assert wave_threshold(None, None) is None


@pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")
@pytest.mark.anyio
async def test_readiness_cockpit_and_gate_read_the_same_number(monkeypatch):
    eng = seed.engine()
    w = seed.seed_tenant(eng)
    w1, w2 = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        with seed.tenant_conn(eng, w["tid"]) as c:
            for wid, name, mod in ((w1, "Wave 1", "fi_gl"), (w2, "Wave 2", "material_master")):
                c.execute(text("INSERT INTO migration_waves (id, tenant_id, name, modules) VALUES (:w, :t, :n, :m)"),
                          {"w": wid, "t": w["tid"], "n": name, "m": [mod]})
            c.execute(text("INSERT INTO wave_gates (wave_id, tenant_id, min_score) VALUES (:w, :t, 85)"),
                      {"w": w1, "t": w["tid"]})
        deps, client = make_client(monkeypatch, w["tid"], w["admin"])
        await deps.engine.dispose()
        async with client:
            r = (await client.get("/api/v1/insights/readiness", headers=H)).json()
            assert r["thresholds"] == {"Wave 1": 85.0, "Wave 2": 75.0} and r["threshold"] is None
            assert {c["wave"]: c["threshold"] for c in r["cells"]} == {"Wave 1": 85.0, "Wave 2": 75.0}
            cockpit = (await client.get(f"/api/v1/migration/waves/{w1}/cockpit", headers=H)).json()
            assert cockpit["threshold"] == 85.0
            gates = {g["wave_id"]: g for g in (await client.get("/api/v1/migration/waves/gates", headers=H)).json()["gates"]}
            assert gates[w1]["gate"]["min_score"] == 85.0
            assert gates[w1]["status"]["checks"][0]["label"] == "Every object at 85.0 or more"
            listed = {x["id"]: x for x in (await client.get("/api/v1/migration/waves", headers=H)).json()["waves"]}
            assert str(listed[w1]["id"]) == w1
            with seed.tenant_conn(eng, w["tid"]) as c:
                c.execute(text("INSERT INTO wave_gates (wave_id, tenant_id, min_score) VALUES (:w, :t, 85)"),
                          {"w": w2, "t": w["tid"]})
            r = (await client.get("/api/v1/insights/readiness", headers=H)).json()
            assert r["threshold"] == 85.0
    finally:
        with seed.tenant_conn(eng, w["tid"]) as c:
            c.execute(text("DELETE FROM wave_gates WHERE tenant_id = :t"), {"t": w["tid"]})
            c.execute(text("DELETE FROM migration_waves WHERE tenant_id = :t"), {"t": w["tid"]})
        seed.drop_tenant(eng, w["tid"])
        eng.dispose()
