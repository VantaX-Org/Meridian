"""Migration mode API — source→source / source→destination transfer readiness.

source_to_destination gap-analyses cleaned source data against a *live*
destination SAP system and gates SAP-loadable exports on a `go` verdict.
source_to_source delegates to the existing 4-eyes writeback flow.

Deterministic throughout — no LLM, no raw SAP values in responses.
"""

import io
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/migration", tags=["migration"])

_VALID_MODES = ("source_to_source", "source_to_destination")
_EXPORT_FORMATS = ("csv", "lsmw", "bapi", "idoc", "sf_csv", "xlsx")


# ── Pydantic ──────────────────────────────────────────────────────────────────


class AnalyzeBody(BaseModel):
    mode: str
    source_system_id: str
    dest_system_id: Optional[str] = None
    modules: list[str] = []


class FieldMapUpdate(BaseModel):
    dest_table: Optional[str] = None
    dest_field: Optional[str] = None
    transform_note: Optional[str] = None
    is_confirmed: Optional[bool] = None


class SeedBody(BaseModel):
    module: str
    dest_system_type: str


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


def _row(r) -> dict:
    return dict(r._mapping)


async def _load_system(db: AsyncSession, tenant_id, system_id: str):
    r = await db.execute(
        text("SELECT id, system_type, name, health_status FROM sap_systems "
             "WHERE id = :sid AND tenant_id = :tid"),
        {"sid": system_id, "tid": str(tenant_id)},
    )
    return r.fetchone()


# ── POST /migration/analyze ───────────────────────────────────────────────────


@router.post("/analyze")
async def start_migration(
    body: AnalyzeBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    if body.mode not in _VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Unknown mode: {body.mode}")
    if not body.modules:
        raise HTTPException(status_code=400, detail="At least one module is required.")

    await _set_rls(db, tenant.id)

    source = await _load_system(db, tenant.id, body.source_system_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source system not found.")

    dest_id = None
    if body.mode == "source_to_destination":
        if not body.dest_system_id:
            raise HTTPException(
                status_code=400,
                detail="A destination system is required for source_to_destination.",
            )
        if body.dest_system_id == body.source_system_id:
            raise HTTPException(
                status_code=400, detail="Destination must differ from the source system.")
        dest = await _load_system(db, tenant.id, body.dest_system_id)
        if not dest:
            raise HTTPException(status_code=404, detail="Destination system not found.")
        # Require a live destination — every gap must be target-confirmed.
        if dest.health_status != "healthy":
            raise HTTPException(
                status_code=400,
                detail=("Destination is not connected (health: "
                        f"{dest.health_status or 'unknown'}). Connect and health-check "
                        "the destination before analysing — no baseline fallback."),
            )
        dest_id = body.dest_system_id

    run_id = str(uuid.uuid4())
    requested_by = getattr(request.state, "local_user_id", None)
    await db.execute(
        text("""
            INSERT INTO migration_runs
                (id, tenant_id, mode, source_system_id, dest_system_id, modules,
                 status, requested_by)
            VALUES (:id, :tid, :mode, :src, :dst, :mods, 'queued', :uid)
        """),
        {"id": run_id, "tid": str(tenant.id), "mode": body.mode,
         "src": body.source_system_id, "dst": dest_id, "mods": body.modules,
         "uid": requested_by},
    )
    await db.commit()

    from workers.tasks.run_migration import run_migration
    task = run_migration.delay(
        str(tenant.id), run_id, body.mode, body.source_system_id, dest_id, body.modules)
    await db.execute(
        text("UPDATE migration_runs SET task_id = :tid WHERE id = :rid"),
        {"tid": task.id, "rid": run_id},
    )
    await db.commit()

    return {"run_id": run_id, "task_id": task.id, "status": "queued",
            "mode": body.mode, "modules": body.modules}


# ── GET /migration/runs ───────────────────────────────────────────────────────


@router.get("/runs")
async def list_runs(
    status: Optional[str] = None,
    mode: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    await _set_rls(db, tenant.id)
    where = "tenant_id = :tid"
    params: dict = {"tid": str(tenant.id)}
    if status:
        where += " AND status = :st"
        params["st"] = status
    if mode:
        where += " AND mode = :mode"
        params["mode"] = mode
    r = await db.execute(
        text(f"""
            SELECT id, mode, source_system_id, dest_system_id, modules, status,
                   readiness_verdict, readiness_score, critical_count,
                   created_at, completed_at
            FROM migration_runs WHERE {where}
            ORDER BY created_at DESC LIMIT 100
        """),
        params,
    )
    return {"runs": [_row(x) for x in r.fetchall()]}


# ── GET /migration/runs/{run_id} ──────────────────────────────────────────────


@router.get("/runs/{run_id}")
async def get_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    await _set_rls(db, tenant.id)
    r = await db.execute(
        text("SELECT * FROM migration_runs WHERE id = :rid AND tenant_id = :tid"),
        {"rid": run_id, "tid": str(tenant.id)},
    )
    run = r.fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")

    total = await db.execute(
        text("SELECT COUNT(*) FROM migration_gap_findings WHERE run_id = :rid"),
        {"rid": run_id},
    )
    findings_total = int(total.scalar() or 0)

    fr = await db.execute(
        text("""
            SELECT module, object_type, record_key, dest_table, field, gap_type,
                   severity, detail, status_source, domain_provenance
            FROM migration_gap_findings WHERE run_id = :rid
            ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                     WHEN 'medium' THEN 2 ELSE 3 END
            LIMIT 200
        """),
        {"rid": run_id},
    )
    return {
        "run": _row(run),
        "findings_total": findings_total,
        "findings": [_row(x) for x in fr.fetchall()],
    }


# ── GET /migration/export/{run_id}/{format} ───────────────────────────────────


@router.get("/export/{run_id}/{export_format}")
async def export_migration(
    run_id: str,
    export_format: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    request: Request = None,
    _role: str = Depends(require_permission("export")),
):
    if export_format not in _EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {export_format}")

    await _set_rls(db, tenant.id)
    r = await db.execute(
        text("SELECT id, mode, readiness_verdict, modules FROM migration_runs "
             "WHERE id = :rid AND tenant_id = :tid"),
        {"rid": run_id, "tid": str(tenant.id)},
    )
    run = r.fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")

    # Gate: load files only when the transfer is certified ready.
    if run.readiness_verdict != "go":
        raise HTTPException(
            status_code=409,
            detail=(f"Export blocked — transfer verdict is "
                    f"'{run.readiness_verdict or 'not analysed'}'. Only 'go' runs are "
                    "exportable; remediate the blocking gaps first."),
        )

    # Records with any gap finding are not transfer-ready — exclude them.
    blocked = await db.execute(
        text("SELECT DISTINCT module, record_key FROM migration_gap_findings "
             "WHERE run_id = :rid"),
        {"rid": run_id},
    )
    blocked_by_module: dict[str, set] = {}
    for m, k in blocked.fetchall():
        blocked_by_module.setdefault(m, set()).add(k)

    records_by_type: dict[str, list[dict]] = {}
    for module in (run.modules or []):
        keys, recs = await _pull_source(db, tenant.id, module)
        bad = blocked_by_module.get(module, set())
        for key, rec in zip(keys, recs):
            if key in bad:
                continue
            records_by_type.setdefault(module, []).append(rec)

    if not any(records_by_type.values()):
        raise HTTPException(status_code=404, detail="No transfer-ready records to export.")

    from api.services.export_engine import ExportEngine
    engine = ExportEngine()

    if export_format == "xlsx":
        content_bytes = engine.export_xlsx_multi(records_by_type)
        return _stream(content_bytes,
                       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                       f"migration_{run_id}.xlsx")

    dispatch = {"csv": engine.export_csv, "lsmw": engine.export_lsmw,
                "bapi": engine.export_bapi, "idoc": engine.export_idoc,
                "sf_csv": engine.export_sf_csv}
    segments = []
    for ot, recs in records_by_type.items():
        body = dispatch[export_format](recs, ot)
        segments.append(f"# object_type={ot} count={len(recs)}\n{body}"
                        if len(records_by_type) > 1 else body)
    content = "\n\n".join(segments)

    media = {"csv": "text/csv", "lsmw": "text/plain", "bapi": "application/json",
             "idoc": "application/json", "sf_csv": "text/csv"}[export_format]
    ext = {"csv": "csv", "lsmw": "txt", "bapi": "json", "idoc": "json",
           "sf_csv": "csv"}[export_format]

    # Audit row (metadata only — no raw values).
    total = sum(len(v) for v in records_by_type.values())
    exported_by = getattr(request.state, "local_user_id", None) if request else None
    await db.execute(
        text("""
            INSERT INTO migration_export_files
                (id, tenant_id, run_id, export_format, record_count, filename, exported_by)
            VALUES (gen_random_uuid(), :tid, :rid, :fmt, :cnt, :fn, :uid)
        """),
        {"tid": str(tenant.id), "rid": run_id, "fmt": export_format, "cnt": total,
         "fn": f"migration_{run_id}.{ext}", "uid": exported_by},
    )
    await db.execute(
        text("UPDATE migration_runs SET status = 'exported' WHERE id = :rid"),
        {"rid": run_id},
    )
    await db.commit()

    return _stream(content.encode(), media, f"migration_{run_id}.{ext}")


def _stream(data: bytes, media_type: str, filename: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(data), media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


async def _pull_source(db: AsyncSession, tenant_id, module: str):
    """Async mirror of run_migration._pull_source — same keys, same order."""
    r = await db.execute(
        text("SELECT sap_object_key, golden_fields FROM master_records "
             "WHERE tenant_id = :tid AND domain = :m "
             "AND status IN ('golden', 'pending_review')"),
        {"tid": str(tenant_id), "m": module},
    )
    rows = r.fetchall()
    if rows:
        return [x[0] for x in rows], [dict(x[1] or {}) for x in rows]
    r = await db.execute(
        text("SELECT record_key, record_data_after, record_data_before FROM cleaning_queue "
             "WHERE tenant_id = :tid AND object_type = :m AND status = 'approved'"),
        {"tid": str(tenant_id), "m": module},
    )
    keys, records = [], []
    for x in r.fetchall():
        data = dict(x[1] or x[2] or {})
        data = {k: v for k, v in data.items() if k not in ("issue", "error")}
        keys.append(x[0])
        records.append(data)
    return keys, records


# ── Field-map CRUD ────────────────────────────────────────────────────────────


@router.get("/field-map")
async def get_field_map(
    module: str = Query(...),
    dest_system_type: str = Query(...),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    r = await db.execute(
        text("""
            SELECT id, module, source_field, source_data_type, dest_system_type,
                   dest_table, dest_field, transform_note, is_confirmed
            FROM transfer_field_mappings
            WHERE tenant_id = :tid AND module = :m AND dest_system_type = :dst
            ORDER BY source_field
        """),
        {"tid": str(tenant.id), "m": module, "dst": dest_system_type},
    )
    return {"mappings": [_row(x) for x in r.fetchall()]}


@router.put("/field-map/{mapping_id}")
async def update_field_map(
    mapping_id: str,
    body: FieldMapUpdate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    sets, params = [], {"id": mapping_id, "tid": str(tenant.id)}
    for col in ("dest_table", "dest_field", "transform_note", "is_confirmed"):
        val = getattr(body, col)
        if val is not None:
            sets.append(f"{col} = :{col}")
            params[col] = val
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update.")
    sets.append("updated_at = now()")
    r = await db.execute(
        text(f"UPDATE transfer_field_mappings SET {', '.join(sets)} "
             "WHERE id = :id AND tenant_id = :tid RETURNING id"),
        params,
    )
    if not r.fetchone():
        raise HTTPException(status_code=404, detail="Mapping not found.")
    await db.commit()
    return {"id": mapping_id, "updated": True}


@router.post("/field-map/seed")
async def seed_field_map(
    body: SeedBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    """Populate an editable starting map by exact-name match against the
    destination dictionary for the module + dest_system_type."""
    from sap.data_dictionary import get_field_metadata, get_table_metadata
    from sap.extraction_registry import get_table_names

    await _set_rls(db, tenant.id)

    tables = get_table_names(body.dest_system_type, body.module)
    if not tables:
        raise HTTPException(
            status_code=400,
            detail=f"No destination tables known for module '{body.module}' on "
                   f"'{body.dest_system_type}'.")

    seeded = 0
    for table in tables:
        meta = get_table_metadata(table)
        if not meta:
            continue
        for field_name in meta.keys():
            fmeta = get_field_metadata(table, field_name) or {}
            await db.execute(
                text("""
                    INSERT INTO transfer_field_mappings
                        (id, tenant_id, module, source_field, source_data_type,
                         dest_system_type, dest_table, dest_field, is_confirmed)
                    VALUES (gen_random_uuid(), :tid, :m, :sf, :dt, :dst, :tbl, :df, false)
                    ON CONFLICT (tenant_id, module, source_field, dest_system_type)
                    DO NOTHING
                """),
                {"tid": str(tenant.id), "m": body.module, "sf": field_name,
                 "dt": fmeta.get("data_type"), "dst": body.dest_system_type,
                 "tbl": table, "df": field_name},
            )
            seeded += 1
    await db.commit()
    return {"seeded": seeded, "module": body.module, "dest_system_type": body.dest_system_type}
