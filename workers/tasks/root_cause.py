"""Celery task: root cause by origin of every finding of an analysed SAP version.

Runs after run_checks. It reads CDPOS/CDHDR/USR02 read-only over RFC for the failing
records (api/services/root_cause.py) and stores one row per check in
finding_root_causes, which GET /versions/{id}/findings/{check_id}/root-cause serves.
Uploaded and non-ABAP versions have no change documents and are skipped.
"""

import json
import logging

from sqlalchemy import text

from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.workers.root_cause")


@celery_app.task(bind=True, name="workers.tasks.root_cause.root_cause_findings",
                 soft_time_limit=1800, time_limit=1860)
def root_cause_findings(self, version_id: str, tenant_id: str) -> dict[str, int]:
    from api.services.connectivity_manager import ConnectivityManager
    from api.services.root_cause import root_causes
    from api.services.source_design import dictionary_for
    from sap.extraction_plan import ABAP_SYSTEM_TYPES

    engine = get_sync_engine()
    with tenant_session(engine, tenant_id) as session:
        p = {"v": version_id, "t": tenant_id}
        meta = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                               p).scalar() or {}
        system_id = meta.get("system_id")
        sysrow = session.execute(text("SELECT system_type, go_live FROM sap_systems WHERE id = :s AND tenant_id = :t"),
                                 {"s": system_id, "t": tenant_id}).fetchone() if system_id else None
        if sysrow is None or sysrow[0] not in ABAP_SYSTEM_TYPES:
            return {"checks": 0}
        go_live = sysrow[1].strftime("%Y%m%d") if sysrow[1] else None
        records: dict[tuple[str, str], list[str]] = {}
        for check_id, module, key in session.execute(text(
                "SELECT check_id, module, record_key FROM finding_records WHERE version_id = :v AND tenant_id = :t"), p):
            records.setdefault((module, check_id), []).append(key)
        manager = ConnectivityManager(session, tenant_id)
        results = root_causes(lambda table, fields, wheres: manager.read_rows(system_id, table, fields, wheres),
                              records, go_live, dictionary_for(session, system_id, sysrow[0]))
        session.execute(text("DELETE FROM finding_root_causes WHERE version_id = :v AND tenant_id = :t"), p)
        for r in results:
            session.execute(text("""
                INSERT INTO finding_root_causes
                    (tenant_id, version_id, check_id, status, field, analysed, total, origins, summary, detail)
                VALUES (:t, :v, :cid, :st, :f, :a, :n, CAST(:o AS jsonb), :s, :d)
            """), {**p, "cid": r.check_id, "st": r.status, "f": r.field, "a": r.analysed, "n": r.total,
                   "o": json.dumps(r.origins), "s": r.summary, "d": r.detail})
        session.commit()
    logger.info(f"root cause {version_id}: {len(results)} checks")
    return {"checks": len(results)}
