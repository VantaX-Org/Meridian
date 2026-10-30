"""Celery beat task: send the scheduled digests that are due (api/services/digests.py, migration 114).

Every five minutes, for every tenant, each enabled digest schedule whose ``next_run_at`` has come is sent once: the
slot (schedule, due time) is claimed in digest_deliveries with ON CONFLICT DO NOTHING before anything is built, so a
slot goes out at most once however often or concurrently the task fires. Then ``next_run_at`` moves to the first
occurrence of the cron after now (compare-and-swap); slots missed while beat was down are not back-filled. In sandbox
mode the slot is recorded as skipped (reason ``sandbox``). One tenant or schedule failing never stops the rest. The
numbers are deterministic; no LLM.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from api.services import digests
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.digests")


def process_tenant(session, tenant_id: str, now: datetime, **kw: Any) -> dict[str, int]:
    out: dict[str, int] = {}
    for sched in digests.due(session, tenant_id, now):
        due_at = sched["next_run_at"]
        try:
            res = digests.send(session, tenant_id, sched, due_at, **kw)
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:  # noqa: BLE001 - one schedule never stops the rest
            session.rollback()
            logger.error("digest %s failed: %s", sched["id"], type(e).__name__)
            res = {"status": "failed"}
        digests.advance(session, sched, due_at, now)
        session.commit()
        status = res["status"] if res else "already_sent"
        out[status] = out.get(status, 0) + 1
    return out


def run_due(engine, now: Optional[datetime] = None, **kw: Any) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    with engine.connect() as c:
        tenants = [r[0] for r in c.execute(text("SELECT id::text FROM tenants")).fetchall()]
    out: dict[str, int] = {}
    for tid in tenants:
        try:
            with tenant_session(engine, tid) as s:
                for k, v in process_tenant(s, tid, now, **kw).items():
                    out[k] = out.get(k, 0) + v
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:  # noqa: BLE001
            logger.error("digests for tenant %s failed: %s", tid, type(e).__name__)
    return out


@celery_app.task(name="workers.tasks.digests.send_due_digests", soft_time_limit=840, time_limit=900)
def send_due_digests() -> dict:
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    try:
        out = run_due(get_sync_engine(), base_url=_resolve_app_base_url())
    except SoftTimeLimitExceeded:
        logger.warning("digest pass timed out; the rest go out on the next tick")
        return {"timed_out": True}
    if out:
        logger.info("digests: %s", out)
    return out
