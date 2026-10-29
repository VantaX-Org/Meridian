"""GET /api/v1/explain/{metric} against a real Postgres (seed: tests/m2_seed.py).

The sentences are built from the numbers the receipt returns, so each assertion checks the text against the arithmetic."""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

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


def rows(body):
    return {r["label"]: r["value"] for r in body["computation"]}


@pytest.mark.anyio
async def test_dqs_and_cap(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        r = await client.get("/api/v1/explain/dqs", params={"module": "material_master"}, headers=headers())
        assert r.status_code == 200, r.text
        b = r.json()
        assert set(b) >= {"title", "text", "computation"} and b["metric"] == "dqs" and b["run_id"] == s["run"]
        assert b["title"] == "Why Material master scores 70"
        assert "Material master scores 70 out of 100 in the run of 16 Oct 2026." in b["text"]
        assert "Completeness 62 × 0.25; Accuracy 72 × 0.25; Consistency 70 × 0.20; Timeliness 88 × 0.10; Uniqueness 90 × 0.10; Validity 65 × 0.10" in b["text"]
        assert "add up to 71.8" in b["text"]
        assert "2 critical rules over tolerance (MM014, MM031) hold it at 70; it measures 71.8 before the cap." in b["text"]
        assert "913 rules were measured, 97.4% of those attempted." in b["text"]
        c = rows(b)
        assert c["Completeness (62 × 0.25)"] == 15.5 and c["Validity (65 × 0.10)"] == 6.5
        assert c["Weighted score"] == 71.8 and c["Cap"] == 70 and c["Score"] == 70.0
        assert round(sum(v for k, v in c.items() if "×" in k), 1) == c["Weighted score"]  # the rows add up to the total

        # only the measured dimensions count, each re-weighted; no cap sentence of a cap that is not there
        gl = (await client.get("/api/v1/explain/dqs", params={"module": "fi_gl"}, headers=headers())).json()
        assert "Completeness 95 × 0.50; Accuracy 90 × 0.50" in gl["text"] and "nothing caps it" in gl["text"]
        assert "Cap" not in rows(gl)

        cap = (await client.get("/api/v1/explain/cap", params={"module": "material_master"}, headers=headers())).json()
        assert cap["title"] == "Why Material master is capped at 70"
        assert "MM014 fails 3,640 records (5.89%); MM031 fails 1,000 records (1.62%)" in cap["text"]
        assert "One critical rule over tolerance caps a score at 85, two or more at 70." in cap["text"]
        assert "at least 0.1% of its records or at least 25 records" in cap["text"]
        assert rows(cap)["MM014 Base unit of measure not valid"] == "3,640 records (5.89%)"
        assert rows(cap)["Measured score"] == 71.8 and rows(cap)["Cap"] == 70
        glcap = (await client.get("/api/v1/explain/cap", params={"module": "fi_gl"}, headers=headers())).json()
        assert glcap["title"] == "FI general ledger is not capped" and "no critical rule is over tolerance" in glcap["text"]


@pytest.mark.anyio
async def test_dimension_coverage_and_tolerance(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        d = (await client.get("/api/v1/explain/dimension", params={"module": "material_master", "dimension": "validity"},
                              headers=headers())).json()
        assert d["text"].startswith("Validity 65 = weighted pass rate across 100 validity rules; "
                                    "1 critical rule over tolerance carries weight 4.")
        assert "critical 4, high 3, medium 2, low 1" in d["text"] and "Validity makes up 10% of the Material master score." in d["text"]
        c = rows(d)
        assert (c["Validity score"], c["Rules measured"], c["Share of the score"], c["Points contributed"]) == (65.0, 100, 0.1, 6.5)
        assert c["Critical rules failing (weight 4)"] == "1 of 1" and c["Critical rules over tolerance"] == 1
        # a dimension no rule measured has no score
        t = (await client.get("/api/v1/explain/dimension", params={"module": "fi_gl", "dimension": "timeliness"}, headers=headers())).json()
        assert "has no score" in t["text"] and t["computation"] == []
        assert (await client.get("/api/v1/explain/dimension", params={"module": "fi_gl"}, headers=headers())).status_code == 422
        assert (await client.get("/api/v1/explain/dimension", params={"module": "fi_gl", "dimension": "x"}, headers=headers())).status_code == 422

        cov = (await client.get("/api/v1/explain/coverage", params={"module": "material_master"}, headers=headers())).json()
        assert "97.4% of the rules attempted" in cov["text"] and "913 rules were measured" in cov["text"]
        c = rows(cov)
        assert (c["Rules measured"], c["Coverage"], c["Records checked"]) == (913, 97.4, 61816)
        assert c["Rules skipped"] is None  # the run did not store it: null, not 0

        tol = (await client.get("/api/v1/explain/tolerance", params={"module": "material_master"}, headers=headers())).json()
        assert "fails at least 0.1% of its records or at least 25 records" in tol["text"]
        assert "2 critical rules fail, 2 of them over tolerance" in tol["text"]
        assert rows(tol)["Tolerance, records"] == 25
        generic = (await client.get("/api/v1/explain/tolerance", headers=headers())).json()  # no module, no run needed
        assert generic["module"] is None and rows(generic)["Tolerance, share of records"] == 0.1


@pytest.mark.anyio
async def test_value_at_risk_failing_pct_and_open_work(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        v = (await client.get("/api/v1/explain/value_at_risk", params={"module": "material_master"}, headers=headers())).json()
        assert v["title"] == "Where the ZAR 4.2m at risk in Material master comes from"
        assert "MM014 Base unit of measure not valid ZAR 4.0m; MM031 Material group missing ZAR 200k" in v["text"]
        c = rows(v)
        assert c["Value at risk"] == 4_200_000.0 and c["MM014 (3,640 records)"] == 4_000_000.0
        # no cost priced for fi_gl's failing rule: no figure, stated as such
        gl = (await client.get("/api/v1/explain/value_at_risk", params={"module": "fi_gl"}, headers=headers())).json()
        assert rows(gl) == {"Value at risk": None} and "no value at risk is stated" in gl["text"]

        f = (await client.get("/api/v1/explain/failing_pct", params={"check_id": "MM014"}, headers=headers())).json()
        assert "MM014 (Base unit of measure not valid) fails 3,640 of 61,816 records, 5.89%." in f["text"]
        assert "critical and over tolerance" in f["text"] and f["module"] == "material_master"
        c = rows(f)
        assert (c["Records failing"], c["Records checked"], c["Failing share"], c["Pass rate"]) == (3640, 61816, 5.89, 94.11)
        assert (await client.get("/api/v1/explain/failing_pct", headers=headers())).status_code == 422
        assert (await client.get("/api/v1/explain/failing_pct", params={"check_id": "NOPE"}, headers=headers())).status_code == 404

        w = (await client.get("/api/v1/explain/open_work", params={"module": "material_master"}, headers=headers())).json()
        assert w["text"].startswith("3 records of Material master still need work in the run of 16 Oct 2026: 2 to fix, 1 with a proposed fix.")
        assert rows(w) == {"To fix": 2, "With a proposed fix": 1, "Approved": 0, "Sent to SAP": 0, "Open work": 3}
        # a run whose work list is not built has no count
        with owner.begin() as conn:
            conn.execute(text("UPDATE analysis_versions SET metadata = metadata - 'worklist_built_at' WHERE id = :r"), {"r": s["run"]})
        nb = (await client.get("/api/v1/explain/open_work", params={"module": "material_master"}, headers=headers())).json()
        assert rows(nb) == {"Open work": None} and "not been built" in nb["text"]

        for bad in ("/api/v1/explain/nope", "/api/v1/explain/dqs"):
            assert (await client.get(bad, headers=headers())).status_code == 422  # unknown metric / module missing
        assert (await client.get("/api/v1/explain/dqs", params={"module": "no_such_object"}, headers=headers())).status_code == 404


@pytest.mark.anyio
async def test_explain_is_tenant_scoped(owner, monkeypatch):
    s = seed_m2(owner)
    from tests.landscape_seed import seed
    bare = seed(owner, with_run=False)
    client = await start(monkeypatch, bare["tid"])
    async with client:
        assert (await client.get("/api/v1/explain/dqs", params={"module": "material_master"}, headers=headers())).status_code == 404
        # another tenant's run id is not found
        assert (await client.get("/api/v1/explain/dqs", params={"module": "material_master", "run": s["run"]}, headers=headers())).status_code == 404
        assert (await client.get("/api/v1/explain/failing_pct", params={"check_id": "MM014", "run": s["run"]}, headers=headers())).status_code == 404
