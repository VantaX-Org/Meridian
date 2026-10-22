"""Scheduled board pack: which channels get it and when, idempotency, and attachment encoding.

The database and the senders are mocked (see tests/test_send_notifications_users.py for the
pattern); the PDF and workbook builders are replaced by a stub pack."""

from __future__ import annotations

import base64
import email
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from workers.tasks import send_notifications as sn
from workers.tasks import send_report_pack as rp

TID = str(uuid.uuid4())
RUN = str(uuid.uuid4())
MONDAY = datetime(2026, 10, 19, 5, 0, tzinfo=timezone.utc)   # ISO week 43
NEXT_MONDAY = datetime(2026, 10, 26, 5, 0, tzinfo=timezone.utc)
FIRST = datetime(2026, 11, 1, 5, 0, tzinfo=timezone.utc)
PDF, XLSX = b"%PDF-1.7 board \x00\xff", b"PK\x03\x04 workbook \x00\xfe"
ATTACHMENTS = [("meridian_board_x.pdf", PDF, "application/pdf"), ("workbook.xlsx", XLSX, rp.XLSX_MIME)]


class _Result:
    def __init__(self, rows=(), scalar=None):
        self._rows, self._scalar = list(rows), scalar

    def mappings(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._scalar


class FakeSession:
    """In-memory alert_channels and notifications behind the SQL the task issues."""

    def __init__(self, channels: list[dict], run: str | None = RUN):
        self.channels = [{"enabled": True, "kind": "email", "report_pack": "off", "report_pack_key": None, **c}
                         for c in channels]
        self.run = run
        self.notifications: list[dict] = []
        self.sql: list[str] = []
        self.commits = 0

    def execute(self, stmt, params=None):
        sql, p = " ".join(str(stmt).split()), params or {}
        self.sql.append(sql)
        if sql.startswith("SELECT id, target, report_pack_key FROM alert_channels"):
            assert "enabled AND kind = 'email' AND report_pack = :c" in sql
            return _Result([{k: c[k] for k in ("id", "target", "report_pack_key")} for c in self.channels
                            if c["enabled"] and c["kind"] == "email" and c["report_pack"] == p["c"]])
        if "FROM analysis_versions" in sql:
            assert "status IN ('complete', 'agents_complete')" in sql and "ORDER BY run_at DESC LIMIT 1" in sql
            return _Result([(self.run,)] if self.run else [])
        if sql.startswith("UPDATE alert_channels SET report_pack_key = :k"):
            ch = next(c for c in self.channels if c["id"] == p["id"])
            if ch["report_pack_key"] != p["prev"]:
                return _Result()
            ch["report_pack_key"] = p["k"]
            return _Result([(p["id"],)])
        if sql.startswith("UPDATE alert_channels SET report_pack_key = CAST(:prev"):
            ch = next(c for c in self.channels if c["id"] == p["id"])
            if ch["report_pack_key"] == p["k"]:
                ch["report_pack_key"] = p["prev"]
            return _Result()
        if sql.startswith("INSERT INTO notifications"):
            self.notifications.append(p)
            return _Result()
        raise AssertionError(f"unexpected SQL: {sql}")

    def commit(self):
        self.commits += 1


def _pack() -> dict:
    return {"tenant_name": "Example Manufacturing Ltd", "attachments": ATTACHMENTS,
            "summary": {"run": "October re-run", "score": 81.46, "blocker_total": 5, "blockers": [
                {"check_id": "BP-001", "name": "Name missing", "module": "Business partner", "affected": 12_345},
                {"check_id": "AP-014", "name": "Bank key", "module": "Accounts payable", "affected": 987},
                {"check_id": "MM-007", "name": "Base unit", "module": "Material master", "affected": 40}]}}


def _channel(target: str, pack: str, **kw) -> dict:
    return {"id": str(uuid.uuid4()), "target": target, "report_pack": pack, **kw}


class Sender:
    def __init__(self, ok: bool = True):
        self.ok, self.calls = ok, []

    def __call__(self, to, subject, body, attachments=None):
        self.calls.append((to, subject, body, attachments))
        return self.ok


def _run(session, cadence="weekly", when=MONDAY, sender=None, build=None):
    built = []

    def _build(*a):
        built.append(a)
        return (build or _pack)()

    sender = sender or Sender()
    n = rp.send_for_tenant(session, TID, cadence, base_url="https://app.example", when=when,
                           build=_build, deliver=sender)
    return n, sender, built


# ── period and cadence ───────────────────────────────────────────────────────

def test_period_keys_follow_the_sast_calendar():
    assert rp.period_key("weekly", MONDAY) == "weekly:2026-W43"
    assert rp.period_key("weekly", NEXT_MONDAY) == "weekly:2026-W44"
    assert rp.period_key("monthly", FIRST) == "monthly:2026-11"
    # 22:30 UTC on the 31st is already the 1st in Johannesburg
    assert rp.period_key("monthly", datetime(2026, 10, 31, 22, 30, tzinfo=timezone.utc)) == "monthly:2026-11"
    with pytest.raises(ValueError):
        rp.period_key("daily")


def test_beat_entries_run_after_the_digests():
    from workers.scheduler import celery_app

    sched = celery_app.conf.beat_schedule
    weekly, monthly = sched["report-pack-weekly-monday"], sched["report-pack-monthly-1st"]
    assert weekly["task"] == monthly["task"] == "workers.tasks.send_report_pack.send_report_pack"
    assert weekly["args"] == ("weekly",) and monthly["args"] == ("monthly",)
    assert weekly["schedule"].hour == {5} and weekly["schedule"].minute == {0} and weekly["schedule"].day_of_week == {1}
    assert monthly["schedule"].hour == {5} and monthly["schedule"].day_of_month == {1}
    assert sched["alert-digest-weekly-monday"]["schedule"].hour == {4}
    task = celery_app.tasks["workers.tasks.send_report_pack.send_report_pack"]
    assert task.soft_time_limit and task.time_limit and task.time_limit > task.soft_time_limit


# ── channel selection ────────────────────────────────────────────────────────

def test_only_enabled_email_channels_on_the_cadence_get_the_pack():
    s = FakeSession([
        _channel("a@example.com", "weekly"),
        _channel("b@example.com", "monthly"),
        _channel("c@example.com", "off"),
        _channel("d@example.com", "weekly", enabled=False),
        _channel("https://hooks.example/x", "weekly", kind="slack"),
    ])
    n, sender, built = _run(s, "weekly")
    assert n == 1 and [c[0] for c in sender.calls] == ["a@example.com"]
    n, sender, _ = _run(s, "monthly", FIRST)
    assert n == 1 and [c[0] for c in sender.calls] == ["b@example.com"]


def test_the_pack_is_built_once_for_the_latest_finished_run():
    s = FakeSession([_channel("a@example.com", "weekly"), _channel("b@example.com", "weekly")])
    n, sender, built = _run(s)
    assert n == 2 and built == [(s, TID, RUN)]
    assert all(c[3] == ATTACHMENTS for c in sender.calls)


def test_nothing_to_send_without_a_channel_or_a_finished_run():
    n, sender, built = _run(FakeSession([_channel("c@example.com", "off")]))
    assert (n, sender.calls, built) == (0, [], [])
    n, sender, built = _run(FakeSession([_channel("a@example.com", "weekly")], run=None))
    assert (n, sender.calls, built) == (0, [], [])


# ── idempotency ──────────────────────────────────────────────────────────────

def test_a_second_firing_in_the_same_period_sends_nothing():
    s = FakeSession([_channel("a@example.com", "weekly")])
    assert _run(s)[0] == 1
    assert s.channels[0]["report_pack_key"] == f"weekly:2026-W43:{RUN}"
    n, sender, built = _run(s)
    assert (n, sender.calls, built) == (0, [], [])  # not even rendered
    assert len(s.notifications) == 1


def test_a_new_period_sends_again_and_only_the_missing_channel_is_sent_late():
    s = FakeSession([_channel("a@example.com", "weekly"), _channel("b@example.com", "weekly")])
    _run(s)
    s.channels.append({"enabled": True, "kind": "email", "report_pack": "weekly", "report_pack_key": None,
                       **_channel("late@example.com", "weekly")})
    n, sender, _ = _run(s)
    assert n == 1 and [c[0] for c in sender.calls] == ["late@example.com"]
    n, sender, _ = _run(s, when=NEXT_MONDAY)
    assert n == 3


def test_a_failed_send_gives_the_key_back_so_the_next_firing_retries():
    s = FakeSession([_channel("a@example.com", "weekly")])
    n, _, _ = _run(s, sender=Sender(ok=False))
    assert n == 0 and s.channels[0]["report_pack_key"] is None and s.notifications == []
    n, _, _ = _run(s)
    assert n == 1


def test_a_raising_backend_counts_as_a_failed_send():
    def boom(*_a):
        raise RuntimeError("smtp down")

    s = FakeSession([_channel("a@example.com", "weekly")])
    n, _, _ = _run(s, sender=boom)
    assert n == 0 and s.channels[0]["report_pack_key"] is None


def test_a_channel_claimed_by_another_worker_is_skipped():
    s = FakeSession([_channel("a@example.com", "weekly")])
    orig = rp._claim

    def lost_race(session, cid, key, prev):
        session.channels[0]["report_pack_key"] = key   # the other worker wins first
        return orig(session, cid, key, prev)

    rp._claim, sender = lost_race, Sender()
    try:
        n, _, _ = _run(s, sender=sender)
    finally:
        rp._claim = orig
    assert n == 0 and sender.calls == []


# ── the notification and the email ───────────────────────────────────────────

def test_one_report_notification_per_send_without_the_full_address():
    s = FakeSession([_channel("alice@example.com", "weekly"), _channel("bob@example.com", "weekly")])
    _run(s)
    assert [n["type"] for n in s.notifications] == ["report", "report"]
    first = s.notifications[0]
    assert first["uid"] is None and first["tid"] == TID and first["link"] == "/insights/reports"
    assert first["title"] == "Board pack sent: October re-run"
    assert "a***@example.com" in first["body"] and "alice@" not in first["body"]
    assert "score 81.5" in first["body"]


def test_email_names_the_run_the_score_and_the_three_blockers():
    s = FakeSession([_channel("a@example.com", "weekly")])
    _, sender, _ = _run(s)
    to, subject, body, attachments = sender.calls[0]
    assert subject == "Meridian board pack: October re-run"
    assert "October re-run" in body and "81.5 out of 100" in body
    for cid in ("BP-001", "AP-014", "MM-007"):
        assert cid in body
    assert "12,345" in body and "The three biggest blockers" in body
    assert "https://app.example/insights/reports" in body and "!" not in body.split("<body", 1)[1]
    assert [a[0] for a in attachments] == ["meridian_board_x.pdf", "workbook.xlsx"]


def test_summary_reads_the_board_context():
    ctx = {"meta": [("Run", "Q3 run"), ("Run ID", "abc")], "overall": {"composite": 72.0}, "blocker_total": 2,
           "blockers": [{"check_id": f"X-{i}", "module": "fi_gl", "affected": 1000 * i, "name": "n"} for i in range(1, 5)]}
    summary = rp.pack_summary(ctx)
    assert summary["run"] == "Q3 run" and summary["score"] == 72.0 and len(summary["blockers"]) == 3
    assert summary["blockers"][0]["module"] == "FI GL"
    _, body = rp.compose_email({**summary, "blockers": summary["blockers"][:2]}, "T", "https://a", with_workbook=False)
    assert "The blockers holding the run back are below." in body and "analyst workbook" not in body
    _, body = rp.compose_email({"run": "R", "score": None, "blocker_total": 0, "blockers": []}, "T", "https://a")
    assert "no score" in body and "No blockers were found" in body


# ── the task entry point ─────────────────────────────────────────────────────

def test_the_task_walks_every_tenant_and_survives_one_failing(monkeypatch):
    seen = []

    class Eng:
        pass

    class Plain:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, *_a):
            return SimpleNamespace(fetchall=lambda: [("t1",), ("t2",), ("t3",)])

    @contextmanager
    def tenant_session(_engine, tid):
        seen.append(tid)
        yield tid

    def send_for_tenant(session, tid, cadence, **_kw):
        if tid == "t2":
            raise RuntimeError("boom")
        return 2

    monkeypatch.setattr(rp, "get_sync_engine", lambda: Eng())
    monkeypatch.setattr(rp, "Session", lambda _e: Plain())
    monkeypatch.setattr(rp, "tenant_session", tenant_session)
    monkeypatch.setattr(rp, "send_for_tenant", send_for_tenant)
    assert rp.send_report_pack("monthly") == {"cadence": "monthly", "sent": 4}
    assert seen == ["t1", "t2", "t3"]
    with pytest.raises(ValueError):
        rp.send_report_pack("daily")


# ── attachment encoding ──────────────────────────────────────────────────────

def test_smtp_attaches_each_file_as_base64(monkeypatch):
    sent = {}

    class SMTP:
        def __init__(self, host, port):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            pass

        def sendmail(self, frm, to, raw):
            sent.update(frm=frm, to=to, raw=raw)

    monkeypatch.setenv("SMTP_HOST", "relay.local")
    monkeypatch.delenv("SMTP_USER", raising=False)
    monkeypatch.setattr("smtplib.SMTP", SMTP)
    assert sn._send_email_smtp("a@example.com", "Subject", "<p>Hi</p>", ATTACHMENTS) is True
    msg = email.message_from_string(sent["raw"])
    parts = msg.get_payload()
    assert parts[0].get_content_type() == "text/html"
    assert [p.get_content_type() for p in parts[1:]] == ["application/pdf", rp.XLSX_MIME]
    assert [p.get_filename() for p in parts[1:]] == ["meridian_board_x.pdf", "workbook.xlsx"]
    assert all(p["Content-Transfer-Encoding"] == "base64" for p in parts[1:])
    assert [p.get_payload(decode=True) for p in parts[1:]] == [PDF, XLSX]


def test_smtp_without_attachments_is_unchanged(monkeypatch):
    sent = {}

    class SMTP:
        def __init__(self, *a):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            pass

        def sendmail(self, frm, to, raw):
            sent["raw"] = raw

    monkeypatch.setattr("smtplib.SMTP", SMTP)
    monkeypatch.delenv("SMTP_USER", raising=False)
    assert sn._send_email_smtp("a@example.com", "S", "<p>Hi</p>") is True
    assert len(email.message_from_string(sent["raw"]).get_payload()) == 1


def test_resend_carries_attachments_as_base64_content(monkeypatch):
    posted = {}

    def post(url, headers, json, timeout):
        posted.update(url=url, json=json, timeout=timeout)
        return SimpleNamespace(ok=True, status_code=200)

    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setattr(sn.requests, "post", post)
    assert sn._send_email_resend("a@example.com", "S", "<p>Hi</p>", ATTACHMENTS) is True
    atts = posted["json"]["attachments"]
    assert [a["filename"] for a in atts] == ["meridian_board_x.pdf", "workbook.xlsx"]
    assert [base64.b64decode(a["content"]) for a in atts] == [PDF, XLSX]
    assert posted["json"]["to"] == ["a@example.com"] and posted["timeout"] > 10
    posted.clear()
    assert sn._send_email_resend("a@example.com", "S", "<p>Hi</p>") is True
    assert "attachments" not in posted["json"] and posted["timeout"] == 10


def test_deliver_email_passes_attachments_on_and_skips_graph(monkeypatch):
    calls = []
    graph = SimpleNamespace(send_email=lambda *a, **k: calls.append("graph") or True)
    monkeypatch.setattr(sn, "create_graph_client", lambda: graph)
    monkeypatch.setenv("SMTP_HOST", "relay.local")
    monkeypatch.setattr(sn, "_send_email_smtp", lambda *a: calls.append(a) or True)
    assert sn._deliver_email("a@example.com", "S", "B", ATTACHMENTS)
    assert calls == [("a@example.com", "S", "B", ATTACHMENTS)]
    calls.clear()
    assert sn._deliver_email("a@example.com", "S", "B")   # unchanged: Graph first
    assert calls == ["graph"]


# ── the setting on the channel endpoints ─────────────────────────────────────

class _RouteDB:
    def __init__(self, row):
        self.row, self.updated = row, None

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        if sql.startswith("UPDATE alert_channels"):
            self.updated = params
            self.row = {**self.row, "digest": params["d"], "immediate_critical": params["i"],
                        "enabled": params["e"], "report_pack": params["r"]}
        if sql.startswith("INSERT INTO alert_channels"):
            self.updated = params
            return _Rows({"id": "new", "kind": params["k"], "digest": params["d"], "report_pack": params["r"],
                          "immediate_critical": params["i"], "enabled": True, "created_at": None, "has_secret": False})
        return _Rows(self.row)

    async def commit(self):
        pass


class _Rows:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row

    def one(self):
        return self.row

    def all(self):
        return [self.row]


def _client(row) -> tuple[TestClient, _RouteDB]:
    from api.deps import Tenant, get_db, get_tenant
    from api.routes.notifications import router

    api, db = FastAPI(), _RouteDB(row)
    api.include_router(router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api), db


@pytest.fixture
def dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


ADMIN = {"X-User-Role": "admin"}
CH = uuid.uuid4()


def test_put_sets_report_pack_on_an_email_channel(dev_roles):
    row = {"kind": "email", "digest": "daily", "immediate_critical": False, "enabled": True,
           "report_pack": "off", "target": "ops@example.com", "id": str(CH), "created_at": None, "has_secret": False}
    client, db = _client(row)
    r = client.put(f"/api/v1/alert-channels/{CH}", json={"report_pack": "weekly"}, headers=ADMIN)
    assert r.status_code == 200 and r.json()["report_pack"] == "weekly" and r.json()["digest"] == "daily"
    assert db.updated["r"] == "weekly" and db.updated["d"] == "daily"


def test_put_rejects_a_pack_on_a_non_email_channel_and_bad_values(dev_roles):
    row = {"kind": "slack", "digest": "daily", "immediate_critical": False, "enabled": True,
           "report_pack": "off", "target": "https://hooks.example/x"}
    client, _ = _client(row)
    r = client.put(f"/api/v1/alert-channels/{CH}", json={"report_pack": "monthly"}, headers=ADMIN)
    assert r.status_code == 400 and "email channel" in r.json()["detail"]
    assert client.put(f"/api/v1/alert-channels/{CH}", json={"report_pack": "daily"}, headers=ADMIN).status_code == 422
    assert client.put(f"/api/v1/alert-channels/{CH}", json={"report_pack": "weekly"},
                      headers={"X-User-Role": "viewer"}).status_code == 403


def test_put_refuses_a_channel_that_would_never_fire(dev_roles):
    row = {"kind": "email", "digest": "off", "immediate_critical": False, "enabled": True,
           "report_pack": "weekly", "target": "ops@example.com"}
    client, _ = _client(row)
    r = client.put(f"/api/v1/alert-channels/{CH}", json={"report_pack": "off"}, headers=ADMIN)
    assert r.status_code == 400 and "would never fire" in r.json()["detail"]


def test_post_accepts_a_pack_only_email_channel_and_defaults_to_off(dev_roles):
    client, db = _client({})
    r = client.post("/api/v1/alert-channels", headers=ADMIN, json={
        "kind": "email", "target": "board@example.com", "digest": "off", "report_pack": "monthly"})
    assert r.status_code == 201 and r.json()["report_pack"] == "monthly"
    r = client.post("/api/v1/alert-channels", headers=ADMIN, json={
        "kind": "email", "target": "board@example.com", "digest": "daily"})
    assert r.status_code == 201 and db.updated["r"] == "off"
    r = client.post("/api/v1/alert-channels", headers=ADMIN, json={
        "kind": "slack", "target": "https://hooks.example/x", "report_pack": "weekly"})
    assert r.status_code == 400
