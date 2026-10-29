"""Data contract enforcement against a real Postgres (MERIDIAN_TEST_DB_URL): per-object thresholds, breaches on the
current state, on the receipt and the landscape cells, recorded after each run, and the baseline gate (409 unless
forced with a reason, which is audited)."""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_step9_seed import seed_step9

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

THRESHOLDS = {"min_score": 80, "max_critical_breaches": 0, "dimensions": {"validity": 60, "completeness": 90}}
EXPECTED = [("score", 80.0, 70.0), ("critical_breaches", 0.0, 2.0), ("validity", 60.0, 50.0)]


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def test_thresholds_from_the_quality_contract():
    from api.services import contract_enforcement as ce
    from tests.m2_step9_seed import summary_of

    c = {"id": "c", "name": "Q", "quality_contract": {"min_dqs": 75, "accuracy": 90}, "producer": "x"}
    assert ce.effective_thresholds(c) == {"min_score": 75.0, "dimensions": {"accuracy": 90.0}}
    got = ce.object_breaches(c, "material_master", summary_of())
    assert [(b["metric"], b["threshold"], b["actual"]) for b in got] == [("score", 75.0, 70.0), ("accuracy", 90.0, 85.0)]
    assert ce.object_breaches(c, "material_master", None)[0]["actual"] is None  # unmeasured: breaches min_score


@pytest.mark.anyio
async def test_enforcement(owner, monkeypatch):
    s = seed_step9(owner)
    tid, run = s["tid"], s["run"]
    deps, client = make_client(monkeypatch, tid, s["ann"])
    await deps.engine.dispose()
    async with client:
        r = await client.post("/api/v1/contracts", headers=headers(), json={
            "name": "Material master to S/4", "producer": "SAP material_master", "consumer": "S/4 load",
            "enforce": False, "thresholds": THRESHOLDS})
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        with owner.begin() as c:
            row = c.execute(text("SELECT enforce, thresholds FROM contracts WHERE id = :c"), {"c": cid}).fetchone()
            assert row[0] is False and row[1] == THRESHOLDS
            c.execute(text("UPDATE contracts SET status = 'active', activated_at = now() WHERE id = :c"), {"c": cid})
        # not enforced: the baseline can be pinned, the breaches still show
        assert (await client.post(f"/api/v1/versions/{run}/baseline", headers=headers())).status_code == 200
        r = await client.put(f"/api/v1/contracts/{cid}/enforcement", json={"enforce": True, "thresholds": THRESHOLDS},
                             headers=headers())
        assert r.status_code == 200 and r.json()["enforce"] is True
        assert (await client.put(f"/api/v1/contracts/{cid}/enforcement", json={"enforce": False},
                                 headers=headers("viewer"))).status_code == 403

        r = await client.get(f"/api/v1/contracts/{cid}/breaches", headers=headers("viewer"))
        b = r.json()
        assert [(x["metric"], x["threshold"], x["actual"]) for x in b["current"]] == EXPECTED
        assert {x["run_id"] for x in b["current"]} == {run} and b["enforce"] is True and b["history"] == []

        r = await client.get("/api/v1/objects/material_master/contracts", headers=headers("viewer"))
        o = r.json()
        assert o["run_id"] == run and o["breached"] == 1 and o["enforced_breached"] == 1
        assert [(x["metric"], x["threshold"], x["actual"]) for x in o["contracts"][0]["breaches"]] == EXPECTED

        r = await client.get("/api/v1/objects/material_master/receipt", headers=headers("viewer"))
        rb = r.json()["contract_breaches"]
        assert [(x["metric"], x["threshold"], x["actual"]) for x in rb] == EXPECTED
        assert rb[0]["contract_id"] == cid and rb[0]["enforce"] is True and rb[0]["name"] == "Material master to S/4"

        cell = (await client.get("/api/v1/landscape", headers=headers("viewer"))).json()["cells"][0]
        assert cell["contract_breaches"] == 3 and cell["enforced_contract_breaches"] == 3

        # after the run: the evaluation records the breaches
        from workers.tasks.evaluate_contracts import evaluate_contracts
        evaluate_contracts(run, tid)
        evaluate_contracts(run, tid)  # idempotent
        hist = (await client.get(f"/api/v1/contracts/{cid}/breaches", headers=headers())).json()["history"]
        assert sorted((h["metric"], h["actual"], h["enforced"]) for h in hist) == \
            sorted((m, a, True) for m, _t, a in EXPECTED) and {h["run_id"] for h in hist} == {run}

        # the baseline gate
        r = await client.post(f"/api/v1/versions/{run}/baseline", headers=headers())
        assert r.status_code == 409 and len(r.json()["detail"]["breaches"]) == 3
        r = await client.post(f"/api/v1/versions/{run}/baseline", json={"force": True}, headers=headers())
        assert r.status_code == 422
        r = await client.post(f"/api/v1/versions/{run}/baseline", json={"force": True, "reason": "Mock 1 reference"},
                              headers=headers())
        assert r.status_code == 200 and r.json()["baseline"] is True
        # unpinning never needs force
        assert (await client.post(f"/api/v1/versions/{run}/baseline", params={"pinned": "false"},
                                  headers=headers())).status_code == 200
    with owner.connect() as c:
        audit = c.execute(text("SELECT after_json FROM audit_log WHERE tenant_id = :t AND action = 'baseline_forced'"),
                          {"t": tid}).scalar()
        actions = [r[0] for r in c.execute(text("SELECT action FROM audit_log WHERE tenant_id = :t AND entity_type = 'contract'"),
                                           {"t": tid}).fetchall()]
    assert audit["reason"] == "Mock 1 reference" and len(audit["breaches"]) == 3
    assert actions == ["contract_enforcement"]
