"""Relationship detection mining task — discovers foreign key relationships in SAP data.

Analyzes candidate key pairs across tables to detect potential relationships
that aren't documented in the data dictionary. Useful for understanding
cross-entity dependencies.

For WS13 from Meridian v3.0 spec §6.
"""

import logging
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.mining.relationship")

# Common SAP foreign key patterns
FK_PATTERNS = {
    "BUT000": "but_fk",
    "KNA1": "kna_fk",
    "LFA1": "lfa_fk",
    "MARA": "mara_fk",
    "MBEW": "mbew_fk",
    "EKKO": "ekko_fk",
    "EKPO": "ekpo_fk",
    "VBAK": "vbak_fk",
    "VBAP": "vbap_fk",
}


def _is_key_field(col_name: str) -> bool:
    """Check if column name looks like a key field."""
    upper = col_name.upper()
    key_indicators = ["PARTNER", "MATNR", "LIFNR", "KUNNR", "EBELN", "EBELP", "VBELN", "POSNR", "KUNNR"]
    return any(ind in upper for ind in key_indicators)


def _is_foreign_key(col_name: str) -> bool:
    """Check if column name looks like a foreign key (reference to another table)."""
    upper = col_name.upper()
    fk_indicators = ["_ID", "_KEY", "MANDT"]
    return any(ind in upper for ind in fk_indicators)


def _compute_cardinality(series_a: pd.Series, series_b: pd.Series) -> dict:
    """Compute cardinality metrics between two series.
    
    Returns dict with one_to_one, one_to_many, many_to_one, and match_ratio.
    """
    # Value counts
    counts_a = series_a.value_counts()
    counts_b = series_b.value_counts()
    
    # Cardinality ratios
    unique_a = len(counts_a)
    unique_b = len(counts_b)
    total_a = len(series_a)
    total_b = len(series_b)
    
    # Null counts
    null_a = series_a.isna().sum()
    null_b = series_b.isna().sum()
    
    # Match ratio (how many values in a exist in b)
    common = set(series_a.dropna().unique()) & set(series_b.dropna().unique())
    match_ratio = len(common) / max(unique_a, 1)
    
    # Determine relationship type
    avg_count_b = (counts_b.value_counts().mean() if len(counts_b) > 0 else 1)
    
    if match_ratio > 0.8 and unique_a < total_a * 0.1:
        rel_type = "one_to_one"
    elif avg_count_b > 1:
        rel_type = "one_to_many"
    elif avg_count_b < 1:
        rel_type = "many_to_one"
    else:
        rel_type = "undetermined"
    
    return {
        "unique_values_a": unique_a,
        "unique_values_b": unique_b,
        "total_a": total_a,
        "total_b": total_b,
        "null_a": int(null_a),
        "null_b": int(null_b),
        "match_ratio": round(match_ratio, 3),
        "relationship_type": rel_type,
        "avg_cardinality_b": round(avg_count_b, 2),
    }


def _detect_relationships(df: pd.DataFrame, module: str, max_pairs: int = 100) -> list[dict]:
    """Detect potential relationships between columns.
    
    Args:
        df: Input dataframe
        module: SAP module name
        max_pairs: Maximum number of pairs to analyze (for performance)
    
    Returns:
        List of {field_a, field_b, cardinality, strength, relationship_type} dicts
    """
    relationships = []
    
    # Get key columns
    key_cols = [c for c in df.columns if _is_key_field(c) or _is_foreign_key(c)]
    
    # Get numeric and categorical columns
    other_cols = [c for c in df.columns if c not in key_cols and not c.startswith("_")]
    
    # Pair key columns with other columns
    pairs_to_check = []
    for key_col in key_cols[:10]:  # Limit key columns
        for other_col in other_cols[:20]:  # Limit other columns
            pairs_to_check.append((key_col, other_col))
    
    # Limit total pairs for performance
    if len(pairs_to_check) > max_pairs:
        # Sample pairs
        import random
        pairs_to_check = random.sample(pairs_to_check, max_pairs)
    
    for col_a, col_b in pairs_to_check:
        try:
            # Convert to string for comparison
            series_a = df[col_a].astype(str)
            series_b = df[col_b].astype(str)
            
            # Skip if mostly null or constant
            if series_a.isna().mean() > 0.9 or series_b.isna().mean() > 0.9:
                continue
            
            if series_a.nunique() == 1 or series_b.nunique() == 1:
                continue
            
            # Compute cardinality
            cardinality = _compute_cardinality(series_a, series_b)
            
            # Only report if there's meaningful relationship
            if cardinality["match_ratio"] > 0.1:
                # Calculate strength score
                strength = _compute_relationship_strength(cardinality)
                
                if strength > 0.3:  # Only report moderate to strong relationships
                    relationships.append({
                        "field_a": col_a,
                        "field_b": col_b,
                        "cardinality": cardinality,
                        "strength": strength,
                        "module": module,
                    })
                    
        except Exception as e:
            logger.debug(f"Skipping pair ({col_a}, {col_b}): {e}")
            continue
    
    # Sort by strength
    relationships.sort(key=lambda x: -x["strength"])
    
    return relationships[:50]  # Cap at 50 relationships


def _compute_relationship_strength(cardinality: dict) -> float:
    """Compute a relationship strength score (0-1)."""
    match_ratio = cardinality["match_ratio"]
    rel_type = cardinality["relationship_type"]
    
    # Base strength from match ratio
    strength = match_ratio * 0.5
    
    # Adjust for relationship type
    if rel_type == "one_to_one":
        strength += 0.4
    elif rel_type == "one_to_many":
        strength += 0.3
    elif rel_type == "many_to_one":
        strength += 0.2
    
    # Penalty for nulls
    null_penalty = (cardinality["null_a"] + cardinality["null_b"]) / (cardinality["total_a"] + cardinality["total_b"])
    strength -= null_penalty * 0.2
    
    return max(0.0, min(1.0, strength))


@celery_app.task(bind=True, name="workers.tasks.mining.relationship.run_relationship",
                 soft_time_limit=600, time_limit=720)
def run_relationship(self, version_id: str, tenant_id: str, module: str, parquet_path: str, *,
                     max_pairs: Optional[int] = None):
    """Detect potential relationships between columns.
    
    Args:
        version_id: Analysis version ID
        tenant_id: Tenant ID for RLS
        module: SAP module to analyze
        parquet_path: Path to parquet file in MinIO
        max_pairs: Maximum pairs to analyze (default 100)
    """
    logger.info(f"run_relationship started: version_id={version_id}, tenant_id={tenant_id}, module={module}")
    
    engine = get_sync_engine()
    max_pairs = max_pairs or 100
    
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
        logger.info(f"Loaded {len(df)} records for relationship detection")
        
        # Detect relationships
        relationships = _detect_relationships(df, module, max_pairs)
        
        # Record relationships in DB
        import json as _json
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

            for rel in relationships:
                session.execute(
                    text("""
                        INSERT INTO data_relationships (
                            id, tenant_id, version_id, module_id,
                            field_a, field_b, relationship_type,
                            cardinality_json, strength_score, detected_at
                        ) VALUES (
                            gen_random_uuid(), :tid, :vid, :mod,
                            :field_a, :field_b, :rel_type,
                            CAST(:cardinality AS jsonb), :strength, now()
                        )
                        ON CONFLICT ON CONSTRAINT uq_data_relationships_fields DO NOTHING
                    """),
                    {
                        "tid": tenant_id,
                        "vid": version_id,
                        "mod": module,
                        "field_a": rel["field_a"],
                        "field_b": rel["field_b"],
                        "rel_type": rel["cardinality"]["relationship_type"],
                        "cardinality": _json.dumps({
                            "unique_a": rel["cardinality"]["unique_values_a"],
                            "unique_b": rel["cardinality"]["unique_values_b"],
                            "match_ratio": rel["cardinality"]["match_ratio"],
                        }),
                        "strength": rel["strength"],
                    },
                )

            session.commit()
        
        logger.info(f"run_relationship complete: found {len(relationships)} relationships for {module}")
        return {
            "version_id": version_id,
            "module": module,
            "relationships_found": len(relationships),
            "status": "complete",
        }
        
    except Exception as e:
        logger.error(f"run_relationship failed: {e}", exc_info=True)
        raise
