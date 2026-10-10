"""Migration readiness API — source system → target (S/4HANA) transfer analysis.

source_to_destination gap-analyses the source system's analysed data (record
grain) against a connected target system's live dictionary + configuration,
or — before the target exists — the SAP S/4HANA standard dictionary.
Load files contain only records without blocking gaps.

Deterministic throughout — no LLM. Values shown are the customer's own data
inside the customer's deployment.
"""

import datetime
import io
import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import current_user_id, require_permission

router = APIRouter(prefix="/api/v1/migration", tags=["migration"])

_VALID_MODES = ("source_to_source", "source_to_destination")
_LIST_TREND_POINTS = 12  # sparkline points shown per wave in the wave list


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


Stage = Literal["plan", "mock1", "mock2", "dress", "cutover"]


class WaveCreate(BaseModel):
    name: str
    source_system_id: Optional[uuid.UUID] = None
    target_system_id: Optional[uuid.UUID] = None
    target_release: str = "s4hana"
    modules: list[str] = []
    target_date: Optional[datetime.date] = None
    stage: Stage = "plan"
    min_readiness: float = 95.0
    min_dqs: Optional[float] = None


#  migration_waves columns that are NOT NULL (db/migrations/versions/068_migration_waves.py).
# An explicit null for one of these is a client error (422), not a DB constraint violation (500).
_WAVE_NON_NULLABLE = frozenset({"name", "target_release", "modules", "stage", "min_readiness"})


class WaveUpdate(BaseModel):
    name: Optional[str] = None
    source_system_id: Optional[uuid.UUID] = None
    target_system_id: Optional[uuid.UUID] = None
    target_release: Optional[str] = None
    modules: Optional[list[str]] = None
    target_date: Optional[datetime.date] = None
    stage: Optional[Stage] = None
    min_readiness: Optional[float] = None
    min_dqs: Optional[float] = None

    @model_validator(mode="before")
    @classmethod
    def _reject_null_for_non_nullable(cls, data):
        if isinstance(data, dict):
            nulled = [k for k in _WAVE_NON_NULLABLE if k in data and data[k] is None]
            if nulled:
                raise ValueError(f"Cannot be null: {', '.join(sorted(nulled))}")
        return data


# Columns update_wave may write. Keep in step with WaveUpdate.
_WAVE_EDITABLE = frozenset(WaveUpdate.model_fields)


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

    return await _enqueue_run(db, tenant.id, current_user_id(request), body.mode, body.source_system_id, dest_id,
                              body.modules, body.source_version_id, body.target_release)


async def _enqueue_run(db: AsyncSession, tenant_id: uuid.UUID, user_id: Optional[str], mode: str,
                       src: Optional[str], dest: Optional[str], modules: list[str],
                       source_version_id: Optional[str], target_release: str,
                       wave_id: Optional[str] = None) -> dict:
    if src and not dest and mode == "source_to_destination":
        dest = (await db.execute(text("SELECT target_system_id::text FROM sap_systems WHERE id = CAST(:s AS uuid)"),
                                 {"s": src})).scalar()  # default to the source's assigned target
    run_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO migration_runs
                (id, tenant_id, mode, source_system_id, dest_system_id, modules, status, requested_by, wave_id)
            VALUES (:id, :tid, :mode, :src, :dst, :mods, 'queued', :uid, :wid)
        """),
        {"id": run_id, "tid": str(tenant_id), "mode": mode, "src": src, "dst": dest, "mods": modules,
         "uid": user_id, "wid": wave_id},
    )
    await db.commit()

    from workers.tasks.run_migration import run_migration
    task = run_migration.delay(str(tenant_id), run_id, mode, src, dest, modules, source_version_id, target_release)
    await db.execute(text("UPDATE migration_runs SET task_id = :tid WHERE id = :rid"), {"tid": task.id, "rid": run_id})
    await db.commit()
    return {"run_id": run_id, "task_id": task.id, "status": "queued", "mode": mode, "modules": modules}


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


# ── Waves ─────────────────────────────────────────────────────────────────────


_WAVE_COLS = ("id, name, source_system_id, target_system_id, target_release, modules, target_date, stage, "
              "min_readiness, min_dqs, signed_off_by, signed_off_at, created_at, updated_at")


async def _load_wave(db: AsyncSession, tenant_id: uuid.UUID, wave_id: uuid.UUID):
    row = (await db.execute(text(f"SELECT {_WAVE_COLS} FROM migration_waves WHERE id = :w AND tenant_id = :t"),
                            {"w": str(wave_id), "t": str(tenant_id)})).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Wave not found.")
    return row


async def _check_systems(db: AsyncSession, tenant_id: uuid.UUID, src: Optional[uuid.UUID],
                         dst: Optional[uuid.UUID]) -> None:
    if src and dst and src == dst:
        raise HTTPException(status_code=400, detail="Target must differ from the source system.")
    for sid in (src, dst):
        if sid and not await _load_system(db, tenant_id, str(sid)):
            raise HTTPException(status_code=404, detail="System not found.")


@router.get("/waves")
async def list_waves(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    await _set_rls(db, tenant.id)
    rows = await db.execute(text(f"""
        SELECT w.{_WAVE_COLS.replace(', ', ', w.')},
               last.id AS last_run_id, last.readiness_verdict AS last_verdict,
               last.readiness_score AS last_score, last.completed_at AS last_completed_at,
               COALESCE(trend.scores, '{{}}') AS trend
          FROM migration_waves w
          LEFT JOIN LATERAL (
                SELECT id, readiness_verdict, readiness_score, completed_at FROM migration_runs
                 WHERE wave_id = w.id AND status = 'analysed' ORDER BY completed_at DESC LIMIT 1) last ON true
          LEFT JOIN LATERAL (
                SELECT array_agg(readiness_score ORDER BY completed_at) AS scores FROM (
                    SELECT readiness_score, completed_at FROM migration_runs
                     WHERE wave_id = w.id AND status = 'analysed' AND readiness_score IS NOT NULL
                     ORDER BY completed_at DESC LIMIT {_LIST_TREND_POINTS}) t) trend ON true
         WHERE w.tenant_id = :t
         ORDER BY w.target_date NULLS LAST, w.name
    """), {"t": str(tenant.id)})
    return {"waves": [_row(r) for r in rows.fetchall()]}


@router.post("/waves")
async def create_wave(
    body: WaveCreate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    await _check_systems(db, tenant.id, body.source_system_id, body.target_system_id)
    if (await db.execute(text("SELECT 1 FROM migration_waves WHERE tenant_id = :t AND name = :n"),
                         {"t": str(tenant.id), "n": body.name})).scalar():
        raise HTTPException(status_code=409, detail=f"A wave named '{body.name}' already exists.")
    row = (await db.execute(text(f"""
        INSERT INTO migration_waves (tenant_id, name, source_system_id, target_system_id, target_release, modules,
                                     target_date, stage, min_readiness, min_dqs)
        VALUES (:t, :name, :src, :dst, :rel, :mods, :date, :stage, :minr, :mind)
        RETURNING {_WAVE_COLS}
    """), {"t": str(tenant.id), "name": body.name,
           "src": str(body.source_system_id) if body.source_system_id else None,
           "dst": str(body.target_system_id) if body.target_system_id else None,
           "rel": body.target_release, "mods": body.modules, "date": body.target_date, "stage": body.stage,
           "minr": body.min_readiness, "mind": body.min_dqs})).fetchone()
    await db.commit()
    return _row(row)


@router.patch("/waves/{wave_id}")
async def update_wave(
    wave_id: uuid.UUID,
    body: WaveUpdate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    current = await _load_wave(db, tenant.id, wave_id)
    changes = body.model_dump(exclude_unset=True)
    await _check_systems(db, tenant.id, changes.get("source_system_id", current.source_system_id),
                         changes.get("target_system_id", current.target_system_id))
    params = {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in changes.items()}
    unknown = params.keys() - _WAVE_EDITABLE
    if unknown:  # never interpolate a column name that is not on the allow-list
        raise HTTPException(status_code=400, detail=f"Not editable: {', '.join(sorted(unknown))}")
    sets = "".join(f"{k} = :{k}, " for k in params)
    # any edit invalidates a sign-off: what was signed is no longer what is planned
    try:
        row = (await db.execute(text(f"""
            UPDATE migration_waves SET {sets}signed_off_by = NULL, signed_off_at = NULL, updated_at = now()
             WHERE id = :w AND tenant_id = :t RETURNING {_WAVE_COLS}
        """), {**params, "w": str(wave_id), "t": str(tenant.id)})).fetchone()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"A wave named '{params.get('name')}' already exists.")
    await db.commit()
    return _row(row)


@router.delete("/waves/{wave_id}", status_code=204)
async def delete_wave(
    wave_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    await _load_wave(db, tenant.id, wave_id)
    await db.execute(text("DELETE FROM migration_waves WHERE id = :w AND tenant_id = :t"),
                     {"w": str(wave_id), "t": str(tenant.id)})
    await db.commit()


@router.post("/waves/{wave_id}/run")
async def run_wave(
    wave_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse")),
):
    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    if not w.source_system_id or not w.modules:
        raise HTTPException(status_code=400, detail="Set a source system and at least one module first.")
    return await _enqueue_run(db, tenant.id, current_user_id(request), "source_to_destination",
                              str(w.source_system_id), str(w.target_system_id) if w.target_system_id else None,
                              list(w.modules), None, w.target_release, str(wave_id))


@router.get("/waves/{wave_id}/cockpit")
async def wave_cockpit(
    wave_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    from api.services.migration.cockpit import load_cockpit

    await _set_rls(db, tenant.id)
    return await load_cockpit(db, str(tenant.id), await _load_wave(db, tenant.id, wave_id))


@router.post("/waves/{wave_id}/signoff")
async def signoff_wave(
    wave_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve")),
):
    import json

    from api.services.migration.cockpit import load_cockpit
    from api.services.rbac import current_user_label

    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    if w.signed_off_at:
        raise HTTPException(status_code=409, detail="This wave is already signed off.")
    cockpit = await load_cockpit(db, str(tenant.id), w)
    if cockpit["verdict"] != "go":
        raise HTTPException(status_code=409, detail="Only a wave with a go verdict can be signed off.")
    uid = current_user_id(request)
    row = (await db.execute(text(f"""
        UPDATE migration_waves SET signed_off_by = :u, signed_off_at = now(), updated_at = now()
         WHERE id = :w AND tenant_id = :t RETURNING {_WAVE_COLS}"""),
        {"u": uid, "w": str(wave_id), "t": str(tenant.id)})).fetchone()

    def snap(r) -> dict:
        return {"stage": r.stage, "signed_off_by": str(r.signed_off_by) if r.signed_off_by else None,
                "signed_off_at": r.signed_off_at.isoformat() if r.signed_off_at else None,
                "verdict": cockpit["verdict"], "score": cockpit["score"]}

    await db.execute(text("""
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path,
                               status_code, before_json, after_json)
        VALUES (:t, :u, :e, 'signoff', 'migration_wave', :w, 'POST', :p, 200,
                CAST(:b AS jsonb), CAST(:a AS jsonb))"""),
        {"t": str(tenant.id), "u": uid, "e": current_user_label(), "w": str(wave_id), "p": request.url.path,
         "b": json.dumps(snap(w)), "a": json.dumps(snap(row))})
    await db.commit()
    return _row(row)


class FixBatchBody(BaseModel):
    module: str
    gap_type: str
    field: Optional[str] = None


@router.get("/waves/{wave_id}/report.{fmt}")
async def wave_report(
    wave_id: uuid.UUID,
    fmt: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export")),
):
    import asyncio

    import pandas as pd

    from api.services.migration.cockpit import load_cockpit, readiness_report_context, readiness_report_sheets
    from api.services.pdf_reports import render

    if fmt not in ("xlsx", "pdf"):
        raise HTTPException(status_code=404, detail="Unknown report format.")
    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    cockpit = await load_cockpit(db, str(tenant.id), w)
    name = f"migration_readiness_{w.name.replace(' ', '_')}"
    if fmt == "pdf":
        pdf = await asyncio.to_thread(render, "migration_readiness_report.html",
                                      readiness_report_context(cockpit, tenant.name, None))
        return _stream(pdf, "application/pdf", f"{name}.pdf")
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for sheet, df in readiness_report_sheets(cockpit).items():
            df.to_excel(xw, sheet_name=sheet, index=False)
    return _stream(buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", f"{name}.xlsx")


@router.post("/waves/{wave_id}/blockers/fix-batch")
async def blocker_fix_batch(
    wave_id: uuid.UUID,
    body: FixBatchBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("apply")),
):
    """Draft a cleaning batch for the open DQ issues on the records one blocker affects.
    Migration and DQ share the record-key format (checks/base.record_keys), so (module, record_key) joins."""
    from api.services import remediation
    from api.services.migration import object_label
    from api.services.rbac import current_user_label

    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    if not w.source_system_id:
        raise HTTPException(status_code=400, detail="This wave has no source system.")
    run_id = (await db.execute(text("SELECT id FROM migration_runs WHERE tenant_id = :t AND wave_id = :w "
                                    "AND status = 'analysed' ORDER BY completed_at DESC LIMIT 1"),
                               {"t": str(tenant.id), "w": str(wave_id)})).scalar()
    if run_id is None:
        raise HTTPException(status_code=404, detail="This wave has not been analysed yet.")
    # record_issues.scope is the source system id (or 'upload') — without this filter, a tenant
    # with another scope holding the same record key would leak those issues into this batch.
    scope = str(w.source_system_id)
    rows = (await db.execute(text("""
        SELECT ri.id AS issue_id, ri.scope, ri.module, ri.check_id, ri.record_key, ri.grain,
               ri.last_seen_version, f.details->>'field_checked' AS field
          FROM record_issues ri
          LEFT JOIN findings f ON f.version_id = ri.last_seen_version AND f.check_id = ri.check_id
         WHERE ri.tenant_id = :t AND ri.scope = :scope AND ri.module = :m AND ri.status IN ('open', 'in_progress')
           AND ri.record_key IN (
                SELECT DISTINCT record_key FROM migration_gap_findings
                 WHERE run_id = :r AND module = :m AND gap_type = :g
                   AND field IS NOT DISTINCT FROM :fld AND record_key IS NOT NULL)
         ORDER BY ri.record_key
         LIMIT 50001"""),
        {"t": str(tenant.id), "scope": scope, "m": body.module, "r": str(run_id), "g": body.gap_type,
         "fld": body.field})).fetchall()
    if not rows:
        raise HTTPException(status_code=400, detail="No open data quality issues match these records. "
                                                    "Fix the mapping in the Mapping tab.")
    if len(rows) > 50_000:
        raise HTTPException(status_code=400, detail="More than 50000 records; fix this blocker in parts.")
    issues = [dict(r._mapping) for r in rows]
    name = f"{w.name}: {object_label(body.module)} {body.gap_type} {body.field or ''}".rstrip()
    uid, label = current_user_id(request), current_user_label()
    out = await db.run_sync(lambda s: remediation.draft_batch(s, str(tenant.id), name, body.model_dump_json(),
                                                              issues, uid, label))
    await db.commit()
    return out


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
    import pandas as pd

    await _set_rls(db, tenant.id)
    where, params = _findings_where(run_id, module, gap_type, severity, None, None)
    rows = (await db.execute(text(f"SELECT {_FINDING_COLS} FROM migration_gap_findings WHERE {where}"), params)).fetchall()
    df = pd.DataFrame([_row(x) for x in rows])
    if format == "csv":
        return _stream(df.to_csv(index=False).encode(), "text/csv", f"migration_gaps_{run_id}.csv")
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    return _stream(buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
        from sap.ddic import get_dictionary
        from workers.dataset import load_dataset
        from workers.tasks.run_migration import load_mappings, load_value_maps, module_source_tables
        with Session(get_sync_engine()) as s:
            s.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})
            from checks.field_status_rules import conversions_for
            frames, _, _, _ = load_dataset(meta["dataset_path"], dictionary_for(s, run.source_system_id), run.modules,
                                           conversions=conversions_for(s, run.source_system_id))
            mtables = {m: module_source_tables(m, frames) for m in run.modules}
            maps = {m: load_mappings(s, m, target_type) for m in run.modules}
            vms = {m: load_value_maps(s, m, run.source_system_id, run.dest_system_id) for m in run.modules}
            target_dict = (dictionary_for(s, run.dest_system_id) if run.dest_system_id
                           else get_dictionary(target_type or "s4hana"))
        return build_load_tables(frames, mtables, maps, vms, blocked, target_dict=target_dict)

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
    # filename is often built from free user text (e.g. a wave name); outside this allow-list a
    # character can break the header (';', '"') or fail latin-1 encoding (em dash, accents) -> 500.
    safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", filename)
    return StreamingResponse(
        io.BytesIO(data), media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={safe_name}"},
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
    where, params = "module = :m AND status = 'confirmed'", {"m": module}
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
                ON CONFLICT ON CONSTRAINT uq_transfer_value_mappings_scope
                DO UPDATE SET target_value = EXCLUDED.target_value, note = EXCLUDED.note,
                              updated_by = EXCLUDED.updated_by, updated_at = now(), status = 'confirmed'
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
