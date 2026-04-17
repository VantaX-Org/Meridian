"""Celery task: config-only sync (SPRO/Foundation Objects)."""

import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

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

    try:
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

            from api.services.connectivity_manager import ConnectivityManager
            manager = ConnectivityManager(session, tenant_id)

            results = manager.sync_config(system_id, modules)
            logger.info(f"Config sync complete for {len(modules)} modules: {results}")
            return results

    except SoftTimeLimitExceeded:
        logger.error("Config sync task timed out")
        return {"error": "timeout"}
    except Exception as e:
        logger.error(f"Config sync failed: {e}")
        return {"error": str(e)[:200]}
