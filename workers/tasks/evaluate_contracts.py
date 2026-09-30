"""Celery task: evaluate active data contracts against a finished analysis run."""

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.contracts")


@celery_app.task(name="workers.tasks.evaluate_contracts.evaluate_contracts",
                 soft_time_limit=300, time_limit=360)
def evaluate_contracts(version_id: str, tenant_id: str) -> list[dict]:
    from api.services.contract_compliance import evaluate_run

    with Session(get_sync_engine()) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        results = evaluate_run(session, str(tenant_id), str(version_id))
        session.commit()
    logger.info(f"contracts for {version_id}: {results}")
    return results
