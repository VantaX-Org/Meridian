"""Outbound webhooks against a real Postgres (MERIDIAN_TEST_DB_URL): CRUD with a write-only secret, a signed test
delivery the receiver verifies, the retry schedule (1, 2, 4, 8 minutes, failed after 5 attempts), the delivery log,
the run, batch and certificate events, payloads without SAP values, and the Slack and Teams alert cards."""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from api.services import webhooks
from tests.m2_client import headers, make_client
from tests.m2_step9_seed import KEYS, days_before, seed_step9

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

CLEAN = (("MM001", "critical", "validity", 0), ("MM005", "critical", "accuracy", 0),
         ("MM015", "low", "completeness", 50), ("MM200", "medium", "completeness", 0))


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


class Resp:
    def __init__(self, code: int):
        self.status_code, self.ok = code, 200 <= code < 300


class Receiver:
    """A stub HTTP endpoint: records each POST and answers with the next code (the last one repeats)."""
    def __init__(self, *codes: int):
        self.codes, self.calls = list(codes) or [200], []

    def __call__(self, url, data=None, headers=None, timeout=None):
        self.calls.append({"url": url, "body": data, "headers": headers})
        return Resp(self.codes.pop(0) if len(self.codes) > 1 else self.codes[0])


def sess(owner, tid) -> Session:
    s = Session(owner)
    s.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
    return s


def strings(obj) -> list[str]:
    if isinstance(obj, dict):
        return [x for k, v in obj.items() for x in [k, *strings(v)]]
    if isinstance(obj, list):
        return [x for v in obj for x in strings(v)]
    return [obj] if isinstance(obj, str) else []


def test_payload_guard():
    webhooks.check_payload({"run_id": "x", "objects": [{"module": "m", "score": 1.5, "rules": ["MM001"]}]})
    for bad in ({"record_key": "MATNR=1"}, {"objects": [{"current_value": "XX"}]}, {"sample_keys": []},
                {"name": "x" * 400}, {"when": datetime.now(timezone.utc)}):
        with pytest.raises(webhooks.UnsafePayload):
            webhooks.check_payload(bad)
    with pytest.raises(ValueError):
        webhooks.emit(None, "t", "not.an.event", {})
    assert [webhooks.backoff(n).total_seconds() for n in (1, 2, 3, 4)] == [60, 120, 240, 480]


@pytest.mark.anyio
async def test_crud_test_send_and_log(owner, monkeypatch):
    s = seed_step9(owner)
    tid = s["tid"]
    deps, client = make_client(monkeypatch, tid, s["ann"])
    await deps.engine.dispose()
    receiver = Receiver(200)
    monkeypatch.setattr("requests.post", receiver)
    async with client:
        assert (await client.get("/api/v1/webhooks", headers=headers("viewer"))).status_code == 403
        r = await client.post("/api/v1/webhooks", json={"url": "http://hooks.example.com/x", "events": ["run.finished"]},
                              headers=headers())
        assert r.status_code == 422
        r = await client.post("/api/v1/webhooks", json={"url": "https://hooks.example.com/T0K3N/path",
                                                        "events": ["run.finished", "breach.new"]}, headers=headers())
        assert r.status_code == 201, r.text
        hook = r.json()
        secret = hook["secret"]
        assert secret.startswith("whsec_") and hook["url"] == "hooks.example.com"
        listed = (await client.get("/api/v1/webhooks", headers=headers())).json()["webhooks"]
        assert listed[0]["id"] == hook["id"] and "secret" not in listed[0] and "T0K3N" not in json.dumps(listed)

        # the test send is signed: the receiver recomputes the HMAC over "<timestamp>.<body>"
        r = await client.post(f"/api/v1/webhooks/{hook['id']}/test", headers=headers())
        assert r.status_code == 200 and r.json()["status"] == "delivered" and r.json()["response_code"] == 200
        call = receiver.calls[-1]
        h = call["headers"]
        assert call["url"] == "https://hooks.example.com/T0K3N/path" and h["X-Meridian-Event"] == "webhook.test"
        assert webhooks.verify(secret, h["X-Meridian-Timestamp"], call["body"], h["X-Meridian-Signature"])
        assert not webhooks.verify("whsec_wrong", h["X-Meridian-Timestamp"], call["body"], h["X-Meridian-Signature"])
        env = json.loads(call["body"])
        assert env["event"] == "webhook.test" and env["tenant_id"] == tid and h["X-Meridian-Delivery"] == r.json()["delivery_id"]

        # PATCH: events and active; a rotated secret signs the next delivery
        r = await client.patch(f"/api/v1/webhooks/{hook['id']}", json={"events": ["*"], "secret": "s" * 20},
                               headers=headers())
        assert r.status_code == 200 and r.json()["events"] == ["*"]
        await client.post(f"/api/v1/webhooks/{hook['id']}/test", headers=headers())
        h = receiver.calls[-1]["headers"]
        assert webhooks.verify("s" * 20, h["X-Meridian-Timestamp"], receiver.calls[-1]["body"], h["X-Meridian-Signature"])

        log = (await client.get(f"/api/v1/webhooks/{hook['id']}/deliveries", headers=headers())).json()["deliveries"]
        assert [(d["event"], d["status"], d["attempts"], d["response_code"]) for d in log] == \
            [("webhook.test", "delivered", 1, 200)] * 2

        # settings: score.dropped thresholds
        r = await client.put("/api/v1/settings/automation", json={"score_drop": {"below": 80, "points": 10}},
                             headers=headers())
        assert r.json()["score_drop"] == {"below": 80.0, "points": 10.0} and r.json()["rule_mining"] == {"min_records": 25}
        assert (await client.put("/api/v1/settings/automation", json={}, headers=headers("viewer"))).status_code == 403

        assert (await client.delete(f"/api/v1/webhooks/{hook['id']}", headers=headers())).status_code == 204
        assert (await client.get(f"/api/v1/webhooks/{hook['id']}/deliveries", headers=headers())).status_code == 404
    with owner.connect() as c:
        actions = [r[0] for r in c.execute(text("SELECT action FROM audit_log WHERE tenant_id = :t AND entity_type = 'webhook' "
                                                "ORDER BY created_at"), {"t": tid}).fetchall()]
    assert actions == ["webhook_created", "webhook_updated", "webhook_deleted"]


def test_retry_schedule_and_sweep(owner):
    from workers.tasks.webhooks import deliver_due

    s = seed_step9(owner)
    tid = s["tid"]
    with sess(owner, tid) as x:
        wid = x.execute(text("INSERT INTO webhooks (tenant_id, url, secret, events) VALUES (:t, 'https://h.example/x', "
                             "'whsec_test_secret_123', ARRAY['run.failed']) RETURNING id::text"), {"t": tid}).scalar()
        [did] = webhooks.emit(x, tid, "run.failed", {"run_id": s["run"], "label": "ECC run"})
        x.commit()
    down = Receiver(500)
    t0 = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(minutes=1)
    expected = [60, 120, 240, 480]
    now = t0
    for n in range(1, 6):
        with sess(owner, tid) as x:
            assert webhooks.due(x, tid, now - timedelta(seconds=1)) == ([] if n > 1 else [did])
        out = deliver_due(owner, post=down, now=now)
        assert out.get("retrying" if n < 5 else "failed", 0) >= 1
        with sess(owner, tid) as x:
            row = x.execute(text("SELECT status, attempts, response_code, error, next_attempt_at FROM webhook_deliveries "
                                 "WHERE id = :d"), {"d": did}).mappings().one()
        assert row["attempts"] == n and row["response_code"] == 500 and row["error"] == "HTTP 500"
        if n < 5:
            assert row["status"] == "retrying" and row["next_attempt_at"] == now + timedelta(seconds=expected[n - 1])
            now = row["next_attempt_at"]
        else:
            assert row["status"] == "failed" and row["next_attempt_at"] is None
    assert len([c for c in down.calls if c["headers"]["X-Meridian-Delivery"] == did]) == 5
    # a second webhook that comes back after one failure is delivered on the retry
    with sess(owner, tid) as x:
        [d2] = webhooks.emit(x, tid, "run.failed", {"run_id": s["run"]})
        x.commit()
    flaky = Receiver(503, 200)
    deliver_due(owner, post=flaky, now=t0)
    deliver_due(owner, post=flaky, now=t0 + timedelta(seconds=60))
    with sess(owner, tid) as x:
        st = x.execute(text("SELECT status, attempts, response_code FROM webhook_deliveries WHERE id = :d"), {"d": d2}).one()
    assert tuple(st) == ("delivered", 2, 200) and wid


@pytest.mark.anyio
async def test_events_carry_no_sap_values(owner, monkeypatch):
    s = seed_step9(owner, findings=CLEAN, run_at=days_before(7))  # the previous run: no breach, 99.31
    tid = s["tid"]
    cur = seed_step9(owner, tid=tid, ecc=s["ecc"])  # this run: MM001 and MM005 over tolerance, 70
    with sess(owner, tid) as x:
        x.execute(text("INSERT INTO webhooks (tenant_id, url, secret, events) VALUES (:t, 'https://h.example/a', "
                       "'whsec_test_secret_123', ARRAY['*'])"), {"t": tid})
        x.execute(text("INSERT INTO webhooks (tenant_id, url, secret, events) VALUES (:t, 'https://h.example/b', "
                       "'whsec_test_secret_123', ARRAY['run.failed'])"), {"t": tid})
        x.execute(text("INSERT INTO webhooks (tenant_id, url, secret, events, active) VALUES (:t, 'https://h.example/c', "
                       "'whsec_test_secret_123', ARRAY['*'], false)"), {"t": tid})
        queued = webhooks.run_events(x, tid, cur["run"])
        x.commit()
    assert queued == {"run.finished": 1, "score.dropped": 1, "breach.new": 1}

    # a batch moving through approval: waiting is queued when drafted, approved through the API
    bid = str(uuid.uuid4())
    with sess(owner, tid) as x:
        x.execute(text("INSERT INTO remediation_batches (id, tenant_id, name, status) VALUES (:b, :t, 'Base units', 'draft')"),
                  {"b": bid, "t": tid})
        for k in KEYS[:3]:
            x.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, "
                           "current_value, proposed_value, accepted) VALUES (:t, :b, :s, 'material_master', 'MM005', :k, "
                           "'XX', 'EA', true)"), {"t": tid, "b": bid, "s": s["ecc"], "k": k})
        assert webhooks.batch_event(x, tid, bid, "batch.waiting") == 1
        x.commit()
    deps, client = make_client(monkeypatch, tid, s["cara"])
    await deps.engine.dispose()
    async with client:
        r = await client.post(f"/api/v1/remediation/batches/{bid}/approve", headers=headers("approver"))
        assert r.status_code == 200, r.text

    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        rows = c.execute(text("SELECT d.event, d.payload, w.url FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id "
                              "WHERE d.tenant_id = :t ORDER BY d.created_at, d.event"), {"t": tid}).fetchall()
    assert {r[2] for r in rows} == {"https://h.example/a"}  # not the run.failed-only hook, never the inactive one
    by = {r[0]: r[1]["data"] for r in rows}
    assert set(by) == {"run.finished", "score.dropped", "breach.new", "batch.waiting", "batch.approved"}
    assert by["run.finished"]["objects"] == [{"module": "material_master", "score": 70.0, "raw_score": 84.72, "breaches": 2}]
    assert by["run.finished"]["system_name"] == "ECC production"
    assert by["score.dropped"]["objects"] == [{"module": "material_master", "score": 70.0, "previous_score": 99.31,
                                               "drop": 29.31, "below_threshold": False}]
    assert by["breach.new"]["objects"] == [{"module": "material_master", "rules": ["MM001", "MM005"]}]
    assert by["batch.approved"]["records"] == 3 and by["batch.approved"]["rules"] == ["MM005"]
    everything = [x for r in rows for x in strings(r[1])]
    assert not any(k in v for v in everything for k in KEYS) and "XX" not in everything and "EA" not in everything
    assert not set(everything) & webhooks.FORBIDDEN_KEYS


@pytest.mark.anyio
async def test_slack_and_teams_cards(owner, monkeypatch):
    from workers.tasks import send_notifications as sn

    alert = sn.build_alert("immediate", "v1", 70.0, 80.0, {"MM001"}, 0, 5, "https://meridian.example")
    alert["system_name"] = "ECC production"
    slack = sn.render("slack", alert)
    assert "MM001" in slack["text"] and [b["type"] for b in slack["blocks"]] == ["header", "section", "section", "actions"]
    assert any("*Score*" in f["text"] for f in slack["blocks"][2]["fields"])
    card = sn.render("teams", alert)["attachments"][0]["content"]
    assert card["type"] == "AdaptiveCard" and card["body"][2]["type"] == "FactSet"
    assert {"title": "Drop", "value": "10.0 points"} in card["body"][2]["facts"]

    s = seed_step9(owner)
    receiver = Receiver(200)
    monkeypatch.setattr("requests.post", receiver)
    deps, client = make_client(monkeypatch, s["tid"], s["ann"])
    await deps.engine.dispose()
    async with client:
        for kind in ("slack", "teams"):
            r = await client.post("/api/v1/alert-channels", json={"kind": kind, "target": f"https://{kind}.example/hook",
                                                                  "digest": "daily"}, headers=headers())
            assert r.status_code == 201, r.text
            t = await client.post(f"/api/v1/alert-channels/{r.json()['id']}/test", headers=headers())
            assert t.json() == {"delivered": True}
    bodies = [json.loads(c["body"]) for c in receiver.calls[-2:]]
    assert "blocks" in bodies[0] and bodies[1]["attachments"][0]["content"]["type"] == "AdaptiveCard"
