"""Migration mode API — source→source / source→destination transfer runs.

MODE selector on the transfer workflow. source_to_destination cleans SOURCE
master data and gap-analyses it against a live DESTINATION SAP system's own
config, gating SAP-loadable export behind a `go` verdict. No LLM, no live
destination write. RLS enforced on every query.
"""

import io
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/migration", tags=["migration"])

_VALID_MODES = ("source_to_source", "source_to_destination")
_VALID_FORMATS = ("csv", "lsmw", "bapi", "idoc", "sf_csv", "xlsx")


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


# ── Pydantic bodies ───────────────────────────────────────────────────────────


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


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _system_exists(db: AsyncSession, tenant_id, system_id: str) -> Optional[dict]:
    row = await db.execute(
        text("""
            SELECT id, system_type, health_status
              FROM sap_systems WHERE id=:sid AND tenant_id=:tid
        """),
        {"sid": system_id, "tid": str(tenant_id)},
    )
    r = row.mappings().first()
    return dict(r) if r else None


# ── Endpoints ──────────────────────────────────────────────────────────────────


@router.post("/analyze")
async def analyze(
    body: AnalyzeBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    if body.mode not in _VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Unknown mode: {body.mode}")
    if not body.modules:
        raise HTTPException(status_code=400, detail="At least one module is required.")

    await _set_rls(db, tenant.id)

    source = await _system_exists(db, tenant.id, body.source_system_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source system not found.")

    if body.mode == "source_to_destination":
        if not body.dest_system_id:
            raise HTTPException(
                status_code=400,
                detail="A destination system is required for source_to_destination.",
            )
        if body.dest_system_id == body.source_system_id:
            raise HTTPException(
                status_code=400, detail="Destination must differ from source."
            )
        dest = await _system_exists(db, tenant.id, body.dest_system_id)
        if dest is None:
            raise HTTPException(status_code=404, detail="Destination system not found.")
        # Live destination required — no baseline fallback.
        if dest.get("health_status") != "healthy":
            raise HTTPException(
                status_code=400,
                detail="Connect the destination first — it must be healthy before analysis.",
            )

    run_id = str(uuid.uuid4())
    requested_by = getattr(tenant, "user_id", None)
    await db.execute(
        text("""
            INSERT INTO migration_runs
                (id, tenant_id, mode, source_system_id, dest_system_id,
                 modules, status, requested_by)
            VALUES (:rid, :tid, :mode, :src, :dst, :mods, 'queued', :rb)
        """),
        {
            "rid": run_id, "tid": str(tenant.id), "mode": body.mode,
            "src": body.source_system_id, "dst": body.dest_system_id,
            "mods": body.modules, "rb": str(requested_by) if requested_by else None,
        },
    )
    await db.commit()

    from workers.tasks.run_migration import run_migration
    task = run_migration.delay(
        str(tenant.id), run_id, body.mode, body.source_system_id,
        body.dest_system_id, body.modules,
    )
    await db.execute(
        text("UPDATE migration_runs SET task_id=:t WHERE id=:rid AND tenant_id=:tid"),
        {"t": task.id, "rid": run_id, "tid": str(tenant.id)},
    )
    await db.commit()

    return {"run_id": run_id, "task_id": task.id, "status": "queued",
            "mode": body.mode, "modules": body.modules}


@router.get("/runs")
async def list_runs(
    status: Optional[str] = Query(None),
    mode: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    await _set_rls(db, tenant.id)
    where = "tenant_id=:tid"
    params: dict = {"tid": str(tenant.id)}
    if status:
        where += " AND status=:st"
        params["st"] = status
    if mode:
        where += " AND mode=:mode"
        params["mode"] = mode
    rows = await db.execute(
        text(f"""
            SELECT id, mode, source_system_id, dest_system_id, modules, status,
                   readiness_verdict, readiness_score, critical_count, task_id,
                   created_at, completed_at
              FROM migration_runs WHERE {where}
             ORDER BY created_at DESC
        """),
        params,
    )
    return {"runs": [dict(r) for r in rows.mappings().all()]}


@router.get("/runs/{run_id}")
async def get_run(
    run_id: str,
    findings_limit: int = Query(200, le=1000),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    await _set_rls(db, tenant.id)
    run = await db.execute(
        text("""
            SELECT id, mode, source_system_id, dest_system_id, modules, status,
                   readiness_verdict, readiness_score, critical_count, gap_summary,
                   task_id, error_detail, created_at, completed_at
              FROM migration_runs WHERE id=:rid AND tenant_id=:tid
        """),
        {"rid": run_id, "tid": str(tenant.id)},
    )
    r = run.mappings().first()
    if r is None:
        raise HTTPException(status_code=404, detail="Migration run not found.")

    total = await db.execute(
        text("SELECT COUNT(*) FROM migration_gap_findings WHERE run_id=:rid AND tenant_id=:tid"),
        {"rid": run_id, "tid": str(tenant.id)},
    )
    findings_total = int(total.scalar() or 0)

    ready = await db.execute(
        text("""
            SELECT COUNT(DISTINCT record_key) FROM migration_gap_findings
             WHERE run_id=:rid AND tenant_id=:tid AND transfer_ready=true
        """),
        {"rid": run_id, "tid": str(tenant.id)},
    )
    transfer_ready_count = int(ready.scalar() or 0)

    findings = await db.execute(
        text("""
            SELECT module, object_type, record_key, dest_table, field, gap_type,
                   severity, detail, status_source, domain_provenance, transfer_ready
              FROM migration_gap_findings WHERE run_id=:rid AND tenant_id=:tid
             ORDER BY severity, module LIMIT :lim
        """),
        {"rid": run_id, "tid": str(tenant.id), "lim": findings_limit},
    )

    out = dict(r)
    out["findings"] = [dict(f) for f in findings.mappings().all()]
    out["findings_total"] = findings_total
    out["transfer_ready_count"] = transfer_ready_count
    return out


@router.get("/export/{run_id}/{export_format}")
async def export_run(
    run_id: str,
    export_format: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export")),
):
    if export_format not in _VALID_FORMATS:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {export_format}")

    await _set_rls(db, tenant.id)
    run = await db.execute(
        text("""
            SELECT readiness_verdict, modules FROM migration_runs
             WHERE id=:rid AND tenant_id=:tid
        """),
        {"rid": run_id, "tid": str(tenant.id)},
    )
    r = run.mappings().first()
    if r is None:
        raise HTTPException(status_code=404, detail="Migration run not found.")

    # GATE — only a `go` verdict may export load files.
    if r["readiness_verdict"] != "go":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Export blocked: transfer-readiness verdict is "
                f"'{r['readiness_verdict'] or 'not analysed'}'. Remediate all blocking "
                f"gaps until the verdict is 'go'."
            ),
        )

    # A record is loadable unless it carries a non-ready (blocking) finding.
    blocked_rows = await db.execute(
        text("""
            SELECT DISTINCT record_key FROM migration_gap_findings
             WHERE run_id=:rid AND tenant_id=:tid AND transfer_ready=false
        """),
        {"rid": run_id, "tid": str(tenant.id)},
    )
    blocked = {row[0] for row in blocked_rows.fetchall()}

    records_by_type: dict[str, list[dict]] = {}
    for module in (r["modules"] or []):
        recs = await _pull_source_records_async(db, tenant.id, module)
        for rec in recs:
            if rec["record_key"] not in blocked:
                records_by_type.setdefault(module, []).append(rec["data"])

    records_by_type = {k: v for k, v in records_by_type.items() if v}
    if not records_by_type:
        raise HTTPException(status_code=404, detail="No transfer-ready records to export.")

    from api.services.export_engine import ExportEngine
    engine = ExportEngine()

    if export_format == "xlsx":
        content_bytes = engine.export_xlsx_multi(records_by_type)
        filename = f"migration_{run_id}.xlsx"
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        payload = io.BytesIO(content_bytes)
    else:
        dispatch = {
            "csv": engine.export_csv, "lsmw": engine.export_lsmw,
            "bapi": engine.export_bapi, "idoc": engine.export_idoc,
            "sf_csv": engine.export_sf_csv,
        }
        segments = []
        for ot, recs in records_by_type.items():
            body = dispatch[export_format](recs, ot)
            segments.append(f"# object_type={ot} count={len(recs)}\n{body}"
                            if len(records_by_type) > 1 else body)
        content = "\n\n".join(segments)
        exts = {"csv": "csv", "lsmw": "txt", "bapi": "json", "idoc": "json", "sf_csv": "csv"}
        medias = {"csv": "text/csv", "lsmw": "text/plain", "bapi": "application/json",
                  "idoc": "application/json", "sf_csv": "text/csv"}
        filename = f"migration_{run_id}.{exts[export_format]}"
        media = medias[export_format]
        payload = io.BytesIO(content.encode())

    total_records = sum(len(v) for v in records_by_type.values())
    await db.execute(
        text("""
            INSERT INTO migration_export_files
                (id, tenant_id, run_id, export_format, record_count, filename, exported_by)
            VALUES (gen_random_uuid(), :tid, :rid, :fmt, :cnt, :fn, :by)
        """),
        {
            "tid": str(tenant.id), "rid": run_id, "fmt": export_format,
            "cnt": total_records, "fn": filename,
            "by": str(getattr(tenant, "user_id", None) or "") or None,
        },
    )
    await db.commit()

    return StreamingResponse(
        payload, media_type=media,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


async def _pull_source_records_async(db: AsyncSession, tenant_id, module) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT sap_object_key AS record_key, golden_fields AS data
              FROM master_records
             WHERE tenant_id=:tid AND domain=:mod
               AND status IN ('golden','pending_review')
        """),
        {"tid": str(tenant_id), "mod": module},
    )
    got = rows.mappings().all()
    if got:
        return [{"record_key": r["record_key"], "data": r["data"] or {}} for r in got]
    rows = await db.execute(
        text("""
            SELECT record_key, record_data_after AS data FROM cleaning_queue
             WHERE tenant_id=:tid AND object_type=:mod AND status IN ('approved','applied')
        """),
        {"tid": str(tenant_id), "mod": module},
    )
    return [
        {"record_key": r["record_key"],
         "data": {k: v for k, v in (r["data"] or {}).items() if k not in ("issue", "error")}}
        for r in rows.mappings().all()
    ]


# ── Field-map CRUD ──────────────────────────────────────────────────────────────


@router.get("/field-map")
async def get_field_map(
    module: str = Query(...),
    dest_system_type: str = Query(...),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    rows = await db.execute(
        text("""
            SELECT id, module, source_field, source_data_type, dest_system_type,
                   dest_table, dest_field, transform_note, is_confirmed
              FROM transfer_field_mappings
             WHERE tenant_id=:tid AND module=:mod AND dest_system_type=:dst
             ORDER BY source_field
        """),
        {"tid": str(tenant.id), "mod": module, "dst": dest_system_type},
    )
    return {"mappings": [dict(r) for r in rows.mappings().all()]}


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
    for fld in ("dest_table", "dest_field", "transform_note", "is_confirmed"):
        val = getattr(body, fld)
        if val is not None:
            sets.append(f"{fld}=:{fld}")
            params[fld] = val
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update.")
    sets.append("updated_at=now()")
    res = await db.execute(
        text(f"""
            UPDATE transfer_field_mappings SET {', '.join(sets)}
             WHERE id=:id AND tenant_id=:tid
        """),
        params,
    )
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Mapping not found.")
    return {"updated": True, "id": mapping_id}


@router.post("/field-map/seed")
async def seed_field_map(
    body: SeedBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    """Auto-populate the field map by exact-name match against the destination
    dictionary — an editable starting point, every row is_confirmed=false."""
    from sap.data_dictionary import get_field_metadata
    from sap.extraction_registry import get_extraction_targets

    targets = get_extraction_targets(body.dest_system_type.lower(), body.module,
                                     include_config=False)
    if not targets:
        raise HTTPException(
            status_code=400,
            detail=f"No known destination tables for module '{body.module}' on "
                   f"'{body.dest_system_type}'.",
        )

    await _set_rls(db, tenant.id)
    seeded = 0
    for tgt in targets:
        if getattr(tgt, "is_config", False):
            continue
        table = tgt.source
        for field in (tgt.fields or []):
            meta = get_field_metadata(table, field)
            dtype = meta.get("data_type") if meta else None
            # ON CONFLICT keeps any steward edits already made.
            await db.execute(
                text("""
                    INSERT INTO transfer_field_mappings
                        (id, tenant_id, module, source_field, source_data_type,
                         dest_system_type, dest_table, dest_field, is_confirmed)
                    VALUES (gen_random_uuid(), :tid, :mod, :sf, :dt, :dst, :tbl, :fld, false)
                    ON CONFLICT (tenant_id, module, source_field, dest_system_type)
                    DO NOTHING
                """),
                {
                    "tid": str(tenant.id), "mod": body.module, "sf": field,
                    "dt": dtype, "dst": body.dest_system_type, "tbl": table, "fld": field,
                },
            )
            seeded += 1
    await db.commit()
    return {"seeded": seeded, "module": body.module, "dest_system_type": body.dest_system_type}
