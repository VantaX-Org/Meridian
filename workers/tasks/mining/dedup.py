"""Deduplication mining task — near-duplicate pairs for the Dedup page (data_duplicates).

Pairs come from the match pipeline's blocking (workers/tasks/run_match.py): the same
block keys and name comparison as the similarity rules, so the Dedup page and the
steward merge queue show the same pairs. Modules the match pipeline does not cover
produce no pairs. Exact primary-key duplicates are cleaning_engine's exact_pk.
"""

import logging
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.mining.dedup")


def _find_potential_duplicates(df: pd.DataFrame, module: str) -> list[dict]:
    """Near-duplicate pairs within each block.

    Returns list of {record_a, record_b, match_score, blocking_key, module, id_field, matched_fields}.
    """
    from workers.tasks.run_match import MATCH_KEYS, candidate_pairs

    if module not in MATCH_KEYS:
        return []
    id_col, name_col, block_by = MATCH_KEYS[module]
    if any(c not in df.columns for c in (id_col, name_col, *block_by)):
        return []
    pairs, _ = candidate_pairs(df, module)
    out = []
    for a, b, score in pairs:
        ra, rb = df.loc[a].to_dict(), df.loc[b].to_dict()
        if str(ra[id_col]) == str(rb[id_col]):
            continue
        out.append({
            "record_a": str(ra[id_col]),
            "record_b": str(rb[id_col]),
            "match_score": round(score, 2),
            "blocking_key": "|".join(str(ra[c]).strip().upper() for c in block_by),
            "module": module,
            "id_field": id_col,
            "matched_fields": _get_matched_fields(ra, rb),
        })
    return out


def _get_matched_fields(record_a: dict, record_b: dict) -> list[str]:
    """Get list of fields that match between two records."""
    matches = []
    common_keys = set(record_a.keys()) & set(record_b.keys())
    for key in common_keys:
        if str(record_a.get(key, "")) == str(record_b.get(key, "")):
            matches.append(key)
    return matches


@celery_app.task(bind=True, name="workers.tasks.mining.dedup.run_dedup",
                 soft_time_limit=1800, time_limit=2100)
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
        # Load the module's records (flat upload or extraction bundle)
        from workers.dataset import load_module_frame
        df = load_module_frame(parquet_path, module)
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
