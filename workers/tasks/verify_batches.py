"""Celery task: after a run, store its verdict on each fix batch it covered (api/services/batch_verification.py).

Enqueued by run_checks once the run's issues and reconciliation are stored. Idempotent: one row per (batch, run),
inserted with ON CONFLICT DO NOTHING, and only a newly stored verdict tells anyone. Runs under the tenant's row-level
security. Logs carry counts only.
"""
from __future__ import annotations

import logging

from celery.exceptions import SoftTimeLimitExceeded

from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.verify_batches")


def run(engine, version_id: str, tenant_id: str) -> dict:
    from api.services import batch_verification, handoff_notices

    with tenant_session(engine, tenant_id) as s:
        stored, jobs = batch_verification.verify(s, tenant_id, version_id)
        s.commit()
    handoff_notices.dispatch(jobs)
    return {"batches": len(stored), "fixed": sum(v["fixed"] for v in stored),
            "still_failing": sum(v["still_failing"] for v in stored)}


@celery_app.task(name="workers.tasks.verify_batches.verify_batches", soft_time_limit=240, time_limit=300)
def verify_batches(version_id: str, tenant_id: str) -> dict:
    try:
        out = run(get_sync_engine(), version_id, tenant_id)
    except SoftTimeLimitExceeded:
        logger.warning("batch verification of %s timed out", version_id)
        return {"timed_out": True}
    logger.info("batch verification of %s: %s", version_id, out)
    return out
