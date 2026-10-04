"""Celery task: extract a system's data for the selected modules, then run checks.

One analysis version per extraction (all modules together, so versions are
comparable run-to-run). Data is stored as a per-table parquet bundle
``staging/<tenant>/<version>/<TABLE>.parquet`` with ``TABLE.FIELD`` columns —
the exact shape the check engine evaluates at record grain. Per-table
coverage (rows, window, truncation, failures) is stored on the version.
"""

import io
from datetime import datetime, timezone
import json
import logging
import os
import uuid

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import jobs
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.workers.extraction")

# A full live read of a large object takes hours over RFC_READ_TABLE.
EXTRACT_TIME_LIMIT = int(os.getenv("MERIDIAN_EXTRACT_TIME_LIMIT", "21600"))


def progress_key(system_id) -> str:
    """Redis key of the running download's progress (GET /systems/{id}/versions)."""
    return f"extract:{system_id}"


@celery_app.task(
    bind=True,
    name="workers.tasks.run_extraction.run_extraction",
    soft_time_limit=EXTRACT_TIME_LIMIT,
    time_limit=EXTRACT_TIME_LIMIT + 60,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_extraction(self, tenant_id, system_id, modules, include_config=True, sync_type="both",
                   scope=None, analyse=True, label=None, version_id=None):
    """Download ``modules`` (business objects) from ``system_id`` into a new version.

    The version is stored as ``extracted`` with its objects, scope and per-object
    record counts; analysis runs now when ``analyse`` else on request
    (POST /api/v1/versions/{id}/analyse). Every download is a new version.
    Progress is reported to the job registry as job ``dl-<version_id>``
    (api/services/jobs.py); the caller may pre-register it as queued.
    """
    from api.services.task_progress import publish_progress

    engine = get_sync_engine()
    version_id = version_id or str(uuid.uuid4())
    job_id = f"dl-{version_id}"
    if jobs.get_job(tenant_id, job_id) is None:
        jobs.start_job(tenant_id, job_id, "extraction", label or ", ".join(modules), system_id=system_id,
                       modules=modules, version_id=version_id)
    jobs.update_job(tenant_id, job_id, stage="connect", message="Connecting to the system")
    # the system page's download bar reads this per-system key; the Runs tab reads the job
    started = {"job_id": job_id, "label": label, "objects": modules,
               "started_at": datetime.now(timezone.utc).isoformat()}

    def progress(p: dict, ttl: int = EXTRACT_TIME_LIMIT + 60) -> None:
        publish_progress(progress_key(system_id), {**started, "status": "running", **{k: v for k, v in p.items() if k != "tables"}}, ttl)

    progress({"step": "connecting", "percent": 0})
    try:
        with tenant_session(engine, tenant_id) as session:
            from api.services.connectivity_manager import ConnectivityManager

            manager = ConnectivityManager(session, tenant_id)
            if sync_type == "config":
                result = manager.sync_config(system_id, modules)
                jobs.finish_job(tenant_id, job_id, result=result)
                return result

            def _progress(p: dict) -> None:
                progress({"step": "reading", **p})
                tables = p.get("tables") or []
                jobs.update_job(tenant_id, job_id, stage="read", tables=tables,
                                rows_done=sum(t["rows"] for t in tables), rows_total=sum(t["expected"] or 0 for t in tables),
                                message=f"Reading {p['table']}" if p.get("table") else "Reading tables")

            frames, coverage = manager.extract(system_id, modules, scope=scope, progress=_progress)
            progress({"step": "saving", "percent": 99})
            jobs.update_job(tenant_id, job_id, stage="store", message="Storing data")
            # refresh the live configuration the value rules compare against
            from workers.tasks.run_discovery import _store_config
            for c in coverage:
                if c.get("purpose") == "config" and c["table"] in frames:
                    df = frames[c["table"]]
                    _store_config(session, tenant_id, system_id, "*", c["table"],
                                  df.rename(columns=lambda x: x.split(".", 1)[-1]).to_dict(orient="records"))
            data_tables = {t: df for t, df in frames.items()
                           if any(c["table"] == t and c.get("purpose", "data") == "data" for c in coverage)}
            if not data_tables:
                _mark_modules(session, tenant_id, system_id, modules, "failed", 0)
                progress({"status": "failed", "error": "No data tables were read"}, 3600)
                jobs.finish_job(tenant_id, job_id, "failed", error="No data table could be read",
                                result={"coverage": coverage})
                logger.error(f"Extraction from {system_id} produced no data tables: {coverage}")
                return {"status": "failed", "coverage": coverage}

            from api.config import settings
            from api.services.storage import upload_file

            prefix = f"staging/{tenant_id}/{version_id}/"
            total_rows = int(sum(len(d) for d in data_tables.values()))
            stored = 0
            for table, df in data_tables.items():
                buf = io.BytesIO()
                df.astype("string").to_parquet(buf, index=False)
                # Upload failure fails the extraction — never report success
                # for data the checks cannot read.
                upload_file(settings.minio_bucket_uploads, f"{prefix}{table}.parquet", buf.getvalue())
                stored += len(df)
                jobs.update_job(tenant_id, job_id, stage="store", rows_done=stored, rows_total=total_rows,
                                message=f"Stored {table}")
            jobs.update_job(tenant_id, job_id, stage="register", message="Registering version")

            from checks.frames import _graph
            anchors = _graph()[1]
            object_rows = {m: len(data_tables[anchors[m]]) for m in modules if anchors.get(m) in data_tables}
            session.execute(
                text("""
                    INSERT INTO analysis_versions (id, tenant_id, status, label, metadata)
                    VALUES (:vid, :tid, :st, :label, CAST(:meta AS jsonb))
                """),
                {"vid": version_id, "tid": tenant_id, "st": "pending" if analyse else "extracted",
                 "label": label, "meta": json.dumps({
                    "modules": modules, "source": "extraction", "system_id": system_id,
                    "scope": scope or {}, "downloaded_at": datetime.now(timezone.utc).isoformat(),
                    "dataset_path": prefix, "object_rows": object_rows,
                    "coverage": coverage, "row_count": int(sum(len(d) for d in data_tables.values())),
                    # every data table read completely (row count reconciled, no truncation, no paging drift)
                    "extraction_complete": all(c.get("complete", True) for c in coverage if c["status"] == "live")
                                           and not any(c["status"] == "failed" for c in coverage),
                })},
            )
            session.commit()

            failed = {c["table"] for c in coverage if c["status"] == "failed" or c.get("complete") is False}
            _mark_modules(session, tenant_id, system_id, modules, "partial" if failed else "success",
                          int(sum(len(d) for d in data_tables.values())))
            jobs.update_job(tenant_id, job_id, stage="register", message="Profiling tables for anomalies")
            _flag_anomalies(session, tenant_id, system_id, version_id, modules, data_tables, coverage)

        progress({"status": "complete", "percent": 100, "version_id": version_id}, 300)
        if analyse:
            from workers.tasks.run_checks import run_checks
            jobs.start_job(tenant_id, version_id, "analysis", label or ", ".join(modules), status="queued",
                           progress_key=version_id, system_id=system_id, version_id=version_id)
            run_checks.delay(version_id, tenant_id, prefix)
        jobs.finish_job(tenant_id, job_id, result={"version_id": version_id, "coverage": coverage,
                                                   "analysis": "queued" if analyse else "on_request"},
                        message="Download complete" + (" — analysis queued" if analyse else ""))
        logger.info(f"Extraction {version_id}: {len(data_tables)} tables, analysis {'enqueued' if analyse else 'on request'}")
        return {"status": "success", "version_id": version_id, "coverage": coverage}

    except SoftTimeLimitExceeded:
        logger.error("Extraction task timed out")
        progress({"status": "failed", "error": f"Timed out after {EXTRACT_TIME_LIMIT // 60} minutes"}, 3600)
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            _mark_modules(session, tenant_id, system_id, modules, "failed", 0)
        jobs.finish_job(tenant_id, job_id, "failed", error="Timed out")
        return {"status": "failed", "error": "timeout"}
    except Exception as e:
        progress({"status": "failed", "error": str(e)[:300]}, 3600)
        jobs.finish_job(tenant_id, job_id, "failed", error=str(e) or e.__class__.__name__)
        raise


def _mark_modules(session, tenant_id, system_id, modules, status, rows) -> None:
    for module in modules:
        session.execute(
            text("""
                INSERT INTO system_module_map (id, tenant_id, system_id, module, last_synced_at,
                                               last_sync_status, row_count, config_synced)
                VALUES (gen_random_uuid(), :tid, :sid, :mod, now(), :st, :cnt, true)
                ON CONFLICT (tenant_id, system_id, module)
                DO UPDATE SET last_synced_at = now(), last_sync_status = :st, row_count = :cnt
            """),
            {"tid": tenant_id, "sid": system_id, "mod": module, "st": status, "cnt": rows},
        )
    session.commit()


_FINDING_SQL = text("""
    INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension,
                          affected_count, total_count, pass_rate, details, finding_type)
    VALUES (gen_random_uuid(), :vid, :tid, :module, :check_id, :severity, :dimension,
            :affected, :total, NULL, CAST(:details AS jsonb), 'anomaly')
    ON CONFLICT (version_id, check_id, tenant_id) DO UPDATE SET
        module = EXCLUDED.module, severity = EXCLUDED.severity, dimension = EXCLUDED.dimension,
        affected_count = EXCLUDED.affected_count, total_count = EXCLUDED.total_count,
        details = EXCLUDED.details, finding_type = 'anomaly'
""")


def _flag_anomalies(session, tenant_id, system_id, version_id, modules, data_tables, coverage) -> None:
    """Profile every data table (checks/anomaly.py), store the profile as the next
    runs' baseline and record deviations from the system's previous extractions as
    findings of type 'anomaly'. Best effort: a failure here never fails the download."""
    from api.services.source_design import dictionary_for
    from checks import anomaly

    try:
        dictionary = dictionary_for(session, system_id)
        cov = {c["table"]: c for c in coverage}
        found = 0
        for table, df in data_tables.items():
            c = cov.get(table, {})
            profile = {**anomaly.profile_table(df, table, dictionary),
                       "window": c.get("window"), "truncated": bool(c.get("truncated"))}
            history = session.execute(text("""
                SELECT profile FROM table_profiles
                 WHERE tenant_id = :tid AND system_id = :sid AND table_name = :t AND version_id <> :vid
                 ORDER BY created_at DESC LIMIT :n
            """), {"tid": tenant_id, "sid": system_id, "t": table, "vid": version_id,
                   "n": anomaly.HISTORY}).scalars().all()[::-1]
            session.execute(text("""
                INSERT INTO table_profiles (tenant_id, version_id, system_id, table_name, row_count, profile)
                VALUES (:tid, :vid, :sid, :t, :rows, CAST(:p AS jsonb))
                ON CONFLICT (version_id, table_name) DO UPDATE SET row_count = EXCLUDED.row_count,
                                                                   profile = EXCLUDED.profile
            """), {"tid": tenant_id, "vid": version_id, "sid": system_id, "t": table,
                   "rows": profile["rows"], "p": json.dumps(profile)})
            module = next((m for m in c.get("modules", ()) if m in modules), modules[0])
            rows = [{"vid": version_id, "tid": tenant_id, "module": module, "check_id": anomaly.check_id(a),
                     "severity": a["severity"], "dimension": a["dimension"], "affected": a["affected"],
                     "total": a["total"], "details": json.dumps({k: a[k] for k in (
                         "message", "metric", "table", "field", "expected", "observed", "samples")})}
                    for a in anomaly.detect(table, profile, history, df, dictionary)]
            if rows:
                session.execute(_FINDING_SQL, rows)
            found += len(rows)
            session.commit()  # per table: a later failure keeps what is done
        logger.info(f"Extraction {version_id}: {len(data_tables)} tables profiled, {found} anomalies")
    except Exception as e:
        session.rollback()
        logger.warning(f"Extraction {version_id}: anomaly detection failed: {e}", exc_info=True)
