import io
import json
import logging
import re
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.deps import Tenant, get_db, get_tenant
from api.services import jobs
from api.services.rbac import Scope, require_permission, require_scope
from api.services.record_issues import scope_of
from api.services.run_lineage import same_lineage_as
from api.services.column_mapper import (
    apply_column_mapping,
    get_required_fields,
    get_standard_fields,
    load_column_map,
)
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
    system_id: str = Form(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Upload a CSV or Excel file for analysis."""
    from api.middleware.licence import enforce_licensed_modules

    enforce_licensed_modules(request, [module])

    # An upload attached to a system joins that system's lineage (frontend lib/runs.ts
    # lineageOf reads metadata.system_id), so its runs compare with the extractions.
    # Checked before anything is stored, so a bad id leaves no orphan file behind.
    if system_id:
        system_id = await _tenant_system(db, tenant.id, system_id)
        await _require_attach_right(request, db, tenant, system_id)

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
        df = _read_frame(content, ext)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"File parse failed for tenant {tenant.id}: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=422,
            detail={"error": "unparseable_file", "detail": "File could not be parsed. Ensure it is a valid CSV or Excel file."},
        )

    # Step 5a: Apply custom AI-detected column mapping (if provided)
    # column_mapping is client-supplied — track which current column names
    # came from it (_client_renamed_columns) and which of those are actually
    # corroborated by the server-controlled alias table (_corroborated_client_mapped,
    # via _is_corroborated_sap_mapping). Step 5c uses this to decide which
    # columns may skip formula-injection sanitisation: trusting the client's
    # claimed target name alone would let an attacker rename any column
    # (containing a formula-injection payload) to a real SAP field name —
    # e.g. column_mapping={"EvilCol": "BUT000.PARTNER"} — to bypass
    # sanitisation entirely, since the exemption check only looked at the
    # (attacker-chosen) current name.
    _client_renamed_columns: set[str] = set()
    _corroborated_client_mapped: set[str] = set()
    if column_mapping:
        try:
            import json as _json
            custom_map = _json.loads(column_mapping)
            if isinstance(custom_map, dict):
                rename_map = {src: tgt for src, tgt in custom_map.items() if src in df.columns}
                if rename_map:
                    df = df.rename(columns=rename_map)
                    _client_renamed_columns = set(rename_map.values())
                    for src, tgt in rename_map.items():
                        if _is_corroborated_sap_mapping(src, tgt, module):
                            _corroborated_client_mapped.add(tgt)
                    logger.info(f"Applied {len(rename_map)} custom column mappings")
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid column_mapping JSON: {e}")

    # Step 5b: Apply standard column mapping (handles any remaining aliases)
    df = apply_column_mapping(df, module)

    # Step 5c: Sanitise formula injection — AFTER column mapping, so that
    # SAP-mapped fields (phone numbers starting with '+', negative balances,
    # email addresses starting with '@') are not corrupted. Only unmapped
    # customer-supplied string columns are sanitised. A column only gets the
    # exemption if it reached its current SAP-looking name via the raw file
    # itself or Step 5b's server-controlled alias table — an uncorroborated
    # client-supplied rename (see Step 5a) does not exempt it, regardless of
    # what target name the client claims.
    _standard_sap_fields_for_sanitise = get_standard_fields(module)
    _known_short = {f.split(".")[-1] for f in _standard_sap_fields_for_sanitise if "." in f} | set(_standard_sap_fields_for_sanitise)
    mapped_columns = {
        col for col in df.columns
        if (col in _standard_sap_fields_for_sanitise or (col.split(".")[-1] if "." in col else col) in _known_short)
        and (col not in _client_renamed_columns or col in _corroborated_client_mapped)
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
    #
    # Resolved through the module rather than imported at call time. The deferred
    # ``from db.queries.versions import create_version`` binds whatever object the module
    # holds at request time, which makes the call site un-patchable from the source module:
    # a test that patches ``db.queries.versions.create_version`` (the obvious seam, and how
    # the other route tests do it) can silently miss this one whenever something earlier in
    # the session has left ``sys.modules['db.queries.versions']`` rebound, and the route then
    # calls the real function against the test's fake session. Observed exactly that:
    # tests/test_upload_path.py passes alone and fails deep in the full suite with
    # ``AttributeError: 'NoneType' object has no attribute 'execute'``. Going through
    # ``versions`` makes the module attribute the single seam, so the patch always lands.
    from db.queries import versions
    create_version = versions.create_version

    metadata = {
        # how the run started: a file, whether or not it is attached to a system (Runs reads "trigger")
        "source": "upload",
        "trigger": "upload",
        "file_name": filename,
        "row_count": len(df),
        "columns": list(df.columns),
        "modules": [module],
        "parquet_path": parquet_path,
        # the raw file, so a purge of this version can remove it too (api/services/purge.py)
        "upload_path": object_name,
        "standard_fields_present": sorted(present_standard),
        "standard_fields_missing": sorted(missing_standard),
        "custom_fields": sorted(custom_fields),
    }
    if system_id:
        metadata["system_id"] = system_id
    # Default label from the filename stem (e.g. "business-partner-clean.csv"
    # -> "business-partner-clean") so the Reports / Versions pages don't show
    # "Unlabelled run" for every upload. Capped at 120 chars for safety.
    label = (filename.rsplit(".", 1)[0] if "." in filename else filename).strip()[:120] or None
    from api.services.semantic_types import safe_profile
    metadata["semantic_profile"] = safe_profile(df)  # shares per column only, no values
    version = await create_version(db, tenant.id, metadata, label=label)
    logger.info(f"Created version: {version.id}")

    # Seed progress so the frontend progress bar has something to show the
    # instant the upload response arrives — before the worker picks up the job.
    # Parsing is already done (we needed the DataFrame to count rows / apply
    # mapping), so we report step 2 as finished and mark the task as queued
    # for the worker.
    parse_step_num, parse_step_name = STEP_PARSE
    jobs.start_job(str(tenant.id), str(version.id), "upload", file.filename or "Upload", status="queued",
                   progress_key=str(version.id), version_id=str(version.id))
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
    job_id = await _enqueue_checks(db, tenant.id, version.id, parquet_path, total_rows=len(df))
    logger.info(f"Upload complete: version={version.id}")

    # Step 10: Return immediately — all heavy lifting happens in the Celery task.
    return UploadResponse(
        version_id=str(version.id),
        job_id=job_id,
        status="pending",
    )


class RoundTripResponse(UploadResponse):
    parent_version_id: str
    kind: str
    applied: int
    unchanged: int
    unmatched: int
    unmapped: dict[str, list[str]]
    skipped: dict[str, str]
    no_table: list[str]
    no_field: list[str]
    notes: dict[str, int] = {}
    # the edits that matched nothing: {sheet, row, table, key, field, reason}, at most 200
    unmatched_rows: list[dict] = []
    # cells another upload changed after this file was exported: left as that upload set them
    conflicts: list[dict] = []
    conflicts_total: int = 0


# A newer extraction of the same lineage holding the file's object: the file's edits would overwrite newer data.
_NEWER_RUN_SQL = f"""
    SELECT id, run_at FROM analysis_versions
     WHERE tenant_id = :t AND id <> CAST(:b AS uuid) AND {same_lineage_as("b")}
       AND status IN ('complete', 'agents_complete')
       AND metadata->>'source' IS DISTINCT FROM 'roundtrip'
       AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
       AND (CAST(:m AS text) IS NULL OR metadata->'modules' @> jsonb_build_array(CAST(:m AS text)))
       AND run_at > (SELECT run_at FROM analysis_versions WHERE id = CAST(:b AS uuid))
     ORDER BY run_at DESC LIMIT 1
"""

# The newest cleaned copy of the same extraction: uploads for other objects of that run build on it, so each
# object's edits accumulate instead of replacing one another.
_TIP_SQL = """
    SELECT id, metadata FROM analysis_versions
     WHERE tenant_id = :t AND metadata->>'source' = 'roundtrip'
       AND metadata->'roundtrip'->>'base_version_id' = :b
       AND status <> 'failed' AND metadata ? 'cleaned_overlay'
     ORDER BY run_at DESC LIMIT 1
"""

# The cells a cleaned copy changed (169); a copy made before 169 kept them in metadata.cleaned_overlay.edits.
_CELLS_SQL = "SELECT grain, record_key, field FROM roundtrip_edits WHERE tenant_id = :t AND version_id = CAST(:v AS uuid)"
_CELLS_INSERT_SQL = """
    INSERT INTO roundtrip_edits (tenant_id, version_id, grain, record_key, field)
    SELECT :t, CAST(:v AS uuid), g, k, f
      FROM unnest(CAST(:g AS text[]), CAST(:k AS text[]), CAST(:f AS text[])) AS x(g, k, f)
    ON CONFLICT DO NOTHING"""
CELL_CHUNK = 5000


async def _cells(db: AsyncSession, tenant_id, version_id: str, meta: dict) -> set[tuple[str, str, str]]:
    """(table, record key, field) of every cell a cleaned copy changed."""
    legacy = (meta.get("cleaned_overlay") or {}).get("edits") or []
    cells = {(e["table"], e["key"], e.get("field") or "") for e in legacy if e.get("table") and e.get("key")}
    rows = (await db.execute(text(_CELLS_SQL), {"t": tenant_id, "v": version_id})).fetchall()
    return cells | {(r[0], r[1], r[2]) for r in rows}


async def _save_cells(db: AsyncSession, tenant_id, version_id: str, cells) -> None:
    """All of a copy's cells, in chunks, so no cap applies."""
    ordered = sorted(cells)
    for i in range(0, len(ordered), CELL_CHUNK):
        part = ordered[i:i + CELL_CHUNK]
        await db.execute(text(_CELLS_INSERT_SQL), {"t": tenant_id, "v": version_id, "g": [c[0] for c in part],
                                                   "k": [c[1] for c in part], "f": [c[2] for c in part]})


@asynccontextmanager
async def _base_lock(base: str) -> AsyncIterator[None]:
    """One cleaned copy at a time per extraction, so a second upload builds on the first one's copy instead of
    racing it to the same tip. The request session commits midway (create_version), which would drop a
    transaction lock, so a session lock is held on its own connection until the copy is committed."""
    from api.deps import engine

    async with engine.connect() as conn:
        await conn.execute(text("SELECT pg_advisory_lock(hashtext(:k))"), {"k": f"roundtrip:{base}"})
        try:
            yield
        finally:
            await conn.execute(text("SELECT pg_advisory_unlock(hashtext(:k))"), {"k": f"roundtrip:{base}"})


def _notes_sql(where: str, update: str) -> str:
    """Status change on the issues a note names, audited the way bulk_update audits it."""
    return f"""
        WITH n AS (SELECT * FROM unnest(CAST(:rules AS text[]), CAST(:keys AS text[]), CAST(:notes AS text[]))
                           AS n(check_id, record_key, note)),
             old AS (SELECT ri.id, ri.status, n.note FROM record_issues ri
                       JOIN n ON n.check_id = ri.check_id AND n.record_key = ri.record_key
                      WHERE ri.tenant_id = :tid AND ri.scope = :scope AND ri.module = :m AND {where}
                      FOR UPDATE OF ri),
             upd AS (UPDATE record_issues ri SET {update}, updated_at = now() FROM old WHERE ri.id = old.id
                     RETURNING ri.id, old.status AS prev, old.note)
        INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, from_value, to_value, note)
        SELECT :tid, id, CAST(:uid AS uuid), :label, 'status', prev, :st, note FROM upd"""


_NOT_AN_ERROR_SQL = _notes_sql(
    "ri.status NOT IN ('accepted', 'resolved')",
    "status = 'accepted', resolution = 'false_positive', steward_verdict = 'false_positive', resolved_at = now(), "
    "acknowledged_at = COALESCE(ri.acknowledged_at, now())")
_IN_PROGRESS_SQL = _notes_sql(
    "ri.status = 'open'", "status = 'in_progress', acknowledged_at = COALESCE(ri.acknowledged_at, now())")
_COMMENT_SQL = """
    INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, note)
    SELECT :tid, ri.id, CAST(:uid AS uuid), :label, 'comment', n.note
      FROM unnest(CAST(:rules AS text[]), CAST(:keys AS text[]), CAST(:notes AS text[])) AS n(check_id, record_key, note)
      JOIN record_issues ri ON ri.check_id = n.check_id AND ri.record_key = n.record_key
     WHERE ri.tenant_id = :tid AND ri.scope = :scope AND ri.module = :m"""


def _note_text(n: dict) -> str:
    parts = [f"Owner: {n['owner']}." if n["owner"] else "", n["comment"]]
    return ("Cleaning workbook: " + " ".join(p for p in parts if p)).strip()


async def _apply_notes(db: AsyncSession, tenant_id, request: Request, role: str, scope: str, module: str,
                       notes: list[dict]) -> dict[str, int]:
    """Status, Owner and Comment from the cleaning workbook onto the run's record issues (same system, same object).
    Not an error accepts the issue as a false positive, which needs the approve right; without it the note is kept
    as a comment saying an approver must confirm."""
    from api.services.rbac import current_user_id, current_user_label, has_permission

    who = {"tid": str(tenant_id), "scope": scope, "m": module, "uid": current_user_id(request),
           "label": current_user_label()}
    approve = has_permission(role, "approve")
    out = {"not_an_error": 0, "in_progress": 0, "comments": 0, "needs_approver": 0}

    def arrays(rows: list[dict], note) -> dict:
        return {"rules": [r["rule"] for r in rows], "keys": [r["key"] for r in rows], "notes": [note(r) for r in rows]}

    nae = [n for n in notes if n["status"] == "not_an_error"]
    if nae and approve:
        out["not_an_error"] = (await db.execute(text(_NOT_AN_ERROR_SQL), {
            **who, "st": "accepted", **arrays(nae, lambda n: _note_text(n) if n["comment"] else
                                              "Cleaning workbook: marked Not an error.")})).rowcount
    elif nae:
        out["needs_approver"] = len(nae)
    prog = [n for n in notes if n["status"] == "in_progress"]
    if prog:
        out["in_progress"] = (await db.execute(text(_IN_PROGRESS_SQL), {
            **who, "st": "in_progress", **arrays(prog, lambda n: _note_text(n) if n["owner"] or n["comment"] else None)})).rowcount
    # a comment event for every note the status change did not already carry
    said = [n for n in notes if (n["owner"] or n["comment"]) and n["status"] not in ("in_progress",)
            and not (n["status"] == "not_an_error" and approve)]
    said += [n for n in nae if not approve and not (n["owner"] or n["comment"])]
    if said:
        out["comments"] = (await db.execute(text(_COMMENT_SQL), {**who, **arrays(said, lambda n: (
            _note_text(n) + (" Marked Not an error; an approver must confirm it." if n["status"] == "not_an_error"
                             and not approve else "")).strip())})).rowcount
    return out


def _roundtrip_edits(tenant_id, parent_id: str, system_id: Optional[str], parent_modules: list[str], parsed: dict,
                     filename: str, data: bytes, dictionary=None) -> tuple[str, list[dict], dict]:
    """Which kind of file this is, its edits, and what could not be mapped (blocking; run in a thread).
    ``dictionary`` names each table's key fields: a value typed into one is refused."""
    from api.services import sf_roundtrip as rt

    def keys_of(table: str) -> list[str]:
        return list(dictionary.keys(table)) if dictionary is not None else []

    sheets, marker = parsed["sheets"], parsed["marker"]
    from api.services.cycle_limits import is_record_sheet, rename_by_header

    kind = marker.get("kind") or ("cleaning" if any(is_record_sheet(n, r) for n, r in sheets) else "template")
    if kind not in rt.KINDS:
        raise rt.RoundTripError("The marker in this file is damaged. Choose the run it came from.")
    if kind == "cleaning":
        edits, blank = rt.cleaning_edits(sheets, keys_of)
        return kind, edits, {"unmapped": {}, "skipped": {}, "blank": blank, "notes": rt.cleaning_notes(sheets)}
    maps = marker.get("map")
    if not maps:  # no marker, or a CSV export: map the columns the way the export did
        from api.routes.migration import _fill_workbook
        maps = {r["name"]: r for r in _fill_workbook(tenant_id, parent_id, data, filename)[2]["sheets"]}
    parsed["sheets"] = sheets = rename_by_header(sheets, maps)
    parsed["maps"] = maps
    edits, report = rt.template_edits(sheets, maps, keys_of)
    return kind, edits, report


class RoundTripCheck(BaseModel):
    id: str
    status: str  # pass | warn | fail
    detail: str


class RoundTripCheckResponse(BaseModel):
    verdict: str  # pass | warn | fail
    checks: list[RoundTripCheck]
    parent_version_id: str
    latest_version_id: Optional[str] = None
    edits: int = 0


@router.post(
    "/upload/roundtrip",
    response_model=RoundTripResponse,
    dependencies=[Depends(_upload_rate_limit)],
)
async def upload_roundtrip(
    request: Request,
    file: UploadFile = File(...),
    parent_version_id: str = Form(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("upload")),
    module: str = Form(None),
    confirm_warnings: bool = Form(False),
):
    """An edited export (filled template or cleaning workbook) comes back as the next run of the same lineage
    and is analysed at once. The hidden marker names the parent run; without one the caller sends it.

    The edits go onto the newest cleaned copy of the same extraction, so uploads for several objects of one run
    accumulate; the new run is tagged ``cleaned_overlay``. A file from an extraction that a newer one of the same
    object has replaced is refused (409). Status, Owner and Comment on cleaning rows update the record issues."""
    return await _roundtrip_one(request, file, parent_version_id, db, tenant, role=role, module=module,
                                confirm_warnings=confirm_warnings)


@router.post("/upload/roundtrip/check", response_model=RoundTripCheckResponse, dependencies=[Depends(_upload_rate_limit)])
async def upload_roundtrip_check(
    request: Request,
    file: UploadFile = File(...),
    parent_version_id: str = Form(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("upload")),
    module: str = Form(None),
):
    """Run every check on an edited file and change nothing: fingerprint, run, template version, columns, rows,
    record keys, value types and lengths, formulas. Each check is pass, warn or fail; no cell value is returned."""
    return await _roundtrip_one(request, file, parent_version_id, db, tenant, role=role, module=module, check_only=True)


class RoundTripBatchItem(BaseModel):
    file_name: str
    ok: bool
    parent_version_id: Optional[str] = None
    result: Optional[RoundTripResponse] = None
    error: Optional[str] = None


class RoundTripBatchResponse(BaseModel):
    items: list[RoundTripBatchItem]
    succeeded: int
    failed: int


@router.post(
    "/upload/roundtrip/batch",
    response_model=RoundTripBatchResponse,
    dependencies=[Depends(_upload_rate_limit)],
)
async def upload_roundtrip_batch(
    request: Request,
    files: list[UploadFile] = File(...),
    parent_version_id: str = Form(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("upload")),
    module: str = Form(None),
):
    """Several edited files in one call (one per object). Each goes through the same checks as a single upload
    (parent_mismatch, stale_run, notes, newest cleaned copy) and builds on the copies before it, so the files of
    one run accumulate; one bad file does not stop the others."""
    if not 1 <= len(files) <= MAX_ROUNDTRIP_BATCH:
        raise HTTPException(status_code=422, detail=f"Send between 1 and {MAX_ROUNDTRIP_BATCH} files.")
    items: list[RoundTripBatchItem] = []
    for f in files:
        try:
            r = await _roundtrip_one(request, f, parent_version_id, db, tenant, role=role, module=module)
            items.append(RoundTripBatchItem(file_name=f.filename or "", ok=True, parent_version_id=r.parent_version_id,
                                            result=r))
        except HTTPException as e:
            await db.rollback()
            d = e.detail
            items.append(RoundTripBatchItem(file_name=f.filename or "", ok=False,
                                            error=d if isinstance(d, str) else " ".join(
                                                str(x) for x in (d.get("detail") or d.get("error"), d.get("fix")) if x)))
    ok = sum(1 for i in items if i.ok)
    return RoundTripBatchResponse(items=items, succeeded=ok, failed=len(items) - ok)


MAX_ROUNDTRIP_BATCH = 20


async def _roundtrip_one(request: Request, file: UploadFile, parent_version_id: Optional[str], db: AsyncSession,
                         tenant: Tenant, role: str = "", module: Optional[str] = None, check_only: bool = False,
                         confirm_warnings: bool = False):
    from starlette.concurrency import run_in_threadpool

    from api.middleware.licence import enforce_licensed_modules
    from api.services import cycle_limits as cl
    from api.services import sf_roundtrip as rt
    from api.services.rbac import write_audit
    from db.queries import versions

    data = await file.read(rt.MAX_UPLOAD_BYTES + 1)
    try:
        parsed = await run_in_threadpool(rt.read_upload, data, file.filename or "")
    except rt.RoundTripError as e:
        raise HTTPException(status_code=422, detail=str(e))
    marker = parsed["marker"]
    if parent_version_id and marker.get("version_id") and parent_version_id.strip().lower() != marker["version_id"].lower():
        raise HTTPException(status_code=422, detail={"error": "parent_mismatch", "detail":
                            "This file came from a different run than the one chosen. Upload it on its own run, "
                            "or download the workbook again from the chosen run."})
    parent = parent_version_id or marker.get("version_id")
    if not parent:
        raise HTTPException(status_code=422, detail={"error": "parent_required",
                            "detail": "This file does not say which run it came from. Choose the run."})
    try:
        parent = str(uuid.UUID(parent))
    except ValueError:
        raise HTTPException(status_code=422, detail="The parent run id is not valid.")
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
    row = (await db.execute(text("SELECT status, label, metadata FROM analysis_versions WHERE id = CAST(:v AS uuid) "
                                 "AND tenant_id = :t"), {"v": parent, "t": tenant.id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Run not found.")
    status, label, meta = row[0] or "", row[1], dict(row[2] or {})
    modules = list(meta.get("modules") or [])
    if "complete" not in status:
        raise HTTPException(status_code=409, detail="That run has not finished.")
    if not str(meta.get("dataset_path") or "").endswith("/"):
        raise HTTPException(status_code=422, detail="Only a run extracted from a system can take an edited file.")
    if marker.get("module") and marker["module"] not in modules:
        raise HTTPException(status_code=422, detail={"error": "module_mismatch", "detail":
                            f"This file was exported from {marker['module']}, which is not an object of the chosen run."})
    if module and module not in modules:
        raise HTTPException(status_code=422, detail={"error": "module_mismatch", "detail":
                            f"{module} is not an object of the chosen run.", "fix": "Choose an object of this run."})
    # the file names its object; a run of one object names it; otherwise the caller must
    module = marker.get("module") or module or (modules[0] if len(modules) == 1 else None)
    if not module:
        raise HTTPException(status_code=422, detail={
            "error": "module_required", "modules": modules, "detail":
            f"This file does not say which object it holds, and the run has {len(modules)} objects.",
            "fix": "Upload the .xlsx file Meridian gave you (it names its object), or choose the object."})
    enforce_licensed_modules(request, modules)
    system_id = meta.get("system_id")
    if system_id:
        await _require_attach_right(request, db, tenant, system_id)
    dictionary = await run_in_threadpool(_dictionary, tenant.id, system_id)
    try:
        kind, edits, report = await run_in_threadpool(_roundtrip_edits, tenant.id, parent, system_id, modules, parsed,
                                                      file.filename or "", data, dictionary)
    except rt.InvalidValues as e:
        raise HTTPException(status_code=422, detail={"error": "invalid_values", "detail": str(e),
                                                     "rows": e.rows[:50], "total": len(e.rows)})
    except rt.RoundTripError as e:
        raise HTTPException(status_code=422, detail=str(e))
    notes = report.pop("notes", [])
    if not edits and not notes:
        detail, fix = cl.no_edit_reason(kind, report)
        raise HTTPException(status_code=422, detail={"error": "no_edits", "detail": detail, "fix": fix})

    # the extraction this file's data came from: a cleaned copy points back at it
    base = str((meta.get("roundtrip") or {}).get("base_version_id") or parent)
    newer = (await db.execute(text(_NEWER_RUN_SQL), {"t": tenant.id, "b": base, "m": module})).fetchone()
    from api.services import upload_checks as uc

    tip = (await db.execute(text(_TIP_SQL), {"t": tenant.id, "b": base})).fetchone()
    path = str(dict(tip[1] or {}).get("dataset_path") or meta["dataset_path"]) if tip else meta["dataset_path"]
    dictionary = await run_in_threadpool(_dictionary, tenant.id, system_id) if edits else None
    dry = await run_in_threadpool(rt.apply_edits, path, "", edits, dictionary, dry=True) if edits else {}
    run_check = uc.check_run(marker, parent, modules, None)
    if newer:
        run_check = {"id": "run", "status": "fail", "detail": "A newer extraction of this object has finished since "
                     "this file was exported. Download the workbook from the latest run."}
    checks = [uc.check_fingerprint(marker, str(tenant.id)), run_check, uc.check_template(marker, kind),
              uc.check_columns(parsed["sheets"], marker, kind, marker.get("map")), uc.check_rows(parsed["sheets"], marker, kind),
              uc.check_keys(dry), uc.check_values(edits, dictionary), uc.check_formulas(edits)]
    verdict = uc.verdict(checks)
    if check_only:
        return RoundTripCheckResponse(verdict=verdict, checks=[RoundTripCheck(**c) for c in checks], parent_version_id=parent,
                                      latest_version_id=str(newer[0]) if newer else None, edits=len(edits))
    if verdict == "fail" and not newer:
        raise HTTPException(status_code=422, detail={"error": "checks_failed", "checks": checks,
                            "detail": "The file did not pass its checks. Fix the failed checks and upload again."})
    if verdict == "warn" and not confirm_warnings:
        raise HTTPException(status_code=422, detail={"error": "confirm_required", "checks": checks,
                            "detail": "The file passed with warnings. Confirm to continue."})
    if newer:
        raise HTTPException(status_code=409, detail={
            "error": "stale_run", "latest_version_id": str(newer[0]), "detail":
            "A newer extraction of this object has finished since this file was exported. Download the workbook "
            "from the latest run and make the changes there; this file would overwrite newer data."})

    async def save_notes() -> dict[str, int]:
        if not (notes and module):
            return {}
        counts = await _apply_notes(db, tenant.id, request, role, scope_of(meta), module, notes)
        await write_audit(db, tenant.id, request, "upload.roundtrip_notes", "analysis_version", parent, None,
                          {"module": module, **counts})
        return counts

    if not edits:
        note_counts = await save_notes()
        await db.commit()
        return RoundTripResponse(
            version_id=parent, job_id="", status="notes_saved", parent_version_id=parent, kind=kind, applied=0,
            unchanged=0, unmatched=0, unmapped=report["unmapped"], skipped=report["skipped"], no_table=[],
            no_field=[], notes=note_counts)

    async with _base_lock(base):
        tip = (await db.execute(text(_TIP_SQL), {"t": tenant.id, "b": base})).fetchone()
        source_id, source_meta = (str(tip[0]), dict(tip[1] or {})) if tip else (parent, meta)
        prior = (source_meta.get("cleaned_overlay") or {}) if source_id != base else {}
        prior_cells = await _cells(db, tenant.id, source_id, source_meta) if source_id != base else set()
        # the file was exported from an older copy: a cell another upload changed since then is a conflict
        stale: set = set()
        if source_id != parent:
            seen = await _cells(db, tenant.id, parent, meta) if parent != base else set()
            stale = prior_cells - seen

        new_meta = {k: v for k, v in meta.items() if k not in ("error", "scoring", "cleaned_overlay", "monitor")}
        new_meta.update({"source": "roundtrip", "trigger": "roundtrip", "file_name": file.filename,
                         "roundtrip": {"parent_version_id": source_id, "base_version_id": base, "kind": kind,
                                       "edits": len(edits), "module": module}})
        version = await versions.create_version(db, tenant.id, new_meta,
                                                label=f"{label or 'Run'} (cleaned)"[:120])
        prefix = f"staging/{tenant.id}/{version.id}/"
        try:
            result = await run_in_threadpool(rt.apply_edits, source_meta["dataset_path"], prefix, edits,
                                             dictionary, frozenset(stale))
        except Exception as e:  # noqa: BLE001 - the version row must not linger pending
            await run_in_threadpool(rt.drop_staging, prefix)
            await versions.mark_version_failed(db, tenant.id, version.id, f"Could not apply the edits: {type(e).__name__}")
            if isinstance(e, rt.RoundTripError):
                raise HTTPException(status_code=422, detail=str(e))
            raise
        rows, rejected = await run_in_threadpool(_rejected, parsed, kind, dictionary, edits, result)
        if not result["applied"]:
            await run_in_threadpool(rt.drop_staging, prefix)
            reason, detail, fix = cl.nothing_applied(result, rejected, already=source_id != base)
            await versions.mark_version_failed(db, tenant.id, version.id, detail)
            # nothing is saved, notes included: the file is fixed and uploaded again as a whole
            raise HTTPException(status_code=422, detail={"error": "nothing_applied", "reason": reason, "detail": detail,
                                "fix": fix, "unmatched": result["unmatched_total"], "rejected": rejected,
                                "unmatched_rows": rows, "unchanged": result["unchanged"],
                                "conflicts": result.get("conflicts", []),
                                "conflicts_total": result.get("conflicts_total", 0), "notes": {}})
        # the cleaned copy is a forecast: a later real extraction that still fails on these records is not a
        # regression of the source, it is a fix not yet made there (workers/tasks/run_checks.py)
        cells = prior_cells | {(e["table"], e["key"], e["field"]) for e in result.get("edited", [])}
        overlay = {"base_version_id": base,
                   "modules": sorted({*(prior.get("modules") or []), *([module] if module else [])}),
                   "edit_count": len(cells)}
        # one transaction from here: the copy, every changed cell, the notes and the audit commit together
        await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
        await _save_cells(db, tenant.id, str(version.id), cells)
        note_counts = await save_notes()
        await db.execute(text(
            "UPDATE analysis_versions SET parent_version_id = CAST(:p AS uuid), "
            "metadata = metadata || jsonb_build_object('dataset_path', CAST(:d AS text), "
            "'cleaned_overlay', CAST(:o AS jsonb)), "
            "run_number = COALESCE((SELECT max(run_number) FROM analysis_versions WHERE tenant_id = :t "
            "AND COALESCE(metadata->>'system_id', 'upload') = COALESCE(:sys, 'upload')), 0) + 1 "
            "WHERE id = :v AND tenant_id = :t"),
            {"p": source_id, "d": prefix, "t": tenant.id, "v": version.id, "sys": system_id, "o": json.dumps(overlay)})
        await write_audit(db, tenant.id, request, "upload.roundtrip", "analysis_version", str(version.id), None,
                          {"parent_version_id": source_id, "base_version_id": base, "kind": kind,
                           "applied": result["applied"]})
        await db.commit()
        jobs.start_job(str(tenant.id), str(version.id), "upload", file.filename or "Upload", status="queued",
                       progress_key=str(version.id), version_id=str(version.id))
        job_id = await _enqueue_checks(db, tenant.id, version.id, prefix)
        return RoundTripResponse(
            version_id=str(version.id), job_id=job_id, status="pending", parent_version_id=source_id, kind=kind,
            applied=result["applied"], unchanged=result["unchanged"], unmatched=result["unmatched_total"],
            unmapped=report["unmapped"], skipped=report["skipped"], no_table=result["no_table"], no_field=result["no_field"],
            notes=note_counts, unmatched_rows=rows, conflicts=result.get("conflicts", []),
            conflicts_total=result.get("conflicts_total", 0))


def _rejected(parsed: dict, kind: str, dictionary, edits: list[dict], result: dict) -> tuple[list[dict], int]:
    """The rows that matched nothing, with sheet and row number (blocking; run in a thread)."""
    from api.services.cycle_limits import rejected_rows

    if not (result.get("unmatched_total") or result.get("no_table") or result.get("no_field")):
        return [], 0
    keys_of = (lambda t: []) if kind == "cleaning" or dictionary is None else (lambda t: list(dictionary.keys(t)))
    return rejected_rows(parsed["sheets"], kind, parsed.get("maps"), keys_of, edits, result)


def _dictionary(tenant_id, system_id):
    from api.services.source_design import dictionary_for
    from workers.db import get_sync_engine, tenant_session

    with tenant_session(get_sync_engine(), tenant_id) as s:
        return dictionary_for(s, system_id)


async def _tenant_system(db: AsyncSession, tenant_id: uuid.UUID, system_id: str) -> str:
    """The id of the tenant's sap_systems row, or 404."""
    try:
        sid = str(uuid.UUID(system_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="System not found")
    found = (await db.execute(
        text("SELECT 1 FROM sap_systems WHERE id = CAST(:s AS uuid) AND tenant_id = :t"),
        {"s": sid, "t": tenant_id})).scalar()
    if not found:
        raise HTTPException(status_code=404, detail="System not found")
    return sid


async def _require_attach_right(request: Request, db: AsyncSession, tenant: Tenant, system_id: str) -> None:
    """Attaching a file to a system puts its values in that system's lineage (and golden-record
    survivorship), so it needs trigger_sync or manage_systems at that system, not just upload."""
    denied: HTTPException | None = None
    for action in ("trigger_sync", "manage_systems"):
        try:
            await require_scope(request, db, tenant, action, Scope(uuid.UUID(system_id), None))
            return
        except HTTPException as e:
            denied = e
    assert denied is not None
    raise denied


async def _enqueue_checks(db: AsyncSession, tenant_id: uuid.UUID, version_id: uuid.UUID,
                          parquet_path: str, *, total_rows: int = 0) -> str:
    """Queue ``run_checks`` for a freshly created version and return the Celery task id.

    The version row is already committed, so a broker failure here must not leave it
    ``pending`` forever with no job behind it: it is marked ``failed`` with the reason, the
    progress stream is told, and the caller gets a 503 to retry the upload."""
    from db.queries import versions
    from workers.tasks.run_checks import run_checks
    mark_version_failed = versions.mark_version_failed

    try:
        job = run_checks.delay(str(version_id), str(tenant_id), parquet_path)
        jobs.set_task_ids(str(tenant_id), str(version_id), [getattr(job, "id", None)])
    except Exception as e:
        logger.exception(f"Failed to enqueue run_checks for version {version_id}: {e}")
        reason = f"Could not queue the analysis: {type(e).__name__}"
        try:
            await mark_version_failed(db, tenant_id, version_id, reason)
        except Exception:
            logger.exception(f"Could not mark version {version_id} failed after enqueue failure")
        try:
            update_task_progress(str(version_id), status="failed", current_step=reason,
                                 step_number=STEP_PARSE[0], total_steps=TOTAL_STEPS,
                                 total_rows=total_rows, error=reason)
            jobs.finish_job(str(tenant_id), str(version_id), "failed", error=reason)
        except Exception:
            logger.exception(f"Could not publish enqueue failure for version {version_id}")
        raise HTTPException(
            status_code=503,
            detail={"error": "queue_unavailable",
                    "detail": "The analysis queue is unavailable. The upload was stored; please try again shortly."},
        )
    logger.info(f"Enqueued run_checks: job_id={job.id}")
    return job.id


# ── Security helpers ──────────────────────────────────────────────────────────

# Leading whitespace before a formula char still executes in Excel/Sheets
# (they strip it), so match optional whitespace (\t \r \n space) first.
# A plain signed number ("-12.50", "+5") is data, not a formula: every column is read as text now, so a numeric
# custom column would otherwise gain a quote it never had when it was parsed as numbers.
_FORMULA_PREFIX = re.compile(r"^\s*(?:[=@]|[+\-](?!\d[\d.,]*$))")


def _is_corroborated_sap_mapping(src: str, tgt: str, module: str) -> bool:
    """Verify a client-claimed src->tgt column rename against the
    server-controlled alias table, rather than trusting the client's word for
    it. Used to gate the formula-injection sanitisation exemption — see the
    Step 5a/5c comments in upload_file. Returns True if `tgt` is `src`
    itself, `src` is `tgt`'s short name (FIELD part of TABLE.FIELD), or
    column_map.yaml already registers `src` as a known alias of `tgt`
    (case-insensitive) for this module.
    """
    src_stripped = src.strip()
    if src_stripped == tgt:
        return True
    short = tgt.split(".")[-1] if "." in tgt else tgt
    if src_stripped == short:
        return True
    col_map = load_column_map(module)
    if col_map.get(src_stripped) == tgt:
        return True
    src_lower = src_stripped.lower()
    return any(canonical == tgt and alias.lower() == src_lower for alias, canonical in col_map.items())


# Every cell as text, and only an empty cell is blank: "00123" keeps its zeros, "NA" (Namibia) stays a value.
_AS_TEXT = {"dtype": str, "keep_default_na": False, "na_values": [""]}


def _read_frame(content: bytes, ext: str) -> pd.DataFrame:
    """The uploaded file as a frame of strings. CSV must be UTF-8 (a BOM is fine): any other encoding is refused,
    never guessed, since a wrong guess turns Arabic or Cyrillic names into mojibake without a trace."""
    if ext == "csv":
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(422, {
                "error": "unsupported_encoding",
                "detail": "The CSV file is not UTF-8. In Excel use Save As > 'CSV UTF-8 (Comma delimited)' and upload again.",
            })
        df = pd.read_csv(io.StringIO(text), **_AS_TEXT)
    elif ext in ("xlsx", "xls"):
        if ext == "xlsx":
            from api.services.migration.workbook_formats import WorkbookError, check_zip_budget
            try:
                check_zip_budget(content)
            except WorkbookError as e:
                raise HTTPException(413, {"error": "workbook_too_large", "detail": str(e)})
        df = pd.read_excel(io.BytesIO(content), **_AS_TEXT)
    else:
        raise HTTPException(422, {"error": "invalid_file_type", "detail": "Unsupported extension"})
    if len(df.columns):  # a BOM inside an Excel header cell, or a doubled one in a CSV
        df = df.rename(columns={df.columns[0]: str(df.columns[0]).lstrip("\ufeff")})
    return df


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
