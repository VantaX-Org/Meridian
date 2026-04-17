"""Celery task: run cleaning detection after check suite completes.

Enqueued by run_checks.py after checks complete successfully.
A cleaning failure must never affect the analysis result stored in findings.
"""

import io
import json
import logging
import traceback

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.cleaning")


def _get_minio_client():
    import os
    from minio import Minio
    return Minio(
        endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
        access_key=os.getenv("MINIO_ACCESS_KEY", "meridian"),
        secret_key=os.getenv("MINIO_SECRET_KEY", ""),
        secure=False,
    )


@celery_app.task(bind=True, name="workers.tasks.run_cleaning.run_cleaning",
                 soft_time_limit=300, time_limit=360)
def run_cleaning(self, version_id: str, tenant_id: str, object_type: str, parquet_path: str):
    """Detect cleaning candidates for a completed analysis run."""
    logger.info(f"run_cleaning started: version_id={version_id}, object_type={object_type}")

    try:
        # Load parquet from MinIO
        import os
        minio_client = _get_minio_client()
        bucket = os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads")
        response = minio_client.get_object(bucket, parquet_path)
        parquet_bytes = response.read()
        response.close()
        response.release_conn()

        df = pd.read_parquet(io.BytesIO(parquet_bytes))
        logger.info(f"Loaded DataFrame for cleaning: {len(df)} rows")

        # Run cleaning detection
        from api.services.cleaning_engine import CleaningEngine
        engine = CleaningEngine()
        candidates = engine.detect_candidates(df, object_type, version_id, tenant_id)

        if not candidates:
            logger.info(f"run_cleaning complete: version_id={version_id}, candidates=0")
            return {"version_id": version_id, "candidates": 0}

        # Bulk insert into cleaning_queue
        db_engine = get_sync_engine()
        with Session(db_engine) as session:
            session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

            # Golden record batch lookup — one query, not per-record
            record_keys = list({c['record_key'] for c in candidates})
            golden_map: dict[str, dict] = {}
            if record_keys:
                # Batch in groups of 500 to avoid query size limits
                for batch_start in range(0, len(record_keys), 500):
                    batch = record_keys[batch_start:batch_start + 500]
                    placeholders = ', '.join(f':k{i}' for i in range(len(batch)))
                    params = {'tid': tenant_id, 'domain': object_type}
                    params.update({f'k{i}': k for i, k in enumerate(batch)})
                    result = session.execute(text(f"""
                        SELECT sap_object_key, id, golden_fields
                        FROM master_records
                        WHERE tenant_id = :tid
                          AND domain = :domain
                          AND status = 'golden'
                          AND sap_object_key IN ({placeholders})
                    """), params)
                    for row in result.fetchall():
                        golden_map[row[0]] = {'id': str(row[1]), 'golden_fields': row[2] or {}}

            # Enrich each candidate with golden record data
            for c in candidates:
                gr = golden_map.get(c['record_key'])
                if gr:
                    c['golden_record_id'] = gr['id']
                    field_name = c.get('field_name') or c.get('check_id', '')
                    c['golden_field_value'] = gr['golden_fields'].get(field_name)
                else:
                    c['golden_record_id'] = None
                    c['golden_field_value'] = None

            for c in candidates:
                # Separate dedup candidates
                if c.get("category") == "dedup" and c.get("merge_preview"):
                    # Insert into dedup_candidates
                    keys = c["record_key"].split("|")
                    key_a = keys[0] if len(keys) > 0 else ""
                    key_b = keys[1] if len(keys) > 1 else ""
                    session.execute(
                        text("""
                            INSERT INTO dedup_candidates (
                                id, tenant_id, object_type, record_key_a, record_key_b,
                                match_score, match_method, match_fields, status
                            ) VALUES (
                                gen_random_uuid(), :tid, :ot, :ka, :kb,
                                :score, :method, CAST(:fields AS jsonb), 'pending'
                            )
                        """),
                        {
                            "tid": tenant_id,
                            "ot": c["object_type"],
                            "ka": key_a,
                            "kb": key_b,
                            "score": c["confidence"],
                            "method": c.get("match_method", "fuzzy"),
                            "fields": json.dumps(c.get("match_fields", {})),
                        },
                    )

                # Insert all candidates into cleaning_queue
                session.execute(
                    text("""
                        INSERT INTO cleaning_queue (
                            id, tenant_id, rule_id, object_type, status, confidence,
                            record_key, record_data_before, record_data_after,
                            merge_preview, priority, version_id,
                            golden_record_id, golden_field_value
                        ) VALUES (
                            gen_random_uuid(), :tid, :rid, :ot, 'detected', :conf,
                            :rk, CAST(:before AS jsonb), CAST(:after AS jsonb),
                            CAST(:mp AS jsonb), :pri, :vid,
                            CAST(:grid AS uuid), :gfv
                        )
                    """),
                    {
                        "tid": tenant_id,
                        "rid": c.get("rule_id"),
                        "ot": c["object_type"],
                        "conf": c["confidence"],
                        "rk": c["record_key"],
                        "before": json.dumps(c.get("record_data_before") or {}),
                        "after": json.dumps(c.get("record_data_after") or {}),
                        "mp": json.dumps(c.get("merge_preview") or {}),
                        "pri": c.get("priority", 50),
                        "vid": version_id,
                        "grid": c.get("golden_record_id"),
                        "gfv": c.get("golden_field_value"),
                    },
                )

            session.commit()

        # Create notification for cleaning candidates
        try:
            from api.services.notifications import create_notification_sync
            with Session(db_engine) as notif_session:
                notif_session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
                create_notification_sync(
                    tenant_id=tenant_id,
                    user_id=None,
                    type="cleaning",
                    title=f"{len(candidates)} cleaning items need review",
                    body=f"Cleaning detection found {len(candidates)} candidates for {object_type}.",
                    link="/cleaning",
                    session=notif_session,
                )
                notif_session.commit()
        except Exception as e:
            logger.warning(f"Failed to create cleaning notification (non-fatal): {e}")

        # Populate stewardship queue so stewards see items immediately
        try:
            from workers.tasks.populate_stewardship_queue import populate_stewardship_queue
            populate_stewardship_queue.delay(tenant_id)
            logger.info(f"Enqueued populate_stewardship_queue for tenant_id={tenant_id}")
        except Exception as e:
            logger.warning(f"Failed to enqueue populate_stewardship_queue (non-fatal): {e}")

        logger.info(f"run_cleaning complete: version_id={version_id}, candidates={len(candidates)}")
        return {"version_id": version_id, "candidates": len(candidates)}

    except Exception as e:
        # Cleaning failure must never affect analysis results
        logger.error(f"run_cleaning failed (non-fatal): {traceback.format_exc()}")
        return {"version_id": version_id, "candidates": 0, "error": str(e)}
