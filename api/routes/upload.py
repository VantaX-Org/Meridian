import io
import logging
import re
import uuid

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission
from api.services.column_mapper import apply_column_mapping, get_required_fields, get_standard_fields
from api.services.rate_limiter import rate_limit
from api.services.storage import upload_file as minio_upload
from api.services.task_progress import (
    STEP_PARSE,
    TOTAL_STEPS,
    update_task_progress,
)

# Uploads are cheap to initiate but kick off a full analysis pipeline behind
# them — cap at 30/tenant/minute so a misbehaving script can't flood MinIO
# + spawn hundreds of Celery tasks.
_upload_rate_limit = rate_limit("upload", limit=30, window_s=60)

router = APIRouter(prefix="/api/v1", tags=["upload"])
logger = logging.getLogger("meridian.upload")

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB
_CHUNK_SIZE = 8 * 1024  # 8 KB


class UploadResponse(BaseModel):
    version_id: str
    job_id: str
    status: str


@router.post(
    "/upload",
    response_model=UploadResponse,
    dependencies=[Depends(_upload_rate_limit), Depends(require_permission("upload"))],
)
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    module: str = Form(...),
    column_mapping: str = Form(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Upload a CSV or Excel file for analysis."""
    from api.middleware.licence import enforce_licensed_modules

    enforce_licensed_modules(request, [module])

    # Step 1-2: Read in chunks — abort early if file exceeds MAX_FILE_SIZE (OOM prevention)
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=422,
                detail={"error": "file_too_large", "detail": "Max file size is 100 MB"},
            )
        chunks.append(chunk)
    content = b"".join(chunks)

    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    # Hard allow-list on the extension — never trust the client content-type as a
    # substitute. Also guarantees `ext` is path-safe for the MinIO object key
    # below (a crafted filename like "x.csv/../y" can't yield a real extension).
    if ext not in ("csv", "xlsx", "xls"):
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_file_type", "detail": "Only .csv, .xlsx and .xls files are supported"},
        )

    # Validate magic bytes before parsing (prevents binary-as-CSV attacks)
    _validate_magic_bytes(content, ext)

    # Step 3: Store raw file in MinIO
    file_id = str(uuid.uuid4())
    object_name = f"uploads/{tenant.id}/{file_id}.{ext}"
    try:
        minio_upload(settings.minio_bucket_uploads, object_name, content, file.content_type or "application/octet-stream")
    except Exception as e:
        logger.exception(f"Failed to store raw upload in MinIO for tenant {tenant.id}: {e}")
        raise HTTPException(
            status_code=503,
            detail={"error": "storage_unavailable", "detail": "Upload storage is unavailable. Please try again shortly."},
        )
    logger.debug(f"Stored raw file: {object_name}")

    # Step 4: Read into DataFrame
    try:
        if ext == "csv":
            try:
                df = pd.read_csv(io.BytesIO(content), encoding="utf-8")
            except UnicodeDecodeError:
                df = pd.read_csv(io.BytesIO(content), encoding="latin-1")
        elif ext in ("xlsx", "xls"):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(422, {"error": "invalid_file_type", "detail": "Unsupported extension"})
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"File parse failed for tenant {tenant.id}: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=422,
            detail={"error": "unparseable_file", "detail": "File could not be parsed. Ensure it is a valid CSV or Excel file."},
        )

    # Step 5a: Apply custom AI-detected column mapping (if provided)
    if column_mapping:
        try:
            import json as _json
            custom_map = _json.loads(column_mapping)
            if isinstance(custom_map, dict):
                rename_map = {src: tgt for src, tgt in custom_map.items() if src in df.columns}
                if rename_map:
                    df = df.rename(columns=rename_map)
                    logger.info(f"Applied {len(rename_map)} custom column mappings")
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid column_mapping JSON: {e}")

    # Step 5b: Apply standard column mapping (handles any remaining aliases)
    df = apply_column_mapping(df, module)

    # Step 5c: Sanitise formula injection — AFTER column mapping, so that
    # SAP-mapped fields (phone numbers starting with '+', negative balances,
    # email addresses starting with '@') are not corrupted. Only unmapped
    # customer-supplied string columns are sanitised.
    _standard_sap_fields_for_sanitise = get_standard_fields(module)
    _known_short = {f.split(".")[-1] for f in _standard_sap_fields_for_sanitise if "." in f} | set(_standard_sap_fields_for_sanitise)
    mapped_columns = {
        col for col in df.columns
        if col in _standard_sap_fields_for_sanitise
        or (col.split(".")[-1] if "." in col else col) in _known_short
    }
    df = _sanitise_formula_injection(df, mapped_columns)

    # Step 6: Classify columns — standard SAP vs custom/customer fields
    required_fields = get_required_fields(module)
    standard_sap_fields = get_standard_fields(module)
    present = set(df.columns)

    # 6a: Identify which standard fields are present vs missing
    missing_standard = []
    present_standard = []
    for field in required_fields:
        short_name = field.split(".")[-1] if "." in field else field
        if field in present or short_name in present:
            present_standard.append(field)
        else:
            missing_standard.append(field)

    if missing_standard:
        logger.warning(
            f"Upload missing {len(missing_standard)}/{len(required_fields)} standard SAP fields "
            f"for module '{module}' — proceeding with partial extract"
        )

    # 6b: Identify custom/customer fields (not in standard SAP schema)
    all_known_short = {f.split(".")[-1] for f in standard_sap_fields if "." in f} | standard_sap_fields
    custom_fields = []
    for col in present:
        short_col = col.split(".")[-1] if "." in col else col
        if col not in standard_sap_fields and short_col not in all_known_short:
            custom_fields.append(col)

    if custom_fields:
        logger.info(
            f"Detected {len(custom_fields)} custom/customer fields: {sorted(custom_fields)}"
        )

    # Step 7: Store cleaned parquet to MinIO
    try:
        parquet_buffer = io.BytesIO()
        df.to_parquet(parquet_buffer, index=False)
        parquet_bytes = parquet_buffer.getvalue()
    except Exception as e:
        logger.exception(f"Failed to serialise parquet for tenant {tenant.id}: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "parquet_serialization_failed",
                "detail": "Server could not prepare the upload for analysis.",
            },
        )
    parquet_path = f"staging/{tenant.id}/{file_id}.parquet"
    try:
        minio_upload(settings.minio_bucket_uploads, parquet_path, parquet_bytes, "application/octet-stream")
    except Exception as e:
        logger.exception(f"Failed to store parquet in MinIO for tenant {tenant.id}: {e}")
        raise HTTPException(
            status_code=503,
            detail={"error": "storage_unavailable", "detail": "Upload storage is unavailable. Please try again shortly."},
        )
    logger.debug(f"Stored parquet: {parquet_path}")

    # Step 8: Create analysis_versions record
    from db.queries.versions import create_version

    metadata = {
        "file_name": filename,
        "row_count": len(df),
        "columns": list(df.columns),
        "modules": [module],
        "parquet_path": parquet_path,
        "standard_fields_present": sorted(present_standard),
        "standard_fields_missing": sorted(missing_standard),
        "custom_fields": sorted(custom_fields),
    }
    # Default label from the filename stem (e.g. "business-partner-clean.csv"
    # -> "business-partner-clean") so the Reports / Versions pages don't show
    # "Unlabelled run" for every upload. Capped at 120 chars for safety.
    label = (filename.rsplit(".", 1)[0] if "." in filename else filename).strip()[:120] or None
    version = await create_version(db, tenant.id, metadata, label=label)
    logger.info(f"Created version: {version.id}")

    # Seed progress so the frontend progress bar has something to show the
    # instant the upload response arrives — before the worker picks up the job.
    # Parsing is already done (we needed the DataFrame to count rows / apply
    # mapping), so we report step 2 as finished and mark the task as queued
    # for the worker.
    parse_step_num, parse_step_name = STEP_PARSE
    update_task_progress(
        str(version.id),
        status="queued",
        current_step="Waiting for worker to start checks",
        step_number=parse_step_num,
        total_steps=TOTAL_STEPS,
        rows_processed=0,
        total_rows=len(df),
        percent_complete=int((parse_step_num / TOTAL_STEPS) * 100),
    )

    # Step 9: Enqueue Celery task
    from workers.tasks.run_checks import run_checks

    job = run_checks.delay(str(version.id), str(tenant.id), parquet_path)
    logger.info(f"Enqueued run_checks: job_id={job.id}")

    logger.info(f"Upload complete: version={version.id}")

    # Step 10: Return immediately — all heavy lifting happens in the Celery task.
    return UploadResponse(
        version_id=str(version.id),
        job_id=job.id,
        status="pending",
    )


# ── Security helpers ──────────────────────────────────────────────────────────

# Leading whitespace before a formula char still executes in Excel/Sheets
# (they strip it), so match optional whitespace (\t \r \n space) first.
_FORMULA_PREFIX = re.compile(r"^\s*[=+\-@]")


def _validate_magic_bytes(content: bytes, ext: str) -> None:
    """Verify file content matches declared extension via magic bytes."""
    if ext == "csv":
        if b"\x00" in content[:512]:
            raise HTTPException(
                422,
                {"error": "invalid_file_type", "detail": "File contains binary data — not a valid CSV"},
            )
    elif ext == "xlsx":
        if not content[:4] == b"PK\x03\x04":
            raise HTTPException(
                422,
                {"error": "invalid_file_type", "detail": "File is not a valid XLSX (ZIP) file"},
            )
    elif ext == "xls":
        if not content[:8] == b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1":
            raise HTTPException(
                422,
                {"error": "invalid_file_type", "detail": "File is not a valid XLS (OLE2) file"},
            )


def _sanitise_formula_injection(df: pd.DataFrame, mapped_columns: set[str]) -> pd.DataFrame:
    """Prefix formula-injection chars (=, +, -, @) with single quote in string cells.

    Skips SAP-mapped columns in ``mapped_columns`` — those legitimately contain
    phone numbers beginning with '+', negative balances with '-', and email
    addresses beginning with '@'. Only unmapped customer-supplied string
    columns are sanitised.
    """
    injections_found = 0
    for col in df.select_dtypes(include="object").columns:
        if col in mapped_columns:
            continue
        mask = df[col].astype(str).str.match(_FORMULA_PREFIX)
        if mask.any():
            injections_found += mask.sum()
            df.loc[mask, col] = "'" + df.loc[mask, col].astype(str)
    if injections_found:
        logger.warning(f"Formula injection sanitised in {injections_found} cells (non-SAP columns only)")
    return df
