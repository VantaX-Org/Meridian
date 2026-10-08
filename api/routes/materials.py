"""Material 360 - read-only views of one material from an analysis version's extracted tables.

All four endpoints are tenant-isolated (RLS plus an explicit tenant_id) and 404 when the
material is not in MARA, 409 when no finished version/dataset exists. Logic: api/services/material_360.py.
"""

import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.routes.rule_authoring import _dictionary, _latest
from api.services import material_360 as m360
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/materials", tags=["materials"])


class Level(BaseModel):
    id: str
    kind: str
    plant: Optional[str] = None


class MatrixCell(BaseModel):
    level: str
    state: str


class MatrixRow(BaseModel):
    view: str
    label: str
    expected: Optional[bool] = None
    cells: list[MatrixCell]


class Phasing(BaseModel):
    plants: int
    phasing_out: int
    with_followup: int
    plant: Optional[str] = None
    ausdt: Optional[str] = None
    nfmat: Optional[str] = None
    followup_description: Optional[str] = None


class Material360Out(BaseModel):
    matnr: str
    description: Optional[str] = None
    language: Optional[str] = None
    mara: dict[str, Any]
    makt: list[dict[str, Any]]
    marm: list[dict[str, Any]]
    mean: list[dict[str, Any]]
    marc: list[dict[str, Any]]
    mvke: list[dict[str, Any]]
    mbew: list[dict[str, Any]]
    mard: list[dict[str, Any]]
    mlgn: list[dict[str, Any]]
    labels: dict[str, Optional[str]]
    expected_views: Optional[list[str]] = None
    expected_known: bool
    levels: list[Level]
    levels_total: int
    views: list[MatrixRow]
    phasing: Phasing
    version_id: uuid.UUID


class FailingRule(BaseModel):
    check_id: str
    message: str
    severity: str
    field: Optional[str] = None
    level: str
    actual_value: Optional[str] = None
    record_key: str
    issue_id: Optional[uuid.UUID] = None
    issue_status: Optional[str] = None
    record_fix: Optional[str] = None


class ViewFindings(BaseModel):
    view: str
    label: str
    rules: int
    failing: list[FailingRule]
    passing_count: int
    not_evaluated: list[str]


class FindingsOut(BaseModel):
    matnr: str
    version_id: uuid.UUID
    rules_total: int
    by_view: list[ViewFindings]


class ChainNode(BaseModel):
    matnr: str
    maktx: Optional[str] = None
    this: bool
    dismm: Optional[str] = None
    mmsta: Optional[str] = None
    kzaus: Optional[str] = None
    ausdt: Optional[str] = None
    nfmat: Optional[str] = None
    flags: list[str]


class PlantChain(BaseModel):
    werks: str
    kzaus: Optional[str] = None
    ausdt: Optional[str] = None
    chain: list[ChainNode]
    links: int
    loop_at: Optional[str] = None
    dead_end: bool
    truncated: bool
    depth: int


class BomUse(BaseModel):
    stlnr: Optional[str] = None
    posnr: Optional[str] = None
    werks: Optional[str] = None
    nfeag: Optional[str] = None
    nfgrp: Optional[str] = None
    flags: list[str]


class SupersessionOut(BaseModel):
    matnr: str
    plants: list[PlantChain]
    bom_usage: Optional[list[BomUse]] = None   # None = STPO not in the extract


class DuplicateItem(BaseModel):
    matnr: str
    maktx: Optional[str] = None
    mtart: Optional[str] = None
    matkl: Optional[str] = None
    meins: Optional[str] = None
    ean11: Optional[str] = None
    matches_on: list[str]
    score: int


class DuplicatesOut(BaseModel):
    matnr: str
    algorithm: str
    threshold: int
    source: str
    items: list[DuplicateItem]


async def _tables(db: AsyncSession, tenant: Tenant, version_id: Optional[uuid.UUID], names: set[str],
                  module: str = m360.MODULE):
    """(version id, {TABLE: frame}) for the requested or newest finished version of ``module``."""
    await _rls(db, tenant)
    if version_id:
        row = (await db.execute(
            text("SELECT id, metadata FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
            {"v": str(version_id), "t": str(tenant.id)})).fetchone()
    else:
        row = await _latest(db, tenant, module, None)
    path = (row[1] or {}).get("dataset_path") if row else None
    if not row or not path:
        raise HTTPException(409, f"No analysis version with an extracted dataset for {module}")
    d = await _dictionary(db, row[1])
    tables = await run_in_threadpool(m360.load_tables, path, d, names)
    return row[0], tables


def _norm(matnr: str) -> str:
    return m360.norm_matnr(matnr)


@router.get("/{matnr}", response_model=Material360Out, dependencies=[Depends(require_permission("view"))])
async def get_material(matnr: str, version_id: Optional[uuid.UUID] = None, plant: Optional[str] = None,
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    vid, tables = await _tables(db, tenant, version_id, set(m360.CORE_TABLES) | set(m360.OPTIONAL_TABLES))
    out = m360.build_material(tables, _norm(matnr))
    if out is None:
        raise HTTPException(404, "Material not found")
    out["levels"], out["levels_total"] = m360.cap_levels(out["levels"], plant)
    shown = {lv["id"] for lv in out["levels"]}
    for row in out["views"]:
        row["cells"] = [c for c in row["cells"] if c["level"] in shown]
    return {**out, "version_id": vid}


@router.get("/{matnr}/findings", response_model=FindingsOut, dependencies=[Depends(require_permission("view"))])
async def get_findings(matnr: str, version_id: Optional[uuid.UUID] = None,
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    m = _norm(matnr)
    cat = m360.rule_catalogue()
    names = {r["table"] for r in cat.values() if r["table"]} | {"MARA"}
    vid, tables = await _tables(db, tenant, version_id, names)
    if m360._for(tables, "MARA", m).empty:
        raise HTTPException(404, "Material not found")
    like = {"exact": f"MATNR={m}", "pre": f"MATNR={m}|%"}
    fr = (await db.execute(text("""
        SELECT check_id, record_key, field_values FROM finding_records
         WHERE tenant_id = :t AND version_id = :v AND module = :mod
           AND (record_key = :exact OR record_key LIKE :pre)"""),
        {"t": str(tenant.id), "v": str(vid), "mod": m360.MODULE, **like})).fetchall()
    failing = [{"check_id": r[0], "record_key": r[1], "field_values": r[2]} for r in fr]
    iss = (await db.execute(text("""
        SELECT id, check_id, record_key, status FROM record_issues
         WHERE tenant_id = :t AND module = :mod AND (record_key = :exact OR record_key LIKE :pre)"""),
        {"t": str(tenant.id), "mod": m360.MODULE, **like})).fetchall()
    issues = {(r[1], r[2]): {"id": r[0], "status": r[3]} for r in iss}
    out = m360.build_findings(failing, issues, m360.present_tables(tables, m), set(tables))
    return {"matnr": m, "version_id": vid, **out}


@router.get("/{matnr}/supersession", response_model=SupersessionOut,
            dependencies=[Depends(require_permission("view"))])
async def get_supersession(matnr: str, version_id: Optional[uuid.UUID] = None, plant: Optional[str] = None,
                           depth: int = Query(m360.CHAIN_DEPTH, ge=1, le=10),
                           db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    m = _norm(matnr)
    _, tables = await _tables(db, tenant, version_id, {"MARA", "MAKT", "MARC", "STPO", "MAST"})
    out = m360.build_supersession(tables, m, plant, depth)
    if out is None:
        raise HTTPException(404, "Material not found")
    return {"matnr": m, **out}


@router.get("/{matnr}/duplicates", response_model=DuplicatesOut,
            dependencies=[Depends(require_permission("view"))])
async def get_duplicates(matnr: str, version_id: Optional[uuid.UUID] = None,
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    m = _norm(matnr)
    _, tables = await _tables(db, tenant, version_id, {"MARA", "MAKT", "MEAN"})
    out = m360.build_duplicates(tables, m)
    if out is None:
        raise HTTPException(404, "Material not found")
    return {"matnr": m, **out}
