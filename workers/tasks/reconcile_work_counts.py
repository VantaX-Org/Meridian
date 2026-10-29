"""Celery beat task: nightly reconcile of work_counts against a live count of work_records (migration 108).

work_counts is kept exact by triggers on work_records; this is the safety net. Per tenant, in one snapshot, it
recomputes every (run, object, status, system, severity, assignee) slice from work_records, logs each slice that
disagrees as a warning with both numbers (count, issues, proposed, value at risk), and rewrites the drifted runs'
counts under a lock that holds work_records writers at their trigger. Idempotent: a second pass finds nothing.
No LLM, no SAP data.
"""
from __future__ import annotations

import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import work_counts
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.reconcile_work_counts")


@celery_app.task(name="workers.tasks.reconcile_work_counts.reconcile_work_counts", soft_time_limit=1800,
                 time_limit=1860)
def reconcile_work_counts() -> dict:
    engine = get_sync_engine()
    with Session(engine) as session:
        tenants = [str(t) for t in session.execute(text("SELECT id FROM tenants ORDER BY id")).scalars()]
    out: dict[str, int] = {}
    for tid in tenants:
        try:
            with Session(engine) as session:
                found = work_counts.reconcile(session, tid, repair=True)
        except SoftTimeLimitExceeded:
            logger.warning("work_counts reconcile timed out after %d tenant(s)", len(out))
            break
        out[tid] = len(found)
    drifted = {t: n for t, n in out.items() if n}
    logger.info("work_counts reconcile: %d tenant(s) checked, drift in %d: %s", len(out), len(drifted), drifted)
    return {"tenants": len(out), "drifted": drifted}
