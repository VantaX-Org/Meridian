"""Celery beat task: learned monitors between full analysis runs, every 15 minutes.

For each tenant, judges the row count of a sync whose extraction has landed but whose analysis has not finished against
the object's learned baseline (api/services/learned_monitors_interim.py) and stores a ``source = 'interim'`` break.
Reads aggregates already in the database: it starts no extraction and no analysis, and each tenant runs under short
statement and lock timeouts so a busy database makes it skip that tenant until the next tick instead of waiting.
Idempotent (ON CONFLICT). No LLM, no SAP value.
"""
from __future__ import annotations

import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from api.services.learned_monitors_interim import detect_interim, store_interim
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.learned_monitor_interim")


@celery_app.task(name="workers.tasks.learned_monitor_interim.check_interim", soft_time_limit=240, time_limit=300)
def check_interim() -> dict:
    engine = get_sync_engine()
    found = skipped = 0
    try:
        with engine.connect() as c:
            tenants = [r[0] for r in c.execute(text("SELECT id::text FROM tenants")).fetchall()]
        for tid in tenants:
            session = tenant_session(engine, tid)
            try:
                session.execute(text("SET LOCAL statement_timeout = '5s'"))
                session.execute(text("SET LOCAL lock_timeout = '2s'"))
                found += store_interim(session, tid, detect_interim(session, tid))
                session.commit()
            except SoftTimeLimitExceeded:
                raise
            except Exception as e:  # one tenant must not stop the others
                session.rollback()
                skipped += 1
                logger.warning("interim monitor skipped tenant %s: %s", tid, str(e)[:200])
            finally:
                session.close()
    except SoftTimeLimitExceeded:
        logger.warning("interim monitor timed out")
        return {"found": found, "skipped": skipped, "timed_out": True}
    return {"found": found, "skipped": skipped}
