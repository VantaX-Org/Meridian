"""Celery task: start the scheduled process discovery runs that have come due.

Beat fires ``run_due_process_schedules`` every 5 minutes (workers/scheduler.py), like ``sync_profile_scheduler``.
For every tenant it reads the active ``process_discovery_schedules`` whose ``next_run_at`` has come, under
``FOR UPDATE SKIP LOCKED`` so two overlapping ticks never take the same row. Each slot is claimed by moving
``next_run_at`` to the first occurrence after now (croniter, in the tenant's time zone) and committing BEFORE
the run is enqueued: a slot is started at most once however often or concurrently the task fires, and a slot
whose dispatch fails is not retried (the next occurrence is). Slots missed while beat was down are not
back-filled.

The run is the one ``POST /process-discovery/systems/{id}/runs`` starts, in incremental mode (a full run when
the L1 has no watermark yet): the same Redis lock per system, run row, job and extraction-then-discover chain.
A system whose lock is held (a run or extraction is active) skips the slot. Every query carries ``tenant_id``
and runs in a tenant session. No LLM.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from celery import chain
from celery.exceptions import SoftTimeLimitExceeded
from croniter import croniter
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services.process_discovery import L1S_BY_SYSTEM
from api.services.process_discovery.dispatch import incremental_window, scope_of, start_chain, take_lock
from api.services.process_discovery.events import DEFAULT_TZ
from api.services.task_progress import _redis_client
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.process_schedules")

DISPATCH_ERROR = "Could not queue the discovery job"


def next_run(cron: str, tz: Optional[str], after: datetime) -> datetime:
    """The first occurrence of ``cron`` after ``after``, read in time zone ``tz``, as an aware UTC instant."""
    try:
        zone = ZoneInfo(tz or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    base = (after if after.tzinfo else after.replace(tzinfo=timezone.utc)).astimezone(zone)
    return croniter(cron, base).get_next(datetime).astimezone(timezone.utc)


def claim_due(session: Session, tenant_id: str, tz: str, now: datetime) -> list[dict]:
    """Take every due slot: advance ``next_run_at`` past now and commit. Returns the claimed schedules."""
    rows = session.execute(text(
        "SELECT id::text AS id, system_id::text AS system_id, l1, schedule_cron, created_by::text AS created_by "
        "FROM process_discovery_schedules WHERE tenant_id = CAST(:t AS uuid) AND active "
        "AND next_run_at IS NOT NULL AND next_run_at <= :now ORDER BY next_run_at FOR UPDATE SKIP LOCKED"),
        {"t": tenant_id, "now": now}).mappings().all()
    claimed = []
    for r in rows:
        try:
            nxt = next_run(r["schedule_cron"], tz, now)
        except Exception:  # an expression croniter rejects: retry in a day rather than every tick
            nxt = now + timedelta(hours=24)
            logger.warning("process schedule %s has an invalid cron; retrying in a day", r["id"])
        session.execute(text("UPDATE process_discovery_schedules SET next_run_at = :n, last_run_at = :now "
                             "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                        {"n": nxt, "now": now, "id": r["id"], "t": tenant_id})
        claimed.append(dict(r))
    session.commit()
    return claimed


def start_run(session: Session, tenant_id: str, sched: dict) -> Optional[str]:
    """Queue the incremental run of one claimed schedule. The run id, or None when the slot is skipped."""
    # imported here: workers.scheduler (imported by celery_app) imports this module, which would cycle back
    from workers.tasks.run_process_discovery import release_lock

    system_id, l1 = sched["system_id"], sched["l1"]
    system = session.execute(text("SELECT system_type, timezone FROM sap_systems "
                                  "WHERE id = CAST(:s AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                             {"s": system_id, "t": tenant_id}).first()
    if system is None or l1 not in L1S_BY_SYSTEM.get(system.system_type, ()):
        logger.warning("process schedule %s: %s is not minable on this system; skipped", sched["id"], l1)
        return None
    client = _redis_client()
    if client is None:
        logger.warning("process schedule %s: job queue unavailable; slot skipped", sched["id"])
        return None
    token = take_lock(client, tenant_id, system_id)
    if token is None:
        logger.info("process schedule %s: a run is already active on the system; slot skipped", sched["id"])
        return None
    zone = ZoneInfo(system.timezone or DEFAULT_TZ)
    try:
        today = datetime.now(zone).date()
        wm = session.execute(text(
            "SELECT max(watermark) FROM process_discovery_runs WHERE tenant_id = CAST(:t AS uuid) "
            "AND system_id = CAST(:s AS uuid) AND l1 = :l1 AND status = 'completed'"),
            {"t": tenant_id, "s": system_id, "l1": l1}).scalar()
        window_from = incremental_window(wm, system.timezone or DEFAULT_TZ)
        mode = "incremental" if window_from else "full"
        rid, version_id = str(uuid.uuid4()), str(uuid.uuid4())
        job_id = f"pd-{rid}"
        session.execute(text(
            "INSERT INTO process_discovery_runs (id, tenant_id, system_id, l1, mode, status, window_from, window_to, "
            "job_id, created_by) VALUES (CAST(:id AS uuid), CAST(:t AS uuid), CAST(:s AS uuid), :l1, :mode, "
            "'queued', :wf, :wt, :j, CAST(:u AS uuid))"),
            {"id": rid, "t": tenant_id, "s": system_id, "l1": l1, "mode": mode, "wf": window_from, "wt": today,
             "j": job_id, "u": sched["created_by"]})
        session.commit()
    except BaseException:
        release_lock(tenant_id, system_id, token)
        raise
    try:
        start_chain(tenant_id, system_id, [l1], [rid], version_id, token, job_id,
                    scope_of([window_from] if window_from else [], today), chain)
    except Exception:  # broker down: free the lock and fail the queued run so the UI is not stuck
        logger.exception("Process discovery dispatch failed for %s", job_id)
        session.execute(text("UPDATE process_discovery_runs SET status = 'failed', error = :e, finished_at = now() "
                             "WHERE tenant_id = CAST(:t AS uuid) AND id = CAST(:id AS uuid) AND status = 'queued'"),
                        {"e": DISPATCH_ERROR, "t": tenant_id, "id": rid})
        session.commit()
        return None
    return rid


def process_tenant(session: Session, tenant_id: str, now: datetime) -> dict[str, int]:
    tz = session.execute(text("SELECT timezone FROM triage_settings WHERE tenant_id = CAST(:t AS uuid)"),
                         {"t": tenant_id}).scalar() or "UTC"
    claimed = claim_due(session, tenant_id, tz, now)
    started = 0
    for sched in claimed:
        try:
            started += start_run(session, tenant_id, sched) is not None
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:  # one schedule failing must not stop the rest
            session.rollback()
            logger.error("process schedule %s failed: %s", sched["id"], type(e).__name__)
    return {"due": len(claimed), "started": started}


@celery_app.task(name="workers.tasks.process_schedules.run_due_process_schedules",
                 soft_time_limit=240, time_limit=300)
def run_due_process_schedules() -> dict[str, int]:
    """Beat, every 5 minutes: start the incremental discovery runs that have come due, for every tenant."""
    engine = get_sync_engine()
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        tenants = [str(r[0]) for r in session.execute(text("SELECT id FROM tenants")).fetchall()]
    totals = {"due": 0, "started": 0}
    for tid in tenants:
        try:
            with tenant_session(engine, tid) as session:
                res = process_tenant(session, tid, now)
            for k in totals:
                totals[k] += res[k]
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:
            logger.error("process schedules failed for tenant %s: %s", tid, type(e).__name__)
    return totals
