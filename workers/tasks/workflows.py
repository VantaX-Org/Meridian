"""Celery beat task: approval steps past their due time climb the escalation chain (api/services/workflow.py).

Every 15 minutes each tenant's pending steps past due are swept under its row-level security: each chain level fires
once per step (the level reached is stored), so a rerun or a second worker does nothing twice (FOR UPDATE SKIP LOCKED).
Logs carry counts only.
"""
from __future__ import annotations

import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from api.services import workflow
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.workflows")


def sweep_all(engine, now=None) -> dict[str, int]:
    """One pass over every tenant. Returns {"escalated": n, "overdue": n} summed."""
    with engine.connect() as c:
        tenants = [r[0] for r in c.execute(text("SELECT id::text FROM tenants")).fetchall()]
    out: dict[str, int] = {}
    for tid in tenants:
        with tenant_session(engine, tid) as s:
            for k, v in workflow.sla_sweep(s, tid, now).items():
                out[k] = out.get(k, 0) + v
            s.commit()
    return out


@celery_app.task(name="workers.tasks.workflows.sla_sweep", soft_time_limit=240, time_limit=300)
def sla_sweep() -> dict:
    try:
        out = sweep_all(get_sync_engine())
    except SoftTimeLimitExceeded:
        logger.warning("workflow SLA sweep timed out; the rest on the next tick")
        return {"timed_out": True}
    if out:
        logger.info("workflow SLA sweep: %s", out)
    return out
