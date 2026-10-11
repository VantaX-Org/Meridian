"""Process discovery job (spec §8): memory guard, lock, wait-for-extraction, the discover passes and pruning.

The Postgres tests run with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from urllib.parse import urlparse

import pytest
from celery.exceptions import Retry

from api.services.process_discovery import reason
from tests.test_process_designer_api import app_engine  # noqa: F401 — fixture
from workers.tasks import run_process_discovery as rpd

# Every Postgres test builds on app_engine, which runs migrations and DROP/CREATE ROLE: never against port 5432.
_shared_db = (urlparse(os.environ.get("MERIDIAN_TEST_DB_URL", "")).port or 5432) == 5432
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL") or _shared_db,
                        reason="MERIDIAN_TEST_DB_URL not set, or it points at the shared port 5432")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GiB = 1024 ** 3


def test_memory_guard_halves_then_fails() -> None:
    used = iter([GiB, int(1.6 * GiB), int(1.6 * GiB), int(2.1 * GiB)])
    g = rpd.MemoryGuard(batch=4000, rss=lambda: next(used))
    assert g.check() == 4000
    assert g.check() == 2000
    assert g.check() == 1000
    with pytest.raises(rpd.MemoryBudgetExceeded, match="narrow the period"):
        g.check()


def test_memory_guard_never_goes_below_min_batch() -> None:
    g = rpd.MemoryGuard(batch=1500, rss=lambda: int(1.6 * GiB))
    assert g.check() == rpd.MIN_BATCH
    assert g.check() == rpd.MIN_BATCH


def test_lock_and_job_ids() -> None:
    assert rpd.lock_key("t1", "s1") == "pd:lock:t1:s1"
    assert rpd.job_id_of(["r1", "r2"]) == "pd-r1"


def test_reason_per_system_type() -> None:
    assert reason("PTP", "ecc") is None
    assert reason("SFX", "ecc") == "Connect the SuccessFactors / Ariba / Concur system to discover this process."
    assert reason("PTP", "ariba") == "Discovered from an ABAP system."
    assert reason("PTP", "s4hana_cloud").startswith("Event tables are not exposed")


def test_other_extraction_ignores_own_chain_and_other_systems(monkeypatch) -> None:
    running = [{"kind": "extraction", "system_id": "s1", "version_id": "own"},
               {"kind": "extraction", "system_id": "s2", "version_id": "x"},
               {"kind": "analysis", "system_id": "s1", "version_id": "y"}]
    monkeypatch.setattr(rpd.jobs, "list_jobs", lambda tenant, active_only=False: running)
    assert not rpd.other_extraction_active("t", "s1", "own")
    running.append({"kind": "config_sync", "system_id": "s1", "version_id": None})
    assert rpd.other_extraction_active("t", "s1", "own")


class _FakeSession:
    def __init__(self) -> None:
        self.sql: list[tuple[str, dict]] = []

    def execute(self, stmt, params=None):
        self.sql.append((str(stmt), params or {}))
        return SimpleNamespace(rowcount=1)

    def commit(self) -> None: ...
    def rollback(self) -> None: ...
    def close(self) -> None: ...


def test_waits_for_running_extraction_and_keeps_the_lock(monkeypatch) -> None:
    session, released, updates = _FakeSession(), [], []
    monkeypatch.setattr(rpd, "tenant_session", lambda eng, t: session)
    monkeypatch.setattr(rpd, "get_sync_engine", lambda: None)
    monkeypatch.setattr(rpd, "other_extraction_active", lambda *a: True)
    monkeypatch.setattr(rpd, "release_lock", lambda t, s: released.append(s))
    monkeypatch.setattr(rpd.jobs, "update_job", lambda *a, **k: updates.append(k))
    with pytest.raises(Retry):
        rpd.discover_process.run("t", "s1", ["r1"], "v1")
    assert released == []
    assert any("status = :status" in q and p["status"] == "waiting" for q, p in session.sql)
    assert updates[0]["message"].startswith("Waiting for another extraction")


def test_gives_up_after_two_hours(monkeypatch) -> None:
    session, released, finished = _FakeSession(), [], []
    monkeypatch.setattr(rpd, "tenant_session", lambda eng, t: session)
    monkeypatch.setattr(rpd, "get_sync_engine", lambda: None)
    monkeypatch.setattr(rpd, "other_extraction_active", lambda *a: True)
    monkeypatch.setattr(rpd, "release_lock", lambda t, s: released.append(s))
    monkeypatch.setattr(rpd.jobs, "finish_job", lambda t, j, status="completed", **k: finished.append((status, k)))
    rpd.discover_process.push_request(retries=rpd.WAIT_RETRIES)
    try:
        assert rpd.discover_process.run("t", "s1", ["r1"], "v1") == {"r1": "failed"}
    finally:
        rpd.discover_process.pop_request()
    assert released == ["s1"]
    assert finished == [("failed", {"error": rpd.WAIT_ERROR})]
    assert any(p.get("e") == rpd.WAIT_ERROR for _, p in session.sql)


# --- Postgres ---------------------------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def engine(app_engine):  # noqa: F811
    """The owner engine, for seeding and assertions."""
    return app_engine[0]


@pytest.fixture(scope="module")
def app(app_engine):  # noqa: F811
    """The NOBYPASSRLS application role: the job's tenant sessions run as this, so RLS is really enforced."""
    from sqlalchemy import text

    with app_engine[0].begin() as c:  # process_events has a bigserial id; the shared fixture grants tables only
        c.execute(text(f"GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {app_engine[1].url.username}"))
    with app_engine[1].connect() as c:
        assert c.execute(text("SELECT NOT (rolbypassrls OR rolsuper) FROM pg_roles "
                              "WHERE rolname = current_user")).scalar() is True
    return app_engine[1]


COVERAGE = [{"table": t, "rows": 1, "status": "live"} for t in
            ("EKKO", "EKPO", "EBAN", "CDHDR", "CDPOS", "EKBE", "RBKP", "BKPF", "BSAK", "USR02")]


def _seed(eng, runs: list[tuple[str, str, date | None]], dataset: bool = True) -> tuple[str, str, str | None, list]:
    """Tenant, ECC system, extraction version and queued runs ``(l1, mode, window_from)``."""
    from sqlalchemy import text

    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    vid = str(uuid.uuid4()) if dataset else None
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDJ-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'S', 'ecc')"),
                  {"s": sid, "t": tid})
        if vid:
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                           "VALUES (:v, :t, 'completed', CAST(:m AS jsonb))"),
                      {"v": vid, "t": tid, "m": json.dumps({"dataset_path": "mem", "coverage": COVERAGE})})
        ids = [str(c.execute(text(
            "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status, window_from) "
            "VALUES (:t, :s, :l1, :m, 'queued', :wf) RETURNING id"),
            {"t": tid, "s": sid, "l1": l1, "m": mode, "wf": wf}).scalar()) for l1, mode, wf in runs]
    return tid, sid, vid, ids


def _frames(_path: str):
    from api.services.process_discovery.events import MemoryFrames
    from tests.process_discovery.test_builders_core import ptp_tables

    return MemoryFrames(ptp_tables())


def _run(eng, rid: str):
    from sqlalchemy import text

    with eng.connect() as c:
        return c.execute(text("SELECT status, coverage, error, model IS NOT NULL AS has_model, watermark, stats "
                              "FROM process_discovery_runs WHERE id = :r"), {"r": rid}).one()


@pg
def test_discover_builds_mines_and_stores_the_model(engine, app) -> None:
    from sqlalchemy import text

    from workers.db import tenant_session

    tid, sid, vid, (rid,) = _seed(engine, [("PTP", "full", None)])
    stages = []
    s = tenant_session(app, tid)
    out = rpd.discover(s, tid, sid, [rid], vid, frames_for=_frames, today=date(2026, 10, 11),
                       progress=lambda stage, pct, msg: stages.append((stage, pct)))
    s.close()
    assert out == {rid: "completed"}
    assert [x[0] for x in stages] == ["building", "mining", "generating"]
    assert [x[1] for x in stages] == [50, 80, 95]
    run = _run(engine, rid)
    assert run.status == "completed" and run.has_model and run.error is None
    assert run.coverage == "partial"  # 2 PO items, below the 50-case floor
    assert run.stats["tables"]["EKKO"] == {"rows": 1, "partial": False}
    with engine.connect() as c:
        events = c.execute(text("SELECT count(*), max(ts) FROM process_events WHERE run_id = :r"), {"r": rid}).one()
        variants = c.execute(text("SELECT count(*) FROM process_discovery_variants WHERE run_id = :r"),
                             {"r": rid}).scalar()
    assert events[0] > 0 and run.watermark == events[1]
    assert variants > 0


@pg
def test_incremental_keeps_history_before_the_window(engine, app) -> None:
    from sqlalchemy import text

    from workers.db import tenant_session

    tid, sid, vid, (full,) = _seed(engine, [("PTP", "full", None)])
    s = tenant_session(app, tid)
    rpd.discover(s, tid, sid, [full], vid, frames_for=_frames, today=date(2026, 10, 11))
    with engine.begin() as c:
        inc = str(c.execute(text(
            "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status, window_from) "
            "VALUES (:t, :s, 'PTP', 'incremental', 'queued', '2026-01-11') RETURNING id"),
            {"t": tid, "s": sid}).scalar())
    assert rpd.discover(s, tid, sid, [inc], vid, frames_for=_frames, today=date(2026, 10, 11)) == {inc: "completed"}
    s.close()
    since = rpd.window_start(date(2026, 1, 11), "Africa/Johannesburg")
    with engine.connect() as c:
        rows = c.execute(text("SELECT run_id, ts >= :since AS recent, count(*) FROM process_events "
                              "WHERE system_id = :s GROUP BY 1, 2"), {"s": sid, "since": since}).all()
    by = {(str(r[0]), r[1]): r[2] for r in rows}
    assert by.get((full, False), 0) > 0      # history before the window is kept from the full run
    assert by.get((full, True), 0) == 0      # the window was rebuilt by the incremental run
    assert by.get((inc, True), 0) > 0
    assert (inc, False) not in by


@pg
def test_memory_failure_fails_only_that_l1(engine, app) -> None:
    from workers.db import tenant_session

    tid, sid, vid, (otc, ptp) = _seed(engine, [("OTC", "full", None), ("PTP", "full", None)])
    s = tenant_session(app, tid)
    guard = rpd.MemoryGuard(rss=lambda: 3 * GiB)  # checked only after an insert batch; OTC has no rows
    out = rpd.discover(s, tid, sid, [otc, ptp], vid, frames_for=_frames, guard=guard, today=date(2026, 10, 11))
    s.close()
    assert out == {otc: "completed", ptp: "failed"}
    assert _run(engine, ptp).error == rpd.MEMORY_ERROR
    assert _run(engine, otc).coverage == "reference"


@pg
def test_no_dataset_fails_every_run(engine, app) -> None:
    from workers.db import tenant_session

    tid, sid, _, ids = _seed(engine, [("PTP", "full", None), ("R2R", "full", None)], dataset=False)
    s = tenant_session(app, tid)
    assert rpd.discover(s, tid, sid, ids, None, frames_for=_frames) == {i: "failed" for i in ids}
    s.close()
    assert {_run(engine, i).error for i in ids} == {rpd.NO_DATA_ERROR}


def _seed_prune(owner, tid: str, sid: str) -> list[str]:
    """Four completed PTP runs, an old and a new event on the first two."""
    from sqlalchemy import text

    with owner.begin() as c:
        ids = [str(c.execute(text(
            "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status, started_at) "
            "VALUES (:t, :s, 'PTP', 'full', 'completed', :at) RETURNING id"),
            {"t": tid, "s": sid, "at": datetime(2026, 1, 1 + i, tzinfo=timezone.utc)}).scalar()) for i in range(4)]
        c.execute(text(
            "INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, ts, ts_precision, "
            "source_table, run_id) VALUES (:t, :s, 'PTP', 'po_item', :c, 'CREATE_PO', :ts, 'day', 'EKKO', :r)"),
            [{"t": tid, "s": sid, "c": "old", "ts": datetime(2020, 1, 1, tzinfo=timezone.utc), "r": ids[0]},
             {"t": tid, "s": sid, "c": "new", "ts": datetime(2026, 1, 1, tzinfo=timezone.utc), "r": ids[1]}])
    return ids


@pg
def test_prune_keeps_recent_runs_and_runs_with_events(app_engine, monkeypatch) -> None:  # noqa: F811
    """Runs as the NOBYPASSRLS app role, one tenant session per tenant, as the nightly task does."""
    from sqlalchemy import text

    from workers.db import tenant_session

    owner, app = app_engine
    tid, sid, _, _ = _seed(owner, [], dataset=False)
    other, other_sid, _, _ = _seed(owner, [], dataset=False)
    ids, other_ids = _seed_prune(owner, tid, sid), _seed_prune(owner, other, other_sid)
    s = tenant_session(app, tid)
    try:
        events, runs = rpd.prune(s, tid, days=730, keep=2)
    finally:
        s.close()
    assert (events, runs) == (1, 1)
    with owner.connect() as c:
        left = {str(r[0]) for r in c.execute(text("SELECT id FROM process_discovery_runs WHERE system_id = :s"),
                                             {"s": sid})}
        cases = [r[0] for r in c.execute(text("SELECT case_id FROM process_events WHERE system_id = :s"),
                                         {"s": sid})]
        untouched = c.execute(text("SELECT (SELECT count(*) FROM process_discovery_runs WHERE system_id = :s), "
                                   "(SELECT count(*) FROM process_events WHERE system_id = :s)"),
                              {"s": other_sid}).one()
    assert left == {ids[1], ids[2], ids[3]}  # ids[0] pruned once its old event went; ids[1] still has events
    assert cases == ["new"]
    assert tuple(untouched) == (4, 2)         # the other tenant is not pruned by this tenant's session
    monkeypatch.setattr(rpd, "get_sync_engine", lambda: app)
    assert rpd.prune_events.run()["events"] >= 1  # the nightly task visits every tenant
    with owner.connect() as c:
        assert c.execute(text("SELECT count(*) FROM process_events WHERE system_id = :s"),
                         {"s": other_sid}).scalar() == 1
    assert other_ids


def _status(eng, rid: str) -> tuple[str, str | None]:
    r = _run(eng, rid)
    return r.status, r.error


@pg
def test_abort_runs_fails_only_pending_runs_and_keeps_a_real_failure(engine, app, monkeypatch) -> None:
    from sqlalchemy import text

    tid, sid, _, (real, pending) = _seed(engine, [("PTP", "full", None), ("R2R", "full", None)])
    with engine.begin() as c:  # the stage that raised has already recorded its own failure
        c.execute(text("UPDATE process_discovery_runs SET status = 'failed', error = :e WHERE id = :r"),
                  {"e": rpd.MEMORY_ERROR, "r": real})
    released, finished = [], []
    monkeypatch.setattr(rpd, "get_sync_engine", lambda: app)
    monkeypatch.setattr(rpd, "release_lock", lambda t, s: released.append(s))
    monkeypatch.setattr(rpd.jobs, "finish_job", lambda t, j, status="completed", **k: finished.append((status, k)))
    rpd.abort_runs.run(tid, sid, [real, pending])
    assert _status(engine, real) == ("failed", rpd.MEMORY_ERROR)
    assert _status(engine, pending) == ("failed", rpd.EXTRACTION_ERROR)
    assert finished == [("failed", {"error": rpd.EXTRACTION_ERROR})] and released == [sid]
    finished.clear()
    rpd.abort_runs.run(tid, sid, [real, pending])  # nothing pending: the recorded failures and the job stay
    assert _status(engine, real) == ("failed", rpd.MEMORY_ERROR)
    assert _status(engine, pending) == ("failed", rpd.EXTRACTION_ERROR)
    assert finished == [] and released == [sid, sid]


@pg
def test_abort_runs_closes_a_run_killed_while_mining(engine, app, monkeypatch) -> None:
    from sqlalchemy import text

    tid, sid, _, (mining, done) = _seed(engine, [("PTP", "full", None), ("R2R", "full", None)])
    with engine.begin() as c:  # the worker was killed mid-stage: the run never left "mining"
        c.execute(text("UPDATE process_discovery_runs SET status = 'mining' WHERE id = :r"), {"r": mining})
        c.execute(text("UPDATE process_discovery_runs SET status = 'completed' WHERE id = :r"), {"r": done})
    released, finished = [], []
    monkeypatch.setattr(rpd, "get_sync_engine", lambda: app)
    monkeypatch.setattr(rpd, "release_lock", lambda t, s: released.append(s))
    monkeypatch.setattr(rpd.jobs, "finish_job", lambda t, j, status="completed", **k: finished.append((status, k)))
    rpd.abort_runs.run(tid, sid, [mining, done])
    assert _status(engine, mining) == ("failed", rpd.ABORT_ERROR)  # not the extraction message: it had finished
    assert _status(engine, done)[0] == "completed"
    assert finished == [("failed", {"error": rpd.ABORT_ERROR})] and released == [sid]


@pg
def test_stage_failure_stores_a_fixed_message_not_the_exception(engine, app, caplog, monkeypatch) -> None:
    from workers.db import tenant_session

    leak = 'relation "process_events" does not exist; SELECT secret FROM pg_shadow'

    def boom(*_a):
        raise RuntimeError(leak)

    monkeypatch.setattr(rpd, "collect", boom)
    tid, sid, vid, (rid,) = _seed(engine, [("PTP", "full", None)])
    s = tenant_session(app, tid)
    assert rpd.discover(s, tid, sid, [rid], vid, frames_for=_frames, today=date(2026, 10, 11)) == {rid: "failed"}
    s.close()
    assert _status(engine, rid) == ("failed", rpd.BUILD_ERROR)
    assert leak in caplog.text  # the detail is logged, not stored
