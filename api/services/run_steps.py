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
                conn.execute(text(
                    "INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name, status) "
                    "VALUES (:t, :v, :n, :name, 'running')"
                ), {"t": tenant_id, "v": version_id, "n": step_number, "name": step_name})
            else:
                conn.execute(text(
                    "UPDATE analysis_run_steps SET status = :status, finished_at = now(), "
                    "duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000, error_detail = :err "
                    "WHERE tenant_id = :t AND version_id = :v AND step_number = :n"
                ), {"status": status, "err": error_detail, "t": tenant_id, "v": version_id, "n": step_number})
    except Exception as exc:  # pragma: no cover - defensive, mirrors task_progress.py
        logger.warning("Failed to record run step %s for version %s: %s", step_number, version_id, exc)
