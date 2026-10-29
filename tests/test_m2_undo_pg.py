"""POST /api/v1/actions/undo and the action_id every mutating decision route returns, against a real Postgres.

Seed: tests/m2_seed.py. Decide, a group's accept-all and set-value, a batch's approve and send-back each return an
action_id; undo puts back the previous status, value, assignee and approval state, within ten minutes, for the same user
or an admin, and writes an audit_log row.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import USER, headers, make_client
from tests.m2_seed import R1, R1B, R2, R3, seed_m2

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

OTHER = "00000000-0000-0000-0000-0000000000c9"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


@pytest.fixture
def s(owner):
    return seed_m2(owner)


class Clock:
    def __init__(self):
        self.t = datetime.now(timezone.utc)

    def __call__(self):
        return self.t


@pytest.fixture
def clock(monkeypatch):
    from api.services import undo
    c = Clock()
    monkeypatch.setattr(undo, "now", c)
    return c


def q(owner, sql, **p):
    with owner.begin() as c:
        res = c.execute(text(sql), p)
        return res.fetchall() if res.returns_rows else []


def issue(owner, s, key, check):
    return q(owner, "SELECT status, resolution, assigned_to::text FROM record_issues WHERE id = :i", i=s["issue"][f"{key}#{check}"])[0]


def items(owner, s, key):
    return q(owner, "SELECT check_id, proposed_value, proposal_source FROM remediation_items WHERE tenant_id = :t AND record_key = :k "
                    "ORDER BY check_id", t=s["tid"], k=key)


async def start(monkeypatch, s, sub=USER):
    deps, client = make_client(monkeypatch, s["tid"], sub)
    await deps.engine.dispose()
    return client


@pytest.mark.anyio
async def test_decide_then_undo_restores_status_and_value(s, owner, monkeypatch, clock):
    client = await start(monkeypatch, s)
    async with client:
        before = (await client.get(f"/api/v1/work/records/material_master/{R1}", headers=headers())).json()
        assert {i["check_id"]: i["status"] for i in before["issues"]} == {"MM014": "to_fix", "MM031": "to_fix"}

        r = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R1, "check_id": "MM014", "action": "edit", "value": "PC"}]})
        assert r.status_code == 200, r.text
        action_id = r.json()["action_id"]
        assert uuid.UUID(action_id) and r.json()["updated"] == 1
        assert items(owner, s, R1) == [("MM014", "PC", "steward")]
        assert issue(owner, s, R1, "MM014")[0] == "in_progress"
        mid = (await client.get(f"/api/v1/work/records/material_master/{R1}", headers=headers())).json()
        assert {i["check_id"]: i["status"] for i in mid["issues"]}["MM014"] == "proposed"

        u = await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": action_id})
        assert u.status_code == 200, u.text
        body = u.json()
        assert (body["action_id"], body["kind"]) == (action_id, "decide")
        assert body["restored"] == {"issues": 1, "items_restored": 0, "items_removed": 1, "batch": False}
        assert items(owner, s, R1) == []
        assert issue(owner, s, R1, "MM014")[0] == "open"
        after = (await client.get(f"/api/v1/work/records/material_master/{R1}", headers=headers())).json()
        assert {i["check_id"]: i["status"] for i in after["issues"]} == {"MM014": "to_fix", "MM031": "to_fix"}

        # the undo is on the record's history and in the audit log, and cannot be repeated
        ev = q(owner, "SELECT action, from_value, to_value, note FROM record_issue_events WHERE issue_id = :i AND note = 'Decision undone'",
               i=s["issue"][f"{R1}#MM014"])
        assert ev == [("status", "in_progress", "open", "Decision undone")]
        audit = q(owner, "SELECT action, entity_type, after_json->>'undone_at' FROM audit_log WHERE tenant_id = :t AND entity_id = :e",
                  t=s["tid"], e=action_id)
        assert audit and audit[0][:2] == ("undo", "undo_action") and audit[0][2]
        assert q(owner, "SELECT undone_at IS NOT NULL FROM undo_actions WHERE id = :i", i=action_id) == [(True,)]
        again = await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": action_id})
        assert again.status_code == 409 and "already been undone" in again.json()["detail"]


@pytest.mark.anyio
async def test_sign_off_and_assign_undo(s, owner, monkeypatch, clock):
    client = await start(monkeypatch, s)
    async with client:
        r = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R2, "check_id": "MM014", "action": "assign", "assignee": s["bob"]},
            {"module": "material_master", "record_key": R3, "check_id": "MM014", "action": "not_an_issue", "note": "Legacy plant"}]})
        assert r.status_code == 200, r.text
        assert issue(owner, s, R2, "MM014")[2] == s["bob"]
        assert issue(owner, s, R3, "MM014")[:2] == ("accepted", "false_positive")
        u = await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": r.json()["action_id"]})
        assert u.status_code == 200, u.text
        assert u.json()["restored"]["issues"] == 2
        assert issue(owner, s, R2, "MM014") == ("open", None, None)
        assert issue(owner, s, R3, "MM014") == ("open", None, None)


@pytest.mark.anyio
async def test_decision_that_changes_nothing_has_no_action(s, monkeypatch, clock):
    client = await start(monkeypatch, s)
    async with client:
        r = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R1, "check_id": "MM014", "action": "comment", "note": "Looking at it"}]})
        assert r.status_code == 200 and r.json()["action_id"] is None


@pytest.mark.anyio
async def test_group_accept_all_and_set_value_undo(s, owner, monkeypatch, clock):
    client = await start(monkeypatch, s)
    async with client:
        # accept-all fills the two records the rule proposes a value for
        a = await client.post("/api/v1/work/groups/MM014/accept-all", headers=headers())
        assert a.status_code == 200, a.text
        assert a.json()["accepted"] == 2 and uuid.UUID(a.json()["action_id"])
        assert items(owner, s, R1) == [("MM014", "EA", "rule")] and items(owner, s, R2) == [("MM014", "EA", "rule")]
        assert issue(owner, s, R2, "MM014")[0] == "in_progress"
        u = await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": a.json()["action_id"]})
        assert u.status_code == 200, u.text
        assert u.json()["restored"]["items_removed"] == 2 and u.json()["restored"]["issues"] == 2
        assert items(owner, s, R1) == [] and items(owner, s, R2) == []
        assert issue(owner, s, R2, "MM014")[0] == "open" and issue(owner, s, R1, "MM014")[0] == "open"

        # set-value replaces a steward's own value for R1; undo gives it back and removes the rest
        e = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R1, "check_id": "MM014", "action": "edit", "value": "PC"}]})
        assert e.status_code == 200
        v = await client.post("/api/v1/work/groups/MM014/set-value", headers=headers(), json={"value": "KG"})
        assert v.status_code == 200, v.text
        assert v.json()["updated"] == 4 and uuid.UUID(v.json()["action_id"])
        assert items(owner, s, R1) == [("MM014", "KG", "steward")] and items(owner, s, R1B) == [("MM014", "KG", "steward")]
        u2 = await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": v.json()["action_id"]})
        assert u2.status_code == 200, u2.text
        assert u2.json()["restored"]["items_restored"] == 1 and u2.json()["restored"]["items_removed"] == 3
        assert items(owner, s, R1) == [("MM014", "PC", "steward")]
        assert items(owner, s, R1B) == [] and items(owner, s, R2) == [] and items(owner, s, R3) == []
        assert issue(owner, s, R2, "MM014")[0] == "open" and issue(owner, s, R1, "MM014")[0] == "in_progress"


@pytest.mark.anyio
async def test_batch_approve_and_send_back_undo(s, owner, monkeypatch, clock):
    client = await start(monkeypatch, s)
    b = s["bob_batch"]

    def batch():
        return q(owner, "SELECT status, approved_by IS NOT NULL, filter ? 'returned' FROM remediation_batches WHERE id = :b", b=b)[0]

    async with client:
        ap = await client.post(f"/api/v1/remediation/batches/{b}/approve", headers=headers())
        assert ap.status_code == 200, ap.text
        assert batch() == ("approved", True, False) and uuid.UUID(ap.json()["action_id"])
        u = await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": ap.json()["action_id"]})
        assert u.status_code == 200, u.text
        assert u.json()["restored"]["batch"] is True and batch() == ("draft", False, False)

        # a draft is sent back with a reason, and marked returned; undo clears the mark
        assert (await client.post(f"/api/v1/remediation/batches/{b}/send-back", headers=headers(), json={"note": " "})).status_code == 422
        sb = await client.post(f"/api/v1/remediation/batches/{b}/send-back", headers=headers(), json={"note": "Wrong unit for R3"})
        assert sb.status_code == 200, sb.text
        assert batch() == ("draft", False, True)
        assert q(owner, "SELECT to_value FROM remediation_events WHERE batch_id = :b AND action = 'sent_back'", b=b) == [("Wrong unit for R3",)]
        assert (await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": sb.json()["action_id"]})).status_code == 200
        assert batch() == ("draft", False, False)

        # an approved batch sent back returns to draft; undo approves it again; once exported nothing can be undone
        ap2 = await client.post(f"/api/v1/remediation/batches/{b}/approve", headers=headers())
        sb2 = await client.post(f"/api/v1/remediation/batches/{b}/send-back", headers=headers(), json={"note": "Check again"})
        assert sb2.status_code == 200 and batch() == ("draft", False, True)
        assert (await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": sb2.json()["action_id"]})).status_code == 200
        assert batch() == ("approved", True, False)
        q(owner, "UPDATE remediation_batches SET status = 'exported' WHERE id = :b", b=b)
        late = await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": ap2.json()["action_id"]})
        assert late.status_code == 409 and "exported" in late.json()["detail"]


@pytest.mark.anyio
async def test_undo_window_uses_the_clock(s, owner, monkeypatch, clock):
    client = await start(monkeypatch, s)
    async with client:
        d1 = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R2, "check_id": "MM014", "action": "not_an_issue", "note": "x"}]})
        clock.t += timedelta(minutes=9, seconds=59)
        ok = await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": d1.json()["action_id"]})
        assert ok.status_code == 200, ok.text

        d2 = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R3, "check_id": "MM014", "action": "not_an_issue", "note": "x"}]})
        clock.t += timedelta(minutes=10, seconds=1)
        late = await client.post("/api/v1/actions/undo", headers=headers(), json={"action_id": d2.json()["action_id"]})
        assert late.status_code == 409
        assert "10 minutes" in late.json()["detail"] and late.json()["detail"].endswith(".")
        assert issue(owner, s, R3, "MM014")[0] == "accepted"  # untouched


@pytest.mark.anyio
async def test_only_the_same_user_or_an_admin_may_undo(s, owner, monkeypatch, clock):
    client = await start(monkeypatch, s)
    async with client:
        d = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R2, "check_id": "MM014", "action": "not_an_issue", "note": "x"}]})
        aid = d.json()["action_id"]
    other = await start(monkeypatch, s, sub=OTHER)
    async with other:
        no = await other.post("/api/v1/actions/undo", headers=headers("analyst"), json={"action_id": aid})
        assert no.status_code == 403 and "who made this change" in no.json()["detail"]
        assert issue(owner, s, R2, "MM014")[0] == "accepted"
        yes = await other.post("/api/v1/actions/undo", headers=headers("admin"), json={"action_id": aid})
        assert yes.status_code == 200, yes.text
        assert issue(owner, s, R2, "MM014")[0] == "open"
        assert (await other.post("/api/v1/actions/undo", headers=headers("admin"),
                                 json={"action_id": str(uuid.uuid4())})).status_code == 404


@pytest.mark.anyio
async def test_undo_is_tenant_scoped(s, owner, monkeypatch, clock):
    client = await start(monkeypatch, s)
    async with client:
        d = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R2, "check_id": "MM014", "action": "not_an_issue", "note": "x"}]})
        aid = d.json()["action_id"]
    t2 = seed_m2(owner)
    other = await start(monkeypatch, t2)
    async with other:
        r = await other.post("/api/v1/actions/undo", headers=headers(), json={"action_id": aid})
        assert r.status_code == 404
    assert issue(owner, s, R2, "MM014")[0] == "accepted"
    assert q(owner, "SELECT count(*) FROM undo_actions WHERE tenant_id = :t", t=t2["tid"]) == [(0,)]
