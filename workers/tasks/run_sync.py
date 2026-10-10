"""Core sync Celery task — download one sync profile's domain, score the batch, then run_checks.

The download itself is run_extraction (module-aware, one parquet per table,
each table released from memory once stored). This task only wraps it with
the sync bookkeeping: the sync_runs row, the AI batch-quality score on the
domain's anchor table (ai_sync_quality.py, BEFORE run_checks), the version's
sync metadata and the relationship discovery pass afterwards.
If ai_quality_score < 0.6, a batch-level WARNING finding is added to the version.
"""

import io
import json
import logging
import uuid

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import EXTRACT_TIME_LIMIT, celery_app
from api.services.run_steps import record_step
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.run_sync")


def _anchor_frame(tenant_id: str, prefix: str, domain: str, coverage: list[dict]) -> pd.DataFrame | None:
    """The domain's anchor table (checks/frames.py) read back from the bundle, or the
    first data table read when the domain has no anchor; None when nothing was stored."""
    from api.config import settings
    from checks.frames import _graph
    from workers.dataset import _client, _read, parquet_name

    live = [c["table"] for c in coverage if c["status"] == "live" and c.get("purpose", "data") == "data"]
    table = _graph()[1].get(domain)
    if table not in live:
        table = live[0] if live else None
    if table is None:
        return None
    return pd.read_parquet(io.BytesIO(_read(_client(), settings.minio_bucket_uploads, f"{prefix}{parquet_name(table)}")))


@celery_app.task(bind=True, name="workers.tasks.run_sync.run_sync",
                 soft_time_limit=EXTRACT_TIME_LIMIT, time_limit=EXTRACT_TIME_LIMIT + 60)
def run_sync(self, profile_id: str, tenant_id: str):
    """Execute a full sync cycle for one sync profile."""
    logger.info(f"run_sync started: profile_id={profile_id}, tenant_id={tenant_id}")

    engine = get_sync_engine()
    sync_run_id = str(uuid.uuid4())

    # Step 1: Load sync profile and system details
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

        # Create sync_runs record
        session.execute(
            text("""
                INSERT INTO sync_runs (id, tenant_id, profile_id, status)
                VALUES (:id, :tenant_id, :profile_id, 'running')
            """),
            {"id": sync_run_id, "tenant_id": tenant_id, "profile_id": profile_id},
        )
        session.commit()

        # Load profile
        result = session.execute(
            text("""
                SELECT sp.domain, sp.ai_anomaly_baseline, ss.name as system_name, ss.id as system_id
                FROM sync_profiles sp
                JOIN sap_systems ss ON sp.system_id = ss.id
                WHERE sp.id = :pid AND sp.tenant_id = :tid AND sp.active = true
            """),
            {"pid": profile_id, "tid": tenant_id},
        )
        profile_row = result.fetchone()

        if not profile_row:
            _fail_sync_run(engine, tenant_id, sync_run_id, "Sync profile not found or inactive")
            return {"status": "failed", "error": "profile_not_found"}

        domain = profile_row[0]
        ai_baseline = profile_row[1]
        system_name = profile_row[2]
        system_id = str(profile_row[3])

    # Step 2: Download the domain (connection, credentials, tables, storage: run_extraction).
    # Direct call: runs here, under this task's time limits, as one job.
    version_id = str(uuid.uuid4())
    prefix = f"staging/{tenant_id}/{version_id}/"
    # Imported here: run_extraction imports celery_app, which imports this module.
    from workers.tasks.run_extraction import run_extraction

    try:
        result = run_extraction(tenant_id, system_id, [domain], analyse=False,
                                label=f"Sync {system_name}", version_id=version_id)
    except Exception as e:
        _fail_sync_run(engine, tenant_id, sync_run_id, f"Extraction failed: {str(e)[:300]}",
                       version_id=version_id)
        return {"status": "failed", "error": "extraction_failed"}
    if result.get("status") != "success":
        _fail_sync_run(engine, tenant_id, sync_run_id, f"Extraction failed: {result.get('error') or 'no data'}",
                       version_id=version_id)
        return {"status": "failed", "error": result.get("error") or "no_data"}
    coverage = result.get("coverage") or []
    total_rows = sum(int(c.get("rows") or 0) for c in coverage
                     if c["status"] == "live" and c.get("purpose", "data") == "data")

    # Step 3: Run AI sync quality on the anchor table BEFORE checks
    from workers.tasks.ai_sync_quality import compute_sync_quality, build_baseline

    anchor = _anchor_frame(tenant_id, prefix, domain, coverage)
    if anchor is None:
        _fail_sync_run(engine, tenant_id, sync_run_id, "No data extracted from any table", version_id=version_id)
        return {"status": "failed", "error": "no_data"}
    # a baseline from the old merged-frame sync shares no columns with the anchor: start over
    if ai_baseline and not set(ai_baseline.get("columns") or []) & set(anchor.columns):
        ai_baseline = None
    ai_quality_score, anomaly_flags = compute_sync_quality(anchor, ai_baseline)
    logger.info(f"AI sync quality score: {ai_quality_score}, flags: {len(anomaly_flags)}")

    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        # Establish the baseline on the first run
        if ai_baseline is None:
            session.execute(
                text("UPDATE sync_profiles SET ai_anomaly_baseline = CAST(:baseline AS jsonb) WHERE id = :pid"),
                {"baseline": json.dumps(build_baseline(anchor)), "pid": profile_id},
            )
        # Update sync_runs with AI quality results
        session.execute(
            text("""
                UPDATE sync_runs
                SET ai_quality_score = :score, anomaly_flags = CAST(:flags AS jsonb),
                    rows_extracted = :rows
                WHERE id = :rid
            """),
            {"score": ai_quality_score, "flags": json.dumps(anomaly_flags), "rows": total_rows, "rid": sync_run_id},
        )
        # Step 4: mark the version as a sync version; parquet_path is the bundle prefix
        # (workers/dataset.py reads a prefix as the per-table bundle)
        session.execute(
            text("""
                UPDATE analysis_versions
                SET metadata = metadata || CAST(:meta AS jsonb), status = 'pending'
                WHERE id = :vid AND tenant_id = :tid
            """),
            {"vid": version_id, "tid": tenant_id, "meta": json.dumps({
                "source": "sync", "sync_run_id": sync_run_id, "system_name": system_name,
                "domain": domain, "parquet_path": prefix,
            })},
        )
        session.commit()
    del anchor

    # Step 5: Run checks (reuse existing task logic)
    from api.services import jobs
    from workers.tasks.run_checks import run_checks
    jobs.start_job(tenant_id, version_id, "analysis", f"Sync {system_name}", status="queued",
                   progress_key=version_id, system_id=system_id, version_id=version_id)
    record_step(engine, tenant_id, version_id, 0, "Sync completed", status="running")
    record_step(engine, tenant_id, version_id, 0, "Sync completed", status="complete")
    run_checks.delay(version_id, tenant_id, prefix)
    logger.info(f"Enqueued run_checks for sync extraction: version={version_id}")

    # Step 6: Complete sync run
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        session.execute(
            text("""
                UPDATE sync_runs
                SET status = 'completed', completed_at = now()
                WHERE id = :rid
            """),
            {"rid": sync_run_id},
        )
        # Update profile last_run_at
        session.execute(
            text("UPDATE sync_profiles SET last_run_at = now() WHERE id = :pid"),
            {"pid": profile_id},
        )
        session.commit()

    # Step 7: Relationship discovery + AI impact scoring
    try:
        from api.services.relationship_discovery import (
            discover_relationships_from_data,
            run_ai_inference_pass,
        )

        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

            # Discover relationships from existing master_records data
            discovered = discover_relationships_from_data(tenant_id, domain, session)
            logger.info(f"Discovered {len(discovered)} relationships from data for domain '{domain}'")

            # Get keys of golden records updated in this sync run
            changed_result = session.execute(
                text("""
                    SELECT DISTINCT mr.sap_object_key
                    FROM master_records mr
                    JOIN master_record_history mrh ON mr.id = mrh.master_record_id
                    WHERE mr.tenant_id = :tid AND mr.domain = :domain
                      AND mrh.changed_at >= (
                          SELECT started_at FROM sync_runs WHERE id = :srid
                      )
                """),
                {"tid": tenant_id, "domain": domain, "srid": sync_run_id},
            )
            changed_keys = [r[0] for r in changed_result.fetchall()]

            if changed_keys:
                run_ai_inference_pass(tenant_id, domain, changed_keys, session)
                logger.info(f"AI inference pass complete for {len(changed_keys)} changed keys")

    except Exception as e:
        logger.warning(f"Relationship discovery failed (non-fatal): {e}")

    # Add batch-level warning if AI quality score is low
    if ai_quality_score < 0.6:
        logger.warning(f"Low AI quality score ({ai_quality_score}) — batch warning added")
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(
                text("""
                    INSERT INTO findings (
                        id, version_id, tenant_id, module, check_id, severity,
                        dimension, affected_count, total_count, pass_rate, details
                    ) VALUES (
                        gen_random_uuid(), :vid, :tid, :module, 'SYNC_QUALITY_WARNING',
                        'warning', 'completeness', :affected, :total, :rate,
                        CAST(:details AS jsonb)
                    )
                    ON CONFLICT (version_id, check_id, tenant_id) DO NOTHING
                """),
                {
                    "vid": version_id,
                    "tid": tenant_id,
                    "module": domain,
                    "affected": total_rows,
                    "total": total_rows,
                    "rate": ai_quality_score,
                    "details": json.dumps({
                        "message": f"Batch quality score below threshold: {ai_quality_score}",
                        "anomaly_flags": anomaly_flags,
                    }),
                },
            )
            session.commit()

    logger.info(f"run_sync complete: profile_id={profile_id}, sync_run_id={sync_run_id}")
    return {
        "status": "completed",
        "sync_run_id": sync_run_id,
        "version_id": version_id,
        "rows_extracted": total_rows,
        "ai_quality_score": ai_quality_score,
    }


def _fail_sync_run(engine, tenant_id: str, sync_run_id: str, error_detail: str,
                   version_id: str | None = None) -> None:
    """Mark a sync run as failed.

    ``version_id`` is the analysis_versions row this sync run was downloading into
    (known from Step 2 onward); when given, the decisive failure is also recorded
    as a step-0 row in ``analysis_run_steps`` so the run detail page can show why
    a sync-type run died.
    """
    logger.error(f"Sync run {sync_run_id} failed: {error_detail}")
    if version_id:
        record_step(engine, tenant_id, version_id, 0, "Sync failed", status="running")
        record_step(engine, tenant_id, version_id, 0, "Sync failed", status="failed", error_detail=error_detail)
    try:
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(
                text("""
                    UPDATE sync_runs
                    SET status = 'failed', error_detail = :err, completed_at = now()
                    WHERE id = :rid
                """),
                {"err": error_detail, "rid": sync_run_id},
            )
            session.commit()
    except Exception as e:
        logger.error(f"Failed to update sync_runs status: {e}")
