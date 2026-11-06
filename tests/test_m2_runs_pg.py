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

needs_db = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


async def start(monkeypatch, tid, sub=USER):
    deps, client = make_client(monkeypatch, tid, sub)
    await deps.engine.dispose()
    return client


@needs_db
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
        pick = lambda o: {k: o[k] for k in ("score", "raw_score", "capped")}  # noqa: E731 - the score fields only
        assert {k: pick(o) for k, o in runs[2]["objects"].items()} == {
            "fi_gl": {"score": 92.5, "raw_score": 92.5, "capped": False},
            "material_master": {"score": 70.0, "raw_score": 71.8, "capped": True}}
        assert pick(runs[0]["objects"]["material_master"]) == {"score": 78.0, "raw_score": 78.0, "capped": False}
        assert [x["run_number"] for x in runs] == [1, 2, 3]
        assert [x["status"] for x in runs] == ["complete", "agents_complete", "complete"]
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


@needs_db
@pytest.mark.anyio
async def test_timeline_findings_and_value_at_risk(owner, monkeypatch):
    from sqlalchemy import text
    s = seed_m2(owner)
    with owner.begin() as c:  # run_mid measured the object too, so the landscape run has a previous run to compare with
        for chk, n in (("MM014", 200), ("MM100", 5), ("MM300", 7)):
            c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count, "
                           "total_count, details) VALUES (:v, :t, 'material_master', :c, 'low', 'validity', :n, 61000, CAST('{}' AS jsonb))"),
                      {"v": s["run_mid"], "t": s["tid"], "c": chk, "n": n})
    client = await start(monkeypatch, s["tid"])
    async with client:
        runs = (await client.get("/api/v1/runs/timeline", params={"system_id": s["ecc"]}, headers=headers())).json()["runs"]
        mm = [x["objects"]["material_master"] for x in runs]
        gl = [x["objects"]["fi_gl"] for x in runs]
        # run0: first run of the system, nothing to compare, nothing priced
        assert (mm[0]["findings_open"], mm[0]["findings_new"], mm[0]["findings_closed"], mm[0]["value_at_risk"]) == (105, None, None, None)
        # run_mid vs run0: MM014 100 -> 200 and MM300 appears (+107); MM100 unchanged
        assert (mm[1]["findings_open"], mm[1]["findings_new"], mm[1]["findings_closed"]) == (212, 107, 0)
        # landscape run vs run_mid: MM014 +3440, MM031 +1000, MM200 +3; MM100 -5, MM300 -7 (errored rules never counted)
        assert (mm[2]["findings_open"], mm[2]["findings_new"], mm[2]["findings_closed"]) == (4643, 4443, 12)
        assert mm[2]["value_at_risk"]["amount"] == 4_200_000 and mm[2]["value_at_risk"]["currency"]  # MM014 + MM031 priced
        # fi_gl was never measured in run_mid: no comparison; GL001 carries no cost, so no value
        assert (gl[2]["findings_open"], gl[2]["findings_new"], gl[2]["findings_closed"], gl[2]["value_at_risk"]) == (12, None, None, None)


@needs_db
@pytest.mark.anyio
async def test_status_per_system_reads_each_object_at_its_own_run(owner, monkeypatch):
    import json
    import uuid
    from datetime import timedelta
    from sqlalchemy import text
    from api.middleware import cache
    from tests.landscape_seed import FI_GL, RUN_AT
    cache._memo.clear()
    monkeypatch.setattr(cache, "get_redis", lambda: None)
    s = seed_m2(owner)
    newer = str(uuid.uuid4())
    with owner.begin() as c:  # a newer ECC run that measured fi_gl only: material_master stays at its older run
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, run_number, label, metadata, dqs_summary) "
                       "VALUES (:v, :t, 'complete', :at, 4, 'ECC newer', CAST(:m AS jsonb), CAST(:s AS jsonb))"),
                  {"v": newer, "t": s["tid"], "at": RUN_AT + timedelta(days=1),
                   "m": json.dumps({"system_id": s["ecc"], "modules": ["fi_gl"]}), "s": json.dumps({"fi_gl": {**FI_GL, "composite_score": 95.0}})})
    client = await start(monkeypatch, s["tid"])
    async with client:
        b = (await client.get("/api/v1/status", headers=headers())).json()
        by = {x["system_id"]: x for x in b["systems"]}
        ecc, spare = by[s["ecc"]], by[s["spare"]]
        assert (ecc["name"], ecc["latest_run_id"], ecc["run_number"], ecc["status"]) == ("ECC production", newer, 4, "complete")
        objs = {o["module"]: o for o in ecc["objects"]}
        assert (objs["fi_gl"]["run_id"], objs["fi_gl"]["run_number"], objs["fi_gl"]["score"]) == (newer, 4, 95.0)
        assert (objs["material_master"]["run_id"], objs["material_master"]["run_number"]) == (s["run"], 3)
        assert objs["material_master"]["label"] == "Material master" and objs["material_master"]["records_checked"] == 61816
        assert ecc["records_checked"] == 61816 + 5000 and ecc["rules_measured"] == 913 + 40
        assert (spare["latest_run_id"], spare["run_number"], [o["module"] for o in spare["objects"]]) == (s["run_spare"], 1, ["material_master"])
        # the tenant-wide fields stay as before
        assert b["run_at"] is not None and b["cost_model"]


def test_findings_delta():
    from api.routes.run_timeline import findings_delta
    assert findings_delta({"a": 5, "b": 2}, {"a": 3, "c": 4}) == (4, 4)  # a +2, b +2 | c -4
    assert findings_delta({"a": 1}, None) == (None, None)


@needs_db
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


@needs_db
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
