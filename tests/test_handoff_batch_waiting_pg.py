"""F06: a fix batch that starts waiting tells the owners of its objects, and their deputies, in the inbox and by
email, once per batch and round (api/services/handoff_notices.py), whether the values went in through Work or the
batch was drafted through the fix-batch API; where the batch's approval is in progress the engine tells its deciders.

Seed (tests/m2_seed.py): Cara owns material_master with Bob as steward; Ann (the signed-in user) decides.
"""
from __future__ import annotations

import os
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, text

from api.services import handoff_notices
from tests.m2_client import headers, make_client
from tests.m2_seed import R1, R2, seed_m2

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


@pytest.fixture
def mail(monkeypatch):
    """An email backend is configured; the queued emails are captured instead of sent."""
    sent: list = []
    monkeypatch.setattr("api.services.handoff_notices.email_backend_name", lambda: "smtp")
    monkeypatch.setattr("api.services.handoff_notices.dispatch", lambda jobs: sent.extend(jobs) or len(sent))
    return sent


def notices(owner, s, user, type_="batch_waiting"):
    return [r[0] for r in q(owner, "SELECT title FROM notifications WHERE tenant_id = :t AND user_id = :u AND type = :ty "
                                   "ORDER BY created_at", t=s["tid"], u=user, ty=type_)]


def accept(key):
    return {"items": [{"module": "material_master", "record_key": key, "check_id": "MM014", "action": "accept"}]}


@pytest.mark.anyio
async def test_values_accepted_in_work_tell_the_owner_once_per_batch(owner, monkeypatch, mail):
    s = seed_m2(owner)
    deps, client = make_client(monkeypatch, s["tid"], s["user"])
    await deps.engine.dispose()
    async with client:
        r = await client.post("/api/v1/work/decide", headers=headers(), json=accept(R1))
        assert r.status_code == 200, r.text
        draft = r.json()["draft_batch_id"]
        r2 = await client.post("/api/v1/work/decide", headers=headers(), json=accept(R2))
        assert r2.status_code == 200 and r2.json()["draft_batch_id"] == draft
    name = q(owner, "SELECT name FROM remediation_batches WHERE id = :b", b=draft)[0][0]
    assert notices(owner, s, s["cara"]) == [f"Fix batch {name} waits for your approval"]
    link = q(owner, "SELECT link, body FROM notifications WHERE user_id = :u AND type = 'batch_waiting'", u=s["cara"])[0]
    assert link[0] == f"/?open=batch:{draft}" and "1 record" in link[1]
    # the person who built it is not told about their own batch
    assert notices(owner, s, s["user"]) == []
    # one email, to the owner, claimed once
    assert [(j.user_id, j.subject, j.link) for j in mail] == [(s["cara"], f"Fix batch {name} waits for your approval",
                                                               f"/?open=batch:{draft}")]
    rows = q(owner, "SELECT channel, status FROM notification_deliveries WHERE tenant_id = :t AND user_id = :u "
                    "AND kind = 'event' ORDER BY channel", t=s["tid"], u=s["cara"])
    assert rows == [("email", "pending"), ("in_app", "sent")]


@pytest.mark.anyio
async def test_a_batch_drafted_through_the_api_tells_the_owner_and_the_deputy(owner, monkeypatch, mail):
    s = seed_m2(owner)
    today = date.today()
    q(owner, "INSERT INTO delegations (tenant_id, from_user_id, to_user_id, starts_on, ends_on, created_by) "
             "VALUES (:t, :f, :to, :a, :b, 'test')", t=s["tid"], f=s["cara"], to=s["dan"],
      a=today - timedelta(days=1), b=today + timedelta(days=1))
    deps, client = make_client(monkeypatch, s["tid"], s["user"])
    await deps.engine.dispose()
    async with client:
        r = await client.post("/api/v1/remediation/batches", headers=headers(),
                              json={"name": "Units", "filter": {"check_id": "MM014", "record_keys": [R1, R2]}})
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
    assert notices(owner, s, s["cara"]) == ["Fix batch Units waits for your approval"]
    assert notices(owner, s, s["dan"]) == ["For Cara Owner: Fix batch Units waits for your approval"]
    assert sorted((j.user_id, j.subject) for j in mail) == sorted([
        (s["cara"], "Fix batch Units waits for your approval"),
        (s["dan"], "For Cara Owner: Fix batch Units waits for your approval")])
    # telling again is a no-op: the hand-off was claimed
    with owner.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": s["tid"]})
        from sqlalchemy.orm import Session
        with Session(bind=c) as sess:
            assert handoff_notices.batch_waiting(sess, s["tid"], bid) == []
    assert len(notices(owner, s, s["cara"])) == 1


@pytest.mark.anyio
async def test_email_off_means_inbox_only_and_no_backend_is_recorded(owner, monkeypatch):
    s = seed_m2(owner)
    sent: list = []
    monkeypatch.setattr("api.services.handoff_notices.dispatch", lambda jobs: sent.extend(jobs) or 0)
    monkeypatch.setattr("api.services.handoff_notices.email_backend_name", lambda: None)
    deps, client = make_client(monkeypatch, s["tid"], s["user"])
    await deps.engine.dispose()
    async with client:
        r = await client.post("/api/v1/work/decide", headers=headers(), json=accept(R1))
        assert r.status_code == 200, r.text
    assert sent == []
    assert q(owner, "SELECT channel, status FROM notification_deliveries WHERE tenant_id = :t AND user_id = :u "
                    "AND kind = 'event' ORDER BY channel", t=s["tid"], u=s["cara"]) == [
        ("email", "no_backend"), ("in_app", "sent")]
    # a person who turned email off gets the inbox line only
    s2 = seed_m2(owner)
    q(owner, "UPDATE users SET preferences = CAST(:p AS jsonb) WHERE id = :u",
      p='{"notifications": {"channels": {"email": false}}}', u=s2["cara"])
    monkeypatch.setattr("api.services.handoff_notices.email_backend_name", lambda: "smtp")
    deps, client = make_client(monkeypatch, s2["tid"], s2["user"])
    await deps.engine.dispose()
    async with client:
        assert (await client.post("/api/v1/work/decide", headers=headers(), json=accept(R1))).status_code == 200
    assert sent == [] and len(notices(owner, s2, s2["cara"])) == 1


def test_the_worker_sends_a_pending_notice_once(owner, monkeypatch):
    s = seed_m2(owner)
    calls: list = []
    monkeypatch.setattr("workers.tasks.send_notifications._deliver_email",
                        lambda to, subject, body, attachments=None: calls.append((to, subject, body)) or True)
    with owner.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": s["tid"]})
        did = c.execute(text("INSERT INTO notification_deliveries (tenant_id, user_id, channel, kind, status, delivery_key) "
                             "VALUES (:t, :u, 'email', 'event', 'pending', 'k1') RETURNING id::text"),
                        {"t": s["tid"], "u": s["cara"]}).scalar()
    from workers.tasks.handoff_notices import send
    out = send(owner, s["tid"], did, s["cara"], "Fix batch X waits", "Fix batch X waits", "Bob built it.",
               "/?open=batch:x", "Open the batch")
    assert out == "sent" and len(calls) == 1 and calls[0][0].startswith("cara-")
    assert "/?open=batch:x" in calls[0][2] and "Open the batch" in calls[0][2]
    assert send(owner, s["tid"], did, s["cara"], "s", "t", "b", None, "Open") == "skipped" and len(calls) == 1
