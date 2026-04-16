"""Core sync Celery task — extract data from SAP via RFC, run AI quality checks, then run_checks.

Reads sync_profile, decrypts credentials from system_credentials using tenant-scoped AES-256,
opens RFC connection, extracts all domain tables, merges into DataFrame.
Calls ai_sync_quality.py BEFORE run_checks.py.
If ai_quality_score < 0.6, adds a batch-level WARNING finding to all findings in this run.
"""

import io
import json
import logging
import os
import re
import traceback
import uuid
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.run_sync")


def _get_minio_client():
    from minio import Minio
    return Minio(
        endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
        access_key=os.getenv("MINIO_ACCESS_KEY", "meridian"),
        secret_key=os.getenv("MINIO_SECRET_KEY", ""),
        secure=False,
    )


@celery_app.task(bind=True, name="workers.tasks.run_sync.run_sync",
                 soft_time_limit=600, time_limit=660)
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
                SELECT sp.domain, sp.tables, sp.ai_anomaly_baseline,
                       ss.host, ss.client, ss.sysnr, ss.name as system_name,
                       ss.id as system_id
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
        tables = profile_row[1] or []
        ai_baseline = profile_row[2]
        host = profile_row[3]
        client = profile_row[4]
        sysnr = profile_row[5]
        system_name = profile_row[6]
        system_id = str(profile_row[7])

        # Load encrypted credentials
        result = session.execute(
            text("SELECT encrypted_password FROM system_credentials WHERE system_id = :sid"),
            {"sid": system_id},
        )
        cred_row = result.fetchone()
        if not cred_row:
            _fail_sync_run(engine, tenant_id, sync_run_id, "No credentials found for system")
            return {"status": "failed", "error": "no_credentials"}

        encrypted_password = cred_row[0]

    # Step 2: Decrypt credentials
    try:
        from api.services.credential_store import decrypt_password
        password = decrypt_password(tenant_id, encrypted_password)
    except Exception as e:
        _fail_sync_run(engine, tenant_id, sync_run_id, f"Credential decryption failed: {e}")
        return {"status": "failed", "error": "decryption_failed"}

    # Step 3: Connect to SAP and extract data
    from sap import get_connector
    from sap.base import SAPConnectionParams, SAPConnectorError, SAPConnector

    rfc_user = os.getenv("SAP_RFC_USER", "RFC_USER")

    params = SAPConnectionParams(
        host=host,
        client=client,
        sysnr=sysnr,
        user=rfc_user,
        password=password,
    )

    all_dfs = []
    total_rows = 0

    try:
        with get_connector() as conn:
            conn.connect(params)

            for table_name in tables:
                try:
                    df = conn.read_table(table_name, fields=[], max_rows=0)
                    if not df.empty:
                        df["_source_table"] = table_name
                        all_dfs.append(df)
                        total_rows += len(df)
                    logger.info(f"Extracted {len(df)} rows from {table_name}")
                except SAPConnectorError as e:
                    safe_msg = SAPConnector._mask_password(str(e), password)
                    logger.warning(f"Failed to extract {table_name}: {safe_msg}")

            # Step 3b: RFC relationship discovery (while conn is still open)
            try:
                from api.services.relationship_discovery import discover_relationships_rfc
                with Session(engine) as rfc_session:
                    rfc_session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                    rfc_discovered = discover_relationships_rfc(conn, tenant_id, domain, rfc_session)
                    logger.info(f"RFC relationship discovery: {len(rfc_discovered)} relationships found")
            except Exception as e:
                logger.warning(f"RFC relationship discovery failed (non-fatal): {e}")

    except SAPConnectorError as e:
        safe_msg = SAPConnector._mask_password(str(e), password)
        if "pyrfc_not_installed" in str(e):
            _fail_sync_run(engine, tenant_id, sync_run_id, "PyRFC is not installed")
            return {"status": "failed", "error": "pyrfc_not_installed"}
        _fail_sync_run(engine, tenant_id, sync_run_id, f"SAP connector failed: {safe_msg}")
        return {"status": "failed", "error": "rfc_error"}
    finally:
        password = ""  # clear from memory

    if not all_dfs:
        _fail_sync_run(engine, tenant_id, sync_run_id, "No data extracted from any table")
        return {"status": "failed", "error": "no_data"}

    # Step 4: Merge DataFrames
    merged_df = pd.concat(all_dfs, ignore_index=True)
    logger.info(f"Total rows extracted: {total_rows} from {len(all_dfs)} tables")

    # Step 5: Run AI sync quality BEFORE checks
    from workers.tasks.ai_sync_quality import compute_sync_quality, build_baseline

    ai_quality_score, anomaly_flags = compute_sync_quality(merged_df, ai_baseline)
    logger.info(f"AI sync quality score: {ai_quality_score}, flags: {len(anomaly_flags)}")

    # Update baseline if this is the first run
    if ai_baseline is None:
        new_baseline = build_baseline(merged_df)
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(
                text("UPDATE sync_profiles SET ai_anomaly_baseline = CAST(:baseline AS jsonb) WHERE id = :pid"),
                {"baseline": json.dumps(new_baseline), "pid": profile_id},
            )
            session.commit()

    # Update sync_runs with AI quality results
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        session.execute(
            text("""
                UPDATE sync_runs
                SET ai_quality_score = :score, anomaly_flags = CAST(:flags AS jsonb),
                    rows_extracted = :rows
                WHERE id = :rid
            """),
            {
                "score": ai_quality_score,
                "flags": json.dumps(anomaly_flags),
                "rows": total_rows,
                "rid": sync_run_id,
            },
        )
        session.commit()

    # Step 6: Apply column mapping and store parquet
    from api.services.column_mapper import apply_column_mapping

    mapped_df = apply_column_mapping(merged_df, domain)

    file_id = str(uuid.uuid4())
    parquet_buffer = io.BytesIO()
    mapped_df.to_parquet(parquet_buffer, index=False)
    parquet_bytes = parquet_buffer.getvalue()
    parquet_path = f"staging/{tenant_id}/{file_id}.parquet"

    from api.services.storage import upload_file as minio_upload
    bucket = os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads")
    minio_upload(bucket, parquet_path, parquet_bytes, "application/octet-stream")

    # Step 7: Create analysis_versions record
    version_id = str(uuid.uuid4())
    metadata = {
        "source": "sync",
        "system_name": system_name,
        "domain": domain,
        "tables": tables,
        "row_count": total_rows,
        "columns": list(mapped_df.columns),
        "modules": [domain],
        "parquet_path": parquet_path,
        "sync_run_id": sync_run_id,
    }

    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        session.execute(
            text("""
                INSERT INTO analysis_versions (id, tenant_id, metadata, status)
                VALUES (:vid, :tid, CAST(:meta AS jsonb), 'pending')
            """),
            {"vid": version_id, "tid": tenant_id, "meta": json.dumps(metadata)},
        )
        session.commit()

    # Step 8: Run checks (reuse existing task logic)
    from workers.tasks.run_checks import run_checks
    run_checks.delay(version_id, tenant_id, parquet_path)
    logger.info(f"Enqueued run_checks for sync extraction: version={version_id}")

    # Step 9: Complete sync run
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

    # Step 10: Relationship discovery + AI impact scoring
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


def _fail_sync_run(engine, tenant_id: str, sync_run_id: str, error_detail: str) -> None:
    """Mark a sync run as failed."""
    logger.error(f"Sync run {sync_run_id} failed: {error_detail}")
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
