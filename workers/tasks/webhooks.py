"""Celery beat task: deliver due webhook events (api/services/webhooks.py), every minute.

Each tenant's pending and retrying deliveries whose next attempt is due are sent once, signed, under the tenant's
row-level security; a failure is retried with exponential backoff (1, 2, 4, 8 minutes) and the delivery fails after
5 attempts. Row locks (FOR UPDATE SKIP LOCKED) keep two workers from sending one delivery twice. Logs carry ids and
status codes only, never the URL or the payload.
"""
from __future__ import annotations

import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from api.services import webhooks
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.webhooks")


def deliver_due(engine, post=None, now=None) -> dict[str, int]:
    """One pass over every tenant's due deliveries. Returns {status: count}."""
    with engine.connect() as c:
        tenants = [r[0] for r in c.execute(text("SELECT id::text FROM tenants")).fetchall()]
    out: dict[str, int] = {}
    for tid in tenants:
        with tenant_session(engine, tid) as s:
            for did in webhooks.due(s, tid, now):
                res = webhooks.deliver_one(s, tid, did, post=post, now=now)
                s.commit()
                if res:
                    out[res["status"]] = out.get(res["status"], 0) + 1
    return out


@celery_app.task(name="workers.tasks.webhooks.deliver_due_webhooks", soft_time_limit=50, time_limit=58)
def deliver_due_webhooks() -> dict:
    try:
        out = deliver_due(get_sync_engine())
    except SoftTimeLimitExceeded:
        logger.warning("webhook delivery pass timed out; the rest go out on the next tick")
        return {"timed_out": True}
    if out:
        logger.info("webhook deliveries: %s", out)
    return out
