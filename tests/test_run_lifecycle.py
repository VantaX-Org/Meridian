"""Run lifecycle: extraction locks, the busy pre-check, cancel cleanup, the orphan reaper, the scheduler's
commit-before-dispatch and the migration claim. Synthetic data, no Postgres, no broker."""

from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.services import jobs
from tests.test_jobs import redis  # noqa: F401  (fixture)
from workers import scheduler
from workers.celery_app import celery_app
from workers.tasks import run_extraction as rx


class LockRedis:
    """The lock subset of redis: set with nx, get, delete of many keys."""

    def __init__(self):
        self.kv: dict[str, bytes] = {}

    def set(self, k, v, nx=False, ex=None):
        if nx and k in self.kv:
            return False
        self.kv[k] = str(v).encode()
        return True

    def get(self, k):
        return self.kv.get(k)

    def delete(self, *keys):
        for k in keys:
            self.kv.pop(k, None)

    def expire(self, k, ttl):
        return k in self.kv


@pytest.fixture
def locks(monkeypatch):
    fake = LockRedis()
    monkeypatch.setattr("redis.from_url", lambda url: fake, raising=False)
    monkeypatch.setattr(celery_app.conf, "broker_url", "redis://fake/0")
    return fake


# ── locks ────────────────────────────────────────────────────────────────────

def test_release_frees_both_locks_when_the_version_owns_the_system(locks):
    assert rx._acquire_version_lock("v1") and rx._acquire_system_lock("s1", "v1")
    rx._release_system_lock("s1", "v1")
    assert locks.kv == {}


def test_release_keeps_a_system_lock_another_version_holds(locks):
    rx._acquire_system_lock("s1", "v-other")
    rx._acquire_version_lock("v1")
    rx._release_system_lock("s1", "v1")
    assert locks.kv == {"extract-lock:system:s1": b"v-other"}


def test_a_finished_or_cancelled_job_makes_a_redelivery_exit(locks, redis, monkeypatch):  # noqa: F811
    jobs.start_job("t1", "dl-v1", "extraction", "Download", system_id="s1", version_id="v1")
    jobs.finish_job("t1", "dl-v1", "completed")
    monkeypatch.setattr(rx, "_extract", lambda *a, **k: pytest.fail("a finished run must not extract again"))
    assert rx.run_extraction.run("t1", "s1", ["MM"], version_id="v1")["status"] == "completed"
    assert locks.kv == {}, "no lock is taken by a run that exits early"


def test_system_busy_fails_the_job_and_frees_only_the_version_lock(locks, redis):  # noqa: F811
    rx._acquire_system_lock("s1", "v-other")
    jobs.start_job("t1", "dl-v1", "extraction", "Download", status="queued", system_id="s1", version_id="v1")
    out = rx.run_extraction.run("t1", "s1", ["MM"], version_id="v1")
    assert out["status"] == "system_busy"
    assert jobs.get_job("t1", "dl-v1")["status"] == "failed"
    assert locks.kv == {"extract-lock:system:s1": b"v-other"}


def test_a_config_retry_leaves_no_version_lock_behind(locks, redis, monkeypatch):  # noqa: F811
    """A Retry raised from the config wait used to keep the version lock, so the retried copy exited duplicate."""
    jobs.start_job("t1", "dl-v1", "extraction", "Download", system_id="s1", version_id="v1")

    def retry(*a, **k):
        raise RuntimeError("Retry in 60s")

    monkeypatch.setattr(rx, "_extract", retry)
    with pytest.raises(RuntimeError):
        rx.run_extraction.run("t1", "s1", ["MM"], version_id="v1")
    assert locks.kv == {}
    assert rx._acquire_version_lock("v1"), "the retried copy can take the version again"


def test_discard_deletes_the_staged_files(locks, monkeypatch):
    deleted = []
    monkeypatch.setattr("api.services.storage.delete_prefix", lambda bucket, prefix: deleted.append(prefix))
    rx._acquire_system_lock("s1", "v1")
    rx.discard_extraction("t1", "s1", "v1")
    assert deleted == ["staging/t1/v1/"] and locks.kv == {}


# ── busy pre-check ───────────────────────────────────────────────────────────

def test_busy_check_returns_409_for_a_download_on_the_same_system(redis):  # noqa: F811
    jobs.start_job("t1", "dl-v1", "extraction", "Download", status="queued", system_id="s1")
    jobs.ensure_no_extraction("t1", "s2")
    with pytest.raises(HTTPException) as e:
        jobs.ensure_no_extraction("t1", "s1")
    assert e.value.status_code == 409


def test_busy_check_lets_the_request_through_when_the_registry_is_unreadable(monkeypatch):
    monkeypatch.setattr(jobs, "_redis_client", lambda: None)
    jobs.ensure_no_extraction("t1", "s1")  # the worker's system lock still refuses a second read


# ── cancel ───────────────────────────────────────────────────────────────────

class _Db:
    def __init__(self):
        self.sql: list[str] = []

    async def execute(self, stmt, params=None):
        self.sql.append(str(stmt))
        return SimpleNamespace(first=lambda: None)

    async def commit(self):
        pass


def _cancel(monkeypatch, uid, granted):
    from api.routes import jobs as route

    async def scope(request, db, tenant, permission, sc):
        if permission not in granted:
            raise HTTPException(403, "no")

    discarded = []
    monkeypatch.setattr(route, "require_scope", scope)
    monkeypatch.setattr(route, "current_user_id", lambda request: uid)
    monkeypatch.setattr(route, "current_user_label", lambda: "Tester")
    monkeypatch.setattr(route, "_revoke", lambda ids: True)

    async def audit(*a, **k):
        pass

    monkeypatch.setattr(route, "write_audit", audit)
    monkeypatch.setattr("workers.tasks.run_extraction.discard_extraction", lambda *a: discarded.append(a))
    vid = "11111111-1111-1111-1111-111111111111"
    jobs.start_job("t1", f"dl-{vid}", "extraction", "Download", system_id="22222222-2222-2222-2222-222222222222",
                   version_id=vid, started_by="u1", task_ids=["task-1"])
    run = route.cancel_job(f"dl-{vid}", SimpleNamespace(), SimpleNamespace(id="t1"), _Db())
    return asyncio.run(run), discarded


def test_the_owner_cancels_their_download_without_manage_settings(redis, monkeypatch):  # noqa: F811
    out, discarded = _cancel(monkeypatch, "u1", {"trigger_sync"})
    assert out["status"] == "cancelled"
    assert discarded and discarded[0][0] == "t1", "an unregistered download's locks and staged files go"


def test_another_user_without_manage_settings_cannot_cancel(redis, monkeypatch):  # noqa: F811
    with pytest.raises(HTTPException) as e:
        _cancel(monkeypatch, "u2", {"trigger_sync"})
    assert e.value.status_code == 403


def test_an_admin_cancels_any_download(redis, monkeypatch):  # noqa: F811
    out, _ = _cancel(monkeypatch, "admin", {"manage_settings"})
    assert out["status"] == "cancelled"


# ── reaper ───────────────────────────────────────────────────────────────────

class _Session:
    """Records statements; returns a version row only for ids in ``registered``."""

    def __init__(self, registered=()):
        self.registered, self.sql, self.events = set(registered), [], []

    def execute(self, stmt, params=None):
        s = str(stmt)
        self.sql.append(s)
        self.events.append("execute")
        params = params or {}
        if s.startswith("SELECT 1 FROM analysis_versions"):
            return SimpleNamespace(first=lambda: (1,) if params.get("v") in self.registered else None)
        return SimpleNamespace(fetchall=lambda: [], first=lambda: None)

    def commit(self):
        self.events.append("commit")


def test_reaper_skips_when_no_worker_replies(monkeypatch):
    insp = SimpleNamespace(active=lambda: None, reserved=lambda: None, scheduled=lambda: None)
    monkeypatch.setattr(celery_app.control, "inspect", lambda timeout=5: insp)
    assert scheduler._live_task_ids() is None


def test_live_ids_include_retries_waiting_in_scheduled(monkeypatch):
    insp = SimpleNamespace(active=lambda: {"w": [{"id": "a"}]}, reserved=lambda: {"w": [{"id": "b"}]},
                           scheduled=lambda: {"w": [{"request": {"id": "c"}}]})
    monkeypatch.setattr(celery_app.control, "inspect", lambda timeout=5: insp)
    assert scheduler._live_task_ids() == {"a", "b", "c"}


def _aged(monkeypatch, seconds):
    """Register jobs as if their last heartbeat was ``seconds`` ago."""
    monkeypatch.setattr(jobs, "_now", lambda: time.time() - seconds)


def test_reaper_fails_a_stale_orphan_and_discards_its_download(redis, monkeypatch):  # noqa: F811
    discarded = []
    monkeypatch.setattr(rx, "discard_extraction", lambda *a: discarded.append(a))
    with monkeypatch.context() as m:
        _aged(m, scheduler.REAP_STALE_SECONDS + 60)
        jobs.start_job("t1", "dl-v1", "extraction", "Download", system_id="s1", version_id="v1", task_ids=["dead"])
        jobs.start_job("t1", "dl-v2", "extraction", "Download", system_id="s2", version_id="v2", task_ids=["live"])
    jobs.start_job("t1", "dl-v3", "extraction", "Download", system_id="s3", version_id="v3", task_ids=["gone"])

    session = _Session()
    assert scheduler._reap_tenant(session, "t1", {"live"}) == 1
    assert jobs.get_job("t1", "dl-v1")["status"] == "failed"
    assert jobs.get_job("t1", "dl-v1")["error"] == scheduler.REAP_REASON
    assert jobs.get_job("t1", "dl-v2")["status"] == "running", "a job whose task is live is never touched"
    assert jobs.get_job("t1", "dl-v3")["status"] == "running", "a fresh job is never touched"
    assert discarded == [("t1", "s1", "v1")]
    assert sum("UPDATE migration_runs" in s or "UPDATE system_comparisons" in s
               or "UPDATE migration_reconciliations" in s for s in session.sql) == 3


def test_reaper_fails_the_version_of_a_stale_analysis(redis, monkeypatch):  # noqa: F811
    with monkeypatch.context() as m:
        _aged(m, scheduler.REAP_STALE_SECONDS + 60)
        jobs.start_job("t1", "v9", "analysis", "Analysis")
    session = _Session(registered={"v9"})
    scheduler._reap_tenant(session, "t1", set())
    assert any(s.startswith("UPDATE analysis_versions SET status = 'failed'") for s in session.sql)


# ── scheduler ────────────────────────────────────────────────────────────────

def test_scheduler_commits_before_dispatch_and_runs_one_profile_per_system(monkeypatch):
    session = _Session()
    rows = [("p1", "0 2 * * *", "s1"), ("p2", "0 2 * * *", "s1"), ("p3", "0 2 * * *", "s2")]
    orig = session.execute

    def execute(stmt, params=None):
        out = orig(stmt, params)
        return SimpleNamespace(fetchall=lambda: rows) if "FROM sync_profiles p" in str(stmt) else out

    session.execute = execute

    class _Ctx:
        def __init__(self, engine):
            pass

        def __enter__(self):
            return session

        def __exit__(self, *a):
            return False

    sent = []
    monkeypatch.setattr(scheduler, "get_sync_engine", lambda: None)
    monkeypatch.setattr(scheduler, "Session", _Ctx)
    monkeypatch.setattr(scheduler, "_get_tenants", lambda s: [{"id": "t1"}])
    monkeypatch.setattr("workers.tasks.run_sync.run_sync.delay",
                        lambda pid, tid, trigger: (sent.append(pid), session.events.append("dispatch")))
    scheduler.sync_profile_scheduler.run()
    assert sent == ["p1", "p3"]
    assert session.events.index("commit") < session.events.index("dispatch")


# ── migration claim ──────────────────────────────────────────────────────────

def test_a_redelivered_migration_of_a_failed_run_is_skipped(monkeypatch):
    from workers.tasks import run_migration as rm

    session = _Session()

    class _Ctx:
        def __init__(self, engine):
            pass

        def __enter__(self):
            return session

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(rm, "get_sync_engine", lambda: None)
    monkeypatch.setattr(rm, "Session", _Ctx)
    out = rm.run_migration.run("t1", "r1", "source_to_source", "s1", None, ["MM"])
    assert out == {"run_id": "r1", "status": "skipped"}
    assert any("status NOT IN ('failed', 'exported')" in s for s in session.sql)
