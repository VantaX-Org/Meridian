"""GET /api/v1/rules/{check_id}/scope against a real Postgres (seed: tests/m2_seed.py)."""
from __future__ import annotations

import json
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


@pytest.mark.anyio
async def test_scope_of_a_shipped_rule(owner, monkeypatch):
    s = seed_m2(owner)
    with owner.begin() as c:
        c.execute(text("INSERT INTO rule_versions (tenant_id, rule_id, version, body, state, created_by, created_at) "
                       "VALUES (:t, 'MM014', 1, CAST('{}' AS jsonb), 'retired', 'ann', now() - interval '3 days'), "
                       "(:t, 'MM014', 2, CAST('{\"severity\": \"high\"}' AS jsonb), 'active', 'bob', now() - interval '1 day')"),
                  {"t": s["tid"]})
        # one contract names the rule, one sets a completeness floor for material master, one is for another object
        for name, producer, qc in (("Names it", "MDM", {"must_pass": ["MM014"]}),
                                   ("Completeness floor", "material_master feed", {"completeness": 90.0}),
                                   ("Other object", "gl feed", {"completeness": 99, "modules": ["fi_gl"]})):
            c.execute(text("INSERT INTO contracts (tenant_id, name, producer, consumer, quality_contract, status) "
                           "VALUES (:t, :n, :p, 'BI', CAST(:q AS jsonb), 'active')"),
                      {"t": s["tid"], "n": name, "p": producer, "q": json.dumps(qc)})
    client = await start(monkeypatch, s["tid"])
    async with client:
        r = await client.get("/api/v1/rules/MM014/scope", headers=headers())
        assert r.status_code == 200, r.text
        b = r.json()
        assert (b["check_id"], b["module"], b["name"]) == ("MM014", "material_master", "Base unit of measure not valid")

        d = b["definition"]
        assert (d["source"], d["check_class"], d["field"], d["table"], d["dimension"]) == ("shipped", "null_check", "MARA.NTGEW", "MARA", "completeness")
        assert d["expression"] is None and isinstance(d["params"], dict)
        a = b["authority"]
        assert a["rule_authority"] and a["why_it_matters"] and a["sap_impact"]

        # where it runs in the current state: the ECC system's material master, at the landscape run
        assert len(b["objects"]) == 1
        o = b["objects"][0]
        assert (o["system_id"], o["system_name"], o["module"], o["run_id"], o["failing"], o["checked"]) == (
            s["ecc"], "ECC production", "material_master", s["run"], 3640, 61816)
        assert b["systems"] == [{"id": s["ecc"], "name": "ECC production", "failing": 3640, "objects": 1}]
        assert b["failing_records"] == 3640 and b["failing_by_object"] == [{"module": "material_master", "label": "Material master", "failing": 3640}]
        assert b["features"] == [{"feature": "Goods receipt", "status": "blocked", "system_id": s["ecc"]}]

        assert [(v["version"], v["state"], v["author"]) for v in b["versions"]] == [(2, "active", "bob"), (1, "retired", "ann")]
        assert b["versions"][0]["created_at"]
        assert b["shipped"]["source"] == "ecc/material_master.yaml" and len(b["shipped"]["hash"]) == 16
        assert {(c["name"], c["via"], c["threshold"]) for c in b["contracts"]} == {
            ("Names it", "names_rule", None), ("Completeness floor", "dimension_threshold", 90.0)}

        # another rule with a pattern: the expression is the pattern
        mm2 = (await client.get("/api/v1/rules/MM002/scope", headers=headers())).json()
        assert mm2["definition"]["check_class"] == "regex_check" and mm2["definition"]["expression"].startswith("^")
        assert mm2["objects"] == [] and mm2["systems"] == [] and mm2["failing_records"] == 0 and mm2["features"] == []

        assert (await client.get("/api/v1/rules/NOPE999/scope", headers=headers())).status_code == 404
        # a module that does not ship the rule is not found; one that does narrows the objects
        assert (await client.get("/api/v1/rules/MM014/scope", params={"module": "fi_gl"}, headers=headers())).status_code == 404
        narrow = (await client.get("/api/v1/rules/MM014/scope", params={"module": "material_master"}, headers=headers())).json()
        assert [x["module"] for x in narrow["objects"]] == ["material_master"]


@pytest.mark.anyio
async def test_scope_contracts(owner, monkeypatch):
    s = seed_m2(owner)
    with owner.begin() as c:
        c.execute(text("INSERT INTO contracts (tenant_id, name, producer, consumer, quality_contract, status) VALUES "
                       "(:t, 'Names it', 'MDM', 'BI', CAST(:a AS jsonb), 'active')"),
                  {"t": s["tid"], "a": json.dumps({"must_pass": ["MM031"]})})
        c.execute(text("INSERT INTO contracts (tenant_id, name, producer, consumer, quality_contract, status) VALUES "
                       "(:t, 'Accuracy floor', 'material_master feed', 'BI', CAST(:a AS jsonb), 'draft')"),
                  {"t": s["tid"], "a": json.dumps({"accuracy": 85.5})})
        c.execute(text("INSERT INTO contracts (tenant_id, name, producer, consumer, quality_contract, status) VALUES "
                       "(:t, 'Other object', 'gl feed', 'BI', CAST(:a AS jsonb), 'active')"),
                  {"t": s["tid"], "a": json.dumps({"accuracy": 99, "modules": ["fi_gl"]})})
    client = await start(monkeypatch, s["tid"])
    async with client:
        b = (await client.get("/api/v1/rules/MM031/scope", headers=headers())).json()
        # MM031 is a validity rule in the YAML, so only the contract naming it applies; the accuracy floor is for accuracy
        assert [(c["name"], c["via"], c["threshold"]) for c in b["contracts"]] == [("Names it", "names_rule", None)]
        assert b["definition"]["dimension"] == "validity"
        with owner.begin() as c:
            c.execute(text("UPDATE contracts SET quality_contract = CAST(:q AS jsonb) WHERE tenant_id = :t AND name = 'Accuracy floor'"),
                      {"t": s["tid"], "q": json.dumps({"validity": 85.5})})
        b = (await client.get("/api/v1/rules/MM031/scope", headers=headers())).json()
        assert {(c["name"], c["via"], c["threshold"]) for c in b["contracts"]} == {
            ("Names it", "names_rule", None), ("Accuracy floor", "dimension_threshold", 85.5)}


@pytest.mark.anyio
async def test_scope_is_tenant_scoped(owner, monkeypatch):
    s = seed_m2(owner)
    from tests.landscape_seed import seed
    bare = seed(owner, with_run=False)
    client = await start(monkeypatch, bare["tid"])
    async with client:
        # the shipped rule is the same for every tenant, but nothing of another tenant's runs, versions or contracts shows
        b = (await client.get("/api/v1/rules/MM014/scope", headers=headers())).json()
        assert b["objects"] == [] and b["systems"] == [] and b["failing_records"] == 0 and b["features"] == []
        assert b["versions"] == [] and b["contracts"] == []
        assert b["name"] is None or b["name"] == b["definition"]["message"]
        # a rule only the first tenant has results for is unknown here
        assert (await client.get("/api/v1/rules/MM200/scope", headers=headers())).status_code == 200  # shipped
        assert (await client.get("/api/v1/rules/ZZ001/scope", headers=headers())).status_code == 404
    mine = await start(monkeypatch, s["tid"])
    async with mine:
        assert (await mine.get("/api/v1/rules/MM014/scope", headers=headers())).json()["failing_records"] == 3640
