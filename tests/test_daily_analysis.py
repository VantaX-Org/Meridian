"""daily_analysis must not re-score old data: fresh runs come from sync_profiles
(sync_profile_scheduler -> run_sync -> run_checks), which also write dqs_history."""

from datetime import datetime, timezone

from workers import scheduler
from workers.tasks import run_checks as rc


class _Row:
    _mapping = {"id": "v1", "run_at": datetime(2020, 1, 1, tzinfo=timezone.utc),
                "dqs_summary": {"fi_gl": {"composite_score": 90.0}}, "parquet_path": "/data/v1.parquet"}


class _Result:
    def fetchone(self):
        return _Row()

    def fetchall(self):
        return []


class _Session:
    sql: list[str] = []

    def __init__(self, *_a, **_k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def execute(self, stmt, params=None):
        _Session.sql.append(str(stmt))
        return _Result()

    def commit(self):
        pass

    def rollback(self):
        pass


def test_daily_analysis_neither_reruns_checks_nor_writes_history(monkeypatch):
    queued = []
    _Session.sql.clear()
    monkeypatch.setattr(scheduler, "Session", _Session)
    monkeypatch.setattr(scheduler, "get_sync_engine", lambda: None)
    monkeypatch.setattr(scheduler, "_get_tenants", lambda _s: [{"id": "t1"}])
    monkeypatch.setattr(scheduler, "_set_rls", lambda _s, _t: None)
    monkeypatch.setattr(scheduler, "_get_redis", lambda: None)  # cache failure is logged, not raised
    monkeypatch.setattr(rc.run_checks, "delay", lambda *a: queued.append(a))
    scheduler.daily_analysis()
    assert queued == []
    assert not any("dqs_history" in s for s in _Session.sql)
    assert any("FROM analysis_versions" in s for s in _Session.sql)
