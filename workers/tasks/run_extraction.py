"""Celery task: module-aware extraction from any SAP system type."""

import io
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
    soft_time_limit=600,
    time_limit=660,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_extraction(self, tenant_id, system_id, modules, include_config=True,
                   sync_type="both"):
    """Extract data and config for modules, then run check pipeline."""
    engine = get_sync_engine()

    try:
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

            from api.services.connectivity_manager import ConnectivityManager
            manager = ConnectivityManager(session, tenant_id)

            for module in modules:
                try:
                    if sync_type in ("data", "both"):
                        data_df, config_frames = manager.extract_module(
                            system_id, module,
                            include_config=(sync_type == "both"),
                        )

                        row_count = len(data_df) if not data_df.empty else 0

                        if not data_df.empty:
                            # Store parquet to MinIO
                            version_id = str(uuid.uuid4())
                            parquet_buf = io.BytesIO()
                            data_df.to_parquet(parquet_buf, index=False)
                            parquet_bytes = parquet_buf.getvalue()

                            try:
                                from api.services.storage import upload_parquet
                                path = f"staging/{tenant_id}/{version_id}/{module}.parquet"
                                upload_parquet(path, parquet_bytes)
                            except Exception as e:
                                logger.warning(f"MinIO upload failed: {e}")

                            # Create analysis version
                            session.execute(
                                text("""
                                    INSERT INTO analysis_versions
                                        (id, tenant_id, status, metadata)
                                    VALUES (:vid, :tid, 'pending',
                                            CAST(:meta AS jsonb))
                                """),
                                {
                                    "vid": version_id,
                                    "tid": tenant_id,
                                    "meta": json.dumps({
                                        "modules": [module],
                                        "source": "extraction",
                                        "system_id": system_id,
                                    }),
                                },
                            )
                            session.commit()

                            # Enqueue check pipeline
                            from workers.tasks.run_checks import run_checks
                            run_checks.delay(tenant_id, version_id, [module])

                    elif sync_type == "config":
                        manager.sync_config(system_id, [module])
                        row_count = 0

                    # Update system_module_map
                    session.execute(
                        text("""
                            INSERT INTO system_module_map
                                (id, tenant_id, system_id, module,
                                 last_synced_at, last_sync_status,
                                 row_count, config_synced)
                            VALUES (gen_random_uuid(), :tid, :sid, :mod,
                                    now(), 'success', :cnt, :cfg)
                            ON CONFLICT (tenant_id, system_id, module)
                            DO UPDATE SET last_synced_at = now(),
                                          last_sync_status = 'success',
                                          row_count = :cnt,
                                          config_synced = :cfg
                        """),
                        {
                            "tid": tenant_id,
                            "sid": system_id,
                            "mod": module,
                            "cnt": row_count if sync_type != "config" else 0,
                            "cfg": sync_type in ("config", "both"),
                        },
                    )
                    session.commit()
                    logger.info(f"Extraction complete: {module} ({row_count} rows)")

                except SoftTimeLimitExceeded:
                    logger.error(f"Extraction timeout for {module}")
                    raise
                except Exception as e:
                    logger.error(f"Extraction failed for {module}: {e}")
                    session.execute(
                        text("""
                            INSERT INTO system_module_map
                                (id, tenant_id, system_id, module,
                                 last_synced_at, last_sync_status)
                            VALUES (gen_random_uuid(), :tid, :sid, :mod,
                                    now(), 'failed')
                            ON CONFLICT (tenant_id, system_id, module)
                            DO UPDATE SET last_synced_at = now(),
                                          last_sync_status = 'failed'
                        """),
                        {"tid": tenant_id, "sid": system_id, "mod": module},
                    )
                    session.commit()

    except SoftTimeLimitExceeded:
        logger.error("Extraction task timed out")
