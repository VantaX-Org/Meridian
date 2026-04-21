"""Anomaly detection mining task — finds statistical outliers in SAP data.

Uses IQR (Interquartile Range) and Z-score methods to detect anomalous
values in numeric fields, which may indicate data quality issues.

For WS13 from Meridian v3.0 spec §6.
"""

import logging
from typing import Optional

import pandas as pd
import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.mining.anomaly")

# Numeric field patterns per module (heuristic detection)
NUMERIC_FIELD_PATTERNS = [
    "AMOUNT", "QTY", "QUANTITY", "PRICE", "VALUE", "RATE", "WEIGHT",
    "VOLUME", "COUNT", "SCORE", "PCT", "PERCENT"
]


def _is_numeric_field(col_name: str) -> bool:
    """Check if column name suggests a numeric field."""
    upper = col_name.upper()
    return any(pat in upper for pat in NUMERIC_FIELD_PATTERNS)


def _detect_outliers_iqr(series: pd.Series, multiplier: float = 1.5) -> pd.Series:
    """Detect outliers using IQR method.
    
    Returns boolean Series where True = outlier.
    """
    if len(series) < 4:
        return pd.Series([False] * len(series), index=series.index)
    
    q1 = series.quantile(0.25)
    q3 = series.quantile(0.75)
    iqr = q3 - q1
    
    lower_bound = q1 - multiplier * iqr
    upper_bound = q3 + multiplier * iqr
    
    return (series < lower_bound) | (series > upper_bound)


def _detect_outliers_zscore(series: pd.Series, threshold: float = 3.0) -> pd.Series:
    """Detect outliers using Z-score method.
    
    Returns boolean Series where True = outlier.
    """
    if len(series) < 3:
        return pd.Series([False] * len(series), index=series.index)
    
    mean = series.mean()
    std = series.std()
    
    if std == 0:
        return pd.Series([False] * len(series), index=series.index)
    
    z_scores = np.abs((series - mean) / std)
    return z_scores > threshold


def _find_anomalies(df: pd.DataFrame, module: str, method: str = "iqr") -> list[dict]:
    """Find statistical anomalies in numeric fields.
    
    Args:
        df: Input dataframe
        module: SAP module name
        method: Detection method ('iqr', 'zscore', or 'both')
    
    Returns:
        List of {field, value, z_score_or_iqr, record_index, severity} dicts
    """
    anomalies = []
    
    for col in df.columns:
        if not _is_numeric_field(col):
            continue
        
        try:
            series = pd.to_numeric(df[col], errors="coerce")
            if series.isna().all():
                continue
            
            # Detect outliers
            if method in ("iqr", "both"):
                outliers_iqr = _detect_outliers_iqr(series)
                for idx in series[outliers_iqr].index:
                    val = series[idx]
                    if pd.isna(val):
                        continue
                    q1 = series.quantile(0.25)
                    q3 = series.quantile(0.75)
                    iqr = q3 - q1
                    anomalies.append({
                        "field": col,
                        "value": float(val),
                        "detection_method": "iqr",
                        "record_index": int(idx),
                        "severity": _compute_severity(val, series),
                        "module": module,
                        "bounds": {
                            "lower": float(q1 - 1.5 * iqr),
                            "upper": float(q3 + 1.5 * iqr),
                        },
                    })
            
            if method in ("zscore", "both"):
                outliers_zs = _detect_outliers_zscore(series)
                for idx in series[outliers_zs].index:
                    val = series[idx]
                    if pd.isna(val):
                        continue
                    mean = series.mean()
                    std = series.std()
                    z_score = (val - mean) / std if std > 0 else 0
                    anomalies.append({
                        "field": col,
                        "value": float(val),
                        "detection_method": "zscore",
                        "z_score": float(z_score),
                        "record_index": int(idx),
                        "severity": _compute_severity(val, series),
                        "module": module,
                    })
                    
        except Exception as e:
            logger.debug(f"Skipping column {col} for anomaly detection: {e}")
            continue
    
    # Sort by severity
    anomalies.sort(key=lambda x: (["low", "medium", "high", "critical"].index(x["severity"])))
    
    return anomalies[:500]  # Cap at 500 anomalies per module


def _compute_severity(value: float, series: pd.Series) -> str:
    """Compute severity based on distance from typical values."""
    mean = series.mean()
    std = series.std()
    
    if std == 0:
        return "low"
    
    z = abs(value - mean) / std
    
    if z > 5:
        return "critical"
    elif z > 4:
        return "high"
    elif z > 3:
        return "medium"
    else:
        return "low"


@celery_app.task(bind=True, name="workers.tasks.mining.anomaly.run_anomaly",
                 soft_time_limit=600, time_limit=720)
def run_anomaly(self, version_id: str, tenant_id: str, module: str, parquet_path: str, *,
                method: Optional[str] = None):
    """Detect anomalous values in numeric fields.
    
    Args:
        version_id: Analysis version ID
        tenant_id: Tenant ID for RLS
        module: SAP module to check
        parquet_path: Path to parquet file in MinIO
        method: Detection method ('iqr', 'zscore', or 'both')
    """
    logger.info(f"run_anomaly started: version_id={version_id}, tenant_id={tenant_id}, module={module}")
    
    engine = get_sync_engine()
    method = method or "both"
    
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
        logger.info(f"Loaded {len(df)} records for anomaly detection")
        
        # Find anomalies
        anomalies = _find_anomalies(df, module, method)
        
        # Record anomalies in DB
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            
            for anomaly in anomalies:
                session.execute(
                    text("""
                        INSERT INTO data_anomalies (
                            id, tenant_id, version_id, module_id,
                            field_name, field_value, record_index,
                            detection_method, z_score, severity,
                            bounds_json, detected_at
                        ) VALUES (
                            gen_random_uuid(), :tid, :vid, :mod,
                            :field, :value, :record_idx,
                            :method, :z_score, :severity,
                            CAST(:bounds AS jsonb), now()
                        )
                        ON CONFLICT DO NOTHING
                    """),
                    {
                        "tid": tenant_id,
                        "vid": version_id,
                        "mod": module,
                        "field": anomaly["field"],
                        "value": anomaly["value"],
                        "record_idx": anomaly["record_index"],
                        "method": anomaly["detection_method"],
                        "z_score": anomaly.get("z_score"),
                        "severity": anomaly["severity"],
                        "bounds": anomaly.get("bounds", {}),
                    },
                )
            
            session.commit()
        
        logger.info(f"run_anomaly complete: found {len(anomalies)} anomalies for {module}")
        return {
            "version_id": version_id,
            "module": module,
            "anomalies_found": len(anomalies),
            "status": "complete",
        }
        
    except Exception as e:
        logger.error(f"run_anomaly failed: {e}", exc_info=True)
        raise
