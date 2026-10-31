"""F08: without a BAPI send, exporting the load file is not "Sent to SAP". The first export of an approved batch moves
it to awaiting_load with who exported it and when, and tells the loader and the steward; Loaded in SAP (an approver
or SAP Basis, not the batch's creator) moves it to exported (Sent to SAP); the work status follows."""
from __future__ import annotations

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
    basis = str(uuid.uuid4())
    bid = str(uuid.uuid4())
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, 'basis@example.com', "
                       "'Basil', 'sap_basis')"), {"u": basis, "t": w["tid"]})
        c.execute(text("INSERT INTO remediation_batches (id, tenant_id, name, status, created_by, created_by_label, "
                       "approved_by, approved_by_label) VALUES (:b, :t, 'Lead times', 'approved', :u, 'requester', :a, "
                       "'alice')"), {"b": bid, "t": w["tid"], "u": w["requester"], "a": w["alice"]})
        c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, "
                       "field, current_value, proposed_value) VALUES (:t, :b, 'S', 'material_master', 'MM_PLIFZ', "
                       "'MATNR=1|WERKS=1000', 'MARC.PLIFZ', '', '12')"), {"t": w["tid"], "b": bid})
    w["basis"] = basis
    yield eng, w, bid, sent
    with seed.tenant_conn(eng, w["tid"]) as c:
        for t in ("notification_deliveries", "export_packages"):
            c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": w["tid"]})
    seed.drop_tenant(eng, w["tid"])
    eng.dispose()


def _one(eng, tid, sql, **p):
    with seed.tenant_conn(eng, tid) as c:
        return c.execute(text(sql), {"t": tid, **p}).first()


async def _call(monkeypatch, tid, who, method, path, body=None, role="admin"):
    deps, client = make_client(monkeypatch, tid, who)
    await deps.engine.dispose()
    async with client:
        return await client.request(method, path, headers={**H, "X-User-Role": role}, json=body)


@pytest.mark.anyio
async def test_export_waits_for_the_load_and_loaded_in_sap_sends_it(batch, monkeypatch):
    eng, w, bid, sent = batch
    tid = w["tid"]
    r = await _call(monkeypatch, tid, w["alice"], "POST", f"/api/v1/remediation/batches/{bid}/export?format=cockpit_csv")
    assert r.status_code == 200, r.text
    row = _one(eng, tid, "SELECT status, exported_by::text, exported_by_label, exported_at IS NOT NULL "
                         "FROM remediation_batches WHERE id = :b AND tenant_id = :t", b=bid)
    assert row[0] == "awaiting_load" and row[1] == w["alice"] and row[2] and row[3]
    # nobody named: the SAP Basis people load it; the steward hears it is exported
    titles = {r[0]: r[1] for r in seed.engine().connect().execute(text(
        "SELECT user_id::text, title FROM notifications WHERE tenant_id = :t AND type = 'batch_awaiting_load'"),
        {"t": tid}).fetchall()}
    assert titles == {w["basis"]: "Load file of fix batch Lead times waits for the SAP load",
                      w["requester"]: "Fix batch Lead times is exported, waiting for the SAP load"}
    assert sorted(j.user_id for j in sent) == sorted([w["basis"], w["requester"]])
    events = [x[0] for x in seed.engine().connect().execute(text(
        "SELECT event FROM webhook_deliveries WHERE tenant_id = :t"), {"t": tid}).fetchall()]
    assert "batch.sent" not in events
    # a second export keeps the status and tells nobody again
    again = await _call(monkeypatch, tid, w["bob"], "POST", f"/api/v1/remediation/batches/{bid}/export?format=mass_change_csv")
    assert again.status_code == 200
    assert _one(eng, tid, "SELECT status, exported_by::text FROM remediation_batches WHERE id = :b", b=bid) == (
        "awaiting_load", w["alice"])
    assert len(sent) == 2

    # the batch's creator cannot confirm the load; a viewer may not either
    own = await _call(monkeypatch, tid, w["requester"], "POST", f"/api/v1/remediation/batches/{bid}/loaded")
    assert own.status_code == 403
    viewer = await _call(monkeypatch, tid, w["dave"], "POST", f"/api/v1/remediation/batches/{bid}/loaded", role="viewer")
    assert viewer.status_code == 403
    ok = await _call(monkeypatch, tid, w["basis"], "POST", f"/api/v1/remediation/batches/{bid}/loaded",
                     {"note": "LTMC project Z1"}, role="sap_basis")
    assert ok.status_code == 200, ok.text
    assert ok.json() == {"id": bid, "status": "exported", "loaded_by": ok.json()["loaded_by"], "load_note": "LTMC project Z1"}
    row = _one(eng, tid, "SELECT status, loaded_by::text, load_note FROM remediation_batches WHERE id = :b", b=bid)
    assert row == ("exported", w["basis"], "LTMC project Z1")
    told = sorted(x[0] for x in seed.engine().connect().execute(text(
        "SELECT user_id::text FROM notifications WHERE tenant_id = :t AND type = 'batch_loaded'"), {"t": tid}).fetchall())
    assert told == sorted([w["requester"], w["alice"]])
    twice = await _call(monkeypatch, tid, w["alice"], "POST", f"/api/v1/remediation/batches/{bid}/loaded")
    assert twice.status_code == 409 and twice.json()["detail"] == "This batch is already sent to SAP."
    got = await _call(monkeypatch, tid, w["alice"], "GET", f"/api/v1/remediation/batches/{bid}")
    b = got.json()["batch"]
    assert b["status"] == "exported" and b["loaded_by_label"] and b["exported_by_label"]


@pytest.mark.anyio
async def test_a_named_loader_is_told_and_a_draft_cannot_be_confirmed(batch, monkeypatch):
    eng, w, bid, sent = batch
    tid = w["tid"]
    r = await _call(monkeypatch, tid, w["alice"], "POST",
                    f"/api/v1/remediation/batches/{bid}/export?format=cockpit_csv&loader_id={w['carol']}")
    assert r.status_code == 200, r.text
    to = [x[0] for x in seed.engine().connect().execute(text(
        "SELECT user_id::text FROM notifications WHERE tenant_id = :t AND title LIKE 'Load file%'"), {"t": tid}).fetchall()]
    assert to == [w["carol"]]
    nobody = await _call(monkeypatch, tid, w["alice"], "POST",
                         f"/api/v1/remediation/batches/{bid}/export?format=cockpit_csv&loader_id={uuid.uuid4()}")
    assert nobody.status_code == 404
    with seed.tenant_conn(eng, tid) as c:
        c.execute(text("UPDATE remediation_batches SET status = 'draft' WHERE id = :b"), {"b": bid})
    r = await _call(monkeypatch, tid, w["alice"], "POST", f"/api/v1/remediation/batches/{bid}/loaded")
    assert r.status_code == 409 and "waits for the SAP load" in r.json()["detail"]
