"""Live run events: the small JSON messages behind GET /api/v1/events/{version_id}.

Workers publish them on the Redis channel ``events:{tenant_id}:{version_id}`` (api/routes/events.py subscribes) at the
points where a run's progress is written (workers/tasks/run_checks.py). Best effort and UX only: the authoritative
state is ``analysis_versions.status`` in Postgres, the frontend polls it as the fallback, and nothing here may fail
a task, so every error is logged and swallowed.

Message: ``{"type": "progress"|"complete"|"failed", "step", "pct", "event"}``. ``event`` is the SSE event name the
route reads: ``progress``, ``complete``, or ``error`` for a failure (the stream closes on the last two).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from api.services.task_progress import _compute_percent, _redis_client

logger = logging.getLogger("meridian.run_events")

_SSE_EVENT = {"progress": "progress", "complete": "complete", "failed": "error"}


def run_channel(tenant_id: Any, version_id: Any) -> str:
    return f"events:{tenant_id}:{version_id}"


def run_event(kind: str, step: str, pct: Optional[int] = None) -> dict:
    """The message for ``kind`` (progress, complete or failed); ``pct`` is left out when unknown."""
    msg: dict = {"type": kind, "event": _SSE_EVENT[kind], "step": step}
    if pct is not None:
        msg["pct"] = max(0, min(100, int(pct)))
    return msg


def publish_run_event(tenant_id: Any, version_id: Any, kind: str, step: str, pct: Optional[int] = None) -> None:
    """Publish one event to the run's channel. Never raises: no Redis, no event."""
    try:
        client = _redis_client()
        if client is None:
            return
        client.publish(run_channel(tenant_id, version_id), json.dumps(run_event(kind, step, pct)))
    except Exception as exc:
        logger.warning("run event for %s not published: %s", version_id, exc)


def publish_progress_write(tenant_id: Any, version_id: Any, **progress: Any) -> None:
    """The event for one ``update_task_progress(version_id, **progress)`` write: ``completed`` is a complete event,
    ``failed`` a failed one, anything else progress, with the percent that write shows."""
    status = progress.get("status", "processing")
    step = str(progress.get("current_step") or "")
    if status == "completed":
        publish_run_event(tenant_id, version_id, "complete", step, 100)
    elif status == "failed":
        publish_run_event(tenant_id, version_id, "failed", step)
    else:
        pct = progress.get("percent_complete")
        if pct is None:
            pct = _compute_percent(int(progress.get("step_number") or 0), int(progress.get("total_steps") or 0),
                                   int(progress.get("rows_processed") or 0), int(progress.get("total_rows") or 0))
        publish_run_event(tenant_id, version_id, "progress", step, pct)
