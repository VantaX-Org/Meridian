"""SAP live connector — extract data directly from SAP via the pluggable connector layer.

Raw SAP data is NEVER persisted. Only findings are stored in Postgres.
The SAP password is NEVER logged or stored.
"""

import io
import logging
import re
import uuid
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

router = APIRouter(prefix="/api/v1", tags=["connect"])
logger = logging.getLogger("meridian.connect")

RATE_LIMIT_SECONDS = 5 * 60

# ── ABAP injection prevention ────────────────────────────────────────────────
_SAFE_WHERE = re.compile(
    r"^[A-Z0-9_]+ (=|<>|<|>|<=|>=|LIKE|IN) '([^']|'')*'"
    r"( (AND|OR) [A-Z0-9_]+ (=|<>|<|>|<=|>=|LIKE|IN) '([^']|'')*')*$",
    re.IGNORECASE,
)
_BLOCKED = re.compile(r"SELECT|EXEC|CALL|FUNCTION|--|/\*|SUBMIT", re.IGNORECASE)


def validate_rfc_where(where: str | None) -> str | None:
    """Validate RFC WHERE clause against ABAP injection.

    Only permits simple field comparisons: FIELD = 'VALUE', FIELD LIKE 'VALUE%'.
    Rejects SQL/ABAP keywords and unsafe character sequences.
    """
    if where is None:
        return None
    stripped = where.strip()
    if not stripped:
        return None
    if _BLOCKED.search(stripped):
        raise HTTPException(status_code=422, detail="Invalid WHERE clause")
    if not _SAFE_WHERE.match(stripped):
        raise HTTPException(
            status_code=422, detail="WHERE clause format not permitted"
        )
    return stripped


# ── Redis-backed rate limiting ────────────────────────────────────────────────


def _check_rfc_rate_limit(tenant_id: str) -> None:
    """Raises 429 if tenant has exceeded 1 RFC connection per 5 minutes.

    Uses Redis INCR + EXPIRE for persistence across API restarts.
    Falls back to allow-through if Redis is unreachable.
    """
    try:
        import redis as _redis
        from api.config import settings

        r = _redis.Redis.from_url(settings.redis_url, decode_responses=True)
        key = f"rate_limit:rfc:{tenant_id}"
        count = r.incr(key)
        if count == 1:
            r.expire(key, RATE_LIMIT_SECONDS)
        if count > 1:
            ttl = r.ttl(key)
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limited",
                    "detail": f"Max 1 live connection per 5 min. Retry in {ttl}s.",
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Rate limit Redis unavailable: {e} — allowing request")


class SAPConnectionRequest(BaseModel):
    host: str
    client: str = Field(..., description="SAP client number, e.g. '100'")
    user: str
    password: str = Field(..., description="SAP password — NEVER logged or stored")
    sysnr: str = Field(..., description="SAP system number, e.g. '00'")
    module: str = Field(..., description="Which module to run checks against")
    table: str = Field(..., description="SAP table to read, e.g. 'BUT000'")
    fields: list[str] = Field(..., description="List of field names to extract")
    where: Optional[str] = Field(None, description="Optional WHERE clause for RFC_READ_TABLE")


class SAPConnectionResponse(BaseModel):
    version_id: str
    status: str
    row_count: int


def _mask_password(msg: str, password: str) -> str:
    """Remove any occurrence of the password from error messages."""
    if password:
        msg = msg.replace(password, "****")
    return msg


@router.post("/connect", response_model=SAPConnectionResponse)
async def connect_sap(
    body: SAPConnectionRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Extract data from SAP via RFC_READ_TABLE and run checks.

    Raw SAP data is never persisted — only findings are stored.
    """
    tenant_key = str(tenant.id)

    # Rate limiting: Redis-backed, persists across restarts
    _check_rfc_rate_limit(tenant_key)

    # ── Connect and extract via SAP connector ──────────────────────────────
    from sap import get_connector
    from sap.base import SAPConnectionParams, SAPConnectorError

    params = SAPConnectionParams(
        host=body.host,
        client=body.client,
        sysnr=body.sysnr,
        user=body.user,
        password=body.password,
    )
    validated_where = validate_rfc_where(body.where)

    try:
        with get_connector() as conn:
            conn.connect(params)
            df = conn.read_table(body.table, body.fields, validated_where)
    except SAPConnectorError as e:
        safe_msg = _mask_password(str(e), body.password)
        logger.error(f"SAP connector failed: {safe_msg}")
        # Preserve existing error key and HTTP status for API compatibility
        if "pyrfc_not_installed" in str(e):
            raise HTTPException(
                status_code=501,
                detail={
                    "error": "pyrfc_not_installed",
                    "detail": "PyRFC is not installed. Build the API image with INSTALL_PYRFC=true.",
                },
            )
        raise HTTPException(
            status_code=422,
            detail={"error": "rfc_error", "detail": safe_msg},
        )

    if df.empty:
        raise HTTPException(
            status_code=422,
            detail={"error": "no_data", "detail": "RFC_READ_TABLE returned no rows."},
        )

    row_count = len(df)
    logger.debug(f"RFC extracted {row_count} rows from {body.table} for tenant {tenant_key}")
    logger.info(f"RFC extraction complete: {row_count} rows")

    # Apply column mapping (same pipeline as CSV upload)
    from api.services.column_mapper import apply_column_mapping

    df = apply_column_mapping(df, body.module)

    # Store as parquet in MinIO for check engine (temporary — not raw SAP data persistence)
    file_id = str(uuid.uuid4())
    parquet_buffer = io.BytesIO()
    df.to_parquet(parquet_buffer, index=False)
    parquet_bytes = parquet_buffer.getvalue()
    parquet_path = f"staging/{tenant_key}/{file_id}.parquet"

    from api.config import settings
    from api.services.storage import upload_file as minio_upload

    minio_upload(
        settings.minio_bucket_uploads,
        parquet_path,
        parquet_bytes,
        "application/octet-stream",
    )

    # Create analysis_versions record
    from db.queries.versions import create_version

    metadata = {
        "source": "rfc",
        "table": body.table,
        "row_count": row_count,
        "columns": list(df.columns),
        "modules": [body.module],
        "parquet_path": parquet_path,
    }
    version = await create_version(db, tenant.id, metadata)

    # Enqueue check engine
    from workers.tasks.run_checks import run_checks

    run_checks.delay(str(version.id), str(tenant.id), parquet_path)
    logger.info(f"Enqueued run_checks for RFC extraction: version={version.id}")

    return SAPConnectionResponse(
        version_id=str(version.id),
        status="pending",
        row_count=row_count,
    )
