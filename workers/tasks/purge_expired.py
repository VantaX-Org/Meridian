"""Nightly retention purge (beat: 02:30 UTC, workers/scheduler.py).

Per tenant, applies the retention policy (api/services/retention.py) through
api/services/purge.py:

* versions the policy selects are purged one by one;
* report rows (and their PDF objects) older than ``reports_days`` are removed;
* audit rows older than ``audit_days`` are removed.

Dry-run gate. Every run writes purge_log rows. Real deletes happen only when
``MERIDIAN_PURGE_ENABLED=true`` *and* the tenant's oldest dry-run purge_log row
is at least DRY_RUN_DAYS old, so an operator always has a week of nightly
previews in the purge log before anything is deleted. Until then the task writes
dry-run rows only. The task is idempotent: a version purged tonight is not
selected tomorrow, and a dry run changes nothing but the log.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text

from workers.celery_app import celery_app

logger = logging.getLogger("meridian.purge_expired")


def enforcement_allowed(session: Any, tenant_id: str, now: Optional[datetime] = None,
                        flag_enabled: Optional[bool] = None) -> bool:
    """True when this tenant has passed the dry-run window and the env flag is on."""
    from api.services.retention import enforcement, oldest_dry_run

    return bool(enforcement(oldest_dry_run(session, tenant_id), now, flag_enabled)["enforced"])


def _purge_reports(session: Any, tenant_id: str, days: int, now: datetime, dry_run: bool) -> dict[str, Any]:
    """Report rows older than ``days`` plus their PDF objects. Returns the purge_log shape."""
    from api.config import settings
    from api.services import storage
    from api.services.purge import write_audit_row, write_purge_log

    cutoff = now - timedelta(days=days)
    rows = session.execute(text(
        "SELECT id, pdf_path FROM reports WHERE tenant_id = :t AND generated_at < :cutoff"),
        {"t": tenant_id, "cutoff": cutoff}).fetchall()
    if not rows:
        return {"rows_by_table": {}, "bytes_freed": 0, "purge_log_id": None}
    counts = {"reports": len(rows)}
    freed = 0
    errors: list[str] = []
    if dry_run:
        for _, path in rows:
            if path:
                try:
                    freed += storage.object_size(settings.minio_bucket_reports, path) or 0
                except Exception as e:  # noqa: BLE001
                    errors.append(f"stat {path}: {e}")
        log_id = write_purge_log(session, tenant_id, "reports", None, True, counts, freed, None, None)
        session.commit()
        return {"rows_by_table": counts, "bytes_freed": freed, "purge_log_id": log_id}
    session.execute(text("DELETE FROM reports WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[]))"),
                    {"t": tenant_id, "ids": [str(r[0]) for r in rows]})
    log_id = write_purge_log(session, tenant_id, "reports", None, False, counts, 0, None, None)
    write_audit_row(session, tenant_id, None, "purge", "reports", "retention", {"rows": counts})
    session.commit()
    for _, path in rows:
        if not path:
            continue
        try:
            size = storage.object_size(settings.minio_bucket_reports, path)
            if size is not None:
                storage.delete_file(settings.minio_bucket_reports, path)
                freed += size
        except Exception as e:  # noqa: BLE001
            errors.append(f"delete {path}: {e}")
    extra = {"storage_errors": errors} if errors else {}
    session.execute(text("UPDATE purge_log SET bytes_freed = :b, rows_by_table = rows_by_table || CAST(:e AS jsonb) "
                         "WHERE id = :id"), {"b": freed, "e": json.dumps(extra), "id": log_id})
    session.commit()
    return {"rows_by_table": counts, "bytes_freed": freed, "purge_log_id": log_id}


def _purge_audit(session: Any, tenant_id: str, days: int, now: datetime, dry_run: bool) -> dict[str, Any]:
    from api.services.purge import write_purge_log

    cutoff = now - timedelta(days=days)
    p = {"t": tenant_id, "cutoff": cutoff}
    n = int(session.execute(text(
        "SELECT count(*) FROM audit_log WHERE tenant_id = :t AND created_at < :cutoff"), p).scalar() or 0)
    if not n:
        return {"rows_by_table": {}, "purge_log_id": None}
    if not dry_run:
        session.execute(text("DELETE FROM audit_log WHERE tenant_id = :t AND created_at < :cutoff"), p)
    log_id = write_purge_log(session, tenant_id, "audit", None, dry_run, {"audit_log": n}, 0, None, None)
    session.commit()
    return {"rows_by_table": {"audit_log": n}, "purge_log_id": log_id}


def run_for_tenant(session: Any, tenant_id: str, now: Optional[datetime] = None,
                   flag_enabled: Optional[bool] = None) -> dict[str, Any]:
    """Apply the policy for one tenant on an open tenant session. Returns a summary."""
    from api.services.purge import purge_version
    from api.services.retention import load_policy, select_expired_versions

    now = now or datetime.now(timezone.utc)
    policy = load_policy(session, tenant_id)
    enforce = enforcement_allowed(session, tenant_id, now, flag_enabled)
    dry_run = not enforce
    summary: dict[str, Any] = {"tenant_id": tenant_id, "dry_run": dry_run, "versions": 0, "blocked": 0,
                               "reports": 0, "audit": 0}
    for v in select_expired_versions(session, tenant_id, policy, now):
        r = purge_version(session, tenant_id, v.id, dry_run=dry_run, actor=None)
        if r["blocked_reason"]:
            summary["blocked"] += 1
        else:
            summary["versions"] += 1
    if policy.reports_days is not None:
        summary["reports"] = _purge_reports(session, tenant_id, policy.reports_days, now, dry_run)["rows_by_table"].get("reports", 0)
    if policy.audit_days is not None:
        summary["audit"] = _purge_audit(session, tenant_id, policy.audit_days, now, dry_run)["rows_by_table"].get("audit_log", 0)
    return summary


@celery_app.task(name="workers.tasks.purge_expired.purge_expired", soft_time_limit=3300, time_limit=3600)
def purge_expired() -> dict[str, Any]:
    from sqlalchemy.orm import Session

    from workers.db import get_sync_engine, tenant_session

    engine = get_sync_engine()
    with Session(engine) as session:
        tenant_ids = [str(r[0]) for r in session.execute(text("SELECT id FROM tenants")).fetchall()]
    out: dict[str, Any] = {"tenants": 0, "versions": 0, "blocked": 0, "dry_run_tenants": 0}
    for tid in tenant_ids:
        try:
            with tenant_session(engine, tid) as session:
                s = run_for_tenant(session, tid)
            out["tenants"] += 1
            out["versions"] += s["versions"]
            out["blocked"] += s["blocked"]
            out["dry_run_tenants"] += int(s["dry_run"])
            logger.info("purge_expired tenant=%s dry_run=%s versions=%d blocked=%d reports=%d audit=%d",
                        tid, s["dry_run"], s["versions"], s["blocked"], s["reports"], s["audit"])
        except Exception:  # noqa: BLE001 — one tenant must not stop the others
            logger.exception("purge_expired failed for tenant %s", tid)
    return out
