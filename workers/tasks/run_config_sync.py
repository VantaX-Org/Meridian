"""Celery task: config-only sync (SPRO/Foundation Objects)."""

import logging
import uuid

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import jobs
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.config_sync")


@celery_app.task(
    bind=True,
    name="workers.tasks.run_config_sync.run_config_sync",
    soft_time_limit=300,
    time_limit=360,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_config_sync(self, tenant_id, system_id, modules):
    """Sync SPRO/FO configuration for specified modules."""
    engine = get_sync_engine()
    job_id = f"cfg-{self.request.id or uuid.uuid4()}"
    jobs.start_job(tenant_id, job_id, "config_sync", f"Configuration: {', '.join(modules)}",
                   system_id=system_id, modules=modules)
    jobs.update_job(tenant_id, job_id, stage="read", message="Reading configuration")

    try:
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

            from api.services.connectivity_manager import ConnectivityManager
            manager = ConnectivityManager(session, tenant_id)

            results = manager.sync_config(system_id, modules)
            logger.info(f"Config sync complete for {len(modules)} modules: {results}")
            failed = results.get("status") == "failed"
            jobs.finish_job(tenant_id, job_id, "failed" if failed else "completed", result=results,
                            error="Could not connect to the system" if failed else None)
            return results

    except SoftTimeLimitExceeded:
        logger.error("Config sync task timed out")
        jobs.finish_job(tenant_id, job_id, "failed", error="Timed out")
        return {"error": "timeout"}
    except Exception as e:
        logger.error(f"Config sync failed: {e}")
        jobs.finish_job(tenant_id, job_id, "failed", error=str(e)[:200])
        return {"error": str(e)[:200]}
