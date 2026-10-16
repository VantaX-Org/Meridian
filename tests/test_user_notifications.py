"""api/services/user_notifications: recipients from users.preferences, backend name, delivery rows."""

import json
import uuid

import pytest

from api.services import user_notifications as un


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _Session:
    """Holds a tenant's users and answers the one recipients query the way Postgres would
    (the WHERE clause is evaluated here, in Python, from the same preference document)."""

    def __init__(self, users):
        self.users = users
        self.statements = []
        self.claimed = set()

    def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.statements.append((sql, params))
        if sql.startswith("INSERT INTO notification_deliveries") and "ON CONFLICT" in sql:
            key = (params["tid"], params["uid"], params["channel"], params["key"])
            if key in self.claimed:
                return _Result([])
            self.claimed.add(key)
            return _Result([(params["id"],)])
        if sql.startswith("INSERT INTO notification_deliveries") or sql.startswith("UPDATE notification_deliveries"):
            return _Result([])
        assert "FROM users" in sql and "is_active" in sql
        rows = []
        for u in self.users:
            if not u.get("is_active", True):
                continue
            n = (u.get("preferences") or {}).get("notifications") or {}
            if "immediate_critical" in sql:
                hit = n.get("immediate_critical") is True
            elif "'daily'" in sql:
                hit = n.get("digest") == "daily"
            elif "'weekly'" in sql:
                hit = n.get("digest") == "weekly"
            else:
                raise AssertionError(sql)
            if hit:
                raw = json.dumps(n) if u.get("as_text") else n
                rows.append((u["id"], u["name"], u.get("email"), raw))
        return _Result(rows)


def _user(name, email="x@example.com", notifications=None, is_active=True, **extra):
    return {"id": uuid.uuid4(), "name": name, "email": email, "is_active": is_active,
            "preferences": {"notifications": notifications} if notifications is not None else {}, **extra}


USERS = [
    _user("Ana", notifications={"immediate_critical": True, "digest": "daily", "channels": {"email": True}}),
    _user("Ben", notifications={"immediate_critical": True, "digest": "weekly"}),  # no channels: in-app only
    _user("Cy", notifications={"immediate_critical": False, "digest": "daily", "channels": {"email": True, "teams": True}}),
    _user("Dee", notifications={"immediate_critical": True, "channels": {"email": False}}),
    _user("Eve", email=None, notifications={"immediate_critical": True, "digest": "daily", "channels": {"email": True}}),
    _user("Flo", notifications={"immediate_critical": True, "digest": "daily", "channels": {"email": True}}, is_active=False),
    _user("Gus"),  # nothing set: never a recipient
    _user("Hal", notifications={"digest": "off", "channels": {"teams": True}}),
]


def _names(recipients):
    return sorted(r.name for r in recipients)


def test_critical_recipients_are_active_users_who_opted_in():
    s = _Session(USERS)
    got = un.resolve_recipients(s, str(uuid.uuid4()), "critical")
    assert _names(got) == ["Ana", "Ben", "Dee", "Eve"]
    assert len(s.statements) == 1, "one query per resolution"
    by = {r.name: r for r in got}
    assert by["Ana"].wants_email is True
    assert by["Ben"].wants_email is False, "absent channels means in-app only"
    assert by["Dee"].wants_email is False, "email: false means in-app only"
    assert by["Eve"].wants_email is False and by["Eve"].email is None, "no address means in-app only"


@pytest.mark.parametrize("kind, expected", [("daily", ["Ana", "Cy", "Eve"]), ("weekly", ["Ben"])])
def test_digest_recipients_match_the_period(kind, expected):
    got = un.resolve_recipients(_Session(USERS), str(uuid.uuid4()), kind)
    assert _names(got) == expected
    if kind == "daily":
        assert {r.name: r.wants_email for r in got} == {"Ana": True, "Cy": True, "Eve": False}


def test_teams_channel_is_accepted_and_ignored():
    got = un.resolve_recipients(_Session([_user("Hal", notifications={"digest": "daily", "channels": {"teams": True}})]),
                                "t", "daily")
    assert len(got) == 1 and got[0].wants_email is False


def test_preferences_stored_as_text_are_decoded():
    got = un.resolve_recipients(_Session([_user("Ana", notifications={"immediate_critical": True, "channels": {"email": True}},
                                                as_text=True)]), "t", "critical")
    assert got[0].wants_email is True


def test_query_is_tenant_scoped_and_bound():
    s = _Session(USERS)
    un.resolve_recipients(s, "11111111-1111-1111-1111-111111111111", "weekly")
    sql, params = s.statements[0]
    assert "tenant_id = CAST(:tid AS uuid)" in sql and params == {"tid": "11111111-1111-1111-1111-111111111111"}


def test_unknown_kind_is_rejected():
    with pytest.raises(ValueError):
        un.resolve_recipients(_Session([]), "t", "monthly")


def test_recipient_ids_are_strings():
    got = un.resolve_recipients(_Session(USERS[:1]), "t", "critical")
    assert isinstance(got[0].user_id, str) and uuid.UUID(got[0].user_id)


# ── email_backend_name: the precedence _deliver_email uses ───────────────────

_GRAPH = {"MICROSOFT_TENANT_ID": "t", "MICROSOFT_CLIENT_ID": "c", "MICROSOFT_CLIENT_SECRET": "s", "EMAIL_FROM": "f@x"}
_ALL = (*_GRAPH, "SMTP_HOST", "RESEND_API_KEY")


@pytest.fixture
def clean_env(monkeypatch):
    for k in _ALL:
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_no_backend_when_nothing_configured(clean_env):
    assert un.email_backend_name() is None


def test_graph_wins_over_smtp_and_resend(clean_env):
    for k, v in _GRAPH.items():
        clean_env.setenv(k, v)
    clean_env.setenv("SMTP_HOST", "relay")
    clean_env.setenv("RESEND_API_KEY", "re_x")
    assert un.email_backend_name() == "graph"


def test_partial_graph_config_falls_through(clean_env):
    clean_env.setenv("MICROSOFT_TENANT_ID", "t")
    clean_env.setenv("SMTP_HOST", "relay")
    clean_env.setenv("RESEND_API_KEY", "re_x")
    assert un.email_backend_name() == "smtp"


def test_resend_is_last(clean_env):
    clean_env.setenv("RESEND_API_KEY", "re_x")
    assert un.email_backend_name() == "resend"


# ── record_delivery ──────────────────────────────────────────────────────────

def test_record_delivery_writes_one_row():
    s = _Session([])
    row_id = un.record_delivery(s, "tid", "uid", "email", "digest", "failed", "RuntimeError")
    sql, params = s.statements[0]
    assert sql.startswith("INSERT INTO notification_deliveries")
    assert params == {"id": row_id, "tid": "tid", "uid": "uid", "channel": "email", "kind": "digest",
                      "status": "failed", "error": "RuntimeError"}


def test_record_delivery_tenant_level_row_has_no_user():
    s = _Session([])
    un.record_delivery(s, "tid", None, "email", "critical", "no_backend")
    assert s.statements[0][1]["uid"] is None and s.statements[0][1]["error"] is None


# ── claim_delivery / finish_delivery (idempotency) ────────────────────────────

def test_claim_inserts_pending_row_with_key_and_returns_none_on_repeat():
    s = _Session([])
    row_id = un.claim_delivery(s, "tid", "uid", "email", "critical", "v1")
    sql, params = s.statements[0]
    assert row_id == params["id"]
    assert "ON CONFLICT (tenant_id, user_id, channel, delivery_key) DO NOTHING" in sql
    assert "'pending'" in sql and "RETURNING id" in sql
    assert params["key"] == "v1" and params["kind"] == "critical"
    assert un.claim_delivery(s, "tid", "uid", "email", "critical", "v1") is None, "same key: not claimed again"
    assert un.claim_delivery(s, "tid", "uid", "in_app", "critical", "v1") is not None, "another channel is its own claim"
    assert un.claim_delivery(s, "tid", "uid", "email", "critical", "v2") is not None


def test_finish_updates_status_and_truncates_error():
    s = _Session([])
    un.finish_delivery(s, "row", "failed", "x" * 600)
    sql, params = s.statements[0]
    assert sql.startswith("UPDATE notification_deliveries SET status = :status, error = :error WHERE id = :id")
    assert params == {"id": "row", "status": "failed", "error": "x" * 500}
    un.finish_delivery(s, "row", "sent")
    assert s.statements[1][1]["error"] is None


def test_digest_keys_name_the_period():
    from datetime import datetime, timezone

    at = datetime(2026, 1, 1, 23, 59, tzinfo=timezone.utc)  # ISO week 1 of 2026
    assert un.digest_key("daily", at) == "daily:2026-01-01"
    assert un.digest_key("weekly", at) == "weekly:2026-W01"
    assert un.digest_key("weekly", datetime(2024, 12, 30, tzinfo=timezone.utc)) == "weekly:2025-W01"
    assert un.digest_key("daily").startswith("daily:")
    with pytest.raises(ValueError):
        un.digest_key("monthly", at)
    assert un.test_key() != un.test_key() and un.test_key().startswith("test:")


def test_migration_083_follows_082_and_the_model_has_rls_shape():
    import importlib.util
    from pathlib import Path

    from db.schema import NotificationDelivery

    path = Path(__file__).resolve().parents[1] / "db/migrations/versions/083_notification_deliveries.py"
    spec = importlib.util.spec_from_file_location("m083", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert (mod.revision, mod.down_revision) == ("083", "082")
    src = path.read_text()
    assert "ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY" in src
    cols = NotificationDelivery.__table__.c
    assert {"tenant_id", "user_id", "channel", "kind", "status", "error", "delivery_key", "created_at"} <= set(cols.keys())
    assert cols.user_id.nullable and cols.error.nullable and not cols.channel.nullable
    assert "uq_notification_deliveries_key" in src and "'pending'" in src
    unique = [ix for ix in NotificationDelivery.__table__.indexes if ix.name == "uq_notification_deliveries_key"]
    assert unique and unique[0].unique
    assert [c.name for c in unique[0].columns] == ["tenant_id", "user_id", "channel", "delivery_key"]
