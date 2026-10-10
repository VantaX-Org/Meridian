"""Migration readiness API — source system → target (S/4HANA) transfer analysis.

source_to_destination gap-analyses the source system's analysed data (record
grain) against a connected target system's live dictionary + configuration,
or — before the target exists — the SAP S/4HANA standard dictionary.
Load files contain only records without blocking gaps.

Deterministic throughout — no LLM. Values shown are the customer's own data
inside the customer's deployment.
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
from api.services.branded_xlsx import ColumnSpec, SheetSpec, build_workbook
from api.services.rbac import current_user_id, require_permission

router = APIRouter(prefix="/api/v1/migration", tags=["migration"])

_VALID_MODES = ("source_to_source", "source_to_destination")


# ── Pydantic ──────────────────────────────────────────────────────────────────


class AnalyzeBody(BaseModel):
    mode: str
    source_system_id: Optional[str] = None
    source_version_id: Optional[str] = None   # default: latest analysis of the source system
    dest_system_id: Optional[str] = None      # connected target (live DDIC + config)
    target_release: str = "s4hana"            # used when no target system is connected
    modules: list[str] = []


class FieldMapUpdate(BaseModel):
    dest_table: Optional[str] = None
    dest_field: Optional[str] = None
    transform_note: Optional[str] = None
    is_confirmed: Optional[bool] = None
    value_map: Optional[bool] = None


class FieldMapCreate(BaseModel):
    module: str
    dest_system_type: str
    source_field: str                # TABLE.FIELD in the source
    dest_table: Optional[str] = None  # NULL target ⇒ intentionally not migrated
    dest_field: Optional[str] = None
    value_map: bool = False
    transform_note: Optional[str] = None


class SeedBody(BaseModel):
    module: str
    dest_system_type: str = "s4hana"
    source_system_id: Optional[str] = None
    source_version_id: Optional[str] = None


class ValueMapEntry(BaseModel):
    source_value: str
    target_value: str
    note: Optional[str] = None


class ValueMapUpsert(BaseModel):
    module: str
    target_field: str   # TABLE.FIELD in the target
    entries: list[ValueMapEntry]


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

    if not body.source_system_id and not body.source_version_id:
        raise HTTPException(status_code=400, detail="A source system or a source analysis version is required.")
    if body.source_system_id and not await _load_system(db, tenant.id, body.source_system_id):
        raise HTTPException(status_code=404, detail="Source system not found.")

    dest_id = None
    if body.mode == "source_to_destination" and body.dest_system_id:
        if body.dest_system_id == body.source_system_id:
            raise HTTPException(status_code=400, detail="Destination must differ from the source system.")
        if not await _load_system(db, tenant.id, body.dest_system_id):
            raise HTTPException(status_code=404, detail="Destination system not found.")
        dest_id = body.dest_system_id
    if body.mode == "source_to_destination" and not dest_id:
        from sap.ddic import RELEASE_FOR_SYSTEM
        if body.target_release not in ("s4hana", "ecc6") and body.target_release not in RELEASE_FOR_SYSTEM:
            raise HTTPException(status_code=400, detail=f"Unknown target release '{body.target_release}'.")

    run_id = str(uuid.uuid4())
    requested_by = current_user_id(request)
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
        str(tenant.id), run_id, body.mode, body.source_system_id, dest_id, body.modules,
        body.source_version_id, body.target_release)
    await db.execute(
        text("UPDATE migration_runs SET task_id = :tid WHERE id = :rid"),
        {"tid": task.id, "rid": run_id},
    )
    await db.commit()

    return {"run_id": run_id, "task_id": task.id, "status": "queued",
            "mode": body.mode, "modules": body.modules}


# ── Runs ──────────────────────────────────────────────────────────────────────


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
            SELECT id, mode, source_system_id, dest_system_id, source_version_id, target_release,
                   target_connected, modules, status, readiness_verdict, readiness_score, critical_count,
                   records_total, records_blocked, error_detail, created_at, completed_at
            FROM migration_runs WHERE {where}
            ORDER BY created_at DESC LIMIT 100
        """),
        params,
    )
    return {"runs": [_row(x) for x in r.fetchall()]}


@router.get("/runs/{run_id}")
async def get_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    """Run header, per-module verdicts and gap counts by type/severity."""
    await _set_rls(db, tenant.id)
    run = (await db.execute(text("SELECT * FROM migration_runs WHERE id = :rid"), {"rid": run_id})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    agg = await db.execute(
        text("""
            SELECT module, gap_type, severity, grounded, COUNT(*) AS n,
                   COUNT(DISTINCT record_key) AS records, COUNT(DISTINCT field) AS fields
            FROM migration_gap_findings WHERE run_id = :rid
            GROUP BY module, gap_type, severity, grounded
            ORDER BY module, CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                     WHEN 'medium' THEN 2 ELSE 3 END, gap_type
        """),
        {"rid": run_id},
    )
    breakdown = [_row(x) for x in agg.fetchall()]
    structural = (await db.execute(text(_STRUCTURAL_SQL), {"rid": run_id})).scalar()
    return {"run": _row(run), "gap_breakdown": breakdown, "structural_critical": int(structural or 0)}


# Critical gaps with no record key hit every record (missing/obsolete target field) → export gate.
_STRUCTURAL_SQL = ("SELECT COUNT(*) FROM migration_gap_findings WHERE run_id = :rid "
                   "AND severity = 'critical' AND record_key IS NULL")

_FINDING_COLS = ("module, source_table, record_key, source_field, source_value, dest_table, field AS target_field, "
                 "target_value, gap_type, severity, detail, provenance, grounded")


def _findings_where(run_id, module, gap_type, severity, grounded, search) -> tuple[str, dict]:
    where, params = ["run_id = :rid"], {"rid": run_id}
    for col, val in (("module", module), ("gap_type", gap_type), ("severity", severity)):
        if val:
            where.append(f"{col} = :{col}")
            params[col] = val
    if grounded is not None:
        where.append("grounded = :grounded")
        params["grounded"] = grounded
    if search:
        where.append("(record_key ILIKE :q OR field ILIKE :q OR source_field ILIKE :q OR source_value ILIKE :q)")
        params["q"] = f"%{search}%"
    return " AND ".join(where), params


@router.get("/runs/{run_id}/findings")
async def run_findings(
    run_id: uuid.UUID,
    module: Optional[str] = None,
    gap_type: Optional[str] = None,
    severity: Optional[str] = None,
    grounded: Optional[bool] = None,
    search: Optional[str] = None,
    limit: int = Query(100, le=1000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    await _set_rls(db, tenant.id)
    where, params = _findings_where(run_id, module, gap_type, severity, grounded, search)
    total = (await db.execute(text(f"SELECT COUNT(*) FROM migration_gap_findings WHERE {where}"), params)).scalar()
    rows = await db.execute(
        text(f"""
            SELECT {_FINDING_COLS} FROM migration_gap_findings WHERE {where}
            ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                     gap_type, record_key NULLS FIRST
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": limit, "offset": offset},
    )
    return {"total": int(total or 0), "items": [_row(x) for x in rows.fetchall()]}


@router.get("/runs/{run_id}/findings/export")
async def export_findings(
    run_id: uuid.UUID,
    format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
    module: Optional[str] = None,
    gap_type: Optional[str] = None,
    severity: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export")),
):
    """Every gap of a run (the remediation work list), as CSV or XLSX."""
    await _set_rls(db, tenant.id)
    where, params = _findings_where(run_id, module, gap_type, severity, None, None)
    rows = (await db.execute(text(f"SELECT {_FINDING_COLS} FROM migration_gap_findings WHERE {where}"), params)).fetchall()
    dicts = [_row(x) for x in rows]
    if format == "csv":
        import pandas as pd

        return _stream(pd.DataFrame(dicts).to_csv(index=False).encode(), "text/csv", f"migration_gaps_{run_id}.csv")
    keys = list(dicts[0].keys()) if dicts else [
        "module", "source_table", "record_key", "source_field", "source_value", "dest_table",
        "target_field", "target_value", "gap_type", "severity", "detail", "provenance", "grounded",
    ]
    columns = [
        ColumnSpec(key=k, header=k, kind="mono" if k in ("record_key", "source_table", "dest_table") else "text")
        for k in keys
    ]
    data = build_workbook(
        tenant_name=tenant.name,
        run_label=None,
        run_id=str(run_id),
        title="Migration gap findings export",
        sheets=[SheetSpec(title="Gap findings", columns=columns, rows=dicts)],
    )
    return _stream(data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                   f"migration_gaps_{run_id}.xlsx")


@router.get("/runs/{run_id}/value-candidates")
async def value_candidates(
    run_id: uuid.UUID,
    target_field: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    """Distinct source values that still need a target value mapping (with record counts)."""
    await _set_rls(db, tenant.id)
    rows = await db.execute(
        text("SELECT source_value, COUNT(*) FROM migration_gap_findings WHERE run_id = :rid AND field = :tf "
             "AND gap_type = 'value_unmapped' GROUP BY source_value ORDER BY COUNT(*) DESC"),
        {"rid": run_id, "tf": target_field},
    )
    return {"target_field": target_field, "values": [{"source_value": v, "records": n} for v, n in rows.fetchall()]}


# ── Load files (ready records only) ───────────────────────────────────────────


@router.get("/export/{run_id}/{export_format}")
async def export_migration(
    run_id: uuid.UUID,
    export_format: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export")),
):
    """Target load files (one sheet/CSV per target table) for records without blocking gaps."""
    if export_format not in ("csv", "xlsx"):
        raise HTTPException(status_code=400, detail="Load files are produced as csv (zip) or xlsx.")
    await _set_rls(db, tenant.id)
    run = (await db.execute(text("SELECT * FROM migration_runs WHERE id = :rid"), {"rid": run_id})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    if run.status not in ("analysed", "exported"):
        raise HTTPException(status_code=409, detail="The run has not finished analysing.")
    structural = (await db.execute(text(_STRUCTURAL_SQL), {"rid": run_id})).scalar()
    if structural:
        raise HTTPException(status_code=409, detail=(
            f"Export blocked — {structural} structural critical gap(s) (missing/obsolete target fields). "
            "Fix the field map and re-analyse."))
    blocked: dict[str, set[str]] = {}
    for m, k in (await db.execute(text(
        "SELECT DISTINCT module, record_key FROM migration_gap_findings WHERE run_id = :rid "
        "AND severity IN ('critical', 'high') AND record_key IS NOT NULL"), {"rid": run_id})).fetchall():
        blocked.setdefault(m, set()).add(k)
    meta_row = (await db.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v"),
                                 {"v": run.source_version_id})).fetchone()
    meta = (meta_row[0] if meta_row else None) or {}
    target_type = run.target_release or (await db.execute(
        text("SELECT system_type FROM sap_systems WHERE id = :s"), {"s": run.dest_system_id})).scalar()

    from starlette.concurrency import run_in_threadpool
    from api.services.migration.export import build_load_tables, to_csv_zip, to_xlsx
    from workers.db import get_sync_engine
    from sqlalchemy.orm import Session

    def _build():
        from api.services.source_design import dictionary_for
        from workers.dataset import load_dataset
        from workers.tasks.run_migration import load_mappings, load_value_maps, module_source_tables
        with Session(get_sync_engine()) as s:
            s.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})
            from checks.field_status_rules import conversions_for
            frames, _, _, _ = load_dataset(meta["dataset_path"], dictionary_for(s, run.source_system_id), run.modules,
                                           conversions=conversions_for(s, run.source_system_id))
            mtables = {m: module_source_tables(m, frames) for m in run.modules}
            maps = {m: load_mappings(s, m, target_type) for m in run.modules}
            vms = {m: load_value_maps(s, m) for m in run.modules}
        return build_load_tables(frames, mtables, maps, vms, blocked)

    tables = await run_in_threadpool(_build)
    if not tables:
        raise HTTPException(status_code=404, detail="No transfer-ready records to export.")
    total = sum(len(t) for t in tables.values())
    content = to_xlsx(tables) if export_format == "xlsx" else to_csv_zip(tables)
    fname = f"migration_{run_id}.{'xlsx' if export_format == 'xlsx' else 'zip'}"
    await db.execute(
        text("INSERT INTO migration_export_files (id, tenant_id, run_id, export_format, record_count, filename, "
             "exported_by) VALUES (gen_random_uuid(), :tid, :rid, :fmt, :cnt, :fn, :uid)"),
        {"tid": str(tenant.id), "rid": run_id, "fmt": export_format, "cnt": total, "fn": fname,
         "uid": current_user_id(request)},
    )
    await db.execute(text("UPDATE migration_runs SET status = 'exported' WHERE id = :rid"), {"rid": run_id})
    await db.commit()
    media = ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if export_format == "xlsx"
             else "application/zip")
    return _stream(content, media, fname)


def _stream(data: bytes, media_type: str, filename: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(data), media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── Field map ─────────────────────────────────────────────────────────────────


@router.get("/field-map")
async def get_field_map(
    module: str = Query(...),
    dest_system_type: str = Query("s4hana"),
    source_system_type: str = Query("ecc"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    """Mappings with source and target field definitions side by side."""
    from sap.ddic import dictionary_for_system

    await _set_rls(db, tenant.id)
    r = await db.execute(
        text("""
            SELECT id, module, source_field, dest_system_type, dest_table, dest_field, value_map, origin,
                   transform_note, is_confirmed
            FROM transfer_field_mappings
            WHERE module = :m AND dest_system_type = :dst
            ORDER BY source_field, dest_table, dest_field
        """),
        {"m": module, "dst": dest_system_type},
    )
    src_d, tgt_d = dictionary_for_system(source_system_type), dictionary_for_system(dest_system_type)

    def _def(d, q):
        f = d.resolve(q) if q else None
        return None if f is None else {"type": f.type, "length": f.length, "decimals": f.decimals,
                                       "check_table": f.check_table, "description": f.description}
    out = []
    for x in r.fetchall():
        row = _row(x)
        tgt = f"{row['dest_table']}.{row['dest_field']}" if row["dest_table"] and row["dest_field"] else None
        out.append({**row, "source_def": _def(src_d, row["source_field"]), "target_def": _def(tgt_d, tgt)})
    return {"mappings": out}


@router.post("/field-map")
async def create_field_map(
    body: FieldMapCreate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    r = await db.execute(
        text("""
            INSERT INTO transfer_field_mappings
                (id, tenant_id, module, source_field, dest_system_type, dest_table, dest_field, value_map,
                 origin, transform_note, is_confirmed)
            VALUES (gen_random_uuid(), :tid, :m, :sf, :dst, :dt, :df, :vm, 'steward', :note, true)
            ON CONFLICT DO NOTHING RETURNING id
        """),
        {"tid": str(tenant.id), "m": body.module, "sf": body.source_field.upper(), "dst": body.dest_system_type,
         "dt": (body.dest_table or "").upper() or None, "df": (body.dest_field or "").upper() or None,
         "vm": body.value_map, "note": body.transform_note},
    )
    row = r.fetchone()
    await db.commit()
    if not row:
        raise HTTPException(status_code=409, detail="This source → target mapping already exists.")
    return {"id": str(row[0])}


@router.put("/field-map/{mapping_id}")
async def update_field_map(
    mapping_id: uuid.UUID,
    body: FieldMapUpdate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    sets, params = [], {"id": mapping_id}
    for col in ("dest_table", "dest_field", "transform_note", "is_confirmed", "value_map"):
        val = getattr(body, col)
        if val is not None:
            sets.append(f"{col} = :{col}")
            params[col] = val.upper() if col in ("dest_table", "dest_field") and val else val
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update.")
    sets += ["updated_at = now()", "origin = 'steward'"]
    r = await db.execute(
        text(f"UPDATE transfer_field_mappings SET {', '.join(sets)} WHERE id = :id RETURNING id"), params)
    if not r.fetchone():
        raise HTTPException(status_code=404, detail="Mapping not found.")
    await db.commit()
    return {"id": str(mapping_id), "updated": True}


@router.delete("/field-map/{mapping_id}")
async def delete_field_map(
    mapping_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    await db.execute(text("DELETE FROM transfer_field_mappings WHERE id = :id"), {"id": mapping_id})
    await db.commit()
    return {"deleted": True}


@router.post("/field-map/seed")
async def seed_field_map(
    body: SeedBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    """Seed the map from the source data actually held: identity where the target
    has the field, plus the SAP-standard conversions (CVI business partner, SD
    status). Existing steward mappings are kept."""
    from starlette.concurrency import run_in_threadpool
    from sqlalchemy.orm import Session
    from workers.db import get_sync_engine

    await _set_rls(db, tenant.id)

    def _seed():
        from api.services.migration.engine import seed_mappings
        from api.services.source_design import dictionary_for
        from sap.ddic import dictionary_for_system
        from workers.dataset import load_dataset
        from workers.tasks.run_migration import module_source_tables, resolve_source_version, save_seed
        with Session(get_sync_engine()) as s:
            s.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})
            vid, meta = resolve_source_version(s, body.source_system_id, body.source_version_id)
            if not vid or not meta.get("dataset_path"):
                return None
            src_d = dictionary_for(s, body.source_system_id or meta.get("system_id"))
            from checks.field_status_rules import conversions_for
            frames, _, _, _ = load_dataset(meta["dataset_path"], src_d, [body.module],
                                           conversions=conversions_for(s, body.source_system_id or meta.get("system_id")))
            tables = module_source_tables(body.module, frames)
            tgt_d = dictionary_for_system(body.dest_system_type)
            seed = seed_mappings({t: list(frames.frames[t].columns) for t in tables}, src_d, tgt_d)
            save_seed(s, str(tenant.id), body.module, body.dest_system_type, seed)
            s.commit()
            return len(seed)

    n = await run_in_threadpool(_seed)
    if n is None:
        raise HTTPException(status_code=409, detail="No analysed source dataset — extract or upload the source first.")
    return {"seeded": n, "module": body.module, "dest_system_type": body.dest_system_type}


# ── Value map ─────────────────────────────────────────────────────────────────


@router.get("/value-map")
async def get_value_map(
    module: str,
    target_field: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    where, params = "module = :m", {"m": module}
    if target_field:
        where += " AND target_field = :tf"
        params["tf"] = target_field
    rows = await db.execute(text(f"SELECT id, target_field, source_value, target_value, note, updated_at "
                                 f"FROM transfer_value_mappings WHERE {where} ORDER BY target_field, source_value"),
                            params)
    return {"entries": [_row(x) for x in rows.fetchall()]}


@router.put("/value-map")
async def upsert_value_map(
    body: ValueMapUpsert,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    for e in body.entries:
        await db.execute(
            text("""
                INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value,
                                                     note, updated_by, updated_at)
                VALUES (gen_random_uuid(), :tid, :m, :tf, :sv, :tv, :note, :uid, now())
                ON CONFLICT (tenant_id, module, target_field, source_value)
                DO UPDATE SET target_value = EXCLUDED.target_value, note = EXCLUDED.note,
                              updated_by = EXCLUDED.updated_by, updated_at = now()
            """),
            {"tid": str(tenant.id), "m": body.module, "tf": body.target_field.upper(), "sv": e.source_value,
             "tv": e.target_value, "note": e.note, "uid": current_user_id(request)},
        )
    await db.commit()
    return {"saved": len(body.entries)}


@router.delete("/value-map/{entry_id}")
async def delete_value_map(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    await db.execute(text("DELETE FROM transfer_value_mappings WHERE id = :id"), {"id": entry_id})
    await db.commit()
    return {"deleted": True}
