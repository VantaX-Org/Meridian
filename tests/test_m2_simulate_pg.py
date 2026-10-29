"""Fix simulation against a real Postgres (MERIDIAN_TEST_DB_URL): the after-scores reconcile by hand with the scoring
arithmetic of tests/m2_step9_seed.py (the same numbers receipt_math reads), and the call is read-only."""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_step9_seed import KEYS, seed_step9

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

COMPLETENESS = (95 * 1 + 100 * 2) / 3


def raw(accuracy: float, validity: float, completeness: float = COMPLETENESS) -> float:
    return round((completeness * 0.25 + accuracy * 0.25 + validity * 0.10) / 0.60, 2)


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


async def start(monkeypatch, tid, sub):
    deps, client = make_client(monkeypatch, tid, sub)
    await deps.engine.dispose()
    return client


def test_seed_reconciles_by_hand():
    from tests.m2_step9_seed import summary_of
    s = summary_of()
    assert s["raw_score"] == raw(85, 50) == 84.72 and s["composite_score"] == 70.0
    assert [b.split(":")[0] for b in s["critical_breaches"]] == ["MM001", "MM005"]


@pytest.mark.anyio
async def test_simulate_fix(owner, monkeypatch):
    s = seed_step9(owner)
    client = await start(monkeypatch, s["tid"], s["ann"])
    async with client:
        # nothing chosen: before = after = the stored receipt
        r = await client.post("/api/v1/simulate/fix", json={"module": "material_master"}, headers=headers())
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["run_id"] == s["run"] and b["method"]["reproduced"] is True and b["method"]["cached"] is False
        before = b["before"]
        assert before == b["after"]
        assert before["score"] == 70.0 and before["raw_score"] == 84.72 and before["cap_level"] == 70
        assert before["breaches"] == ["MM001", "MM005"] and before["verdict"] == "no-go"
        assert before["dimensions"] == {"completeness": round(COMPLETENESS, 2), "accuracy": 85.0, "validity": 50.0}
        assert (before["features_blocked"], before["features_degraded"]) == (2, 1)
        assert before["wave_gate"] == [{"wave_id": s["wave"], "name": "Wave 1", "open": False,
                                        "reasons": ["2 critical rule(s) over tolerance", "score below the wave minimum of 80"]}]
        assert b["landscape"]["before"]["held_under_85"] == 1 and b["landscape"]["before"]["release_if_fixed"] == ["MM001", "MM005"]

        # fix MM001: validity 100, one breach left -> held at 85
        r = await client.post("/api/v1/simulate/fix", json={"module": "material_master", "rules": ["MM001"]}, headers=headers())
        a = r.json()["after"]
        assert a["raw_score"] == raw(85, 100) == 93.06 and a["score"] == 85.0 and a["cap_level"] == 85
        assert a["breaches"] == ["MM005"] and a["features_blocked"] == 1 and a["verdict"] == "at-risk"
        assert r.json()["delta"]["score"] == 15.0 and r.json()["delta"]["breaches_cleared"] == ["MM001"]
        assert r.json()["delta"]["features_blocked"] == -1

        # ten of MM005's records: 20 failing, r' = 100 - 5*2 = 90; still over tolerance (2 % >= 0.1 %)
        r = await client.post("/api/v1/simulate/fix", json={
            "module": "material_master", "records": [{"module": "material_master", "record_key": k} for k in KEYS[:10]]},
            headers=headers())
        a = r.json()["after"]
        assert a["dimensions"]["accuracy"] == 90.0 and a["raw_score"] == raw(90, 50) == 86.81 and a["score"] == 70.0
        assert r.json()["method"]["records_resolved"] == {"MM005": 10}

        # a fix batch holding every MM005 record clears that breach
        with owner.begin() as c:
            bid = c.execute(text("INSERT INTO remediation_batches (tenant_id, name) VALUES (:t, 'B') RETURNING id::text"),
                            {"t": s["tid"]}).scalar()
            for k in KEYS:
                c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key) "
                               "VALUES (:t, :b, :s, 'material_master', 'MM005', :k)"), {"t": s["tid"], "b": bid, "s": s["ecc"], "k": k})
        r = await client.post("/api/v1/simulate/fix", json={"module": "material_master", "batches": [bid]}, headers=headers())
        a = r.json()["after"]
        assert a["raw_score"] == raw(100, 50) == 90.97 and a["score"] == 85.0 and a["breaches"] == ["MM001"]

        # both critical rules: no cap, go, the wave's gate opens and the landscape releases the object
        r = await client.post("/api/v1/simulate/fix", json={"module": "material_master", "rules": ["MM001", "MM005"]},
                              headers=headers())
        out = r.json()
        a = out["after"]
        assert a["score"] == a["raw_score"] == raw(100, 100) == 99.31 and a["cap_level"] is None and a["verdict"] == "go"
        assert a["wave_gate"][0]["open"] is True and out["delta"]["gates_opened"] == [s["wave"]]
        assert out["landscape"]["after"] == {"held_under_85": 0, "objects": 1, "critical_over_tolerance": 0,
                                             "release_if_fixed": [], "released": 0}

        # top five: MM001 and MM005 both lift the shown score to 85; MM001 moves the raw score more
        r = await client.get("/api/v1/simulate/fix/top", params={"module": "material_master"}, headers=headers())
        top = r.json()
        assert top["score"] == 70.0 and [x["check_id"] for x in top["rules"]] == ["MM001", "MM005", "MM015"]
        assert [x["after_score"] for x in top["rules"]] == [85.0, 85.0, 70.0]
        assert top["rules"][0]["breach_cleared"] is True and top["rules"][2]["delta"] == 0.0

        # read-only: nothing changed in the stored run
        with owner.connect() as c:
            stored = c.execute(text("SELECT dqs_summary->'material_master'->>'composite_score' FROM analysis_versions "
                                    "WHERE id = :v"), {"v": s["run"]}).scalar()
        assert float(stored) == 70.0

        # not found, and another tenant's run is not visible
        assert (await client.post("/api/v1/simulate/fix", json={"module": "fi_gl"}, headers=headers())).status_code == 404
        other = seed_step9(owner)
        r = await client.post("/api/v1/simulate/fix", json={"module": "material_master", "run_id": other["run"]},
                              headers=headers())
        assert r.status_code == 404
