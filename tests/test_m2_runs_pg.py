"""GET /api/v1/runs/timeline and /api/v1/runs/{a}/vs/{b}/summary against a real Postgres (seed: tests/m2_seed.py).

Runs of the ECC system, oldest first: run0 (pinned baseline, scheduled, 120 s), run_mid (manual), the landscape run
(702 s). The spare system has one run; an archived and a failed run of ECC never show.
"""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine

from tests.m2_client import USER, headers, make_client
from tests.m2_seed import seed_m2

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


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
async def test_timeline_order_baseline_and_shape(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        r = await client.get("/api/v1/runs/timeline", params={"system_id": s["ecc"]}, headers=headers())
        assert r.status_code == 200, r.text
        b = r.json()
        assert (b["system_id"], b["limit"]) == (s["ecc"], 8)
        runs = b["runs"]
        assert [x["id"] for x in runs] == [s["run0"], s["run_mid"], s["run"]]  # oldest first; archived and failed left out
        assert [x["run_at"] for x in runs] == sorted(x["run_at"] for x in runs)
        assert [x["baseline"] for x in runs] == [True, False, False]  # the pinned baseline
        assert [x["kind"] for x in runs] == ["scheduled", "manual", None]
        assert [x["label"] for x in runs] == ["ECC production baseline", "ECC production mid", "ECC production run"]
        assert [x["duration_s"] for x in runs] == [120, None, 702]
        assert [x["records_checked"] for x in runs] == [60000 + 5000, 61000 + 5000, 61816 + 5000]
        assert runs[2]["objects"] == {"fi_gl": {"score": 92.5, "raw_score": 92.5, "capped": False},
                                      "material_master": {"score": 70.0, "raw_score": 71.8, "capped": True}}
        assert runs[0]["objects"]["material_master"] == {"score": 78.0, "raw_score": 78.0, "capped": False}
        assert all(x["system_id"] == s["ecc"] for x in runs)

        # the last N, still oldest first
        two = (await client.get("/api/v1/runs/timeline", params={"system_id": s["ecc"], "limit": 2}, headers=headers())).json()
        assert [x["id"] for x in two["runs"]] == [s["run_mid"], s["run"]]
        # every system, and the spare system on its own
        every = (await client.get("/api/v1/runs/timeline", headers=headers())).json()
        assert [x["id"] for x in every["runs"]] == [s["run0"], s["run_mid"], s["run_spare"], s["run"]]
        spare = (await client.get("/api/v1/runs/timeline", params={"system_id": s["spare"]}, headers=headers())).json()
        assert [x["id"] for x in spare["runs"]] == [s["run_spare"]]
        assert (await client.get("/api/v1/runs/timeline", params={"limit": 0}, headers=headers())).status_code == 422
        assert (await client.get("/api/v1/runs/timeline", params={"system_id": "x"}, headers=headers())).status_code == 422


@pytest.mark.anyio
async def test_compare_counts_reconcile_with_the_object_rows(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        r = await client.get(f"/api/v1/runs/{s['run0']}/vs/{s['run']}/summary", headers=headers())
        assert r.status_code == 200, r.text
        b = r.json()
        assert (b["a"]["id"], b["b"]["id"]) == (s["run0"], s["run"])
        by = {o["module"]: o for o in b["objects"]}
        assert list(by) == ["fi_gl", "material_master"]
        mm = by["material_master"]
        assert mm["label"] == "Material master"
        assert mm["before"] == {"score": 78.0, "raw_score": 78.0, "capped": False, "records_checked": 60000, "coverage": 0.974}
        assert mm["after"] == {"score": 70.0, "raw_score": 71.8, "capped": True, "records_checked": 61816, "coverage": 0.974}
        assert mm["score_change"] == -8.0
        # MM031 0 -> 1000 newly failing, MM100 5 -> 0 fixed, MM014 100 -> 3640 worse; MM200 is new in this run
        assert (mm["newly_failing"], mm["fixed"], mm["worse"], mm["better"]) == (1, 1, 1, 0)
        gl = by["fi_gl"]
        assert gl["score_change"] == 4.5 and (gl["newly_failing"], gl["fixed"], gl["worse"], gl["better"]) == (0, 0, 0, 0)  # 20 -> 12 is not material

        t = b["totals"]
        for k in ("newly_failing", "fixed", "worse", "better"):
            assert t[k] == sum(o[k] for o in b["objects"])  # the total is the sum of the rows
        assert t["records_checked_before"] == sum(o["before"]["records_checked"] for o in b["objects"]) == 65000
        assert t["records_checked_after"] == sum(o["after"]["records_checked"] for o in b["objects"]) == 66816
        assert (t["rules_compared"], t["rules_added"], t["rules_dropped"]) == (4, 1, 0)
        assert b["method"].startswith("Rules are compared on the common set: the 4 rules that ran cleanly in both runs. "
                                      "1 rule added since the baseline of 4 Oct 2026 is excluded.")

        # the other way round: fixed and newly failing swap, the added rule becomes a dropped one
        back = (await client.get(f"/api/v1/runs/{s['run']}/vs/{s['run0']}/summary", headers=headers())).json()
        bm = {o["module"]: o for o in back["objects"]}["material_master"]
        assert (bm["newly_failing"], bm["fixed"], bm["better"], bm["worse"]) == (1, 1, 1, 0)
        assert back["totals"]["rules_dropped"] == 1 and back["totals"]["rules_added"] == 0
        assert "No rules were added since the earlier run" in back["method"] and "1 rule that ran before but not now is excluded" in back["method"]

        # different systems cannot be compared; unknown runs are not found
        assert (await client.get(f"/api/v1/runs/{s['run0']}/vs/{s['run_spare']}/summary", headers=headers())).status_code == 400
        assert (await client.get(f"/api/v1/runs/{s['run0']}/vs/00000000-0000-0000-0000-000000000000/summary", headers=headers())).status_code == 404


@pytest.mark.anyio
async def test_runs_are_tenant_scoped(owner, monkeypatch):
    s, t2 = seed_m2(owner), seed_m2(owner)
    from tests.landscape_seed import seed
    bare = seed(owner, with_run=False)
    client = await start(monkeypatch, bare["tid"])
    async with client:
        assert (await client.get("/api/v1/runs/timeline", headers=headers())).json()["runs"] == []
        assert (await client.get(f"/api/v1/runs/{s['run0']}/vs/{s['run']}/summary", headers=headers())).status_code == 404
    client = await start(monkeypatch, t2["tid"])
    async with client:
        ids = {x["id"] for x in (await client.get("/api/v1/runs/timeline", headers=headers())).json()["runs"]}
        assert ids == {t2["run0"], t2["run_mid"], t2["run_spare"], t2["run"]} and not ids & {s["run"], s["run0"]}
        assert (await client.get(f"/api/v1/runs/{s['run0']}/vs/{t2['run']}/summary", headers=headers())).status_code == 404
