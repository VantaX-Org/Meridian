"""The Work ledger's backend additions against a real Postgres (seed: tests/m2_seed.py): value / due / owner sorts with
cursor paging, the readable row fields, the record's field descriptions, filtered summary counts and the command hrefs.

Seeded failing records of the landscape run (checks MM014 = MARA.MEINS, 4,000,000 over 3640 records; MM031 = 200,000
over 1000): R1 fails MM014 and MM031 (1098.90 + 200.00 = 1298.90 at risk), R2 and R3 fail MM014 (1098.90 each).
"""
from __future__ import annotations

import json
import os

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import USER, headers, make_client
from tests.m2_seed import R1, R2, R3, seed_m2

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

NO_COST = "MATNR=000000000000000105|WERKS=3000"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


async def start(monkeypatch, tid, sub=USER):
    deps, client = make_client(monkeypatch, tid, sub)
    await deps.engine.dispose()
    return client


def seed_work(owner) -> dict:
    """seed_m2 plus a fourth open record whose only check (MM100) is unpriced, valid values for MM014 and a draft batch
    of the test user holding a value for R2 (status proposed)."""
    s = seed_m2(owner)
    with owner.begin() as c:
        ctx = {"valid_values_with_labels": {f"U{n:02d}": f"Unit {n}" for n in range(25)} | {"EA": "each"}}
        c.execute(text("UPDATE findings SET rule_context = CAST(:c AS jsonb) WHERE version_id = :v AND check_id = 'MM014'"),
                  {"c": json.dumps(ctx), "v": s["run"]})
        c.execute(text("INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, name, issues, sev_rank, "
                       "checks, status) VALUES (:t, :v, :s, 'material_master', :k, 'No cost', 1, 3, ARRAY['MM100'], 'to_fix')"),
                  {"t": s["tid"], "v": s["run"], "s": s["ecc"], "k": NO_COST})
        batch = c.execute(text("INSERT INTO remediation_batches (tenant_id, name, status, filter, created_by, created_by_label) "
                               "VALUES (:t, 'Mine', 'draft', CAST('{\"source\": \"worklist\"}' AS jsonb), :u, 'me') RETURNING id::text"),
                          {"t": s["tid"], "u": USER}).scalar()
        c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, proposed_value, "
                       "proposal_source) VALUES (:t, :b, :s, 'material_master', 'MM014', :k, 'EA', 'steward')"),
                  {"t": s["tid"], "b": batch, "s": s["ecc"], "k": R2})
    return s


async def listing(client, sort=None, limit=500, **params):
    r = await client.get("/api/v1/work/records", params={"scope": "current", "limit": limit, **({"sort": sort} if sort else {}),
                                                         **params}, headers=headers())
    assert r.status_code == 200, r.text
    return r.json()


async def paged(client, sort, limit=1):
    """Every key of the list, a page of ``limit`` at a time through the cursor."""
    keys, after = [], None
    for _ in range(20):
        body = await listing(client, sort, limit, **({"after": after} if after else {}))
        keys += [i["record_key"] for i in body["items"]]
        after = body["next"]
        if not after:
            return keys
    raise AssertionError("cursor did not end")


@pytest.mark.anyio
@pytest.mark.parametrize("sort", ["value", "-value", "due", "-due", "owner", "-owner", "-value,owner", "owner,-due"])
async def test_sorts_page_by_cursor_in_the_same_order(owner, monkeypatch, sort):
    s = seed_work(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        whole = [i["record_key"] for i in (await listing(client, sort))["items"]]
        assert len(whole) == 4 and len(set(whole)) == 4
        assert await paged(client, sort, 1) == whole
        assert await paged(client, sort, 3) == whole


@pytest.mark.anyio
async def test_sort_orders(owner, monkeypatch):
    s = seed_work(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        top = await listing(client, "-value")
        assert top["items"][0]["record_key"] == R1
        assert top["items"][-1]["record_key"] == NO_COST and top["items"][-1]["value_at_risk"] is None  # nulls last
        low = await listing(client, "value")
        assert low["items"][-1]["record_key"] == NO_COST  # nulls last ascending too
        assert [i["value_at_risk"] for i in low["items"][:3]] == [1098.9, 1098.9, 1298.9]

        due = [i["record_key"] for i in (await listing(client, "due"))["items"]]
        assert due[0] == R1  # the only record with a due date; the rest sort last
        assert (await listing(client, "-due"))["items"][0]["record_key"] == R1

        asc = (await listing(client, "owner"))["items"]
        desc = (await listing(client, "-owner"))["items"]
        names = [i["assignee_email"] for i in asc]
        assert names[-1] is None and names[-2] is not None  # unassigned last
        assert [i["assignee_email"] for i in desc][-1] is None
        assigned = [n for n in names if n]
        assert assigned == sorted(assigned, key=str.lower)
        assert [i["assignee_email"] for i in desc if i["assignee_email"]] == assigned[::-1]
        r = await client.get("/api/v1/work/records", params={"sort": "colour"}, headers=headers())
        assert r.status_code == 422 and "value" in r.json()["detail"]
        # a cursor of another sort is refused
        nxt = (await listing(client, "value", 1))["next"]
        r = await client.get("/api/v1/work/records", params={"sort": "due", "after": nxt}, headers=headers())
        assert r.status_code == 422


@pytest.mark.anyio
async def test_row_fields_with_a_cost_model(owner, monkeypatch):
    s = seed_work(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        rows = {i["record_key"]: i for i in (await listing(client))["items"]}
        r1, r2, r3, bare = rows[R1], rows[R2], rows[R3], rows[NO_COST]
        assert r1["value_at_risk"] == 1298.9 and r2["value_at_risk"] == 1098.9
        assert (r1["current_value"], r1["field_description"]) == ("XX", "Base unit of measure")
        assert r1["current_label"] is None and r1["suggested_label"] is None  # XX is not in the rule's list: never invented
        assert r1["possible_values_total"] == 26 and len(r1["possible_values"]) == 20
        assert {"value": "EA", "label": "each"} in r1["possible_values"] or r1["possible_values"][0]["label"].startswith("Unit")
        assert all(set(v) == {"value", "label"} for v in r1["possible_values"])
        assert r2["status"] == "proposed" and r2["new_value"] == "EA" and r1["new_value"] is None and r3["new_value"] is None
        assert r1["resolution"] is None
        # a record whose check names no field has none of the field values; unpriced means null, not zero
        assert bare["value_at_risk"] is None
        assert bare["current_value"] is None and bare["field_description"] is None
        assert bare["possible_values"] is None and bare["possible_values_total"] is None


@pytest.mark.anyio
async def test_row_fields_without_a_cost_model_and_resolution(owner, monkeypatch):
    s = seed_work(owner)
    with owner.begin() as c:
        c.execute(text("UPDATE findings SET cost_at_risk = NULL WHERE tenant_id = :t"), {"t": s["tid"]})
        c.execute(text("UPDATE work_records SET status = 'not_an_issue' WHERE version_id = :v AND record_key = :k"),
                  {"v": s["run"], "k": R3})
        c.execute(text("UPDATE record_issues SET status = 'accepted', resolution = 'accepted_risk' "
                       "WHERE tenant_id = :t AND record_key = :k AND check_id = 'MM014'"), {"t": s["tid"], "k": R3})
        c.execute(text("UPDATE work_records SET status = 'not_an_issue' WHERE version_id = :v AND record_key = :k"),
                  {"v": s["run"], "k": R2})  # signed off, but no draft value is shown for it any more
    client = await start(monkeypatch, s["tid"])
    async with client:
        rows = {i["record_key"]: i for i in (await listing(client, status="all"))["items"]}
        assert all(i["value_at_risk"] is None for i in rows.values())
        assert rows[R3]["resolution"] == "accepted_risk" and rows[R1]["resolution"] is None
        assert rows[R2]["new_value"] is None and rows[R2]["resolution"] is None
        # sorting by value still works and pages when nothing is priced
        keys = [i["record_key"] for i in (await listing(client, "-value"))["items"]]
        assert await paged(client, "-value", 1) == keys


@pytest.mark.anyio
async def test_record_field_descriptions(owner, monkeypatch):
    s = seed_work(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        r = await client.get(f"/api/v1/work/records/material_master/{R1}", headers=headers())
        assert r.status_code == 200, r.text
        d = r.json()["field_descriptions"]
        assert d["MARA.MEINS"] == "Base unit of measure"
        assert set(d) == {f"MARA.{k}" for k in r.json()["values"]}  # one entry per field of the record
        assert d["MARA.MATKL"]  # a described or named field, never empty


@pytest.mark.anyio
async def test_summary_objects_follow_the_filters(owner, monkeypatch):
    s = seed_work(owner)
    with owner.begin() as c:  # the fixed fi_gl record fails MM014 in the seed's work rows; give it its own check
        c.execute(text("UPDATE work_records SET checks = ARRAY['GL001'], sev_rank = 2 WHERE version_id = :v AND module = 'fi_gl'"),
                  {"v": s["run"]})
    client = await start(monkeypatch, s["tid"])
    async with client:
        async def objects(**params):
            r = await client.get("/api/v1/work/summary", params={"scope": "current", **params}, headers=headers())
            assert r.status_code == 200, r.text
            return {o["module"]: o for o in r.json()["objects"]}

        every = await objects()
        assert set(every) == {"material_master", "fi_gl"}
        mm = every["material_master"]
        assert mm["records"] == 5 and mm["statuses"] == {"to_fix": 3, "proposed": 1, "fixed": 1}

        only_gl = await objects(module="fi_gl")
        assert set(only_gl) == {"fi_gl"} and only_gl["fi_gl"]["records"] == 1
        by_check = await objects(check_id="MM100")
        assert set(by_check) == {"material_master"} and by_check["material_master"]["statuses"] == {"to_fix": 1}
        sev = await objects(severity="critical")
        assert sev["material_master"]["records"] == 4 and "fi_gl" not in sev
        assert (await objects(system=s["spare"])) == {}
        assert set(await objects(system=s["ecc"])) == {"material_master", "fi_gl"}
        # filters that are not the four leave the objects as they were
        assert (await objects(status="proposed"))["material_master"]["records"] == 5


@pytest.mark.anyio
async def test_command_action_hrefs_whatever_the_old_cookie_says(owner, monkeypatch):
    s = seed_work(owner)
    client = await start(monkeypatch, s["tid"])
    async with client:
        async def hrefs(**cookies):
            r = await client.get("/api/v1/command", params={"q": ""}, headers=headers(), cookies=cookies)
            assert r.status_code == 200, r.text
            group = next(g for g in r.json()["groups"] if g["kind"] == "action")
            return {i["id"]: i["href"] for i in group["items"]}

        # One interface since the cut-over: the mn_ui cookie of the old switch no longer changes where an action goes.
        new = await hrefs()
        assert new["approvals"] == "/work?filter=approvals" and new["export-fix-sheet"] == "/work?export=1"
        assert await hrefs(mn_ui="v1") == new and await hrefs(mn_ui="v2") == new
        assert all(v.startswith("/?open=system:") for k, v in new.items() if k.startswith("extract:"))


@pytest.mark.anyio
async def test_tenant_isolation(owner, monkeypatch):
    a, b = seed_work(owner), seed_work(owner)
    client = await start(monkeypatch, b["tid"])
    async with client:
        rows = (await listing(client, "-value"))["items"]
        assert {i["version_id"] for i in rows} == {b["run"]}
        assert all(i["value_at_risk"] is not None or i["record_key"] == NO_COST for i in rows)
        r = await client.get(f"/api/v1/work/records/material_master/{R1}", params={"version_id": a["run"]}, headers=headers())
        assert r.status_code == 404  # another tenant's run
        summary = (await client.get("/api/v1/work/summary", params={"scope": "current", "module": "material_master"},
                                    headers=headers())).json()
        assert summary["version_ids"] == [b["run"]] and summary["objects"][0]["records"] == 5
