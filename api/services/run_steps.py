"""Durable per-run step log — api/services/run_steps.py.

Written by workers/tasks/run_checks.py and workers/tasks/run_sync.py alongside
(not instead of) the Redis-only task_progress mechanism. Read by
GET /api/v1/runs/{id}/steps (api/routes/runs.py).
"""
from __future__ import annotations

import logging

from sqlalchemy import text

logger = logging.getLogger("meridian.run_steps")


def record_step(
    engine,
    tenant_id: str,
    version_id: str,
    step_number: int,
    step_name: str,
    status: str = "running",
    error_detail: str | None = None,
) -> None:
    """Insert a new step row when it starts; update it in place when it finishes.

    Non-fatal: a failure here must never break the analysis/sync run itself.
    """
    try:
        with engine.begin() as conn:
            conn.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            if status == "running":
                # Starting a later step means any earlier, still-open steps are done.
                conn.execute(text(
                    "UPDATE analysis_run_steps SET status = 'complete', finished_at = now(), "
                    "duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000 "
                    "WHERE tenant_id = :t AND version_id = :v AND step_number < :n AND finished_at IS NULL"
                ), {"t": tenant_id, "v": version_id, "n": step_number})
                # Idempotent: only insert if this step has no open row yet (repeated
                # "running" calls for the same step_number produce a single row).
                conn.execute(text(
                    "INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name, status) "
                    "SELECT :t, :v, :n, :name, 'running' "
                    "WHERE NOT EXISTS ("
                    "  SELECT 1 FROM analysis_run_steps "
                    "  WHERE tenant_id = :t AND version_id = :v AND step_number = :n AND finished_at IS NULL"
                    ")"
                ), {"t": tenant_id, "v": version_id, "n": step_number, "name": step_name})
            elif status == "failed":
                # Idempotency guarantees at most one open row per version, so the
                # open row (whichever step_number it's actually on) is the one that
                # failed — match on finished_at IS NULL alone, not step_number, so a
                # failure after a later step has already opened isn't lost against a
                # step_number that's no longer open.
                conn.execute(text(
                    "UPDATE analysis_run_steps SET status = 'failed', finished_at = now(), "
                    "duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000, error_detail = :err "
                    "WHERE tenant_id = :t AND version_id = :v AND finished_at IS NULL"
                ), {"err": error_detail, "t": tenant_id, "v": version_id})
            else:
                conn.execute(text(
                    "UPDATE analysis_run_steps SET status = :status, finished_at = now(), "
                    "duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000, error_detail = :err "
                    "WHERE tenant_id = :t AND version_id = :v AND step_number = :n AND finished_at IS NULL"
                ), {"status": status, "err": error_detail, "t": tenant_id, "v": version_id, "n": step_number})
    except Exception as exc:  # pragma: no cover - defensive, mirrors task_progress.py
        logger.warning("Failed to record run step %s for version %s: %s", step_number, version_id, exc)
