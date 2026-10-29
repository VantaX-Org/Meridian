"""Batch fields on the work API, the batch_id filter, batch value / due / steward, batch reassignment with undo and
people's sla_met_pct, against a real Postgres (seed: tests/m2_seed.py).

The batch built here is Bob's "Cleanup" draft: MM014 items for R1 and R2 (proposed EA). MM014 and MM031 are priced so
the value at risk is known: MM014 10 per record, MM031 5 per record (R1 fails both).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_seed import R1, R2, R3, seed_m2

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

CREATED = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def q(owner, sql, **p):
    with owner.begin() as c:
        res = c.execute(text(sql), p)
        return res.fetchall() if res.returns_rows else []


def priced(owner, s):
    """Price MM014 at 10 and MM031 at 5 per failing record in the landscape run."""
    q(owner, "UPDATE findings SET cost_at_risk = affected_count * 10 WHERE version_id = :v AND check_id = 'MM014'", v=s["run"])
    q(owner, "UPDATE findings SET cost_at_risk = affected_count * 5 WHERE version_id = :v AND check_id = 'MM031'", v=s["run"])


def groups(owner, s):
    """The run's work groups, which the seed leaves out: a decision recomputes the work rows of the checks that have one."""
    for key, who in ((R1, s["bob"]), (R2, s["bob"]), (R3, s["user"])):  # the seed assigns the work rows only; the issues follow
        q(owner, "UPDATE record_issues SET assigned_to = :a WHERE tenant_id = :t AND record_key = :k", a=who, t=s["tid"], k=key)
    q(owner, "INSERT INTO work_groups (tenant_id, version_id, check_id, module, severity, sev_rank, dimension, message, records, population) "
             "SELECT tenant_id, version_id, check_id, module, severity, 0, dimension, check_id, affected_count, total_count "
             "FROM findings WHERE version_id = :v AND check_id IN ('MM014', 'MM031')", v=s["run"])


def make_batch(owner, s, name="Cleanup", keys=(R1, R2), created_by=None):
    created_by = created_by or s["bob"]
    bid = q(owner, "INSERT INTO remediation_batches (tenant_id, name, status, created_by, created_by_label, created_at) "
                   "VALUES (:t, :n, 'draft', :b, 'bob@example.com', :at) RETURNING id::text",
            t=s["tid"], n=name, b=created_by, at=CREATED)[0][0]
    for k in keys:
        q(owner, "INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key, proposed_value, "
                 "proposal_source) VALUES (:t, :b, CAST(:i AS uuid), :sc, 'material_master', 'MM014', :k, 'EA', 'steward')",
          t=s["tid"], b=bid, i=s["issue"].get(f"{k}#MM014"), sc=s["ecc"], k=k)
    return bid


async def start(monkeypatch, s, sub=None):
    deps, client = make_client(monkeypatch, s["tid"], sub or s["user"])
    await deps.engine.dispose()
    return client


def by_key(body):
    return {i["record_key"]: i for i in body["items"]}


@pytest.mark.anyio
async def test_rows_name_their_batch_and_the_filter_narrows(owner, monkeypatch):
    s = seed_m2(owner)
    bid = make_batch(owner, s)
    client = await start(monkeypatch, s)
    async with client:
        rows = by_key((await client.get("/api/v1/work/records?status=all&limit=100", headers=headers())).json())
        assert (rows[R1]["batch_id"], rows[R1]["batch_name"]) == (bid, "Cleanup")
        assert rows[R2]["batch_id"] == bid
        assert rows[R3]["batch_id"] is None and rows[R3]["batch_name"] is None
        assert rows[R1]["resolution_note"] is None and rows[R1]["resolved_by"] is None and rows[R1]["resolved_at"] is None

        r = await client.get(f"/api/v1/work/records?status=all&batch_id={bid}", headers=headers())
        assert r.status_code == 200, r.text
        assert sorted(i["record_key"] for i in r.json()["items"]) == sorted([R1, R2]) and r.json()["total"] == 2
        # the other batch (Bob's seeded one) holds one other record
        r = await client.get(f"/api/v1/work/records?status=all&batch_id={s['bob_batch']}", headers=headers())
        assert [i["record_key"] for i in r.json()["items"]] == ["MATNR=000000000000000104|WERKS=3000"] and r.json()["total"] == 1
        # any state of the batch counts
        q(owner, "UPDATE remediation_batches SET status = 'exported' WHERE id = :b", b=bid)
        r = await client.get(f"/api/v1/work/records?status=all&batch_id={bid}", headers=headers())
        assert r.json()["total"] == 2
        assert (await client.get("/api/v1/work/records?batch_id=nope", headers=headers())).status_code == 422


@pytest.mark.anyio
async def test_signed_off_rows_carry_the_note_who_and_when(owner, monkeypatch):
    s = seed_m2(owner)
    groups(owner, s)
    client = await start(monkeypatch, s)
    async with client:
        r = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R3, "action": "accept_risk", "note": "Legacy plant, retiring in Q4"}]})
        assert r.status_code == 200, r.text
        row = by_key((await client.get("/api/v1/work/records?status=all&limit=100", headers=headers())).json())[R3]
        assert row["status"] == "not_an_issue" and row["resolution"] == "accepted_risk"
        assert row["resolution_note"] == "Legacy plant, retiring in Q4"
        assert row["resolved_by"] == "Ann Steward"
        assert datetime.fromisoformat(row["resolved_at"]) > datetime.now(timezone.utc) - timedelta(minutes=5)


@pytest.mark.anyio
async def test_batch_list_and_detail_carry_value_due_steward_records(owner, monkeypatch):
    s = seed_m2(owner)
    priced(owner, s)
    bid = make_batch(owner, s)
    empty = make_batch(owner, s, name="Unknown records", keys=())
    client = await start(monkeypatch, s)
    async with client:
        listed = {b["id"]: b for b in (await client.get("/api/v1/remediation/batches", headers=headers())).json()["items"]}
        b = listed[bid]
        assert b["records"] == 2 and b["items"] == 2  # existing keys stay
        assert b["value_at_risk"] == 25.0  # R1: 10 + 5, R2: 10
        assert b["steward_label"] == "Bob Steward"
        # critical work, critical SLA policy 1440 minutes from creation
        assert datetime.fromisoformat(b["due_at"]) == CREATED + timedelta(days=1)
        # a batch with no records: no value, no due date, no records
        e = listed[empty]
        assert (e["records"], e["value_at_risk"], e["due_at"]) == (0, None, None)
        # Bob's seeded batch holds one record failing MM014 only
        assert listed[s["bob_batch"]]["value_at_risk"] == 10.0 and listed[s["bob_batch"]]["records"] == 1

        d = (await client.get(f"/api/v1/remediation/batches/{bid}", headers=headers())).json()
        assert {k: d["batch"][k] for k in ("records", "value_at_risk", "steward_label", "due_at")} == {
            "records": 2, "value_at_risk": 25.0, "steward_label": "Bob Steward", "due_at": b["due_at"]}
        assert len(d["items"]) == 2

        # without a cost model there is no value
        q(owner, "UPDATE findings SET cost_at_risk = NULL WHERE version_id = :v", v=s["run"])
        d = (await client.get(f"/api/v1/remediation/batches/{bid}", headers=headers())).json()
        assert d["batch"]["value_at_risk"] is None
        # without a policy there is no due date
        q(owner, "DELETE FROM sla_policies WHERE tenant_id = :t", t=s["tid"])
        d = (await client.get(f"/api/v1/remediation/batches/{bid}", headers=headers())).json()
        assert d["batch"]["due_at"] is None


@pytest.mark.anyio
async def test_reassign_then_undo_round_trip(owner, monkeypatch):
    s = seed_m2(owner)
    groups(owner, s)
    bid = make_batch(owner, s)
    client = await start(monkeypatch, s)
    async with client:
        before = {k: v["assigned_to"] for k, v in by_key((await client.get("/api/v1/work/records?limit=100", headers=headers())).json()).items()}
        assert before[R1] == s["bob"]
        r = await client.post(f"/api/v1/remediation/batches/{bid}/reassign", headers=headers(), json={"assignee_id": s["cara"]})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["batch_id"] == bid and out["reassigned"] == 2 and out["action_id"]
        rows = by_key((await client.get("/api/v1/work/records?limit=100", headers=headers())).json())
        assert (rows[R1]["assigned_to"], rows[R2]["assigned_to"]) == (s["cara"], s["cara"])
        assert rows[R3]["assigned_to"] == s["user"]  # not in the batch: untouched
        # every open issue of the batch's records, with an assign event each
        assert {r[0] for r in q(owner, "SELECT assigned_to::text FROM record_issues WHERE tenant_id = :t AND record_key = ANY(:k) "
                                       "AND check_id IN ('MM014', 'MM031')", t=s["tid"], k=[R1, R2])} == {s["cara"]}
        assert q(owner, "SELECT count(*) FROM record_issue_events WHERE tenant_id = :t AND action = 'assign' AND to_value = :c",
                 t=s["tid"], c=s["cara"])[0][0] == 3

        u = await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": out["action_id"]})
        assert u.status_code == 200, u.text
        assert u.json()["kind"] == "reassign_batch" and u.json()["restored"]["issues"] == 3
        rows = by_key((await client.get("/api/v1/work/records?limit=100", headers=headers())).json())
        assert {k: rows[k]["assigned_to"] for k in (R1, R2, R3)} == {k: before[k] for k in (R1, R2, R3)}
        assert (await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": out["action_id"]})).status_code == 409


@pytest.mark.anyio
async def test_reassign_checks(owner, monkeypatch):
    s = seed_m2(owner)
    groups(owner, s)
    bid = make_batch(owner, s)
    client = await start(monkeypatch, s)
    async with client:
        url = f"/api/v1/remediation/batches/{bid}/reassign"
        assert (await client.post(url, headers=headers(), json={"assignee_id": str(uuid.uuid4())})).status_code == 404
        assert (await client.post(url, headers=headers(), json={})).status_code == 422
        assert (await client.post(f"/api/v1/remediation/batches/{uuid.uuid4()}/reassign", headers=headers(),
                                  json={"assignee_id": s["cara"]})).status_code == 404
        # a viewer may not assign
        assert (await client.post(url, headers=headers("viewer"), json={"assignee_id": s["cara"]})).status_code == 403
        assert q(owner, "SELECT assigned_to::text FROM record_issues WHERE id = :i", i=s["issue"][f"{R1}#MM014"])[0][0] == s["bob"]


@pytest.mark.anyio
async def test_people_sla_met_pct(owner, monkeypatch):
    s = seed_m2(owner)
    now = datetime.now(timezone.utc)
    # Bob closed three issues with a due date in the last 90 days (two in time), one 100 days ago, one with no due date
    for n, (closed, due) in enumerate(((now - timedelta(days=3), now - timedelta(days=2)), (now - timedelta(days=10), now - timedelta(days=9)),
                                       (now - timedelta(days=5), now - timedelta(days=6)), (now - timedelta(days=100), now - timedelta(days=99)),
                                       (now - timedelta(days=4), None))):
        q(owner, "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, status, resolution, assigned_to, "
                 "first_seen_version, last_seen_version, resolved_at, due_at) VALUES (:t, :sc, 'material_master', :c, 'MATNR=7', 'high', "
                 "'resolved', 'verified_fixed', :b, :v, :v, :r, :d)",
          t=s["tid"], sc=s["ecc"], c=f"MM8{n}", b=s["bob"], v=s["run"], r=closed, d=due)
    client = await start(monkeypatch, s)
    async with client:
        people = {p["name"]: p for p in (await client.get("/api/v1/people", headers=headers())).json()["people"]}
        assert people["Bob Steward"]["sla_met_pct"] == 66.7
        assert people["Ann Steward"]["sla_met_pct"] is None and people["Cara Owner"]["sla_met_pct"] is None


@pytest.mark.anyio
async def test_tenant_isolation(owner, monkeypatch):
    s, t2 = seed_m2(owner), seed_m2(owner)
    priced(owner, s)
    bid = make_batch(owner, s)
    client = await start(monkeypatch, t2)
    async with client:
        assert bid not in {b["id"] for b in (await client.get("/api/v1/remediation/batches", headers=headers())).json()["items"]}
        assert (await client.get(f"/api/v1/remediation/batches/{bid}", headers=headers())).status_code == 404
        assert (await client.post(f"/api/v1/remediation/batches/{bid}/reassign", headers=headers(),
                                  json={"assignee_id": t2["cara"]})).status_code == 404
        r = await client.get(f"/api/v1/work/records?status=all&batch_id={bid}", headers=headers())
        assert r.json()["items"] == []
        rows = by_key((await client.get("/api/v1/work/records?status=all&limit=100", headers=headers())).json())
        assert all(v["batch_id"] != bid for v in rows.values())
    client2 = await start(monkeypatch, s)
    async with client2:
        # another tenant's user is not a valid assignee
        assert (await client2.post(f"/api/v1/remediation/batches/{bid}/reassign", headers=headers(),
                                   json={"assignee_id": t2["cara"]})).status_code == 404
