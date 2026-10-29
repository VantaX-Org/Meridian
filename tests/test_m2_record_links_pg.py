"""GET /api/v1/records/{module}/{record_key}/links against a real Postgres (seed: tests/m2_seed.py)."""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import USER, headers, make_client
from tests.m2_seed import R1, R1B, R1H, R2, seed_m2

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


def test_key_parts():
    from api.routes.record_links import identity_of, parse_key
    assert parse_key("MATNR=1|WERKS=3000") == [("MATNR", "1"), ("WERKS", "3000")]
    assert identity_of("MATNR=1|WERKS=3000") == ["MATNR=1"] and identity_of("BUKRS=1000|SAKNR=4") == ["SAKNR=4"]
    assert identity_of("BUKRS=1000") == [] and identity_of("0000123") == ["0000123"]


@pytest.mark.anyio
async def test_links_of_a_record(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        r = await client.get(f"/api/v1/records/material_master/{R1}/links", headers=headers())
        assert r.status_code == 200, r.text
        b = r.json()
        assert (b["module"], b["record_key"], b["run_id"]) == ("material_master", R1, s["run"])

        # every failing rule, worst first; the field is the one the finding stored, else the shipped rule's
        assert [(x["check_id"], x["severity"], x["name"], x["field"]) for x in b["failing_rules"]] == [
            ("MM014", "critical", "Base unit of measure not valid", "MARA.MEINS"),
            ("MM031", "critical", "Material group missing", "MARC.ABCIN")]
        only = (await client.get(f"/api/v1/records/material_master/{R1}/links", params={"check_id": "MM014"}, headers=headers())).json()
        assert [x["check_id"] for x in only["failing_rules"]] == ["MM031"]

        # the same material at another plant and as the header row, not other materials
        v = b["variants"]
        assert v["identity"] == "MATNR=000000000000000101" and v["total"] == 2
        assert {(i["record_key"], tuple(f["check_id"] for f in i["failing"])) for i in v["items"]} == {
            (R1B, ("MM014",)), (R1H, ("MM031",))}
        assert {i["record_key"]: i["differs_in"] for i in v["items"]} == {R1B: {"WERKS": "1000"}, R1H: {"WERKS": None}}
        assert R2 not in {i["record_key"] for i in v["items"]}

        # feature impact: blocked by MM014, degraded by MM031; Reporting is ok and Period close is GL001's
        assert b["features"] == [{"feature": "Goods receipt", "status": "blocked", "because": ["MM014"]},
                                 {"feature": "Pricing", "status": "degraded", "because": ["MM031"]}]

        p = b["provenance"]
        assert p["source_tables"] == [{"table": "MARA", "fields": ["MARA.MEINS"]}, {"table": "MARC", "fields": ["MARC.ABCIN"]}]
        assert (p["run_id"], p["system_id"], p["system_name"]) == (s["run"], s["ecc"], "ECC production")
        assert p["run_at"].startswith("2026-10-16T05:17:00") and p["extracted_at"].startswith("2026-10-16T04:47:00")
        assert p["record_hash"] == "abcdef01"

        # history: newest first, at most 10
        assert [(h["action"], h["note"], h["user"]) for h in b["history"]] == [
            ("comment", "Check the unit with purchasing", "bob"), ("assign", None, "ann"), ("status", "Fix proposed", "bob")]
        assert b["history"][0]["check_id"] == "MM014" and b["history"][1]["to_value"] == s["bob"]

        # a record with no hash, no history and no variants: nulls and empties, nothing invented
        r2 = (await client.get(f"/api/v1/records/material_master/{R2}/links", headers=headers())).json()
        assert r2["provenance"]["record_hash"] is None and r2["history"] == [] and r2["variants"]["total"] == 0
        assert [f["feature"] for f in r2["features"]] == ["Goods receipt"]
        # named run
        named = (await client.get(f"/api/v1/records/material_master/{R1}/links", params={"run": s["run"]}, headers=headers())).json()
        assert named["run_id"] == s["run"]
        # not failing / bad run id
        assert (await client.get("/api/v1/records/material_master/MATNR=nope/links", headers=headers())).status_code == 404
        assert (await client.get(f"/api/v1/records/material_master/{R1}/links", params={"run": "x"}, headers=headers())).status_code == 422
        assert (await client.get(f"/api/v1/records/material_master/{R1}/links", params={"run": s["run0"]}, headers=headers())).status_code == 404


@pytest.mark.anyio
async def test_history_keeps_only_the_last_ten(owner, monkeypatch):
    s = seed_m2(owner)
    with owner.begin() as c:
        for n in range(15):
            c.execute(text("INSERT INTO record_issue_events (tenant_id, issue_id, user_label, action, note, created_at) "
                           "VALUES (:t, :i, 'x', 'comment', :n, now() + make_interval(mins => :m))"),
                      {"t": s["tid"], "i": s["issue"][f"{R1}#MM031"], "n": f"c{n}", "m": n})
    client = await start(monkeypatch, s["tid"])
    async with client:
        h = (await client.get(f"/api/v1/records/material_master/{R1}/links", headers=headers())).json()["history"]
        assert len(h) == 10 and h[0]["note"] == "c14" and h[-1]["note"] == "c5"


@pytest.mark.anyio
async def test_links_are_tenant_scoped(owner, monkeypatch):
    s, t2 = seed_m2(owner), seed_m2(owner)
    # the second tenant has the same keys in its own run, so it answers with its own data only
    client = await start(monkeypatch, t2["tid"])
    async with client:
        b = (await client.get(f"/api/v1/records/material_master/{R1}/links", headers=headers())).json()
        assert b["run_id"] == t2["run"] and b["run_id"] != s["run"]
        assert (await client.get(f"/api/v1/records/material_master/{R1}/links", params={"run": s["run"]}, headers=headers())).status_code == 404
    # a tenant with no run at all
    from tests.landscape_seed import seed
    bare = seed(owner, with_run=False)
    client = await start(monkeypatch, bare["tid"])
    async with client:
        assert (await client.get(f"/api/v1/records/material_master/{R1}/links", headers=headers())).status_code == 404
