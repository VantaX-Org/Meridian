"""F12: a change without a new value (blank, or a placeholder such as "no value yet") is never approved unseen, never
exported and never sent: approve refuses with the records named, or approves the rest with ``without_blank``."""
from __future__ import annotations

import io
import os
import uuid

import pytest
from sqlalchemy import text

from api.services import remediation
from tests import workflow_seed as seed
from tests.m2_client import make_client

H = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


def test_has_value_and_the_sentence():
    assert remediation.has_value("12") and remediation.has_value("0")
    for v in (None, "", "   ", "no value yet", "No value yet", "(blank)", " <empty> "):
        assert not remediation.has_value(v), v
    blank = [{"module": "material_master", "record_key": "MATNR=000000000000000700", "field": "MARA.MTART"},
             {"module": "material_master", "record_key": "MATNR=000000000000000701|WERKS=3000", "field": "MARC.PLIFZ"}]
    s = remediation.blank_sentence(blank, 316)
    assert s == ("2 records have no new value: MARA-MTART on 700, MARC-PLIFZ on 701 / 3000. Enter their values, "
                 "approve the other 316 without them, or send the batch back.")
    assert remediation.blank_sentence(blank * 6, 1, limit=2).count(" and 10 more") == 1
    items = [{"field": "MARA.MTART", "record_key": "K1", "module": "m", "check_id": "c", "proposed_value": "no value yet"},
             {"field": "MARA.BRGEW", "record_key": "K2", "module": "m", "check_id": "c", "proposed_value": "1.5"}]
    assert [i["record_key"] for i in remediation._exportable(items)] == ["K2"]
    assert list(remediation.mass_change(items)["RECORD_KEY"]) == ["K2"]


pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


@pytest.fixture
def batch():
    eng = seed.engine()
    w = seed.seed_tenant(eng)
    bid = str(uuid.uuid4())
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("INSERT INTO remediation_batches (id, tenant_id, name, status, created_by, created_by_label) "
                       "VALUES (:b, :t, 'Types', 'draft', :u, 'requester@example.com')"),
                  {"b": bid, "t": w["tid"], "u": w["requester"]})
        for k, f, v in (("MATNR=000000000000000700", "MARA.MTART", None),
                        ("MATNR=000000000000000701", "MARA.BRGEW", "no value yet"),
                        ("MATNR=000000000000000702", "MARA.MTART", "FERT")):
            c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, "
                           "field, current_value, proposed_value) VALUES (:t, :b, 'S', 'material_master', 'MM1', :k, "
                           ":f, '', :v)"), {"t": w["tid"], "b": bid, "k": k, "f": f, "v": v})
    yield eng, w, bid
    seed.drop_tenant(eng, w["tid"])
    eng.dispose()


async def _call(monkeypatch, tid, who, method, path, body=None):
    deps, client = make_client(monkeypatch, tid, who)
    await deps.engine.dispose()
    async with client:
        return await client.request(method, path, headers=H, json=body)


@pg
@pytest.mark.anyio
async def test_approve_refuses_then_holds_the_blank_changes_out(batch, monkeypatch):
    eng, w, bid = batch
    url = f"/api/v1/remediation/batches/{bid}/approve"
    r = await _call(monkeypatch, w["tid"], w["alice"], "POST", url)
    assert r.status_code == 409
    assert r.json()["detail"] == ("2 records have no new value: MARA-MTART on 700, MARA-BRGEW on 701. Enter their "
                                  "values, approve the other 1 without them, or send the batch back.")
    with seed.tenant_conn(eng, w["tid"]) as c:
        assert c.execute(text("SELECT status FROM remediation_batches WHERE id = :b"), {"b": bid}).scalar() == "draft"
    got = await _call(monkeypatch, w["tid"], w["alice"], "GET", f"/api/v1/remediation/batches/{bid}")
    assert sorted((i["record_key"][-3:], i["no_value"]) for i in got.json()["items"]) == [
        ("700", True), ("701", True), ("702", False)]
    listed = await _call(monkeypatch, w["tid"], w["alice"], "GET", "/api/v1/remediation/batches")
    mine = next(b for b in listed.json()["items"] if b["id"] == bid)
    assert (mine["with_proposal"], mine["no_value"]) == (1, 2)

    r = await _call(monkeypatch, w["tid"], w["alice"], "POST", url, {"without_blank": True})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"
    with seed.tenant_conn(eng, w["tid"]) as c:
        held = c.execute(text("SELECT i.record_key FROM remediation_events e JOIN remediation_items i ON i.id = e.item_id "
                              "WHERE e.batch_id = :b AND e.action = 'held_out' ORDER BY 1"), {"b": bid}).fetchall()
    assert [h[0][-3:] for h in held] == ["700", "701"]

    # the export holds the one change with a value
    r = await _call(monkeypatch, w["tid"], w["bob"], "POST", f"/api/v1/remediation/batches/{bid}/export?format=mass_change_csv")
    assert r.status_code == 200, r.text
    lines = io.StringIO(r.content.decode()).read().strip().splitlines()
    assert len(lines) == 2 and "000000000000000702" in lines[1] and "FERT" in lines[1]


@pg
@pytest.mark.anyio
async def test_a_batch_with_no_value_at_all_cannot_be_approved(batch, monkeypatch):
    eng, w, bid = batch
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("UPDATE remediation_items SET proposed_value = NULL WHERE batch_id = :b"), {"b": bid})
    r = await _call(monkeypatch, w["tid"], w["alice"], "POST", f"/api/v1/remediation/batches/{bid}/approve",
                    {"without_blank": True})
    assert r.status_code == 409 and "nothing to approve" in r.json()["detail"]


@pg
@pytest.mark.anyio
async def test_the_bapi_check_never_counts_a_blank_change(batch, monkeypatch):
    eng, w, bid = batch
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("UPDATE remediation_batches SET status = 'approved' WHERE id = :b"), {"b": bid})
    r = await _call(monkeypatch, w["tid"], w["alice"], "POST", f"/api/v1/writeback/batches/{bid}/check")
    assert r.status_code == 200, r.text
    assert r.json()["records"] == 1 and len(r.json()["fields"]) == 1
