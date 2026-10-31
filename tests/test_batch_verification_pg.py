"""F09: after a run, each fix batch it covered says "Verified on run 23 Oct 2026: n fixed, m still failing"; the
verdict is stored once per batch and run, returned by the batch API, and told to the steward and the approver."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from api.services import batch_verification
from tests import workflow_seed as seed
from tests.m2_client import make_client

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

H = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
RUN_AT = datetime(2026, 10, 23, 6, 0, tzinfo=timezone.utc)


@pytest.fixture
def batch(monkeypatch):
    sent: list = []
    monkeypatch.setattr("api.services.handoff_notices.email_backend_name", lambda: "smtp")
    monkeypatch.setattr("api.services.handoff_notices.dispatch", lambda jobs: sent.extend(jobs) or len(sent))
    eng = seed.engine()
    w = seed.seed_tenant(eng)
    bid, v1, v2 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with seed.tenant_conn(eng, w["tid"]) as c:
        for v, at in ((v1, RUN_AT), (v2, RUN_AT.replace(day=30))):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at) VALUES (:v, :t, 'complete', :at)"),
                      {"v": v, "t": w["tid"], "at": at})
        c.execute(text("INSERT INTO remediation_batches (id, tenant_id, name, status, created_by, created_by_label, "
                       "approved_by, approved_by_label, exported_at) VALUES (:b, :t, 'Units', 'exported', :u, 'requester', "
                       ":a, 'alice', :at)"), {"b": bid, "t": w["tid"], "u": w["requester"], "a": w["alice"],
                                              "at": RUN_AT.replace(day=20)})
        # three records: K1 fixed, K2 fails one of its two changes, K3 fixed
        for k, chk, st in (("K1", "C1", "fixed"), ("K2", "C1", "fixed"), ("K2", "C2", "still_failing"), ("K3", "C1", "fixed")):
            c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, field, "
                           "proposed_value, recon_status, recon_version) VALUES (:t, :b, 'S', 'material_master', :c, :k, "
                           "'MARA.MEINS', 'EA', :st, :v)"), {"t": w["tid"], "b": bid, "c": chk, "k": k, "st": st, "v": v1})
    yield eng, w, bid, v1, v2, sent
    with seed.tenant_conn(eng, w["tid"]) as c:
        for t in ("notification_deliveries", "remediation_batch_verifications", "remediation_items", "remediation_batches",
                  "analysis_versions"):
            c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": w["tid"]})
    seed.drop_tenant(eng, w["tid"])
    eng.dispose()


def _verify(eng, tid, vid):
    from workers.tasks.verify_batches import run
    return run(eng, vid, tid)


def _rows(eng, tid, sql, **p):
    with seed.tenant_conn(eng, tid) as c:
        return c.execute(text(sql), {"t": tid, **p}).fetchall()


def test_the_sentence():
    assert batch_verification.sentence({"run_at": RUN_AT, "fixed": 320, "still_failing": 8}) == \
        "Verified on run 23 Oct 2026: 320 fixed, 8 still failing"


@pytest.mark.anyio
async def test_a_run_verifies_the_batch_once_and_tells_steward_and_approver(batch, monkeypatch):
    eng, w, bid, v1, v2, sent = batch
    tid = w["tid"]
    assert _verify(eng, tid, v1) == {"batches": 1, "fixed": 2, "still_failing": 1}
    assert _rows(eng, tid, "SELECT records, fixed, still_failing FROM remediation_batch_verifications "
                           "WHERE tenant_id = :t AND batch_id = :b", b=bid) == [(3, 2, 1)]
    told = _rows(eng, tid, "SELECT user_id::text, title FROM notifications WHERE tenant_id = :t AND type = 'batch_verified' "
                           "ORDER BY user_id")
    title = "Fix batch Units: verified on run 23 Oct 2026: 2 fixed, 1 still failing"
    assert sorted(told) == sorted([(w["requester"], title), (w["alice"], title)])
    assert sorted(j.user_id for j in sent) == sorted([w["requester"], w["alice"]])
    hooks = _rows(eng, tid, "SELECT event FROM webhook_deliveries WHERE tenant_id = :t")
    assert hooks == []  # no subscription: nothing delivered, and nothing failed

    # the task again for the same run: nothing new
    assert _verify(eng, tid, v1)["batches"] == 0
    assert len(_rows(eng, tid, "SELECT 1 FROM notifications WHERE tenant_id = :t AND type = 'batch_verified'")) == 2

    # the batch API carries the verdict
    deps, client = make_client(monkeypatch, tid, w["alice"])
    await deps.engine.dispose()
    async with client:
        got = (await client.get(f"/api/v1/remediation/batches/{bid}", headers=H)).json()["batch"]["verification"]
        listed = (await client.get("/api/v1/remediation/batches", headers=H)).json()["items"]
    assert got["version_id"] == v1 and (got["records"], got["fixed"], got["still_failing"]) == (3, 2, 1)
    assert got["sentence"] == "Verified on run 23 Oct 2026: 2 fixed, 1 still failing"
    assert next(b for b in listed if b["id"] == bid)["verification"]["fixed"] == 2

    # a later run with the same verdict is stored but tells nobody; a changed one tells again
    with seed.tenant_conn(eng, tid) as c:
        c.execute(text("UPDATE remediation_items SET recon_version = :v WHERE batch_id = :b"), {"v": v2, "b": bid})
    assert _verify(eng, tid, v2)["batches"] == 1
    assert len(_rows(eng, tid, "SELECT 1 FROM notifications WHERE tenant_id = :t AND type = 'batch_verified'")) == 2
    with seed.tenant_conn(eng, tid) as c:
        c.execute(text("DELETE FROM remediation_batch_verifications WHERE batch_id = :b AND version_id = :v"),
                  {"b": bid, "v": v2})
        c.execute(text("UPDATE remediation_items SET recon_status = 'fixed' WHERE batch_id = :b"), {"b": bid})
    assert _verify(eng, tid, v2) == {"batches": 1, "fixed": 3, "still_failing": 0}
    assert len(_rows(eng, tid, "SELECT 1 FROM notifications WHERE tenant_id = :t AND type = 'batch_verified'")) == 4


def test_a_draft_batch_is_never_verified(batch):
    eng, w, bid, v1, v2, sent = batch
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("UPDATE remediation_batches SET status = 'draft' WHERE id = :b"), {"b": bid})
    assert _verify(eng, w["tid"], v1)["batches"] == 0 and sent == []
