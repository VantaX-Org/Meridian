"""Task progress tracking via Redis for long-running analysis jobs.

Progress is keyed by version_id (stable across retries) and consumed by the
/api/v1/analysis/status/{version_id} endpoint to drive the frontend progress bar.

All failures are non-fatal — progress is UX sugar layered on top of the
authoritative analysis_versions.status column in Postgres.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

logger = logging.getLogger("meridian.task_progress")

PROGRESS_KEY_PREFIX = "task_progress:"
PROGRESS_TTL_SECONDS = 3600  # 1 hour — long enough to cover the largest jobs

# Canonical step vocabulary so frontend can match against known names if needed.
TOTAL_STEPS = 6
STEP_UPLOAD_VALIDATE = (1, "Uploading and validating file")
STEP_PARSE = (2, "Parsing file structure")
STEP_RUN_CHECKS = (3, "Running data quality checks")
STEP_AI_INSIGHTS = (4, "Generating AI insights")
STEP_BUILD_REPORT = (5, "Building report")
STEP_FINALISE = (6, "Finalising")


_redis_instance = None


def _redis_client():
    """Return a singleton sync Redis client, or None if unavailable.

    Uses short timeouts so a flaky Redis can never block analysis progress.
    """
    global _redis_instance
    if _redis_instance is not None:
        try:
            _redis_instance.ping()
            return _redis_instance
        except Exception:
            _redis_instance = None

    try:
        import redis

        url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        _redis_instance = redis.from_url(
            url,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=False,
        )
        _redis_instance.ping()
        return _redis_instance
    except Exception as exc:
        logger.warning("Redis client unavailable for task progress: %s", exc)
        _redis_instance = None
        return None


def _compute_percent(
    step_number: int,
    total_steps: int,
    rows_processed: int,
    total_rows: int,
) -> int:
    """Interpolate within the current step based on row progress when possible."""
    if total_steps <= 0 or step_number <= 0:
        return 0
    base = int(((step_number - 1) / total_steps) * 100)
    step_width = 100 / total_steps
    if total_rows > 0 and rows_processed > 0:
        within = min(1.0, rows_processed / total_rows) * step_width
        return min(99, int(base + within))
    # No row info — land at the middle of the step.
    return min(99, int(base + step_width / 2))


def update_task_progress(
    version_id: str,
    *,
    status: str = "processing",
    current_step: str = "",
    step_number: int = 0,
    total_steps: int = TOTAL_STEPS,
    rows_processed: int = 0,
    total_rows: int = 0,
    percent_complete: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    """Publish a progress update for the given version_id.

    Parameters mirror the frontend's ProgressData shape. Pass ``percent_complete``
    explicitly to override the auto-computed interpolation (useful for 0 / 100
    on queued / completed states).
    """
    client = _redis_client()
    if client is None:
        return

    if percent_complete is None:
        if status == "completed":
            percent_complete = 100
        elif status in ("queued", "failed"):
            percent_complete = 0 if status == "queued" else percent_complete or 0
        else:
            percent_complete = _compute_percent(
                step_number, total_steps, rows_processed, total_rows
            )

    payload = {
        "status": status,
        "current_step": current_step,
        "step_number": step_number,
        "total_steps": total_steps,
        "rows_processed": rows_processed,
        "total_rows": total_rows,
        "percent_complete": int(percent_complete or 0),
        "error": error,
    }

    try:
        client.setex(
            f"{PROGRESS_KEY_PREFIX}{version_id}",
            PROGRESS_TTL_SECONDS,
            json.dumps(payload),
        )
    except Exception as exc:
        logger.warning("Failed to write task progress for %s: %s", version_id, exc)


def get_task_progress(version_id: str) -> Optional[dict]:
    """Return the latest progress payload, or ``None`` if absent/unavailable."""
    client = _redis_client()
    if client is None:
        return None
    try:
        raw = client.get(f"{PROGRESS_KEY_PREFIX}{version_id}")
        if not raw:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.warning("Failed to read task progress for %s: %s", version_id, exc)
        return None


def clear_task_progress(version_id: str) -> None:
    """Delete a progress entry. Optional — TTL handles cleanup otherwise."""
    client = _redis_client()
    if client is None:
        return
    try:
        client.delete(f"{PROGRESS_KEY_PREFIX}{version_id}")
    except Exception:
        pass
