"""Fix batch approval through the workflow engine: the seeded default reproduces today's four-eyes approval, a
two-step definition holds the batch in draft until its last step, and send-back and undo keep the approval in step.
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
def batch():
    eng = seed.engine()
    w = seed.seed_tenant(eng)
    bid = str(uuid.uuid4())
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("INSERT INTO remediation_batches (id, tenant_id, name, status, created_by, created_by_label) "
                       "VALUES (:b, :t, 'Lead times', 'draft', :u, 'requester@example.com')"),
                  {"b": bid, "t": w["tid"], "u": w["requester"]})
        for k in ("MATNR=1|WERKS=1000", "MATNR=2|WERKS=1000"):
            c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, "
                           "field, current_value, proposed_value) VALUES (:t, :b, 'S', 'material_master', 'MM_PLIFZ', "
                           ":k, 'MARC.PLIFZ', '', '12')"), {"t": w["tid"], "b": bid, "k": k})
        c.execute(text("INSERT INTO webhooks (tenant_id, url, secret, events) VALUES (:t, 'https://h.example/a', "
                       "'whsec_test_secret_123', ARRAY['*'])"), {"t": w["tid"]})
    yield eng, w, bid
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
async def test_the_default_workflow_is_todays_four_eyes_approval(batch, monkeypatch):
    eng, w, bid = batch
    tid = w["tid"]
    url = f"/api/v1/remediation/batches/{bid}/approve"
    own = await _post(monkeypatch, tid, w["requester"], url)
    assert own.status_code == 403 and own.json()["detail"] == "The batch creator cannot approve it."
    r = await _post(monkeypatch, tid, w["alice"], url)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "approved" and uuid.UUID(body["action_id"])
    assert body["workflow"]["workflow"] == "default-fix-batch" and body["workflow"]["status"] == "approved"
    assert _q(eng, tid, "SELECT status, approved_by::text FROM remediation_batches WHERE id = :b", b=bid) == [
        ("approved", w["alice"])]
    inst = _q(eng, tid, "SELECT status, definition_version, requester_id::text FROM workflow_instances "
                        "WHERE object_kind = 'fix_batch' AND object_id = :b", b=bid)
    assert inst == [("approved", 1, w["requester"])]
    # the same webhook traffic as before: a wildcard subscription hears batch.approved and no workflow step event
    events = [r[0] for r in _q(eng, tid, "SELECT event FROM webhook_deliveries WHERE tenant_id = :t")]
    assert events == ["batch.approved"]
    # the default does not notify approvers of a step decided at once; the creator hears of the outcome from the
    # batch (F07), not from the engine
    assert _q(eng, tid, "SELECT count(*) FROM notifications WHERE tenant_id = :t AND type = 'approval'") == [(0,)]
    assert _q(eng, tid, "SELECT user_id::text, title FROM notifications WHERE tenant_id = :t AND type = 'batch_approved'") == [
        (w["requester"], "Fix batch Lead times was approved")]
    again = await _post(monkeypatch, tid, w["bob"], url)
    assert again.status_code == 409


@pytest.mark.anyio
async def test_a_two_step_workflow_keeps_the_batch_a_draft_until_its_last_step(batch, monkeypatch):
    eng, w, bid = batch
    tid = w["tid"]
    doc = {"steps": [{"name": "Four eyes", "assignee": {"rule": "role", "action": "approve"}},
                     {"name": "Material owner", "assignee": {"rule": "users", "users": [w["bob"], w["carol"]]},
                      "when": [{"fact": "modules", "op": "contains", "value": "material_master"}]}]}
    with seed.tenant_conn(eng, tid) as c:
        c.execute(text("INSERT INTO workflow_definitions (tenant_id, key, name, object_kind, version, active, definition) "
                       "VALUES (:t, 'materials', 'Materials', 'fix_batch', 1, true, CAST(:d AS jsonb))"),
                  {"t": tid, "d": json.dumps(doc)})
    url = f"/api/v1/remediation/batches/{bid}/approve"
    first = await _post(monkeypatch, tid, w["alice"], url)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "draft" and first.json()["workflow"]["waiting_step"] == "Material owner"
    assert _q(eng, tid, "SELECT status FROM remediation_batches WHERE id = :b", b=bid) == [("draft",)]
    # the second step's approvers are told
    titles = [r[0] for r in _q(eng, tid, "SELECT title FROM notifications WHERE user_id = :u", u=w["bob"])]
    assert titles == ["Material owner: Fix batch Lead times waits for your approval"]
    # alice approved the first step: not the second
    twice = await _post(monkeypatch, tid, w["alice"], url)
    assert twice.status_code == 403 and "different person" in twice.json()["detail"]
    r = await _post(monkeypatch, tid, w["bob"], url)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved" and r.json()["workflow"]["steps"][1]["decided_by"]
    assert _q(eng, tid, "SELECT status FROM remediation_batches WHERE id = :b", b=bid) == [("approved",)]


@pytest.mark.anyio
async def test_send_back_and_undo_keep_the_approval_in_step(batch, monkeypatch):
    eng, w, bid = batch
    tid = w["tid"]
    url = f"/api/v1/remediation/batches/{bid}/approve"
    ap = await _post(monkeypatch, tid, w["alice"], url)
    assert ap.status_code == 200, ap.text
    sb = await _post(monkeypatch, tid, w["bob"], f"/api/v1/remediation/batches/{bid}/send-back", {"note": "Plant 2000"})
    assert sb.status_code == 200, sb.text

    def inst():
        return [r[0] for r in _q(eng, tid, "SELECT status FROM workflow_instances WHERE object_id = :b "
                                           "ORDER BY started_at", b=bid)]
    assert inst() == ["withdrawn"]
    undo = await _post(monkeypatch, tid, w["bob"], "/api/v1/actions/undo", {"action_id": sb.json()["action_id"]})
    assert undo.status_code == 200, undo.text
    assert inst() == ["approved"]
    undo2 = await _post(monkeypatch, tid, w["alice"], "/api/v1/actions/undo", {"action_id": ap.json()["action_id"]})
    assert undo2.status_code == 200, undo2.text
    assert inst() == ["withdrawn"]
    # approved again: a new approval, the old one stays in the history
    ap2 = await _post(monkeypatch, tid, w["carol"], url)
    assert ap2.status_code == 200 and inst() == ["withdrawn", "approved"]
