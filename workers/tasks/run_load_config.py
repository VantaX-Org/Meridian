"""Celery task: read-only configuration load (all modules, one job) followed by process flow derivation."""

import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import jobs
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.load_config")


_SENTENCES = {
    "pyrfc_not_installed": "The SAP RFC library is not installed: build the API and worker images with INSTALL_PYRFC=true.",
}


def failure_sentence(error: str) -> str:
    """What the job line shows: a sentence, never a connector's internal code (``pyrfc_not_installed: ...``)."""
    code, sep, rest = error.partition(":")
    if sep and code in _SENTENCES:
        return _SENTENCES[code]
    if sep and code and code.replace("_", "").isalpha() and code.islower() and "_" in code:
        rest = rest.strip()
        return (rest[:1].upper() + rest[1:]) if rest else error
    return error


def _fail(session: Session, tenant_id: str, load_id: str, job_id: str, error: str) -> None:
    session.rollback()
    session.execute(text("UPDATE config_loads SET status = 'failed', error = :e, finished_at = now() "
                         "WHERE id = :lid AND tenant_id = :tid"), {"e": error, "lid": load_id, "tid": tenant_id})
    session.commit()
    jobs.finish_job(tenant_id, job_id, "failed", error=error)


@celery_app.task(
    bind=True,
    name="workers.tasks.run_load_config.run_load_config",
    soft_time_limit=1500,
    time_limit=1560,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_load_config(self, tenant_id, system_id, load_id, job_id):
    tenant_id = str(tenant_id)
    engine = get_sync_engine()
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": tenant_id})
        try:
            from api.services.connectivity_manager import ConnectivityManager

            system_type, role = session.execute(
                text("SELECT system_type, role FROM sap_systems WHERE id = :sid AND tenant_id = :tid"),
                {"sid": system_id, "tid": tenant_id}).fetchone() or (None, "source")
            # enqueue_config_load may have inserted this row already; a retry finds it too
            session.execute(
                text("INSERT INTO config_loads (id, tenant_id, system_id, system_type, role, origin, status) "
                     "VALUES (:lid, :tid, :sid, :st, :role, 'connection', 'running') "
                     "ON CONFLICT (id) DO UPDATE SET status = 'running', error = NULL, role = EXCLUDED.role"),
                {"lid": load_id, "tid": tenant_id, "sid": system_id, "st": system_type or "unknown", "role": role})
            session.commit()
            jobs.update_job(tenant_id, job_id, stage="read", message="Reading configuration")

            from api.services.config_areas import build_areas

            seen: list[str] = []

            def progress(done: int, total: int, name: str) -> None:
                if name and name not in seen:
                    seen.append(name)
                areas = build_areas(system_type or "", done=set(seen[:done]), current=name or None)
                jobs.update_job(tenant_id, job_id, stage="read", percent=int(90 * done / total) if total else 0,
                                message=f"Reading {name}" if name else "Storing snapshot", areas=areas)

            result = ConnectivityManager(session, tenant_id).load_config(system_id, load_id, progress)
            objects = session.execute(text("SELECT objects FROM config_loads WHERE id = :lid AND tenant_id = :tid"),
                                      {"lid": load_id, "tid": tenant_id}).scalar()
            jobs.update_job(tenant_id, job_id, areas=build_areas(system_type or "", objects or []))
            jobs.finish_job(tenant_id, job_id, "completed", result=result)
            return result
        except SoftTimeLimitExceeded:
            _fail(session, tenant_id, load_id, job_id, "Timed out")
            return {"error": "timeout"}
        except Exception as e:
            logger.error("Config load failed: %s", e)
            _fail(session, tenant_id, load_id, job_id, failure_sentence(str(e))[:200])
            return {"error": str(e)[:200]}
