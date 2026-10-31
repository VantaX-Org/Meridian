"""Record history and time travel against a real Postgres (MERIDIAN_TEST_DB_URL): one record's failing checks and
values in every run with every decision in order, the object as it stood at a run, and the ledger as of a run.
Another tenant sees nothing."""
from __future__ import annotations

import os
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_step10_seed import RUN_AT, seed_run, seed_tenant

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

K1, K2 = "LIFNR=0000100001|BANKS=ZA", "LIFNR=0000100002|BANKS=ZA"
M = "accounts_payable"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def q(owner, sql, **p):
    with owner.begin() as c:
        res = c.execute(text(sql), p)
        return res.fetchall() if res.returns_rows else []


def _seed(owner) -> dict:
    s = seed_tenant(owner)
    tid, ecc = s["tid"], s["ecc"]
    run1 = seed_run(owner, tid, ecc, findings=(("AP039", "critical", "validity", 2), ("AP016", "high", "completeness", 0)),
                    run_at=RUN_AT - timedelta(days=7), keys={"AP039": [K1, K2]}, values={K1: "123", K2: "456"})
    run2 = seed_run(owner, tid, ecc, findings=(("AP039", "critical", "validity", 1), ("AP016", "high", "completeness", 1)),
                    keys={"AP039": [K1], "AP016": [K1]}, values={K1: "999"})
    q(owner, "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, status, "
             "first_seen_version, last_seen_version) VALUES (:t, :s, :m, 'AP039', :k, 'critical', 'open', :a, :b)",
      t=tid, s=ecc, m=M, k=K1, a=run1, b=run2)
    return {**s, "run1": run1, "run2": run2}


@pytest.mark.anyio
async def test_history_and_time_travel(owner, monkeypatch):
    s = _seed(owner)
    tid = s["tid"]
    other = seed_tenant(owner)
    seed_run(owner, other["tid"], other["ecc"], keys={"AP039": [K1]})

    deps, client = make_client(monkeypatch, tid, s["ann"])
    await deps.engine.dispose()
    async with client:
        r = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": M, "record_key": K1, "check_id": "AP039", "action": "assign", "assignee": "me",
             "note": "Mine"},
            {"module": M, "record_key": K1, "check_id": "AP039", "action": "edit", "value": "000111"}]})
        assert r.status_code == 200, r.text
        batch = r.json()["draft_batch_id"]
        q(owner, "UPDATE remediation_batches SET approved_at = now(), approved_by_label = 'Cara' WHERE id = :b", b=batch)

        h = (await client.get(f"/api/v1/work/records/{M}/{K1}/history", headers=headers("viewer"))).json()
        assert h["systems"] == [s["ecc"]] and [x["run_id"] for x in h["runs"]] == [s["run1"], s["run2"]]
        r1, r2 = h["runs"]
        assert r1["failing"] and r1["checks"] == ["AP039"] and r1["values"] == {"LFBK.BANKN": "123"}
        assert r2["checks"] == ["AP016", "AP039"] and r2["values"] == {"LFBK.BANKN": "999"}
        assert r2["work_status"] == "to_fix" and r2["severity"] == "critical"  # the seed builds no work groups
        kinds = [(e["kind"], e.get("action")) for e in h["events"]]
        assert ("issue", "assign") in kinds and ("issue", "status") in kinds
        proposed = next(e for e in h["events"] if e["kind"] == "fix_proposed")
        assert proposed["to_value"] == "000111" and proposed["batch_id"] == batch and proposed["check_id"] == "AP039"
        assert any(e["kind"] == "fix_approved" and e["by"] == "Cara" for e in h["events"])
        ats = [e["at"] for e in h["events"] if e["at"]]
        assert ats == sorted(ats)

        h2 = (await client.get(f"/api/v1/work/records/{M}/{K2}/history", headers=headers("viewer"))).json()
        assert [(x["failing"], x["checks"]) for x in h2["runs"]] == [(True, ["AP039"]), (False, [])]
        assert h2["events"] == []
        assert (await client.get(f"/api/v1/work/records/{M}/LIFNR=9/history", headers=headers())).status_code == 404
        # the record itself is still served by the work route
        assert (await client.get(f"/api/v1/work/records/{M}/{K1}", headers=headers())).status_code == 200

        a1 = (await client.get(f"/api/v1/objects/{M}/as-of?run={s['run1']}", headers=headers("viewer"))).json()
        a2 = (await client.get(f"/api/v1/objects/{M}/as-of?run={s['run2']}", headers=headers("viewer"))).json()
        assert a1["run_id"] == s["run1"] and a2["run_id"] == s["run2"]
        assert a1["failing_records"] == 2 and a2["failing_records"] == 1
        assert {x["check_id"]: x["failing"] for x in a1["rules"]} == {"AP039": 2, "AP016": 0}
        assert a1["breaches"] == ["AP039"] and a1["capped"] is True
        assert (await client.get(f"/api/v1/objects/material_master/as-of?run={s['run1']}",
                                 headers=headers())).status_code == 404

        w1 = (await client.get(f"/api/v1/work/records?as_of_run={s['run1']}&status=all", headers=headers("viewer"))).json()
        w2 = (await client.get(f"/api/v1/work/records?as_of_run={s['run2']}&status=all", headers=headers("viewer"))).json()
        assert sorted(i["record_key"] for i in w1["items"]) == [K1, K2] and {i["version_id"] for i in w1["items"]} == {s["run1"]}
        assert [i["record_key"] for i in w2["items"]] == [K1] and w2["items"][0]["version_id"] == s["run2"]
        assert (await client.get(f"/api/v1/work/records?as_of_run={s['run1']}&version_id={s['run2']}",
                                 headers=headers())).status_code == 422

    deps, client = make_client(monkeypatch, other["tid"], other["ann"])
    async with client:
        h = (await client.get(f"/api/v1/work/records/{M}/{K1}/history", headers=headers())).json()
        assert s["run1"] not in [x["run_id"] for x in h["runs"]] and h["events"] == []
        assert (await client.get(f"/api/v1/work/records/{M}/{K2}/history", headers=headers())).status_code == 404
        assert (await client.get(f"/api/v1/objects/{M}/as-of?run={s['run1']}", headers=headers())).status_code == 404
        assert (await client.get(f"/api/v1/work/records?as_of_run={s['run1']}", headers=headers())).status_code == 404


@pytest.mark.anyio
async def test_back_after_clean(owner, monkeypatch):
    s = _seed(owner)
    tid = s["tid"]
    iid = q(owner, "SELECT id FROM record_issues WHERE tenant_id = :t AND check_id = 'AP039'", t=tid)[0][0]
    for action in ("auto_resolved", "reopened"):
        q(owner, "INSERT INTO record_issue_events (tenant_id, issue_id, action, user_label) VALUES (:t, :i, :a, 'system')",
          t=tid, i=iid, a=action)
    deps, client = make_client(monkeypatch, tid, s["ann"])
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/work/back-after-clean", headers=headers())
    assert r.status_code == 200
    body = r.json()
    assert sum(w["back"] for w in body["weeks"]) == 1 and sum(w["fixed"] for w in body["weeks"]) == 1
    assert body["rules"][0]["check_id"] == "AP039"
