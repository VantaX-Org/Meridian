"""The non-database half of starting a process discovery run, shared by ``POST /systems/{id}/runs`` and the
schedule tick (workers/tasks/process_schedules.py): the per-system Redis lock, the incremental window, and the
job plus extraction-then-discover chain. Each caller inserts the run rows itself (async session in the route,
sync session in the worker) and marks them failed when ``start_chain`` raises.

The Celery tasks are imported inside the functions: workers.celery_app imports workers.scheduler, which imports
the schedule task, and run_extraction imports celery_app. ``chain`` is passed in so callers (and their tests)
own the Celery primitive.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Any, Callable, Optional, Sequence
from zoneinfo import ZoneInfo

from api.services import jobs
from api.services.process_discovery import MODULE_OF

OVERLAP_DAYS = 14  # spec §5.3 / §8.2 step 3: incremental scope starts at watermark - 14 days


def incremental_window(watermark: Optional[datetime], tz: str, fallback: Optional[date] = None) -> Optional[date]:
    """First day to extract: ``watermark`` - 14 days in ``tz``; ``fallback`` when there is no watermark."""
    if watermark is None:
        return fallback
    return watermark.astimezone(ZoneInfo(tz)).date() - timedelta(days=OVERLAP_DAYS)


def scope_of(starts: Sequence[date], today: date) -> Optional[dict[str, str]]:
    return {"date_from": min(starts).isoformat(), "date_to": today.isoformat()} if starts else None


def take_lock(client: Any, tenant_id: str, system_id: str) -> Optional[str]:
    """The owner token when this call took the system's lock, None when a run or extraction already holds it."""
    from workers.tasks.run_process_discovery import LOCK_TTL, lock_key

    token = uuid.uuid4().hex
    return token if client.set(lock_key(tenant_id, system_id), token, nx=True, ex=LOCK_TTL) else None


def start_chain(tenant_id: str, system_id: str, l1s: Sequence[str], run_ids: Sequence[str], version_id: Optional[str],
                token: str, job_id: str, scope: Optional[dict[str, str]], chain: Callable[..., Any]) -> None:
    """Register the job and queue extraction then discovery. ``l1s`` and ``run_ids`` are the sourced L1s and their
    runs, in the same order. Raises on any failure; the lock is released first, the caller fails the runs."""
    from workers.tasks.run_extraction import run_extraction
    from workers.tasks.run_process_discovery import PURPOSE, abort_runs, discover_process, release_lock

    try:
        jobs.start_job(tenant_id, job_id, "process_discovery", f"Process discovery: {', '.join(l1s)}",
                       system_id=system_id, run_ids=list(run_ids), version_id=version_id)
        jobs.update_job(tenant_id, job_id, stage="extraction", percent=0, message="Extracting event tables")
        queued = chain(run_extraction.si(tenant_id, system_id, [MODULE_OF[l1] for l1 in l1s], include_config=False,
                                         sync_type="data", scope=scope, analyse=False, label="Process discovery",
                                         version_id=version_id, purpose=PURPOSE),
                       discover_process.si(tenant_id, system_id, list(run_ids), version_id, token)).apply_async(
            link_error=abort_runs.si(tenant_id, system_id, list(run_ids), version_id, token))
        ids, node = [], queued  # the chain's tasks, last to first, for POST /jobs/{id}/cancel
        while node is not None and len(ids) < 10:
            ids.append(getattr(node, "id", None))
            node = getattr(node, "parent", None)
        jobs.set_task_ids(tenant_id, job_id, [i for i in ids if isinstance(i, str)])
    except Exception:
        release_lock(tenant_id, system_id, token)
        raise
