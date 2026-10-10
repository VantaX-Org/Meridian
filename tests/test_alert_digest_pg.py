"""Alerts compare runs of the same system (workers/tasks/send_notifications.py).

The Postgres part runs with MERIDIAN_TEST_DB_URL (see tests/test_drilldown_routes_pg.py).
Seed: two systems, each with a baseline run two days ago and a fresh run today.
  PRD  DQS 90 -> 70, CHK-X newly failing  -> score_drop + new_critical
  QAS  DQS 80 -> 80, CHK-X newly failing  -> new_critical only
PRD's fresh run is the tenant's newest, so the old tenant-wide lookup compared
QAS with PRD and reported one mixed alert.
"""

from __future__ import annotations

import json
import os
import uuid

import pytest

from workers.tasks import send_notifications as sn

_ROLE = "meridian_digest_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


def test_alert_text_names_the_system():
    a = sn.build_alert("daily", "v", None, None, {"AP001"}, 0, 5, "https://app")
    assert sn.alert_text(a).startswith("Meridian daily alert — ")
    a["system_name"] = "PRD"
    assert sn.alert_text(a).startswith("Meridian daily alert for PRD — ")


@pytest.fixture(scope="module")
def app_engine():
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _version(c, tid, sid, score, interval):
    from sqlalchemy import text

    vid = str(uuid.uuid4())
    c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) VALUES "
                   "(:v, :t, 'complete', now() - CAST(:i AS interval), CAST(:m AS jsonb), CAST(:q AS jsonb))"),
              {"v": vid, "t": tid, "i": interval, "m": json.dumps({"system_id": sid}),
               "q": json.dumps({"accounts_payable": {"composite_score": score}})})
    return vid


def _critical(c, tid, vid, check_id):
    from sqlalchemy import text

    c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                   "affected_count, total_count, details) VALUES (:v, :t, 'accounts_payable', :c, 'critical', "
                   "'validity', 3, 10, '{}'::jsonb)"), {"v": vid, "t": tid, "c": check_id})


@pg
def test_digest_and_immediate_alert_are_per_system(app_engine, monkeypatch):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    owner, app = app_engine
    tid, prd, qas = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'D-digest')"), {"t": tid})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:p, :t, 'PRD'), (:q, :t, 'QAS')"),
                  {"p": prd, "q": qas, "t": tid})
        _version(c, tid, prd, 90.0, "2 days")
        prd_cur = _version(c, tid, prd, 70.0, "1 hour")
        _version(c, tid, qas, 80.0, "2 days")
        qas_cur = _version(c, tid, qas, 80.0, "2 hours")
        _critical(c, tid, prd_cur, "CHK-X")
        _critical(c, tid, qas_cur, "CHK-X")
        c.execute(text("INSERT INTO alert_channels (tenant_id, kind, target, digest, immediate_critical) VALUES "
                       "(:t, 'slack', 'https://hooks.example/d', 'daily', false), "
                       "(:t, 'slack', 'https://hooks.example/i', 'off', true)"), {"t": tid})

    sent: list[dict] = []
    monkeypatch.setenv("MERIDIAN_APP_URL", "https://app")
    monkeypatch.setattr(sn, "get_sync_engine", lambda: app)
    monkeypatch.setattr(sn, "deliver", lambda ch, alert: sent.append(alert) or True)

    sn.send_alert_digest("daily")
    mine = {a["system_name"]: a for a in sent if a["version_id"] in (prd_cur, qas_cur)}
    assert set(mine) == {"PRD", "QAS"}
    assert mine["PRD"]["triggers"] == ["score_drop", "new_critical"]
    assert mine["PRD"]["previous_score"] == 90.0 and mine["PRD"]["score"] == 70.0
    assert mine["QAS"]["triggers"] == ["new_critical"] and mine["QAS"]["new_critical_rules"] == ["CHK-X"]
    assert mine["QAS"]["previous_score"] == 80.0

    # immediate: QAS's run is compared with QAS's baseline, not with PRD's newer run
    sent.clear()
    with Session(app) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tid})
        sn._send_immediate_critical(s, tid, qas_cur)
    assert [(a["system_name"], a["new_critical_rules"]) for a in sent] == [("QAS", ["CHK-X"])]


@pg
def test_digest_one_raising_channel_does_not_stop_the_rest(app_engine, monkeypatch):
    """One channel's deliver() raising (e.g. an expired Graph token) must not drop the other
    channel's delivery, or the rest of the tenant's digest."""
    from sqlalchemy import text

    owner, app = app_engine
    tid, prd = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'D-digest-raise')"), {"t": tid})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:p, :t, 'PRD')"), {"p": prd, "t": tid})
        _version(c, tid, prd, 90.0, "2 days")
        prd_cur = _version(c, tid, prd, 70.0, "1 hour")
        _critical(c, tid, prd_cur, "CHK-X")
        c.execute(text("INSERT INTO alert_channels (tenant_id, kind, target, digest, immediate_critical) VALUES "
                       "(:t, 'slack', 'https://hooks.example/broken', 'daily', false), "
                       "(:t, 'slack', 'https://hooks.example/good', 'daily', false)"), {"t": tid})

    delivered: list[tuple[str, str]] = []  # (channel target, alert version_id) — this tenant's only

    def flaky_deliver(ch, alert):
        if ch["target"].endswith("/broken"):
            raise RuntimeError("expired token")
        delivered.append((ch["target"], alert["version_id"]))
        return True

    monkeypatch.setenv("MERIDIAN_APP_URL", "https://app")
    monkeypatch.setattr(sn, "get_sync_engine", lambda: app)
    monkeypatch.setattr(sn, "deliver", flaky_deliver)

    sn.send_alert_digest("daily")

    # the shared pg instance may carry other tenants' leftover channels/alerts from other test
    # modules — key on this run's own version id, not on raw totals, to stay contamination-proof
    mine = [t for t, v in delivered if v == prd_cur]
    assert mine == ["https://hooks.example/good"]


@pg
def test_digest_sent_count_excludes_an_undelivered_email_channel(app_engine, monkeypatch):
    """An email channel with no backend configured must not count toward `sent` — I1: deliver()
    (exercised here for real, not mocked) reports false instead of always true for email."""
    from sqlalchemy import text

    owner, app = app_engine
    tid, prd = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'D-digest-email')"), {"t": tid})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:p, :t, 'PRD')"), {"p": prd, "t": tid})
        _version(c, tid, prd, 90.0, "2 days")
        prd_cur = _version(c, tid, prd, 70.0, "1 hour")
        _critical(c, tid, prd_cur, "CHK-X")
        c.execute(text("INSERT INTO alert_channels (tenant_id, kind, target, digest, immediate_critical) VALUES "
                       "(:t, 'email', 'ops@example.com', 'daily', false)"), {"t": tid})

    for var in ("MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "EMAIL_FROM",
                "SMTP_HOST", "RESEND_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("MERIDIAN_APP_URL", "https://app")
    monkeypatch.setattr(sn, "get_sync_engine", lambda: app)

    real_deliver = sn.deliver
    mine: list[bool] = []

    def spy_deliver(ch, alert):
        ok = real_deliver(ch, alert)
        if alert["version_id"] == prd_cur:
            mine.append(ok)
        return ok

    monkeypatch.setattr(sn, "deliver", spy_deliver)

    sn.send_alert_digest("daily")

    # the shared pg instance may carry other tenants' leftover channels/alerts — key on this run's
    # own version id so contamination from other test modules can't mask the count going wrong
    assert mine == [False]
