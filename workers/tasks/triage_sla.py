"""SLA sweep: auto-assign unrouted items, start clocks, refresh SLA states, escalate.

Runs every 5 minutes from beat. Every step is idempotent (assignment only touches
never-assigned items, clocks start once, each notification fires once per item),
so overlapping or repeated runs are harmless.
"""

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services.triage import run_tenant
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.triage")


@celery_app.task(name="workers.tasks.triage_sla.sla_sweep", soft_time_limit=240, time_limit=300)
def sla_sweep() -> dict:
    engine = get_sync_engine()
    with Session(engine) as session:
        tenant_ids = [str(r[0]) for r in session.execute(text("SELECT id FROM tenants"))]
    out = {}
    for tid in tenant_ids:
        try:
            with tenant_session(engine, tid) as session:
                out[tid] = run_tenant(session, tid)
                session.commit()
        except Exception:  # one tenant's failure never stops the others
            logger.exception("SLA sweep failed for tenant %s", tid)
    return out
