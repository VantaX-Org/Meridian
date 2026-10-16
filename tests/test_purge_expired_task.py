"""Nightly purge task: the dry-run gate and the per-tenant flow, on a fake session."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from workers.tasks import purge_expired as task

NOW = datetime(2026, 10, 15, 2, 30, tzinfo=timezone.utc)
TENANT = str(uuid.uuid4())


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._rows[0][0] if self._rows else None


class _Session:
    def __init__(self, retention, oldest_dry_run, versions=(), old_reports=(), old_audit=0):
        self.retention = retention
        self.oldest_dry_run = oldest_dry_run
        self.versions = list(versions)
        self.old_reports = list(old_reports)
        self.old_audit = old_audit
        self.deletes: list[str] = []
        self.params: list[dict] = []
        self.logs: list[dict] = []
        self.commits = 0

    def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        if sql.startswith("SELECT retention"):
            return _Result([(self.retention,)])
        if sql.startswith("SELECT min(created_at) FROM purge_log"):
            return _Result([(self.oldest_dry_run,)])
        if sql.startswith("SELECT id, label, run_at, metadata, status"):
            return _Result(self.versions)
        if sql.startswith("SELECT id, pdf_path FROM reports"):
            return _Result(self.old_reports)
        if sql.startswith("SELECT count(*) FROM audit_log"):
            return _Result([(self.old_audit,)])
        if sql.startswith("INSERT INTO purge_log"):
            self.logs.append(params)
            return _Result([])
        if sql.startswith("INSERT INTO audit_log"):
            return _Result([])
        if sql.startswith("DELETE FROM") or sql.startswith("UPDATE purge_log"):
            self.deletes.append(sql)
            self.params.append(params)
            return _Result([])
        raise AssertionError(sql)

    def commit(self):
        self.commits += 1


def _version(days_ago: int):
    return (uuid.uuid4(), f"run-{days_ago}", NOW - timedelta(days=days_ago), {"archived": True}, "complete")


def _stub_purge(monkeypatch):
    calls = []

    def fake(session, tenant_id, version_id, *, dry_run, actor=None, force=False, source="manual"):
        calls.append({"version_id": version_id, "dry_run": dry_run, "source": source})
        return {"rows_by_table": {}, "bytes_freed": 0, "blocked_reason": None, "storage_errors": [],
                "purge_log_id": "x"}

    monkeypatch.setattr("api.services.purge.purge_version", fake)
    return calls


def test_gate_requires_flag_and_seven_days_of_dry_runs():
    s = _Session({}, None)
    assert task.enforcement_allowed(s, TENANT, NOW, flag_enabled=True) is False  # never dry-run yet
    s = _Session({}, NOW - timedelta(days=3))
    assert task.enforcement_allowed(s, TENANT, NOW, flag_enabled=True) is False
    s = _Session({}, NOW - timedelta(days=7))
    assert task.enforcement_allowed(s, TENANT, NOW, flag_enabled=True) is True
    assert task.enforcement_allowed(s, TENANT, NOW, flag_enabled=False) is False


def test_gate_asks_for_nightly_rows_under_the_current_policy():
    seen = []

    class _S(_Session):
        def execute(self, stmt, params=None):
            seen.append(" ".join(str(stmt).split()))
            return super().execute(stmt, params)

    task.enforcement_allowed(_S({}, None), TENANT, NOW, flag_enabled=True)
    assert seen and "source = 'nightly'" in seen[0] and "retention->>'updated_at'" in seen[0]


def test_report_storage_failures_are_recorded_on_the_log_row(monkeypatch):
    _stub_purge(monkeypatch)
    s = _Session({"reports_days": 60}, NOW - timedelta(days=8), old_reports=[(uuid.uuid4(), "reports/t/a.pdf")])

    def boom(bucket, path):
        raise RuntimeError("storage unreachable")

    monkeypatch.setattr("api.services.storage.object_size", boom)
    task.run_for_tenant(s, TENANT, NOW, flag_enabled=True)
    outcome = [d for d in s.deletes if d.startswith("UPDATE purge_log")]
    assert outcome, "the storage outcome must be written back onto the purge_log row"
    assert any("storage unreachable" in str(p.get("e", "")) for p in s.params if p)
    assert s.logs[-1]["src"] == "nightly"


def test_gate_reads_the_env_flag(monkeypatch):
    s = _Session({}, NOW - timedelta(days=30))
    monkeypatch.delenv("MERIDIAN_PURGE_ENABLED", raising=False)
    assert task.enforcement_allowed(s, TENANT, NOW) is False
    monkeypatch.setenv("MERIDIAN_PURGE_ENABLED", "true")
    assert task.enforcement_allowed(s, TENANT, NOW) is True
    monkeypatch.setenv("MERIDIAN_PURGE_ENABLED", "false")
    assert task.enforcement_allowed(s, TENANT, NOW) is False


def test_flag_on_but_young_dry_runs_writes_dry_run_rows_only(monkeypatch):
    calls = _stub_purge(monkeypatch)
    s = _Session({"versions_days": 30, "reports_days": 60, "audit_days": 90}, NOW - timedelta(days=1),
                 versions=[_version(1), _version(90)], old_reports=[(uuid.uuid4(), "reports/t/a.pdf")], old_audit=7)
    monkeypatch.setattr("api.services.storage.object_size", lambda b, p: 512)
    summary = task.run_for_tenant(s, TENANT, NOW, flag_enabled=True)
    assert summary["dry_run"] is True and summary["versions"] == 1
    assert calls == [{"version_id": str(s.versions[1][0]), "dry_run": True, "source": "nightly"}]
    assert summary["reports"] == 1 and summary["audit"] == 7
    assert s.deletes == []  # nothing deleted
    assert [(l["k"], l["d"], l["src"]) for l in s.logs] == [("reports", True, "nightly"), ("audit", True, "nightly")]
    assert s.logs[0]["b"] == 512


def test_after_the_window_with_the_flag_the_task_deletes(monkeypatch):
    calls = _stub_purge(monkeypatch)
    s = _Session({"versions_days": 30, "reports_days": 60, "audit_days": 90}, NOW - timedelta(days=8),
                 versions=[_version(1), _version(90)], old_reports=[(uuid.uuid4(), "reports/t/a.pdf")], old_audit=7)
    removed = []
    monkeypatch.setattr("api.services.storage.object_size", lambda b, p: 512)
    monkeypatch.setattr("api.services.storage.delete_file", lambda b, p: removed.append(p))
    summary = task.run_for_tenant(s, TENANT, NOW, flag_enabled=True)
    assert summary["dry_run"] is False
    assert calls == [{"version_id": str(s.versions[1][0]), "dry_run": False, "source": "nightly"}]
    assert any(d.startswith("DELETE FROM reports") for d in s.deletes)
    assert any(d.startswith("DELETE FROM audit_log") for d in s.deletes)
    assert removed == ["reports/t/a.pdf"]
    assert [(l["k"], l["d"], l["src"]) for l in s.logs] == [("reports", False, "nightly"), ("audit", False, "nightly")]


def test_flag_off_after_the_window_still_dry_runs(monkeypatch):
    calls = _stub_purge(monkeypatch)
    s = _Session({"versions_days": 30}, NOW - timedelta(days=30), versions=[_version(1), _version(90)])
    summary = task.run_for_tenant(s, TENANT, NOW, flag_enabled=False)
    assert summary["dry_run"] is True and calls[0]["dry_run"] is True


def test_empty_policy_touches_nothing(monkeypatch):
    calls = _stub_purge(monkeypatch)
    s = _Session({}, NOW - timedelta(days=30), versions=[_version(400)], old_reports=[(uuid.uuid4(), None)], old_audit=5)
    summary = task.run_for_tenant(s, TENANT, NOW, flag_enabled=True)
    assert calls == [] and summary == {"tenant_id": TENANT, "dry_run": False, "versions": 0, "blocked": 0,
                                       "reports": 0, "audit": 0}
    assert s.logs == [] and s.deletes == []


def test_blocked_versions_are_counted_not_raised(monkeypatch):
    def fake(session, tenant_id, version_id, *, dry_run, actor=None, force=False, source="manual"):
        return {"rows_by_table": {}, "bytes_freed": 0, "blocked_reason": "open work", "storage_errors": [],
                "purge_log_id": "x"}

    monkeypatch.setattr("api.services.purge.purge_version", fake)
    s = _Session({"versions_days": 30}, None, versions=[_version(1), _version(90)])
    summary = task.run_for_tenant(s, TENANT, NOW, flag_enabled=True)
    assert summary["blocked"] == 1 and summary["versions"] == 0


def test_beat_entry_and_registration():
    from workers.celery_app import celery_app

    entry = celery_app.conf.beat_schedule["purge-expired-0230"]
    assert entry["task"] == "workers.tasks.purge_expired.purge_expired"
    assert entry["task"] in celery_app.tasks
    assert str(entry["schedule"]).startswith("<crontab: 30 2")
