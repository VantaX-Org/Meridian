"""F07: Approve and Send back tell the steward who built the batch, in the inbox and by email, with the comment;
once per approval and per send-back round. A definition that tells the requester itself is not doubled in the inbox.
"""
from __future__ import annotations

import json
import os
import uuid

import pytest
from sqlalchemy import text

from tests import workflow_seed as seed
from tests.m2_client import make_client

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

H = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


@pytest.fixture
def batch(monkeypatch):
    sent: list = []
    monkeypatch.setattr("api.services.handoff_notices.email_backend_name", lambda: "smtp")
    monkeypatch.setattr("api.services.handoff_notices.dispatch", lambda jobs: sent.extend(jobs) or len(sent))
    eng = seed.engine()
    w = seed.seed_tenant(eng)
    bid = str(uuid.uuid4())
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("INSERT INTO remediation_batches (id, tenant_id, name, status, created_by, created_by_label) "
                       "VALUES (:b, :t, 'Lead times', 'draft', :u, 'requester@example.com')"),
                  {"b": bid, "t": w["tid"], "u": w["requester"]})
        c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, "
                       "field, current_value, proposed_value) VALUES (:t, :b, 'S', 'material_master', 'MM_PLIFZ', "
                       "'MATNR=1|WERKS=1000', 'MARC.PLIFZ', '', '12')"), {"t": w["tid"], "b": bid})
    yield eng, w, bid, sent
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("DELETE FROM notification_deliveries WHERE tenant_id = :t"), {"t": w["tid"]})
    seed.drop_tenant(eng, w["tid"])
    eng.dispose()


def _q(eng, tid, sql, **p):
    with seed.tenant_conn(eng, tid) as c:
        return c.execute(text(sql), {"t": tid, **p}).fetchall()


async def _post(monkeypatch, tid, who, path, body=None):
    deps, client = make_client(monkeypatch, tid, who)
    await deps.engine.dispose()
    async with client:
        return await client.post(path, headers=H, json=body)


@pytest.mark.anyio
async def test_approve_tells_the_steward_with_the_comment(batch, monkeypatch):
    eng, w, bid, sent = batch
    r = await _post(monkeypatch, w["tid"], w["alice"], f"/api/v1/remediation/batches/{bid}/approve",
                    {"comment": "Checked with purchasing"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"
    rows = _q(eng, w["tid"], "SELECT user_id::text, title, body, link FROM notifications WHERE tenant_id = :t AND type = 'batch_approved'")
    assert len(rows) == 1 and rows[0][0] == w["requester"] and rows[0][1] == "Fix batch Lead times was approved"
    assert "Checked with purchasing" in rows[0][2] and rows[0][3] == f"/?open=batch:{bid}"
    assert [(j.user_id, j.subject) for j in sent] == [(w["requester"], "Fix batch Lead times was approved")]
    # the comment is the step's comment in the approval trail too
    assert _q(eng, w["tid"], "SELECT comment FROM workflow_tasks WHERE tenant_id = :t AND status = 'approved'") == [("Checked with purchasing",)]


@pytest.mark.anyio
async def test_approve_without_a_body_still_works_and_tells_the_steward(batch, monkeypatch):
    eng, w, bid, sent = batch
    r = await _post(monkeypatch, w["tid"], w["alice"], f"/api/v1/remediation/batches/{bid}/approve")
    assert r.status_code == 200, r.text
    assert len(_q(eng, w["tid"], "SELECT 1 FROM notifications WHERE tenant_id = :t AND type = 'batch_approved'")) == 1


@pytest.mark.anyio
async def test_send_back_tells_the_steward_each_round(batch, monkeypatch):
    eng, w, bid, sent = batch
    url = f"/api/v1/remediation/batches/{bid}/send-back"
    r = await _post(monkeypatch, w["tid"], w["alice"], url, {"note": "Plant 2000 is missing"})
    assert r.status_code == 200, r.text
    rows = _q(eng, w["tid"], "SELECT user_id::text, title, body FROM notifications WHERE tenant_id = :t AND type = 'batch_sent_back'")
    assert [(u, t) for u, t, _ in rows] == [(w["requester"], "Fix batch Lead times was sent back")]
    assert "Plant 2000 is missing" in rows[0][2]
    r2 = await _post(monkeypatch, w["tid"], w["bob"], url, {"note": "Still missing"})
    assert r2.status_code == 200, r2.text
    assert len(_q(eng, w["tid"], "SELECT 1 FROM notifications WHERE tenant_id = :t AND type = 'batch_sent_back'")) == 2
    assert [j.user_id for j in sent] == [w["requester"], w["requester"]]


@pytest.mark.anyio
async def test_a_definition_that_tells_the_requester_is_not_doubled(batch, monkeypatch):
    eng, w, bid, sent = batch
    doc = {"steps": [{"name": "Four eyes", "assignee": {"rule": "role", "action": "approve"}}],
           "notify_requester": True}
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("INSERT INTO workflow_definitions (tenant_id, key, name, object_kind, version, active, definition) "
                       "VALUES (:t, 'told', 'Told', 'fix_batch', 1, true, CAST(:d AS jsonb))"),
                  {"t": w["tid"], "d": json.dumps(doc)})
    r = await _post(monkeypatch, w["tid"], w["alice"], f"/api/v1/remediation/batches/{bid}/approve")
    assert r.status_code == 200, r.text
    to_steward = _q(eng, w["tid"], "SELECT type FROM notifications WHERE tenant_id = :t AND user_id = :u", u=w["requester"])
    assert to_steward == [("approval",)]  # the engine's line; the batch adds the email only
    assert [j.user_id for j in sent] == [w["requester"]]


@pytest.mark.anyio
async def test_a_step_decided_through_the_workflow_carries_its_comment(batch, monkeypatch):
    eng, w, bid, sent = batch
    doc = {"steps": [{"name": "Four eyes", "assignee": {"rule": "role", "action": "approve"}},
                     {"name": "Owner", "assignee": {"rule": "users", "users": [w["bob"]]}}],
           "notify_requester": False}
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("INSERT INTO workflow_definitions (tenant_id, key, name, object_kind, version, active, definition) "
                       "VALUES (:t, 'two', 'Two', 'fix_batch', 1, true, CAST(:d AS jsonb))"),
                  {"t": w["tid"], "d": json.dumps(doc)})
    first = await _post(monkeypatch, w["tid"], w["alice"], f"/api/v1/remediation/batches/{bid}/approve")
    assert first.status_code == 200 and first.json()["status"] == "draft"
    assert _q(eng, w["tid"], "SELECT count(*) FROM notifications WHERE tenant_id = :t AND type = 'batch_approved'") == [(0,)]
    task = _q(eng, w["tid"], "SELECT id::text FROM workflow_tasks WHERE tenant_id = :t AND status = 'pending'")[0][0]
    r = await _post(monkeypatch, w["tid"], w["bob"], f"/api/v1/workflows/tasks/{task}/decide",
                    {"decision": "approve", "comment": "Fine by me"})
    assert r.status_code == 200, r.text
    body = _q(eng, w["tid"], "SELECT body FROM notifications WHERE tenant_id = :t AND type = 'batch_approved'")
    assert len(body) == 1 and "Fine by me" in body[0][0]

