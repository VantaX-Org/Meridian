"""Golden-record build task.

Registers the records in an uploaded analysis version as ``master_records`` so
the Golden Records workbench reflects the customer's real, uploaded data.

Fanned out from ``run_checks`` per module — the same way dedup / cleaning are.
For each module it locates the object-key column (PARTNER, MATNR, LIFNR, ...),
groups the uploaded parquet by that key, and feeds each object to
``golden_record_engine.process_sync_batch`` — the existing deterministic
survivorship engine, which writes ``master_records`` + ``master_record_history``.

Operates only on uploaded rows — no seed data.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from workers.celery_app import celery_app

logger = logging.getLogger("meridian.worker.golden_records")

# Object-key column candidates, in priority order. Mirrors the identifier
# detection used by run_checks' column-pruning and the dedup miner.
_KEY_CANDIDATES = (
    "PARTNER", "MATNR", "LIFNR", "KUNNR", "USERID",
    "EQUNR", "ANLN1", "EBELN", "VBELN",
)


def _bare(col: str) -> str:
    """Reduce a ``TABLE.FIELD`` / ``TABLE_FIELD`` column name to its bare field."""
    return str(col).split(".")[-1].rsplit("_", 1)[-1].upper()


def _find_key_column(df: pd.DataFrame) -> str | None:
    """Locate the object-key column for a module's uploaded data, or None."""
    bare = {c: _bare(c) for c in df.columns}
    for candidate in _KEY_CANDIDATES:
        for col, b in bare.items():
            if b == candidate:
                return col
    return None


def _clean_value(v):
    """Convert a pandas/numpy cell value to a JSON-friendly Python native."""
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, "item"):  # numpy scalar
        try:
            return v.item()
        except Exception:
            return str(v)
    return v


def _rows_to_incoming(group: pd.DataFrame, source_system: str) -> list[dict]:
    """Turn the upload rows for one object key into engine ``incoming_records``."""
    extracted = datetime.now(timezone.utc).isoformat()
    records: list[dict] = []
    for _, row in group.iterrows():
        fields = {
            str(col): _clean_value(val)
            for col, val in row.items()
            if not str(col).startswith("_")
        }
        records.append(
            {
                "source_system": source_system,
                "extracted_at": extracted,
                "fields": fields,
                "confidence": 1.0,
            }
        )
    return records


def _load_parquet(parquet_path: str) -> pd.DataFrame:
    """Download an uploaded parquet from MinIO into a DataFrame."""
    from minio import Minio

    client = Minio(
        endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
        access_key=os.getenv("MINIO_ACCESS_KEY", "meridian"),
        secret_key=os.getenv("MINIO_SECRET_KEY", ""),
        secure=False,
    )
    bucket = os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads")
    response = client.get_object(bucket, parquet_path)
    try:
        data = response.read()
    finally:
        response.close()
        response.release_conn()
    return pd.read_parquet(io.BytesIO(data))


async def _build_for_module(
    version_id: str,
    tenant_id: str,
    module: str,
    df: pd.DataFrame,
    key_col: str,
) -> int:
    """Feed each object key's rows to the survivorship engine. Returns count."""
    from api.services.golden_record_engine import process_sync_batch

    url = os.getenv("DATABASE_URL") or os.getenv("DATABASE_URL_SYNC", "")
    if not url:
        raise RuntimeError("DATABASE_URL not configured")
    # process_sync_batch needs an async session — ensure an asyncpg URL.
    if "+asyncpg" not in url and url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(url, pool_pre_ping=True)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    source_system = f"upload:{str(version_id)[:8]}"
    built = 0
    try:
        async with maker() as db:
            # Commit the RLS GUC in its own transaction so it survives the
            # engine's per-object internal commits/rollbacks.
            await db.execute(
                text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)}
            )
            await db.commit()

            for key_value, group in df.groupby(key_col, sort=False):
                key_str = str(key_value).strip()
                if not key_str or key_str.lower() in ("nan", "none", "nat"):
                    continue
                incoming = _rows_to_incoming(group, source_system)
                # process_sync_batch swallows its own errors and returns None,
                # so one bad object never aborts the rest of the module.
                record_id = await process_sync_batch(
                    db, str(tenant_id), module, key_str, incoming
                )
                if record_id:
                    built += 1
    finally:
        await engine.dispose()
    return built


@celery_app.task(
    bind=True,
    name="workers.tasks.build_golden_records.build_golden_records",
    soft_time_limit=900,
    time_limit=1020,
)
def build_golden_records(
    self, version_id: str, tenant_id: str, module: str, parquet_path: str
) -> dict:
    """Build ``master_records`` for one module of an uploaded analysis version."""
    logger.info(
        "build_golden_records started: version=%s tenant=%s module=%s",
        version_id, tenant_id, module,
    )
    df = _load_parquet(parquet_path)

    key_col = _find_key_column(df)
    if not key_col:
        logger.info(
            "build_golden_records: no object-key column for module=%s — "
            "nothing matched %s; skipping",
            module, ", ".join(_KEY_CANDIDATES),
        )
        return {
            "version_id": version_id,
            "module": module,
            "records": 0,
            "status": "skipped_no_key",
        }

    built = asyncio.run(
        _build_for_module(version_id, tenant_id, module, df, key_col)
    )
    logger.info(
        "build_golden_records complete: module=%s key_col=%s master_records=%d",
        module, key_col, built,
    )
    return {
        "version_id": version_id,
        "module": module,
        "key_column": key_col,
        "records": built,
        "status": "complete",
    }
