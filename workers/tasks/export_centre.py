"""Celery task: build one export centre file (api/services/export_centre.py) and keep it in the report history.

POST /reports/exports registers an "export" job (api/services/jobs.py) and queues ``run_export``; the job's
stages (read, write, store) reach the browser on the existing jobs stream. Idempotent on the job id: a retry
or a duplicate delivery whose file is already in report_files finishes the job with that file instead of
building a second one. Deterministic, no LLM.
"""

from __future__ import annotations

import logging
from typing import Optional

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import export_centre
from api.services import report_history as rh
from api.services.jobs import finish_job, update_job
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.export_centre")


def existing_file(session: Session, tenant_id: str, job_id: str) -> Optional[str]:
    row = session.execute(text(
        "SELECT id FROM report_files WHERE tenant_id = CAST(:t AS uuid) AND params->>'job_id' = :j LIMIT 1"),
        {"t": str(tenant_id), "j": job_id}).first()
    return str(row[0]) if row else None


def export_once(session: Session, tenant_id: str, job_id: str, dataset: str, params: dict,
                user_id: Optional[str] = None, email: Optional[str] = None) -> dict:
    """Build, store and return {"report_file_id", "file_name"}; the stored file when this job already made one."""
    done = existing_file(session, tenant_id, job_id)
    if done:
        return {"report_file_id": done, "file_name": None, "reused": True}

    def tick(stage: str, pct: int) -> None:
        update_job(tenant_id, job_id, stage=stage, percent=pct)

    gen = export_centre.build(session, tenant_id, dataset, params, progress=tick)
    if gen is None:
        return {"report_file_id": None, "file_name": None}
    tick("store", 90)
    file_id = rh.store_report_file(
        session, tenant_id, kind=f"export_{dataset}", data=gen.data, file_name=gen.file_name,
        content_type=gen.content_type, version_id=gen.version_id, params={**params, "job_id": job_id},
        source="download", created_by=user_id, created_by_email=email,
        name=f"{export_centre.DATASETS[dataset].name} export")
    session.commit()
    return {"report_file_id": file_id, "file_name": gen.file_name}


@celery_app.task(name="workers.tasks.export_centre.run_export", soft_time_limit=900, time_limit=960)
def run_export(tenant_id: str, job_id: str, dataset: str, params: dict,
               user_id: Optional[str] = None, email: Optional[str] = None) -> dict:
    try:
        update_job(tenant_id, job_id, stage="read", percent=1)
        with tenant_session(get_sync_engine(), tenant_id) as session:
            res = export_once(session, tenant_id, job_id, dataset, params, user_id, email)
    except SoftTimeLimitExceeded:
        finish_job(tenant_id, job_id, status="failed", error="timed out", message="The export took too long.")
        return {"status": "failed"}
    except rh.NoRun:
        finish_job(tenant_id, job_id, status="failed", error="no_run", message="No finished run in this scope yet.")
        return {"status": "failed"}
    except Exception as e:
        logger.error(f"export {job_id} failed: {type(e).__name__}")
        finish_job(tenant_id, job_id, status="failed", error=type(e).__name__, message="The export failed.")
        return {"status": "failed"}
    if not res["report_file_id"]:
        finish_job(tenant_id, job_id, status="failed", error="empty", result=res,
                   message="Nothing to export, or the file could not be kept.")
        return {"status": "failed", **res}
    finish_job(tenant_id, job_id, result=res, message="Export ready")
    return {"status": "completed", **res}
