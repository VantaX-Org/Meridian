"""Celery task: SAP system health checks."""

import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.health_check")


@celery_app.task(
    bind=True,
    name="workers.tasks.run_health_check.run_health_check",
    soft_time_limit=120,
    time_limit=180,
)
def run_health_check(self, tenant_id, system_id):
    """Run a connection health check for one system."""
    engine = get_sync_engine()

    try:
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

            from api.services.connectivity_manager import ConnectivityManager
            manager = ConnectivityManager(session, tenant_id)

            result = manager.health_check(system_id)
            logger.info(f"Health check for {system_id}: {result['status']}")
            return result

    except SoftTimeLimitExceeded:
        logger.error(f"Health check timeout for {system_id}")
        return {"connected": False, "status": "timeout", "message": "Health check timed out"}
    except Exception as e:
        logger.error(f"Health check failed for {system_id}: {e}")
        return {"connected": False, "status": "error", "message": str(e)[:200]}


@celery_app.task(
    bind=True,
    name="workers.tasks.run_health_check.check_all_systems",
    soft_time_limit=300,
    time_limit=360,
)
def check_all_systems(self):
    """Check health of all active systems across all tenants."""
    engine = get_sync_engine()

    with Session(engine) as session:
        result = session.execute(
            text("SELECT id, tenant_id FROM sap_systems WHERE is_active = true")
        )
        systems = result.fetchall()

    for system_id, tenant_id in systems:
        try:
            run_health_check.delay(str(tenant_id), str(system_id))
        except Exception as e:
            logger.warning(f"Failed to enqueue health check for {system_id}: {e}")

    logger.info(f"Enqueued health checks for {len(systems)} systems")
