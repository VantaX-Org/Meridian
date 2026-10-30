"""workers/tasks/send_notifications per-user fan-out: critical alerts reach opted-in users only,
personal digests skip users with nothing open, a run without an email backend writes one
no_backend row per tenant, every delivery key is claimed before the send so a repeated run
sends nothing twice, and the tenant is set again after every commit. _deliver_email and
create_notification_sync are monkeypatched."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from api.services import notifications as notif_service
from api.services import user_notifications as un
from api.services.user_notifications import Recipient
from workers.tasks import send_notifications as sn

TID = str(uuid.uuid4())
VID = str(uuid.uuid4())
_GRAPH = ("MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "EMAIL_FROM")


def _r(name, email="u@example.com", wants_email=True):
    return Recipient(user_id=str(uuid.uuid4()), name=name, email=email, wants_email=wants_email)


class _Result:
    def __init__(self, rows=(), scalar=0):
        self._rows = list(rows)
        self._scalar = scalar

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def first(self):
        return self.fetchone()

    def scalar(self):
        return self._scalar

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _Session:
    """Answers the worker's queries from a small in-memory picture of one tenant and records
    every notification_deliveries row (claims honour the unique key the way Postgres does,
    updates mutate the claimed row), commits, and the order of commits, tenant sets and
    other statements."""

    def __init__(self, open_items=None, queue=None, owner_rows=(), channels=()):
        self.open_items = open_items or {}   # user_id -> [(severity, count), ...]
        self.queue = queue or {}             # user_id -> count
        self.owner_rows = list(owner_rows)   # OWNER_ISSUE_SQL rows
        self.channels = list(channels)
        self.deliveries: list[dict] = []
        self.commits = 0
        self.rolled_back = 0
        self.events: list[tuple] = []        # ("commit",) | ("set", tid) | ("sql", first two words)

    def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        p = params or {}
        if sql.startswith("SELECT set_config('app.tenant_id'"):
            self.events.append(("set", p["tid"]))
            return _Result()
        if not sql.startswith("SET "):
            self.events.append(("sql", " ".join(sql.split()[:2])))
        if sql.startswith("INSERT INTO notification_deliveries") and "ON CONFLICT" in sql:
            assert "'pending'" in sql and "RETURNING id" in sql
            if any((d["uid"], d["channel"], d.get("key")) == (p["uid"], p["channel"], p["key"])
                   for d in self.deliveries):
                return _Result()
            self.deliveries.append(dict(p, status="pending", error=None))
            return _Result([(p["id"],)])
        if sql.startswith("INSERT INTO notification_deliveries"):
            self.deliveries.append(dict(p))
            return _Result()
        if sql.startswith("UPDATE notification_deliveries"):
            row = next(d for d in self.deliveries if d["id"] == p["id"])
            assert row["status"] == "pending", "only a claimed row is finished"
            row.update(status=p["status"], error=p["error"])
            return _Result()
        if "FROM alert_channels" in sql:
            return _Result(self.channels)
        if "FROM record_issues ri JOIN users" in sql:
            return _Result([SimpleNamespace(_mapping=r) for r in self.owner_rows])
        if "FROM record_issues" in sql:
            return _Result(self.open_items.get(p.get("uid"), []))
        if "FROM stewardship_queue" in sql:
            return _Result(scalar=self.queue.get(p.get("uid"), 0))
        if "FROM analysis_versions WHERE id" in sql:
            return _Result([(datetime.now(timezone.utc), "upload")])
        if "FROM analysis_versions" in sql:
            return _Result()  # no previous run
        if "FROM findings" in sql:
            return _Result([("BP-001",), ("MM-002",)])
        if sql.startswith("SELECT alert_thresholds FROM tenants"):
            return _Result([({},)])
        if "FROM tenants" in sql:
            return _Result([(TID,)])
        if "FROM exceptions" in sql:
            return _Result(scalar=0)
        if sql.startswith("SET "):
            return _Result()
        raise AssertionError(f"unexpected SQL: {sql}")

    def commit(self):
        self.commits += 1
        self.events.append(("commit",))

    def rollback(self):
        self.rolled_back += 1

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def assert_tenant_set_after_every_commit(self, tid):
        """Every commit is followed by a set_config for the tenant before any other statement."""
        assert self.commits, "nothing committed"
        for i, ev in enumerate(self.events):
            if ev == ("commit",):
                assert self.events[i + 1] == ("set", tid), f"commit at {i} not followed by set_config: {self.events}"


@pytest.fixture
def wired(monkeypatch):
    """Capture emails and in-app rows; start with no email backend configured."""
    for k in (*_GRAPH, "SMTP_HOST", "RESEND_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("MERIDIAN_APP_URL", "https://app")
    emails: list[tuple] = []
    in_app: list[dict] = []
    monkeypatch.setattr(sn, "_deliver_email", lambda to, subject, body: emails.append((to, subject, body)) or True)
    monkeypatch.setattr(notif_service, "create_notification_sync",
                        lambda tid, uid, type_, title, body, link, session: in_app.append(
                            {"tid": tid, "uid": uid, "type": type_, "title": title, "body": body, "link": link}) or "id")
    return SimpleNamespace(emails=emails, in_app=in_app, monkeypatch=monkeypatch)


def _alert():
    return sn.build_alert("immediate", VID, None, None, {"BP-001", "MM-002"}, 0, 0, "https://app") | {"system_name": "PRD"}


# ── critical ─────────────────────────────────────────────────────────────────

def test_critical_emails_opted_in_users_only_and_everyone_gets_in_app(wired):
    wired.monkeypatch.setenv("SMTP_HOST", "relay")
    ana, ben, eve = _r("Ana"), _r("Ben", wants_email=False), _r("Eve", email=None, wants_email=False)
    s = _Session()
    assert sn._notify_users_critical(s, TID, _alert(), [ana, ben, eve]) == 1

    assert [e[0] for e in wired.emails] == ["u@example.com"]
    assert "PRD" in wired.emails[0][1]
    assert sorted(n["uid"] for n in wired.in_app) == sorted([ana.user_id, ben.user_id, eve.user_id])
    assert all(n["tid"] == TID and n["type"] == "dq_alert" and n["link"] in (f"/run/{VID}", f"/o/_/material-master?run={VID}") for n in wired.in_app)
    assert "BP-001" in wired.in_app[0]["body"]

    by = {(d["uid"], d["channel"]): d for d in s.deliveries}
    assert by[(ana.user_id, "email")]["status"] == "sent" and by[(ana.user_id, "email")]["kind"] == "critical"
    assert by[(ana.user_id, "in_app")]["status"] == "sent"
    assert (ben.user_id, "email") not in by and (eve.user_id, "email") not in by
    assert not any(d["status"] == "no_backend" for d in s.deliveries)
    assert all(d["key"] == VID for d in s.deliveries), "critical deliveries are keyed on the version"
    s.assert_tenant_set_after_every_commit(TID)


def test_critical_without_backend_writes_one_no_backend_row_and_no_email(wired):
    s = _Session()
    users = [_r("Ana"), _r("Ben"), _r("Cy", wants_email=False)]
    assert sn._notify_users_critical(s, TID, _alert(), users) == 0
    assert wired.emails == []
    assert len(wired.in_app) == 3
    nb = [d for d in s.deliveries if d["status"] == "no_backend"]
    assert len(nb) == 1 and nb[0]["uid"] is None and nb[0]["channel"] == "email" and nb[0]["kind"] == "critical"
    assert sum(d["status"] == "sent" and d["channel"] == "in_app" for d in s.deliveries) == 3


def test_critical_without_backend_and_nobody_wanting_email_writes_no_backend_row_at_all(wired):
    s = _Session()
    sn._notify_users_critical(s, TID, _alert(), [_r("Ben", wants_email=False)])
    assert not any(d["status"] == "no_backend" for d in s.deliveries)


def test_failed_and_raising_sends_are_recorded_not_raised(wired):
    wired.monkeypatch.setenv("RESEND_API_KEY", "re_x")
    calls = iter([False, RuntimeError("token expired")])

    def deliver(to, subject, body):
        r = next(calls)
        if isinstance(r, Exception):
            raise r
        return r

    wired.monkeypatch.setattr(sn, "_deliver_email", deliver)
    s = _Session()
    a, b = _r("A"), _r("B")
    assert sn._notify_users_critical(s, TID, _alert(), [a, b]) == 0
    rows = {d["uid"]: d for d in s.deliveries if d["channel"] == "email"}
    assert rows[a.user_id]["status"] == "failed" and rows[a.user_id]["error"] is None
    assert rows[b.user_id]["status"] == "failed" and rows[b.user_id]["error"] == "RuntimeError"


def test_send_immediate_critical_runs_user_fanout_after_tenant_channels(wired):
    wired.monkeypatch.setenv("SMTP_HOST", "relay")
    ana = _r("Ana")
    wired.monkeypatch.setattr(un, "resolve_recipients", lambda session, tid, kind: [ana] if kind == "critical" else [])
    delivered = []
    wired.monkeypatch.setattr(sn, "_deliver_safe", lambda ch, alert: delivered.append((ch["id"], alert["mode"])) or True)
    s = _Session(channels=[{"id": "c1", "kind": "slack", "target": "https://h", "secret": None}])
    sn._send_immediate_critical(s, TID, VID)
    assert delivered == [("c1", "immediate")], "tenant channel behaviour unchanged"
    assert [e[0] for e in wired.emails] == ["u@example.com"]
    assert wired.in_app[0]["uid"] == ana.user_id


def test_send_immediate_critical_runs_without_any_tenant_channel(wired):
    ana = _r("Ana", wants_email=False)
    wired.monkeypatch.setattr(un, "resolve_recipients", lambda *a: [ana])
    s = _Session()
    sn._send_immediate_critical(s, TID, VID)
    assert len(wired.in_app) == 1 and wired.emails == []


def test_send_immediate_critical_is_silent_when_nobody_opted_in(wired):
    wired.monkeypatch.setattr(un, "resolve_recipients", lambda *a: [])
    s = _Session()
    sn._send_immediate_critical(s, TID, VID)
    assert wired.in_app == [] and s.deliveries == []


def test_recipient_lookup_failure_reads_as_nobody(wired):
    def boom(*a):
        raise RuntimeError("relation users.preferences does not exist")

    wired.monkeypatch.setattr(un, "resolve_recipients", boom)
    s = _Session()
    assert sn._recipients_safe(s, TID, "critical") == [] and s.rolled_back == 1


# ── digest ───────────────────────────────────────────────────────────────────

def _owner_row(user_id, owner, severity, open_count):
    return {"user_id": user_id, "owner": owner, "severity": severity, "open_count": open_count,
            "baseline_open_count": open_count, "fixed_since_baseline": 0,
            "oldest_open_first_seen": datetime.now(timezone.utc) if open_count else None}


def test_digest_skips_users_with_zero_items(wired):
    wired.monkeypatch.setenv("SMTP_HOST", "relay")
    ana, ben, cy = _r("Ana"), _r("Ben"), _r("Cy", wants_email=False)
    s = _Session(open_items={ana.user_id: [("critical", 2), ("high", 1)]}, queue={cy.user_id: 3})
    assert sn._send_user_digests(s, TID, "daily", [ana, ben, cy], "https://app") == 1

    assert sorted(n["uid"] for n in wired.in_app) == sorted([ana.user_id, cy.user_id])
    assert all(n["type"] == "digest" and n["title"] == "Your daily data quality digest" for n in wired.in_app)
    ana_body = next(n["body"] for n in wired.in_app if n["uid"] == ana.user_id)
    assert "3 open item(s)" in ana_body and "2 critical" in ana_body and "1 high" in ana_body
    cy_body = next(n["body"] for n in wired.in_app if n["uid"] == cy.user_id)
    assert "3 stewardship" in cy_body
    assert [e[0] for e in wired.emails] == ["u@example.com"] and "daily digest" in wired.emails[0][1]
    assert not any(d["uid"] == ben.user_id for d in s.deliveries), "zero items: no row at all"
    assert all(d["key"] == un.digest_key("daily") for d in s.deliveries if d["uid"]), "keyed on the period"
    s.assert_tenant_set_after_every_commit(TID)


def test_digest_matches_owner_card_on_display_name(wired):
    naidoo = _r("P. Naidoo", wants_email=False)
    s = _Session(owner_rows=[_owner_row(str(uuid.uuid4()), "P. Naidoo", "critical", 1)])
    assert sn._send_user_digests(s, TID, "weekly", [naidoo], "https://app") == 0
    assert len(wired.in_app) == 1 and "P. Naidoo's score is" in wired.in_app[0]["body"]
    assert "0 open item(s) assigned to you" in wired.in_app[0]["body"]


def test_digest_without_backend_writes_no_backend_once_per_run(wired):
    users = [_r("A"), _r("B"), _r("C")]
    s = _Session(open_items={u.user_id: [("low", 1)] for u in users})
    assert sn._send_user_digests(s, TID, "daily", users, "https://app") == 0
    assert wired.emails == [] and len(wired.in_app) == 3
    nb = [d for d in s.deliveries if d["status"] == "no_backend"]
    assert len(nb) == 1 and nb[0]["uid"] is None and nb[0]["kind"] == "digest"


def test_send_alert_digest_runs_personal_digests_without_tenant_channels(wired):
    ana = _r("Ana", wants_email=False)
    s = _Session(open_items={ana.user_id: [("high", 4)]})
    wired.monkeypatch.setattr(sn, "get_sync_engine", lambda: object())
    wired.monkeypatch.setattr(sn, "Session", lambda engine: s)
    wired.monkeypatch.setattr(un, "resolve_recipients", lambda session, tid, kind: [ana] if kind == "daily" else [])
    assert sn.send_alert_digest("daily") == {"period": "daily", "sent": 0}
    assert len(wired.in_app) == 1 and wired.in_app[0]["uid"] == ana.user_id


# ── idempotency: the key is claimed before the send ───────────────────────────

def test_critical_for_the_same_version_twice_notifies_once(wired):
    wired.monkeypatch.setenv("SMTP_HOST", "relay")
    ana = _r("Ana")
    s = _Session()
    assert sn._notify_users_critical(s, TID, _alert(), [ana]) == 1
    assert sn._notify_users_critical(s, TID, _alert(), [ana]) == 0, "re-queued alert: nothing goes out"
    assert len(wired.emails) == 1 and len(wired.in_app) == 1
    assert sorted(d["channel"] for d in s.deliveries) == ["email", "in_app"], "no second row either"
    other = sn.build_alert("immediate", str(uuid.uuid4()), None, None, {"BP-001"}, 0, 0, "https://app")
    assert sn._notify_users_critical(s, TID, other, [ana]) == 1, "another version is a new alert"


def test_digest_for_the_same_period_twice_sends_once(wired):
    wired.monkeypatch.setenv("SMTP_HOST", "relay")
    ana = _r("Ana")
    s = _Session(open_items={ana.user_id: [("high", 1)]})
    assert sn._send_user_digests(s, TID, "daily", [ana], "https://app") == 1
    assert sn._send_user_digests(s, TID, "daily", [ana], "https://app") == 0
    assert len(wired.emails) == 1 and len(wired.in_app) == 1
    assert len(s.deliveries) == 2
    assert sn._send_user_digests(s, TID, "weekly", [ana], "https://app") == 1, "another period is its own digest"


def test_claim_lands_with_the_in_app_notification_before_the_email_goes_out(wired):
    """The in-app row and both claims are committed before the external send; the outcome is
    recorded in a second transaction."""
    wired.monkeypatch.setenv("SMTP_HOST", "relay")
    s = _Session()
    order = []
    wired.monkeypatch.setattr(sn, "_deliver_email",
                              lambda to, subject, body: order.append(("send", s.commits)) or True)
    sn._notify_users_critical(s, TID, _alert(), [_r("Ana")])
    assert order == [("send", 1)], "one commit (claims + in-app notification) before the send"
    assert s.commits == 2
    email_row = next(d for d in s.deliveries if d["channel"] == "email")
    assert email_row["status"] == "sent"


def test_failed_send_keeps_its_key_and_is_not_retried(wired):
    """A failed external send is not retried automatically: the row stays "failed" and a repeat
    run skips the recipient. The test-send button is the manual path."""
    wired.monkeypatch.setenv("SMTP_HOST", "relay")
    ana = _r("Ana")
    s = _Session()
    wired.monkeypatch.setattr(sn, "_deliver_email", lambda *a: False)
    assert sn._notify_users_critical(s, TID, _alert(), [ana]) == 0
    sent_calls = []
    wired.monkeypatch.setattr(sn, "_deliver_email", lambda *a: sent_calls.append(a) or True)
    assert sn._notify_users_critical(s, TID, _alert(), [ana]) == 0
    assert sent_calls == [] and len(wired.in_app) == 1
    email_row = next(d for d in s.deliveries if d["channel"] == "email")
    assert email_row["status"] == "failed"


# ── tenant context survives the personal senders' commits ─────────────────────

def test_tenant_is_set_again_after_each_personal_commit_before_tenant_channel_queries(wired):
    """send_alert_digest sets app.tenant_id once per tenant session; the personal digest commits
    mid-way, after which the pooled connection may change. The task must set the tenant again
    right after each commit, before the tenant-channel queries that follow."""
    wired.monkeypatch.setenv("SMTP_HOST", "relay")
    ana = _r("Ana")
    s = _Session(open_items={ana.user_id: [("high", 4)]},
                 channels=[{"id": "c1", "kind": "slack", "target": "https://h", "secret": None}])
    wired.monkeypatch.setattr(sn, "get_sync_engine", lambda: object())
    wired.monkeypatch.setattr(sn, "Session", lambda engine: s)
    wired.monkeypatch.setattr(sn, "_deliver_safe", lambda ch, alert: True)
    wired.monkeypatch.setattr(un, "resolve_recipients", lambda session, tid, kind: [ana] if kind == "daily" else [])
    sn.send_alert_digest("daily")
    assert len(wired.emails) == 1 and s.commits == 2
    s.assert_tenant_set_after_every_commit(TID)
    last_commit = max(i for i, ev in enumerate(s.events) if ev == ("commit",))
    after = s.events[last_commit + 1:]
    assert after[0] == ("set", TID)
    assert ("sql", "SELECT alert_thresholds") in after and ("sql", "SELECT DISTINCT") in after, \
        "the tenant-channel queries run after the tenant was set again"


def test_send_notification_sets_tenant_again_after_the_critical_fanout(wired):
    """send_notification runs _send_immediate_critical first; its commits must not leave the
    rest of the task (version load, tenant email) without a tenant."""
    ana = _r("Ana", wants_email=False)
    s = _Session()
    wired.monkeypatch.setattr(un, "resolve_recipients", lambda *a: [ana])
    sn._send_immediate_critical(s, TID, VID)
    assert len(wired.in_app) == 1 and s.commits == 1
    s.assert_tenant_set_after_every_commit(TID)
    assert s.events[-1] == ("set", TID), "the session is left with the tenant set for the caller"


def test_personal_digest_text_is_deterministic():
    title, body = sn.personal_digest("Ana", {"critical": 1, "stewardship": 2}, None)
    assert title == "3 open item(s)"
    assert body == "You have 3 open item(s) assigned to you: 1 critical, 2 stewardship."
