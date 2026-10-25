"""Celery task: (re)build a run's work list (api/services/worklist.py) without the run's frames.

The run itself builds its work list, with record names, at the end of run_checks. This task is for runs
from before the work list and for a rebuild on request (POST /api/v1/work/build); records keep their keys
as their names here. Idempotent: a rebuild replaces the run's rows.
"""
import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.build_worklist")


@celery_app.task(bind=True, name="workers.tasks.build_worklist.build_worklist", soft_time_limit=3300, time_limit=3600)
def build_worklist(self, version_id: str, tenant_id: str) -> dict:
    from api.services import worklist
    try:
        with Session(get_sync_engine()) as session:
            out = worklist.build(session, tenant_id, version_id)
        logger.info("work list for %s: %s", version_id, out)
        return out
    except SoftTimeLimitExceeded:
        logger.error("work list build timed out for %s", version_id)
        return {"error": "timeout"}
