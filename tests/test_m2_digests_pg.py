"""Scheduled digests against a real Postgres (MERIDIAN_TEST_DB_URL): CRUD (manage_settings, audited), the preview of
one's own role digest, the deterministic numbers, send-now by email with the PDF attached, the webhook channel, the
beat task sending a due slot once and moving it on, and sandbox mode holding a digest back. Another tenant sees
nothing."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_step10_seed import RUN_AT, seed_run, seed_tenant

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


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
    tid, ecc = s["tid"], s["ecc"]
    # an earlier run where AP039 failed less: the score moves between the two
    seed_run(owner, tid, ecc, findings=(("AP039", "critical", "validity", 0), ("AP016", "high", "completeness", 2)),
             run_at=RUN_AT - timedelta(days=7))
    run = seed_run(owner, tid, ecc)
    q(owner, "UPDATE findings SET cost_at_risk = 2000 WHERE version_id = :v AND check_id = 'AP039'", v=run)
    q(owner, "UPDATE findings SET cost_at_risk = 300 WHERE version_id = :v AND check_id = 'AP016'", v=run)
    wave = q(owner, "INSERT INTO migration_waves (tenant_id, name, source_system_id, modules, min_dqs) VALUES "
                    "(:t, 'Wave A', :s, ARRAY['accounts_payable'], 80) RETURNING id::text", t=tid, s=ecc)[0][0]
    q(owner, "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, status, "
             "first_seen_version, last_seen_version, sla_state) VALUES (:t, :s, 'accounts_payable', 'AP039', 'LIFNR=1', "
             "'critical', 'open', :v, :v, 'breached')", t=tid, s=ecc, v=run)
    b = q(owner, "INSERT INTO remediation_batches (tenant_id, name) VALUES (:t, 'Fixes') RETURNING id", t=tid)[0][0]
    q(owner, "INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, accepted) "
             "VALUES (:t, :b, :s, 'accounts_payable', 'AP039', 'LIFNR=1', true)", t=tid, b=b, s=ecc)
    return {**s, "run": run, "wave": wave}


@pytest.mark.anyio
async def test_digests(owner, monkeypatch):
    s = _seed(owner)
    tid = s["tid"]
    other = _seed(owner)
    sent: list[tuple] = []

    def fake_email(address, subject, body, attachments=None):
        sent.append((address, subject, body, attachments))
        return True

    monkeypatch.setattr("workers.tasks.send_notifications._deliver_email", fake_email)
    monkeypatch.setattr("workers.tasks.send_user_invitation._resolve_app_base_url", lambda: "https://meridian.example.com")

    deps, client = make_client(monkeypatch, tid, s["ann"])
    await deps.engine.dispose()
    async with client:
        body = {"name": "Steward weekly", "audience": "role", "role": "data_steward", "cron": "0 7 * * 1",
                "timezone": "Africa/Johannesburg", "channel": "email", "recipients": ["steward@example.com"]}
        assert (await client.post("/api/v1/digests", json=body, headers=headers("data_steward"))).status_code == 403
        assert (await client.post("/api/v1/digests", json={**body, "cron": "every monday"},
                                  headers=headers())).status_code == 422
        assert (await client.post("/api/v1/digests", json={**body, "role": "nobody"}, headers=headers())).status_code == 422
        assert (await client.post("/api/v1/digests", json={**body, "audience": "wave", "wave_id": s["wave"],
                                                           "recipients": []}, headers=headers())).status_code == 422
        r = await client.post("/api/v1/digests", json=body, headers=headers())
        assert r.status_code == 201, r.text
        dg = r.json()
        nxt = datetime.fromisoformat(dg["next_run_at"])
        assert nxt > datetime.now(timezone.utc) and nxt.astimezone(timezone.utc).hour == 5  # 07:00 SAST
        wave = (await client.post("/api/v1/digests", headers=headers(), json={
            "name": "Wave A gate", "audience": "wave", "wave_id": s["wave"], "cron": "30 6 * * *",
            "channel": "webhook"})).json()
        assert wave["channel"] == "webhook" and wave["role"] is None

        listed = (await client.get("/api/v1/digests", headers=headers())).json()["digests"]
        assert {d["id"] for d in listed} == {dg["id"], wave["id"]}
        assert (await client.get("/api/v1/digests", headers=headers("data_steward"))).status_code == 403
        r = await client.patch(f"/api/v1/digests/{dg['id']}", json={"cron": "0 8 * * 1", "attach_pdf": True},
                               headers=headers())
        assert r.status_code == 200 and r.json()["cron"] == "0 8 * * 1"

        # preview: a steward may read the steward digest, a viewer may not
        r = await client.get(f"/api/v1/digests/{dg['id']}/preview", headers=headers("data_steward"))
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
        assert "1 of 1 objects held under 85" in r.text and "·" not in r.text
        assert (await client.get(f"/api/v1/digests/{dg['id']}/preview", headers=headers("viewer"))).status_code == 403
        assert (await client.get(f"/api/v1/digests/{wave['id']}/preview",
                                 headers=headers("data_steward"))).status_code == 403
        n = (await client.get(f"/api/v1/digests/{dg['id']}/preview.json", headers=headers())).json()
        assert n["landscape"]["objects"] == 1 and n["landscape"]["held_under_85"] == 1
        assert n["landscape"]["release_if_fixed"] == ["AP039"] and n["landscape"]["released"] == 1
        assert n["approvals_waiting"] == 1 and n["sla_breaches"] == 1
        assert [(m["module"], m["delta"] < 0) for m in n["score_moves"]] == [("accounts_payable", True)]
        assert n["value_at_risk"]["total"] == 2300.0 and n["value_at_risk"]["top"][0]["check_id"] == "AP039"
        assert [(w["name"], w["gate_open"]) for w in n["waves"]] == [("Wave A", False)]
        wn = (await client.get(f"/api/v1/digests/{wave['id']}/preview.json", headers=headers())).json()
        assert wn["wave_id"] == s["wave"] and len(wn["waves"]) == 1

        # send now: one email with the PDF attached
        r = await client.post(f"/api/v1/digests/{dg['id']}/send-now", headers=headers())
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "sent" and r.json()["delivered"] == 1
        address, subject, html, attachments = sent[-1]
        assert address == "steward@example.com" and subject == "Meridian digest: Steward weekly"
        assert attachments and attachments[0][1][:4] == b"%PDF" and attachments[0][2] == "application/pdf"

        # webhook channel: one digest.sent event per subscribed webhook
        q(owner, "INSERT INTO webhooks (tenant_id, url, secret, events) VALUES (:t, 'https://hooks.example.com/d', "
                 "'whsec_test_secret_123456', ARRAY['digest.sent'])", t=tid)
        r = (await client.post(f"/api/v1/digests/{wave['id']}/send-now", headers=headers())).json()
        assert r["status"] == "sent" and r["delivered"] == 1
        payload = q(owner, "SELECT payload FROM webhook_deliveries WHERE tenant_id = :t AND event = 'digest.sent'",
                    t=tid)[0][0]
        assert payload["data"]["held_under_85"] == 1 and payload["data"]["schedule_id"] == wave["id"]

        deliveries = (await client.get(f"/api/v1/digests/{dg['id']}/deliveries", headers=headers())).json()["deliveries"]
        assert [(d["status"], d["manual"]) for d in deliveries] == [("sent", True)]

        # the beat task: a due slot goes out once and the schedule moves on
        from api.services import digests
        from workers.db import get_sync_engine
        from workers.db import tenant_session
        from workers.tasks.digests import process_tenant
        due_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        q(owner, "UPDATE digest_schedules SET next_run_at = :d WHERE id = :i", d=due_at, i=dg["id"])
        before = len(sent)
        with tenant_session(get_sync_engine(), tid) as sess:
            assert process_tenant(sess, tid, datetime.now(timezone.utc), send_email=fake_email) == {"sent": 1}
            assert process_tenant(sess, tid, datetime.now(timezone.utc), send_email=fake_email) == {}
        assert len(sent) == before + 1
        nxt = q(owner, "SELECT next_run_at FROM digest_schedules WHERE id = :i", i=dg["id"])[0][0]
        assert nxt > datetime.now(timezone.utc)
        with tenant_session(get_sync_engine(), tid) as sess:  # the same slot again: already claimed
            assert digests.send(sess, tid, digests.load(sess, tid, dg["id"]), due_at, send_email=fake_email) is None

        # sandbox mode: held back and recorded
        q(owner, "UPDATE tenants SET sandbox = true WHERE id = :t", t=tid)
        r = (await client.post(f"/api/v1/digests/{dg['id']}/send-now", headers=headers())).json()
        assert r == {"delivery_id": r["delivery_id"], "status": "skipped", "reason": "sandbox", "delivered": 0,
                     "failed": 0}
        assert q(owner, "SELECT channel, kind FROM skipped_deliveries WHERE tenant_id = :t", t=tid) == [("digest", "email")]
        q(owner, "UPDATE tenants SET sandbox = false WHERE id = :t", t=tid)

        assert (await client.delete(f"/api/v1/digests/{wave['id']}", headers=headers())).status_code == 204

    deps, client = make_client(monkeypatch, other["tid"], other["ann"])
    async with client:
        assert (await client.get("/api/v1/digests", headers=headers())).json() == {"digests": []}
        assert (await client.get(f"/api/v1/digests/{dg['id']}", headers=headers())).status_code == 404
        assert (await client.get(f"/api/v1/digests/{dg['id']}/preview", headers=headers())).status_code == 404

    actions = [r[0] for r in q(owner, "SELECT action FROM audit_log WHERE tenant_id = :t AND entity_type = "
                                      "'digest_schedule' ORDER BY created_at", t=tid)]
    assert actions == ["digest_created", "digest_created", "digest_updated", "digest_deleted"]


def test_next_run_in_the_time_zone():
    from api.services import digests

    after = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)  # a Thursday
    assert digests.next_run("0 7 * * 1", "Africa/Johannesburg", after) == datetime(2026, 11, 2, 5, 0, tzinfo=timezone.utc)
    assert digests.valid_cron("*/15 * * * *") and not digests.valid_cron("0 7 * *") and not digests.valid_cron("x")
