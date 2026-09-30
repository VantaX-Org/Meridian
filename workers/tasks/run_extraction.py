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
import uuid

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.extraction")


@celery_app.task(
    bind=True,
    name="workers.tasks.run_extraction.run_extraction",
    soft_time_limit=3000,
    time_limit=3060,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_extraction(self, tenant_id, system_id, modules, include_config=True, sync_type="both",
                   scope=None, analyse=True, label=None):
    """Download ``modules`` (business objects) from ``system_id`` into a new version.

    The version is stored as ``extracted`` with its objects, scope and per-object
    record counts; analysis runs now when ``analyse`` else on request
    (POST /api/v1/versions/{id}/analyse). Every download is a new version.
    """
    engine = get_sync_engine()
    version_id = str(uuid.uuid4())
    try:
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            from api.services.connectivity_manager import ConnectivityManager

            manager = ConnectivityManager(session, tenant_id)
            if sync_type == "config":
                return manager.sync_config(system_id, modules)

            frames, coverage = manager.extract(system_id, modules, scope=scope)
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
                logger.error(f"Extraction from {system_id} produced no data tables: {coverage}")
                return {"status": "failed", "coverage": coverage}

            from api.config import settings
            from api.services.storage import upload_file

            prefix = f"staging/{tenant_id}/{version_id}/"
            for table, df in data_tables.items():
                buf = io.BytesIO()
                df.astype("string").to_parquet(buf, index=False)
                # Upload failure fails the extraction — never report success
                # for data the checks cannot read.
                upload_file(settings.minio_bucket_uploads, f"{prefix}{table}.parquet", buf.getvalue())

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
                })},
            )
            session.commit()

            failed = {c["table"] for c in coverage if c["status"] == "failed"}
            _mark_modules(session, tenant_id, system_id, modules, "partial" if failed else "success",
                          int(sum(len(d) for d in data_tables.values())))

        if analyse:
            from workers.tasks.run_checks import run_checks
            run_checks.delay(version_id, tenant_id, prefix)
        logger.info(f"Extraction {version_id}: {len(data_tables)} tables, analysis {'enqueued' if analyse else 'on request'}")
        return {"status": "success", "version_id": version_id, "coverage": coverage}

    except SoftTimeLimitExceeded:
        logger.error("Extraction task timed out")
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            _mark_modules(session, tenant_id, system_id, modules, "failed", 0)
        return {"status": "failed", "error": "timeout"}


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
