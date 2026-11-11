"""Non-SAP SQL database sources: register a read-only Postgres connection, pick a table or one SELECT, map the
columns, and load the rows through the same path as a file upload so the existing rules score them.

Every route needs manage_systems. The password is encrypted with the SAP system credential key
(api/services/credential_store.py) and is never returned. The trust boundary (address check, read-only session,
timeout, row cap, single statement) is in api/services/external_db.py.
"""
import asyncio
import io
import logging
import uuid
from typing import Any, Literal, Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.deps import Tenant, get_db, get_tenant
from api.routes.upload import (
    _enqueue_checks,
    _require_attach_right,
    _sanitise_formula_injection,
    _tenant_system,
)
from api.services import external_db as xdb
from api.services import jobs
from api.services.column_mapper import apply_column_mapping, get_required_fields, get_standard_fields
from api.services.credential_store import decrypt_password, encrypt_password
from api.services.rate_limiter import rate_limit
from api.services.rbac import current_user_label, require_permission
from api.services.storage import upload_file as minio_upload
from api.services.task_progress import STEP_PARSE, TOTAL_STEPS, update_task_progress

router = APIRouter(prefix="/api/v1/external-db", tags=["external-db"])
logger = logging.getLogger("meridian.external_db")

_load_rate_limit = rate_limit("external_db_load", limit=10, window_s=60)
_COLS = "id, name, engine, host, port, database, username, ssl_mode, created_by, created_at, last_tested_at, last_test_ok, last_loaded_at"


class ConnectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = Field(min_length=1, max_length=128)
    username: str = Field(min_length=1, max_length=128)
    password: SecretStr = Field(min_length=1, max_length=512)
    ssl_mode: Literal["disable", "require", "verify-ca", "verify-full"] = "require"


class TableRef(BaseModel):
    schema_: str = Field(alias="schema", min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)


class SourceIn(BaseModel):
    table: Optional[TableRef] = None
    query: Optional[str] = Field(default=None, max_length=20000)


class LoadIn(SourceIn):
    module: str = Field(min_length=1, max_length=64)
    column_mapping: dict[str, str] = Field(default_factory=dict)
    system_id: Optional[str] = None


class ConnectionOut(BaseModel):
    id: str
    name: str
    engine: str
    host: str
    port: int
    database: str
    username: str
    ssl_mode: str
    created_by: Optional[str] = None
    created_at: str
    last_tested_at: Optional[str] = None
    last_test_ok: Optional[int] = None
    last_loaded_at: Optional[str] = None


class ConnectionList(BaseModel):
    connections: list[ConnectionOut]
    engines: list[str]
    max_rows: int
    timeout_s: int


class ConnectionTestOut(BaseModel):
    ok: bool
    error: Any = None


class TableOut(BaseModel):
    schema_: str = Field(alias="schema", serialization_alias="schema")
    name: str
    kind: str


class TableList(BaseModel):
    tables: list[TableOut]


class PreviewOut(BaseModel):
    columns: list[str]
    rows: list[list[Optional[str]]]


class LoadOut(BaseModel):
    version_id: str
    job_id: str
    status: str
    rows: int
    truncated: bool


def _http(e: xdb.ExternalDbError) -> HTTPException:
    return HTTPException(status_code=422, detail={"error": e.code, "detail": e.detail})


async def _row(db: AsyncSession, tenant: Tenant, conn_id: str, *, secret: bool = False) -> dict:
    try:
        cid = str(uuid.UUID(conn_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Connection not found")
    cols = _COLS + (", encrypted_password" if secret else "")
    r = (await db.execute(text(f"SELECT {cols} FROM external_db_connections WHERE id = CAST(:i AS uuid) AND tenant_id = :t"),
                          {"i": cid, "t": tenant.id})).mappings().first()
    if not r:
        raise HTTPException(status_code=404, detail="Connection not found")
    return dict(r)


def _out(r: dict) -> dict:
    return {k: (str(v) if k == "id" else v.isoformat() if hasattr(v, "isoformat") else v)
            for k, v in r.items() if k != "encrypted_password"}


def _password(tenant: Tenant, r: dict) -> str:
    return decrypt_password(str(tenant.id), r["encrypted_password"])


async def _in_thread(fn, *args, **kw):
    try:
        return await asyncio.to_thread(fn, *args, **kw)
    except xdb.ExternalDbError as e:
        raise _http(e)


@router.get("/connections", response_model=ConnectionList, dependencies=[Depends(require_permission("manage_systems"))])
async def list_connections(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    rows = (await db.execute(text(f"SELECT {_COLS} FROM external_db_connections WHERE tenant_id = :t ORDER BY name"),
                             {"t": tenant.id})).mappings().all()
    return {"connections": [_out(dict(r)) for r in rows], "engines": ["postgres"], "max_rows": xdb.MAX_ROWS,
            "timeout_s": xdb.STATEMENT_TIMEOUT_MS // 1000}


@router.post("/connections", status_code=201, response_model=ConnectionOut, dependencies=[Depends(require_permission("manage_systems"))])
async def create_connection(body: ConnectionIn, db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)):
    try:
        await asyncio.to_thread(xdb.resolve_safe, body.host, body.port)
    except xdb.ExternalDbError as e:
        raise _http(e)
    clash = (await db.execute(text("SELECT 1 FROM external_db_connections WHERE tenant_id = :t AND name = :n"),
                              {"t": tenant.id, "n": body.name})).scalar()
    if clash:
        raise HTTPException(status_code=409, detail={"error": "name_taken", "detail": "A connection with that name exists."})
    row = (await db.execute(text(
        "INSERT INTO external_db_connections (tenant_id, name, engine, host, port, database, username, "
        "encrypted_password, ssl_mode, created_by) VALUES (:t, :n, 'postgres', :h, :p, :d, :u, :pw, :s, :by) "
        f"RETURNING {_COLS}"),
        {"t": tenant.id, "n": body.name, "h": body.host, "p": body.port, "d": body.database, "u": body.username,
         "pw": encrypt_password(str(tenant.id), body.password.get_secret_value()), "s": body.ssl_mode,
         "by": current_user_label()})).mappings().one()
    await db.commit()
    logger.info("external db connection created tenant=%s id=%s", tenant.id, row["id"])
    return _out(dict(row))


@router.delete("/connections/{conn_id}", status_code=204, dependencies=[Depends(require_permission("manage_systems"))])
async def delete_connection(conn_id: str, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    r = await _row(db, tenant, conn_id)
    await db.execute(text("DELETE FROM external_db_connections WHERE id = CAST(:i AS uuid) AND tenant_id = :t"),
                     {"i": r["id"], "t": tenant.id})
    await db.commit()


@router.post("/connections/{conn_id}/test", response_model=ConnectionTestOut, dependencies=[Depends(require_permission("manage_systems"))])
async def test_connection(conn_id: str, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    r = await _row(db, tenant, conn_id, secret=True)
    ok, err = 1, None
    try:
        await _in_thread(xdb.ping, r, _password(tenant, r))
    except HTTPException as e:
        ok, err = 0, e.detail
    await db.execute(text("UPDATE external_db_connections SET last_tested_at = now(), last_test_ok = :ok "
                          "WHERE id = CAST(:i AS uuid) AND tenant_id = :t"), {"ok": ok, "i": r["id"], "t": tenant.id})
    await db.commit()
    return {"ok": bool(ok), "error": err}


@router.get("/connections/{conn_id}/tables", response_model=TableList, dependencies=[Depends(require_permission("manage_systems"))])
async def tables(conn_id: str, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    r = await _row(db, tenant, conn_id, secret=True)
    return {"tables": await _in_thread(xdb.list_tables, r, _password(tenant, r))}


@router.post("/connections/{conn_id}/preview", response_model=PreviewOut, dependencies=[Depends(require_permission("manage_systems"))])
async def preview(conn_id: str, body: SourceIn, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Column names and the first rows of the chosen table or query (at most 20), to map columns against."""
    r = await _row(db, tenant, conn_id, secret=True)
    df, _ = await _in_thread(xdb.fetch, r, _password(tenant, r), limit=20,
                             table=(body.table.schema_, body.table.name) if body.table else None, query=body.query)
    return {"columns": list(df.columns), "rows": [[None if pd.isna(v) else str(v) for v in row] for row in df.itertuples(index=False)]}


@router.post("/connections/{conn_id}/load", response_model=LoadOut, dependencies=[Depends(_load_rate_limit), Depends(require_permission("manage_systems"))])
async def load(request: Request, conn_id: str, body: LoadIn, db: AsyncSession = Depends(get_db),
               tenant: Tenant = Depends(get_tenant)):
    """Same path as a file upload: column mapping, parquet to storage, a version, then run_checks."""
    from api.middleware.licence import enforce_licensed_modules
    enforce_licensed_modules(request, [body.module])
    system_id = None
    if body.system_id:
        system_id = await _tenant_system(db, tenant.id, body.system_id)
        await _require_attach_right(request, db, tenant, system_id)
    r = await _row(db, tenant, conn_id, secret=True)
    df, truncated = await _in_thread(xdb.fetch, r, _password(tenant, r), limit=xdb.MAX_ROWS,
                                     table=(body.table.schema_, body.table.name) if body.table else None, query=body.query)
    if df.empty:
        raise HTTPException(status_code=422, detail={"error": "no_rows", "detail": "The source returned no rows."})

    module = body.module
    renames = {s: t for s, t in body.column_mapping.items() if s in df.columns and t}
    if len(set(renames.values())) != len(renames) or (set(renames.values()) & (set(df.columns) - set(renames))):
        raise HTTPException(status_code=422, detail={"error": "mapping_clash", "detail": "Two columns map to the same field."})
    df = df.rename(columns=renames)
    df = apply_column_mapping(df, module)
    known = get_standard_fields(module)
    short = {f.split(".")[-1] for f in known}
    # an admin-chosen rename does not exempt a column from formula-injection sanitising (as for an uncorroborated upload rename)
    exempt = {c for c in df.columns if (c in known or c in short) and c not in set(renames.values())}
    df = _sanitise_formula_injection(df, exempt)

    required = get_required_fields(module)
    present = set(df.columns)
    present_std = [f for f in required if f in present or f.split(".")[-1] in present]
    missing_std = [f for f in required if f not in present_std]
    all_short = short | known
    custom = [c for c in present if c not in known and c.split(".")[-1] not in all_short]

    file_id = str(uuid.uuid4())
    buf = io.BytesIO()
    try:
        df.to_parquet(buf, index=False)
    except Exception as e:
        logger.warning("external db parquet failed tenant=%s: %s", tenant.id, type(e).__name__)
        raise HTTPException(status_code=500, detail={"error": "parquet_serialization_failed",
                                                     "detail": "Server could not prepare the rows for analysis."})
    parquet_path = f"staging/{tenant.id}/{file_id}.parquet"
    try:
        minio_upload(settings.minio_bucket_uploads, parquet_path, buf.getvalue(), "application/octet-stream")
    except Exception as e:
        logger.exception("external db storage failed tenant=%s: %s", tenant.id, type(e).__name__)
        raise HTTPException(status_code=503, detail={"error": "storage_unavailable",
                                                     "detail": "Upload storage is unavailable. Please try again shortly."})

    from db.queries import versions
    ref = f"{body.table.schema_}.{body.table.name}" if body.table else "query"
    label = f"{r['name']}: {ref}"[:120]
    # recorded as an upload-class run (source/trigger "upload") so lineage and golden-record survivorship treat it
    # like a file; "origin" says where the rows came from. The query text is not stored (it may hold literals).
    metadata = {
        "source": "upload", "trigger": "upload", "origin": "external_db", "connection_id": str(r["id"]),
        "file_name": label, "row_count": len(df), "columns": list(df.columns), "modules": [module],
        "parquet_path": parquet_path, "truncated_at_row_cap": truncated,
        "standard_fields_present": sorted(present_std), "standard_fields_missing": sorted(missing_std),
        "custom_fields": sorted(custom),
    }
    if system_id:
        metadata["system_id"] = system_id
    version = await versions.create_version(db, tenant.id, metadata, label=label)
    step_n, _ = STEP_PARSE
    jobs.start_job(str(tenant.id), str(version.id), "upload", label, status="queued",
                   progress_key=str(version.id), version_id=str(version.id))
    update_task_progress(str(version.id), status="queued", current_step="Waiting for worker to start checks",
                         step_number=step_n, total_steps=TOTAL_STEPS, rows_processed=0, total_rows=len(df),
                         percent_complete=int((step_n / TOTAL_STEPS) * 100))
    job_id = await _enqueue_checks(db, tenant.id, version.id, parquet_path, total_rows=len(df))
    await db.execute(text("UPDATE external_db_connections SET last_loaded_at = now() "
                          "WHERE id = CAST(:i AS uuid) AND tenant_id = :t"), {"i": r["id"], "t": tenant.id})
    await db.commit()
    logger.info("external db load tenant=%s conn=%s rows=%d version=%s", tenant.id, r["id"], len(df), version.id)
    return {"version_id": str(version.id), "job_id": job_id, "status": "pending", "rows": len(df),
            "truncated": truncated}
