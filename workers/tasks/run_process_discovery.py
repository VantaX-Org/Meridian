"""Celery tasks: process discovery (spec §8).

``discover_process`` runs after the chain's own extraction. It builds the event log of each requested L1 from the
extraction bundle, mines it in Postgres and stores the generated as-is model on the run. ``abort_runs`` is the
chain's error callback. ``prune_events`` is the nightly retention job.
"""

from __future__ import annotations

import json
import logging
import os
import resource
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Callable, Iterable, Mapping, Optional, Sequence
from zoneinfo import ZoneInfo

import pandas as pd
from celery import Task
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session
from sqlalchemy.types import Text

from api.models.process_model import ProcessModelDocument
from api.services import jobs
from api.services.process_discovery import primary_case_type
from api.services.process_discovery.builders import builder
from api.services.process_discovery.events import DEFAULT_TZ, BundleFrames, EventRow, Frames, collect, make_context
from api.services.process_discovery.generate import generate, reference_model, write_back
from api.services.process_discovery.mining import MiningResult, Scope, mine, store_variants
from api.services.task_progress import _redis_client
from sap.process_definitions import reference_document
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.workers.process_discovery")

LOCK_TTL = 21600            # spec §8.1: SET NX EX 21600
BATCH = 50_000              # spec §2.1: delete-and-insert batches
MIN_BATCH = 1_000
SOFT_BYTES = 1536 * 1024 * 1024
HARD_BYTES = 2048 * 1024 * 1024
WAIT_RETRIES = 24           # 24 x 300 s = 2 hours (spec §8.2 step 1)
WAIT_COUNTDOWN = 300
MIN_CASES = 50              # spec §10: below this the DFG is anecdotes, not a process
EVENT_DAYS = 730            # retention: 24 months of events
KEEP_RUNS = 20              # retention: runs kept per (system, l1)
EXCLUSIVE_KINDS = ("extraction", "config_sync")
LIVE = frozenset({"live", "delta", "delta_fallback"})

WAIT_ERROR = "Extraction on this system still running after 2 hours."
NO_DATA_ERROR = "Extraction produced no data"
MEMORY_ERROR = "Memory budget exceeded; narrow the period."
# Fixed per-stage messages: exception text can carry SQL and bound parameters, so it is logged, never stored.
BUILD_ERROR = "Event log build failed"
MINE_ERROR = "Discovery failed"
GENERATE_ERROR = "Generation failed"
EXTRACTION_ERROR = "Extraction failed"

INSERT_EVENT_SQL = text("""
INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, l5_id, ts, ts_precision, seq,
                            resource, automated, doc_type, org, object_refs, attributes, source_table, run_id)
VALUES (:t, :s, :l1, :case_type, :case_id, :activity, :l5_id, :ts, :ts_precision, :seq, :resource, :automated,
        :doc_type, CAST(:org AS jsonb), CAST(:object_refs AS jsonb), CAST(:attributes AS jsonb), :source_table,
        :run_id)""")

DELETE_SCOPE_SQL = text("DELETE FROM process_events WHERE tenant_id = :t AND system_id = :s AND l1 = :l1")

DELETE_TOUCHED_SQL = text("""
DELETE FROM process_events
WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 AND ts >= :since
  AND (case_type, case_id) IN (SELECT * FROM unnest(:cts, :cids))""").bindparams(
    bindparam("cts", type_=ARRAY(Text)), bindparam("cids", type_=ARRAY(Text)))

BASE_SQL = text("""
SELECT document FROM (SELECT document, created_at, id FROM process_derivations WHERE tenant_id = :t
                      UNION ALL SELECT derivation, created_at, id FROM config_loads WHERE tenant_id = :t
                      AND derivation IS NOT NULL) d ORDER BY created_at DESC, id DESC LIMIT 1""")


def lock_key(tenant_id: str, system_id: str) -> str:
    return f"pd:lock:{tenant_id}:{system_id}"


def release_lock(tenant_id: str, system_id: str) -> None:
    client = _redis_client()
    if client is not None:
        client.delete(lock_key(tenant_id, system_id))


def job_id_of(run_ids: Sequence[str]) -> str:
    return f"pd-{run_ids[0]}"


# --- memory budget (spec §8.3) ------------------------------------------------------------------------------


class MemoryBudgetExceeded(RuntimeError):
    pass


def current_rss() -> int:
    """Resident set size now, in bytes. ``ru_maxrss`` is the peak, which never falls again, so after one large
    L1 every later L1 would fail too; Linux reads the current value from /proc instead."""
    try:
        with open("/proc/self/statm") as f:
            return int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")
    except OSError:  # macOS dev machines: peak in bytes
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return peak if sys.platform == "darwin" else peak * 1024


@dataclass
class MemoryGuard:
    """Checked after every insert batch: above ``soft`` the batch halves, above ``hard`` the L1 fails."""
    batch: int = BATCH
    soft: int = SOFT_BYTES
    hard: int = HARD_BYTES
    rss: Callable[[], int] = field(default=current_rss)

    def check(self) -> int:
        used = self.rss()
        if used > self.hard:
            raise MemoryBudgetExceeded(MEMORY_ERROR)
        if used > self.soft:
            self.batch = max(MIN_BATCH, self.batch // 2)
        return self.batch


# --- event storage ------------------------------------------------------------------------------------------


def _row(scope: Scope, run_id: str, e: EventRow) -> dict[str, object]:
    r = e.as_row()
    for k in ("org", "object_refs", "attributes"):
        r[k] = json.dumps(r[k], sort_keys=True)
    return {**r, "t": scope.tenant_id, "s": scope.system_id, "l1": scope.l1, "run_id": run_id}


def window_start(window_from: date, tz: str) -> datetime:
    """Midnight SAP-local time of the first window day, as an instant."""
    return datetime.combine(window_from, time(), ZoneInfo(tz))


def store_events(session: Session, scope: Scope, run_id: str, events: Sequence[EventRow], mode: str,
                 window_from: Optional[date], guard: MemoryGuard) -> int:
    """Replace the scope's events with ``events`` (full), or rebuild only the window of the touched cases
    (incremental). Incremental keeps each touched case's events older than the window, so a case's history
    survives windowed extractions; events the builder dated before the window are dropped, because the stored
    copies of those are already there. Returns the rows inserted. The caller commits."""
    if mode == "incremental" and window_from is not None:
        since = window_start(window_from, scope.tz)
        events = [e for e in events if e.ts >= since]
        touched = sorted({(e.case_type, e.case_id) for e in events})
        if touched:
            session.execute(DELETE_TOUCHED_SQL, {"t": scope.tenant_id, "s": scope.system_id, "l1": scope.l1,
                                                 "since": since, "cts": [c[0] for c in touched],
                                                 "cids": [c[1] for c in touched]})
    else:
        session.execute(DELETE_SCOPE_SQL, {"t": scope.tenant_id, "s": scope.system_id, "l1": scope.l1})
    done = 0
    size = guard.batch
    while done < len(events):
        chunk = events[done:done + size]
        session.execute(INSERT_EVENT_SQL, [_row(scope, run_id, e) for e in chunk])
        done += len(chunk)
        size = guard.check()
    return done


# --- inputs -------------------------------------------------------------------------------------------------


class RecordingFrames:
    """Frames proxy that records which bundle tables a builder read (for ``stats.tables``)."""

    def __init__(self, inner: Frames) -> None:
        self.inner = inner
        self.read: set[str] = set()

    def has(self, table: str) -> bool:
        return self.inner.has(table)

    def get(self, table: str, cols: Sequence[str]) -> pd.DataFrame:
        self.read.add(table)
        return self.inner.get(table, cols)


def base_document(session: Session, tenant_id: str) -> ProcessModelDocument:
    """Sync twin of ``api/routes/process_designer._reference`` (latest derivation, else the template)."""
    row = session.execute(BASE_SQL, {"t": tenant_id}).fetchone()
    if row is None:
        return reference_document()
    from sap.spro_paths import enrich_evidence
    return ProcessModelDocument.model_validate(enrich_evidence(row[0], row[0].get("system_type", "")))


def source_tables(coverage: Iterable[Mapping[str, object]], read: Iterable[str]) -> dict[str, dict[str, object]]:
    """``{table: {rows, partial}}`` for the tables a builder read. A table is partial when it was not read live,
    or was read incompletely."""
    by_table = {c["table"]: c for c in coverage}
    out: dict[str, dict[str, object]] = {}
    for t in sorted(read):
        c = by_table.get(t)
        out[t] = {"rows": int(str(c.get("rows") or 0)) if c else 0,
                  "partial": c is None or c.get("status") not in LIVE or c.get("complete") is False}
    return out


def coverage_of(mining: MiningResult, tables: Mapping[str, Mapping[str, object]]) -> str:
    """Spec §10: discovered needs 50 primary cases and no partial table; partial has some cases."""
    if not any(r.cases for r in mining.by_type.values()):
        return "reference"
    primary = mining.by_type.get(mining.primary)
    if primary and primary.cases >= MIN_CASES and not any(t["partial"] for t in tables.values()):
        return "discovered"
    return "partial"


# --- the job ------------------------------------------------------------------------------------------------


@dataclass
class _Run:
    id: str
    l1: str
    mode: str
    window_from: Optional[date]
    failed: bool = False
    tables: dict[str, dict[str, object]] = field(default_factory=dict)
    mining: Optional[MiningResult] = None


def _set(session: Session, tenant_id: str, run_ids: Sequence[str], **cols: Optional[str]) -> None:
    """``cols`` are fixed column names written by this module, never request input."""
    sets = ", ".join(f"{k} = :{k}" for k in cols)
    session.execute(text(f"UPDATE process_discovery_runs SET {sets} "
                         "WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[]))"),
                    {"ids": list(run_ids), "t": tenant_id, **cols})


def _fail(session: Session, tenant_id: str, run_ids: Sequence[str], error: str, *, pending_only: bool = False) -> int:
    """Marks the runs failed and returns how many changed. ``pending_only`` leaves runs a stage already failed or
    advanced alone, so a late error callback cannot overwrite the real failure."""
    session.rollback()
    keep = "status IN ('queued', 'waiting', 'extracting')" if pending_only else "status <> 'completed'"
    n = session.execute(text("UPDATE process_discovery_runs SET status = 'failed', error = :e, finished_at = now() "
                             f"WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[])) AND {keep}"),
                        {"ids": list(run_ids), "e": error[:500], "t": tenant_id}).rowcount
    session.commit()
    return n


def _stage_error(e: Exception, fallback: str) -> str:
    """The memory budget message is ours and actionable; anything else is replaced by the stage's fixed message."""
    return str(e) if isinstance(e, MemoryBudgetExceeded) else fallback


def discover(session: Session, tenant_id: str, system_id: str, run_ids: Sequence[str], version_id: Optional[str],
             *, frames_for: Callable[[str], Frames] = BundleFrames, guard: Optional[MemoryGuard] = None,
             progress: Callable[[str, int, str], None] = lambda stage, pct, msg: None,
             today: Optional[date] = None) -> dict[str, str]:
    """Build, mine and generate every run in ``run_ids``. One L1 failing never stops the others.
    Returns ``{run_id: final status}``. Three passes (build all, mine all, generate all) keep job stages
    moving forward, as §8.4's percent bands expect."""
    sysrow = session.execute(text("SELECT system_type, timezone FROM sap_systems WHERE id = :s "
                                  "AND tenant_id = :t"), {"s": system_id, "t": tenant_id}).fetchone()
    system_type, tz = sysrow[0], sysrow[1] or DEFAULT_TZ
    meta: Optional[Mapping[str, object]] = None
    if version_id:
        meta = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v "
                                    "AND tenant_id = :t"), {"v": version_id, "t": tenant_id}).scalar()
    if not meta or not meta.get("dataset_path"):
        _fail(session, tenant_id, run_ids, NO_DATA_ERROR)
        return {r: "failed" for r in run_ids}
    runs = [_Run(str(r[0]), r[1], r[2], r[3]) for r in session.execute(text(
        "SELECT id, l1, mode, window_from FROM process_discovery_runs WHERE tenant_id = :t "
        "AND id = ANY(CAST(:ids AS uuid[])) ORDER BY l1, id"), {"ids": list(run_ids), "t": tenant_id})]
    frames = frames_for(str(meta["dataset_path"]))
    guard = guard or MemoryGuard()
    raw_coverage = meta.get("coverage")
    coverage: list[Mapping[str, object]] = list(raw_coverage) if isinstance(raw_coverage, list) else []
    n = len(runs)

    for i, run in enumerate(runs):  # 50-80
        progress("building", 50 + 30 * i // n, f"Building the {run.l1} event log")
        _set(session, tenant_id, [run.id], status="building", extraction_version_id=version_id)
        session.commit()
        try:
            rec = RecordingFrames(frames)
            ctx = make_context(rec, tenant_id, system_type, today or date.today(), tz,
                               window_from=run.window_from if run.mode == "incremental" else None)
            events = collect(builder(run.l1).build, rec, ctx)
            store_events(session, Scope(tenant_id, system_id, run.l1, tz), run.id, events, run.mode,
                         run.window_from, guard)
            run.tables = source_tables(coverage, rec.read)
            del events
            session.commit()
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:
            logger.exception("process discovery build %s %s failed", system_id, run.l1)
            run.failed = True
            _fail(session, tenant_id, [run.id], _stage_error(e, BUILD_ERROR))

    live = [r for r in runs if not r.failed]
    for i, run in enumerate(live):  # 80-95
        progress("mining", 80 + 15 * i // len(live), f"Mining {run.l1}")
        _set(session, tenant_id, [run.id], status="mining")
        try:
            mapping = builder(run.l1).MAPPING
            run.mining = mine(session, Scope(tenant_id, system_id, run.l1, tz), mapping,
                              primary_case_type(run.l1, system_type))
            session.execute(text("DELETE FROM process_discovery_variants WHERE tenant_id = :t "
                                      "AND run_id = :r"), {"r": run.id, "t": tenant_id})
            for result in run.mining.by_type.values():
                store_variants(session, run.id, tenant_id, result)
            session.commit()
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:
            logger.exception("process discovery mining %s %s failed", system_id, run.l1)
            run.failed = True
            _fail(session, tenant_id, [run.id], _stage_error(e, MINE_ERROR))

    base = base_document(session, tenant_id)
    live = [r for r in runs if not r.failed]
    for i, run in enumerate(live):  # 95-100
        progress("generating", 95 + 5 * i // len(live), f"Generating the {run.l1} model")
        scope = Scope(tenant_id, system_id, run.l1, tz)
        try:
            cov = coverage_of(run.mining, run.tables)
            if cov == "reference":
                model = reference_model(base, run.l1, system_type)
            else:
                gen = generate(base, run.mining, builder(run.l1).MAPPING, system_type=system_type)
                write_back(session, scope, gen.l5_of)
                model = gen.document
            session.execute(text("""
                UPDATE process_discovery_runs
                   SET status = 'completed', coverage = :cov, model = CAST(:model AS jsonb),
                       stats = CAST(:stats AS jsonb), finished_at = now(),
                       watermark = (SELECT max(ts) FROM process_events
                                    WHERE tenant_id = :t AND system_id = :s AND l1 = :l1)
                 WHERE tenant_id = :t AND id = :id"""), {
                "cov": cov, "model": model.model_dump_json(), "id": run.id, "t": tenant_id, "s": system_id,
                "l1": run.l1, "stats": json.dumps(run.mining.stats(tables=run.tables), default=str)})
            session.commit()
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:
            logger.exception("process discovery generation %s %s failed", system_id, run.l1)
            run.failed = True
            _fail(session, tenant_id, [run.id], _stage_error(e, GENERATE_ERROR))
    return {r.id: "failed" if r.failed else "completed" for r in runs}


def other_extraction_active(tenant_id: str, system_id: str, version_id: Optional[str]) -> bool:
    """Spec §8.2 step 1: an extraction or sync job on this system other than this chain's own."""
    return any(j.get("kind") in EXCLUSIVE_KINDS and str(j.get("system_id")) == str(system_id)
               and j.get("version_id") != version_id for j in jobs.list_jobs(tenant_id, active_only=True))


@celery_app.task(bind=True, name="workers.tasks.run_process_discovery.discover_process", acks_late=True,
                 soft_time_limit=7200, time_limit=7500, max_retries=WAIT_RETRIES)
def discover_process(self: Task, tenant_id: str, system_id: str, run_ids: list[str],
                     version_id: Optional[str]) -> dict[str, str]:
    job_id = job_id_of(run_ids)
    session = tenant_session(get_sync_engine(), tenant_id)
    keep_lock = False
    try:
        if other_extraction_active(tenant_id, system_id, version_id):
            if self.request.retries >= WAIT_RETRIES:
                _fail(session, tenant_id, run_ids, WAIT_ERROR)
                jobs.finish_job(tenant_id, job_id, "failed", error=WAIT_ERROR)
                return {r: "failed" for r in run_ids}
            _set(session, tenant_id, run_ids, status="waiting")
            session.commit()
            jobs.update_job(tenant_id, job_id, stage="extraction",
                            message="Waiting for another extraction on this system to finish")
            keep_lock = True
            raise self.retry(countdown=WAIT_COUNTDOWN)

        def progress(stage: str, pct: int, msg: str) -> None:
            jobs.update_job(tenant_id, job_id, stage=stage, percent=pct, message=msg)

        result = discover(session, tenant_id, system_id, run_ids, version_id, progress=progress)
        failed = [r for r, s in result.items() if s == "failed"]
        if len(failed) == len(result):
            jobs.finish_job(tenant_id, job_id, "failed", error="Every process failed", result=result)
        else:
            jobs.finish_job(tenant_id, job_id, result=result,
                            message=f"{len(result) - len(failed)} of {len(result)} processes discovered")
        return result
    except SoftTimeLimitExceeded:
        _fail(session, tenant_id, run_ids, "Timed out")
        jobs.finish_job(tenant_id, job_id, "failed", error="Timed out")
        return {r: "failed" for r in run_ids}
    except Exception:
        if keep_lock:  # the Retry exception
            raise
        logger.exception("process discovery job %s failed", job_id)
        _fail(session, tenant_id, run_ids, MINE_ERROR)
        jobs.finish_job(tenant_id, job_id, "failed", error=MINE_ERROR)
        raise
    finally:
        session.close()
        if not keep_lock:
            release_lock(tenant_id, system_id)


@celery_app.task(name="workers.tasks.run_process_discovery.abort_runs", soft_time_limit=300, time_limit=360)
def abort_runs(tenant_id: str, system_id: str, run_ids: list[str]) -> None:
    """Chain error callback: the extraction raised, so ``discover_process`` never runs. Fails the runs still
    waiting for it, finishes the job and frees the lock (otherwise held for the full 6-hour TTL). When no run is
    pending a stage has already recorded the real failure, which this must not overwrite."""
    session = tenant_session(get_sync_engine(), tenant_id)
    try:
        if _fail(session, tenant_id, run_ids, EXTRACTION_ERROR, pending_only=True):
            jobs.finish_job(tenant_id, job_id_of(run_ids), "failed", error=EXTRACTION_ERROR)
    finally:
        session.close()
        release_lock(tenant_id, system_id)


PRUNE_EVENTS_SQL = text("DELETE FROM process_events WHERE tenant_id = :t "
                        "AND ts < now() - make_interval(days => :days)")

# A run still referenced by events is kept: process_events.run_id cascades, so deleting the run would delete
# events newer than the retention window (incremental runs leave old cases pointing at older runs).
PRUNE_RUNS_SQL = text("""
DELETE FROM process_discovery_runs r
USING (SELECT id, row_number() OVER (PARTITION BY system_id, l1 ORDER BY started_at DESC, id DESC) AS n
       FROM process_discovery_runs WHERE tenant_id = :t AND status IN ('completed', 'failed')) old
WHERE r.tenant_id = :t AND r.id = old.id AND old.n > :keep
  AND NOT EXISTS (SELECT 1 FROM process_events e WHERE e.tenant_id = :t AND e.run_id = r.id)""")


def prune(session: Session, tenant_id: str, days: int = EVENT_DAYS, keep: int = KEEP_RUNS) -> tuple[int, int]:
    """(events deleted, runs deleted) for one tenant. The session has ``app.tenant_id`` set: under FORCE RLS
    and a role that cannot bypass it, a statement without the tenant would delete nothing."""
    events = session.execute(PRUNE_EVENTS_SQL, {"t": tenant_id, "days": days}).rowcount
    runs = session.execute(PRUNE_RUNS_SQL, {"t": tenant_id, "keep": keep}).rowcount
    session.commit()
    return events, runs


@celery_app.task(name="workers.tasks.run_process_discovery.prune_events", soft_time_limit=1800, time_limit=1860)
def prune_events() -> dict[str, int]:
    """Nightly retention over every tenant, one tenant session each. A failing tenant is logged and skipped."""
    engine = get_sync_engine()
    with Session(engine) as session:
        tenants = [str(r[0]) for r in session.execute(text("SELECT id FROM tenants ORDER BY id"))]
    total_events = total_runs = 0
    for tid in tenants:
        tenant = tenant_session(engine, tid)
        try:
            events, runs = prune(tenant, tid)
            total_events += events
            total_runs += runs
        except SoftTimeLimitExceeded:
            raise
        except Exception:
            logger.exception("process discovery prune failed for tenant %s", tid)
        finally:
            tenant.close()
    logger.info("process discovery prune: %d events, %d runs", total_events, total_runs)
    return {"events": total_events, "runs": total_runs}
