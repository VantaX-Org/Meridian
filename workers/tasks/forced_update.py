"""
Celery beat task: apply an HQ-forced platform update without losing work.

revalidate_licence stores HQ's min_version / force_now in Redis (worker
processes don't share the API's in-memory manifest). Every 15 minutes this
task checks: below min_version? inside the update window (or forced now)?
no other Celery job running? Then it asks the updater sidecar to run
scripts/update.sh, which backs up Postgres first and keeps all volumes.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from workers.celery_app import celery_app

logger = logging.getLogger("meridian.forced_update")

REDIS_KEY = "meridian:forced_update"


def store_signal(result: dict) -> None:
    """Called after each licence validation. Never raises."""
    try:
        from workers.scheduler import _get_redis
        r = _get_redis()
        min_version = result.get("min_version") or ""
        if min_version:
            r.set(REDIS_KEY, json.dumps({
                "min_version": min_version,
                "force_now": bool(result.get("force_update_now")),
            }))
        else:
            r.delete(REDIS_KEY)
    except Exception as exc:
        logger.warning("Could not store forced-update signal: %s", exc)


def _busy(own_task_id: str | None) -> bool:
    """True if any worker runs a job other than this one. No reply = busy."""
    active = celery_app.control.inspect(timeout=2).active()
    if not active:
        return True
    return any(t.get("id") != own_task_id for tasks in active.values() for t in tasks)


@celery_app.task(name="forced_update_check", bind=True, soft_time_limit=60, time_limit=90)
def forced_update_check(self):
    from api.config import settings
    from api.services.forced_update import decide
    from api.services.version import APP_VERSION
    from workers.scheduler import _get_redis

    r = _get_redis()
    raw = r.get(REDIS_KEY)
    if not raw:
        return {"decision": "none"}
    signal = json.loads(raw)
    min_version = signal.get("min_version", "")
    force_now = bool(signal.get("force_now"))
    now = datetime.now(timezone.utc)

    decision = decide(min_version, APP_VERSION, force_now, now, settings.update_window, busy=False)
    if decision == "go" and _busy(self.request.id):
        decision = "wait_jobs"
    if decision != "go":
        if decision != "none":
            logger.info("Forced update to >= %s pending: %s", min_version, decision)
        return {"decision": decision, "min_version": min_version}

    # One attempt per min_version per day, so a failed or rolled-back update
    # does not loop. ponytail: a job started in the seconds between the busy
    # check and the container restart is killed and must be re-run; pause the
    # queue during the update if that ever bites.
    if not r.set(f"{REDIS_KEY}:attempted:{min_version}", "1", nx=True, ex=86400):
        return {"decision": "attempted_today", "min_version": min_version}

    from api.services.updater_client import trigger_update
    result = asyncio.run(trigger_update())
    logger.warning(
        "Forced update to >= %s (running %s, force_now=%s): sidecar says %s",
        min_version, APP_VERSION, force_now, result.get("status"),
    )
    return {"decision": "go", "min_version": min_version, "updater": result.get("status")}
