"""Celery beat task: mine learned-rule proposals from stewards' fixes, daily (api/services/fix_mining.py).

Per tenant, under its row-level security; idempotent (a proposal is keyed by object and fingerprint, refreshed while
pending, left alone once decided). Proposals are never enabled here: a person approves them.
"""
from __future__ import annotations

import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from api.services import fix_mining
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.fix_mining")


def mine_all(engine) -> dict[str, dict]:
    with engine.connect() as c:
        tenants = [r[0] for r in c.execute(text("SELECT id::text FROM tenants")).fetchall()]
    out = {}
    for tid in tenants:
        with tenant_session(engine, tid) as s:
            try:
                out[tid] = fix_mining.mine(s, tid)
                s.commit()
            except SoftTimeLimitExceeded:
                raise
            except Exception as e:  # noqa: BLE001 - one tenant's failure never stops the others
                s.rollback()
                logger.warning("fix mining for tenant %s failed: %s", tid, type(e).__name__)
    return out


@celery_app.task(name="workers.tasks.fix_mining.mine_rules_from_fixes", soft_time_limit=900, time_limit=960)
def mine_rules_from_fixes() -> dict:
    try:
        out = mine_all(get_sync_engine())
    except SoftTimeLimitExceeded:
        logger.warning("fix mining timed out")
        return {"timed_out": True}
    return {tid: {k: v for k, v in r.items() if k != "proposal_ids"} for tid, r in out.items()}
