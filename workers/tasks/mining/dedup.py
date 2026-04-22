"""Deduplication mining task — finds duplicate records across SAP entities.

Uses configurable blocking keys (e.g., email + name) and scoring to
detect potential duplicates that should be consolidated.

For WS13 from Meridian v3.0 spec §6.
"""

import logging
import hashlib
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.mining.dedup")

# Blocking key field combinations per module
BLOCKING_KEYS = {
    "business_partner": ["BUT000.PARTNER", "BUT000.BU_TYPE"],
    "material_master": ["MARA.MATNR", "MARA.MTART"],
    "employee_central": ["empemployment.userId", "empemployment.startDate"],
}


def _compute_record_hash(df: pd.DataFrame, key_fields: list[str]) -> pd.Series:
    """Compute a hash of key field values for blocking."""
    hash_input = df[key_fields].astype(str).apply(lambda row: "|".join(row), axis=1)
    return hash_input.apply(lambda x: hashlib.md5(x.encode()).hexdigest())


def _find_potential_duplicates(df: pd.DataFrame, module: str) -> list[dict]:
    """Find potential duplicates using blocking keys.
    
    Returns list of {record_a, record_b, match_score, blocking_key} dicts.
    """
    blocking_fields = BLOCKING_KEYS.get(module, [])
    
    if not blocking_fields:
        # No blocking keys configured — try to use first available column
        if len(df.columns) > 0:
            blocking_fields = [df.columns[0]]
        else:
            return []
    
    # Filter to available columns
    available = [f for f in blocking_fields if f in df.columns]
    if not available:
        return []
    
    # Compute blocking hash
    blocking_hash = _compute_record_hash(df, available)
    df = df.copy()
    df["_blocking_hash"] = blocking_hash
    
    # Find groups with multiple records (potential duplicates)
    duplicate_groups = df.groupby("_blocking_hash").filter(lambda x: len(x) > 1)
    
    if len(duplicate_groups) == 0:
        return []
    
    # Generate pairs within each blocking group
    duplicates = []
    for block_hash, group in duplicate_groups.groupby("_blocking_hash"):
        if len(group) < 2:
            continue
        
        # Get identifier columns for records
        id_col = _get_id_column(group)
        
        records = group.to_dict("records")
        for i in range(len(records)):
            for j in range(i + 1, len(records)):
                dup = {
                    "record_a": str(records[i].get(id_col, records[i])),
                    "record_b": str(records[j].get(id_col, records[j])),
                    "match_score": _compute_match_score(records[i], records[j]),
                    "blocking_key": block_hash,
                    "module": module,
                    "id_field": id_col,
                    "matched_fields": _get_matched_fields(records[i], records[j]),
                }
                duplicates.append(dup)
    
    return duplicates


def _get_id_column(df: pd.DataFrame) -> str:
    """Get the best identifier column from the dataframe."""
    candidates = ["PARTNER", "MATNR", "USERID", "LIFNR", "KUNNR", "id"]
    for col in candidates:
        if col in df.columns:
            return col
    return df.columns[0] if len(df.columns) > 0 else "id"


def _compute_match_score(record_a: dict, record_b: dict) -> float:
    """Compute a simple match score (0-1) based on field similarity."""
    if record_a == record_b:
        return 1.0
    
    common_keys = set(record_a.keys()) & set(record_b.keys())
    if not common_keys:
        return 0.0
    
    matches = sum(1 for k in common_keys if str(record_a.get(k, "")) == str(record_b.get(k, "")))
    return round(matches / len(common_keys), 2)


def _get_matched_fields(record_a: dict, record_b: dict) -> list[str]:
    """Get list of fields that match between two records."""
    matches = []
    common_keys = set(record_a.keys()) & set(record_b.keys())
    for key in common_keys:
        if str(record_a.get(key, "")) == str(record_b.get(key, "")):
            matches.append(key)
    return matches


@celery_app.task(bind=True, name="workers.tasks.mining.dedup.run_dedup",
                 soft_time_limit=600, time_limit=720)
def run_dedup(self, version_id: str, tenant_id: str, module: str, parquet_path: str, *,
              id_column: Optional[str] = None):
    """Find and record potential duplicate records.
    
    Args:
        version_id: Analysis version ID
        tenant_id: Tenant ID for RLS
        module: SAP module to check for duplicates
        parquet_path: Path to parquet file in MinIO
        id_column: Optional explicit ID column (overrides detection)
    """
    logger.info(f"run_dedup started: version_id={version_id}, tenant_id={tenant_id}, module={module}")
    
    engine = get_sync_engine()
    
    try:
        # Download parquet from MinIO
        from minio import Minio
        import os
        
        minio_client = Minio(
            endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
            access_key=os.getenv("MINIO_ACCESS_KEY", "meridian"),
            secret_key=os.getenv("MINIO_SECRET_KEY", ""),
            secure=False,
        )
        
        bucket = os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads")
        response = minio_client.get_object(bucket, parquet_path)
        parquet_bytes = response.read()
        response.close()
        response.release_conn()
        
        import io
        df = pd.read_parquet(io.BytesIO(parquet_bytes))
        logger.info(f"Loaded {len(df)} records for dedup check")
        
        # Find potential duplicates
        duplicates = _find_potential_duplicates(df, module)
        
        # Record duplicates in DB
        import json as _json
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

            for dup in duplicates:
                session.execute(
                    text("""
                        INSERT INTO data_duplicates (
                            id, tenant_id, version_id, module_id,
                            record_a, record_b, match_score,
                            blocking_key, id_field, matched_fields, detected_at
                        ) VALUES (
                            gen_random_uuid(), :tid, :vid, :mod,
                            :rec_a, :rec_b, :score,
                            :blocking_key, :id_field, CAST(:matched AS jsonb), now()
                        )
                        ON CONFLICT ON CONSTRAINT uq_data_duplicates_pair DO NOTHING
                    """),
                    {
                        "tid": tenant_id,
                        "vid": version_id,
                        "mod": module,
                        "rec_a": dup["record_a"],
                        "rec_b": dup["record_b"],
                        "score": dup["match_score"],
                        "blocking_key": dup.get("blocking_key"),
                        "id_field": dup["id_field"],
                        "matched": _json.dumps(dup["matched_fields"]),
                    },
                )

            session.commit()
        
        logger.info(f"run_dedup complete: found {len(duplicates)} potential duplicates for {module}")
        return {
            "version_id": version_id,
            "module": module,
            "duplicates_found": len(duplicates),
            "status": "complete",
        }
        
    except Exception as e:
        logger.error(f"run_dedup failed: {e}", exc_info=True)
        raise
