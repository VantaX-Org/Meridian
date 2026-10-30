"""Sandbox tenant mode against a real Postgres (MERIDIAN_TEST_DB_URL): enter copies the latest run into a sandbox run,
the status strip says so, decisions land on sandbox rows only, webhooks, write-backs and report mailouts are held
back and recorded, exit discards the copy; both audited, admin only. Another tenant is untouched."""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_step10_seed import seed_run, seed_tenant

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

KEYS = [f"LIFNR=00000{n}|BANKS=ZA" for n in range(1, 5)]


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def q(owner, sql, **p):
    with owner.begin() as c:
        res = c.execute(text(sql), p)
        return res.fetchall() if res.returns_rows else []


def _seed(owner) -> dict:
    s = seed_tenant(owner)
    run = seed_run(owner, s["tid"], s["ecc"], keys={"AP039": KEYS})
    for k in KEYS:
        q(owner, "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, status, "
                 "first_seen_version, last_seen_version) VALUES (:t, :s, 'accounts_payable', 'AP039', :k, 'critical', "
                 "'open', :v, :v)", t=s["tid"], s=s["ecc"], k=k, v=run)
    q(owner, "INSERT INTO webhooks (tenant_id, url, secret, events) VALUES (:t, 'https://hooks.example.com/x', "
             "'whsec_test_secret_123456', ARRAY['*'])", t=s["tid"])
    return {**s, "run": run}


@pytest.mark.anyio
async def test_sandbox(owner, monkeypatch):
    s = _seed(owner)
    tid, run = s["tid"], s["run"]
    other = _seed(owner)

    deps, client = make_client(monkeypatch, tid, s["ann"])
    await deps.engine.dispose()
    async with client:
        st = (await client.get("/api/v1/status", headers=headers("viewer"))).json()
        assert st["sandbox"] is False
        assert (await client.post("/api/v1/admin/sandbox/enter", headers=headers("programme_lead"))).status_code == 403
        assert (await client.post("/api/v1/admin/sandbox/exit", headers=headers())).status_code == 409

        r = await client.post("/api/v1/admin/sandbox/enter", json={"copy_run": True}, headers=headers())
        assert r.status_code == 200, r.text
        out = r.json()
        sb = out["sandbox_run_id"]
        assert out["sandbox"] is True and out["source_run_id"] == run and out["runs"] == [sb]
        assert out["copied"]["findings"] == 3 and out["copied"]["work_records"] == 4
        assert out["copied"]["record_issues"] == 4 and out["copied"]["finding_records"] == 4
        assert (await client.post("/api/v1/admin/sandbox/enter", headers=headers())).status_code == 409

        st = (await client.get("/api/v1/status", headers=headers("viewer"))).json()
        assert st["sandbox"] is True
        meta = q(owner, "SELECT metadata FROM analysis_versions WHERE id = :v", v=sb)[0][0]
        assert meta["sandbox"] is True and meta["sandbox_of"] == run and "dataset_path" not in meta
        assert q(owner, "SELECT DISTINCT scope FROM work_records WHERE version_id = :v", v=sb) == [(f"sandbox:{s['ecc']}",)]

        # the work list reads the sandbox run; a decision lands on the sandbox issue only
        recs = (await client.get("/api/v1/work/records", headers=headers("viewer"))).json()
        assert recs["version_id"] == sb and recs["total"] == 4
        r = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "accounts_payable", "record_key": KEYS[0], "check_id": "AP039", "action": "not_an_issue",
             "note": "Trying it in the sandbox"}]})
        assert r.status_code == 200, r.text
        rows = q(owner, "SELECT scope, status FROM record_issues WHERE tenant_id = :t AND record_key = :k ORDER BY scope",
                 t=tid, k=KEYS[0])
        assert rows == [(s["ecc"], "open"), (f"sandbox:{s['ecc']}", "accepted")]
        # a decision on the real run is refused while in sandbox
        r = await client.post("/api/v1/work/decide", headers=headers(), json={"version_id": run, "items": [
            {"module": "accounts_payable", "record_key": KEYS[1], "check_id": "AP039", "action": "not_an_issue",
             "note": "Real"}]})
        assert r.status_code == 409

        # nothing leaves: a webhook test is held back and recorded
        r = await client.post(f"/api/v1/webhooks/{q(owner, 'SELECT id FROM webhooks WHERE tenant_id = :t', t=tid)[0][0]}"
                              "/test", headers=headers())
        assert r.status_code == 200 and r.json()["status"] == "skipped"

        from api.services import webhooks
        from workers.db import get_sync_engine, tenant_session
        from workers.tasks.run_golden_writeback import run as golden_run
        with tenant_session(get_sync_engine(), tid) as sess:
            assert webhooks.emit(sess, tid, "run.finished", {"run_id": run}) == []
            assert webhooks.due(sess, tid) == []
            assert golden_run(sess, tid, str(uuid.uuid4()), "apply") == {"skipped": True, "reason": "sandbox"}
            sess.commit()
        skipped = q(owner, "SELECT channel, kind, reason FROM skipped_deliveries WHERE tenant_id = :t ORDER BY created_at",
                    t=tid)
        assert [(c, k) for c, k, _r in skipped] == [("webhook", "webhook.test"), ("webhook", "run.finished"),
                                                    ("write_back", "golden_record")]
        assert {r for _c, _k, r in skipped} == {"sandbox"}
        assert (await client.get("/api/v1/admin/sandbox", headers=headers("viewer"))).json()["skipped_deliveries"] == 3

        r = await client.post("/api/v1/admin/sandbox/exit", headers=headers())
        assert r.status_code == 200, r.text
        assert r.json()["sandbox"] is False and r.json()["runs"] == [] and r.json()["discarded"]["analysis_versions"] == 1
        assert q(owner, "SELECT count(*) FROM analysis_versions WHERE id = :v", v=sb)[0][0] == 0
        assert q(owner, "SELECT count(*) FROM record_issues WHERE tenant_id = :t AND scope LIKE 'sandbox:%'", t=tid)[0][0] == 0
        assert q(owner, "SELECT count(*) FROM remediation_items WHERE tenant_id = :t AND scope LIKE 'sandbox:%'",
                 t=tid)[0][0] == 0
        st = (await client.get("/api/v1/status", headers=headers("viewer"))).json()
        assert st["sandbox"] is False
        recs = (await client.get("/api/v1/work/records", headers=headers("viewer"))).json()
        assert recs["version_id"] == run
        with tenant_session(get_sync_engine(), tid) as sess:
            assert webhooks.emit(sess, tid, "run.finished", {"run_id": run})  # queued again after the exit
            sess.rollback()

    deps, client = make_client(monkeypatch, other["tid"], other["ann"])
    async with client:
        assert (await client.get("/api/v1/status", headers=headers("viewer"))).json()["sandbox"] is False
        body = (await client.get("/api/v1/admin/sandbox", headers=headers("viewer"))).json()
        assert body == {"sandbox": False, "since": None, "by": None, "runs": [], "skipped_deliveries": 0}

    actions = [r[0] for r in q(owner, "SELECT action FROM audit_log WHERE tenant_id = :t AND action LIKE 'sandbox%' "
                                      "ORDER BY created_at", t=tid)]
    assert actions == ["sandbox_entered", "sandbox_exited"]
