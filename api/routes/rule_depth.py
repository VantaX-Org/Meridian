"""Rule depth: coverage matrix, rule by SAP-facing code, DDIC field lookup. All read-only.

Registered before the rules router: `/rules/coverage` must not be read as `/rules/{rule_id}`.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import rule_coverage as rc
from api.services.rbac import require_permission
from sap.ddic import get_dictionary

router = APIRouter(prefix="/api/v1", tags=["rules"], dependencies=[Depends(require_permission("view"))])


async def _tenant_rules(db: AsyncSession, tenant: Tenant) -> list[dict]:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
    res = await db.execute(text("""
        SELECT id, name, module, category, enabled, source, severity, conditions
          FROM rules WHERE tenant_id = :tid"""), {"tid": str(tenant.id)})
    return [dict(r._mapping) for r in res.fetchall()]


async def _last_runs(db: AsyncSession, tenant: Tenant) -> dict[tuple[str, str], Optional[float]]:
    res = await db.execute(text("""
        SELECT DISTINCT ON (check_id, module) check_id, module, pass_rate
          FROM findings WHERE tenant_id = :tid
         ORDER BY check_id, module, created_at DESC"""), {"tid": str(tenant.id)})
    return {(r.check_id, r.module): None if r.pass_rate is None else float(r.pass_rate) for r in res.fetchall()}


# ── coverage ──────────────────────────────────────────────────────────────────


class CoverageObject(BaseModel):
    module: str
    by_dimension: dict[str, int]
    total: int
    never_run: int


class CheckClassCount(BaseModel):
    check_class: Optional[str]
    count: int


class CoverageTotals(BaseModel):
    shipped: int
    rules: int
    enabled: int
    customer: int
    objects: int
    thin_cells: int
    never_run: int


class CoverageResponse(BaseModel):
    objects: list[CoverageObject]
    dimensions: list[str]
    check_classes: list[CheckClassCount]
    totals: CoverageTotals


class TableCount(BaseModel):
    table: str
    count: int


class ViewRule(BaseModel):
    check_id: str
    message: Optional[str]
    check_class: Optional[str]
    severity: Optional[str]
    dimension: Optional[str]
    field: Optional[str]
    last_pass_rate: Optional[float]


class CoverageView(BaseModel):
    view: str
    label: str
    total: int
    tables: list[TableCount]
    rules: list[ViewRule]


class ModuleTotals(BaseModel):
    rules: int
    never_run: int
    views: int
    views_total: int
    tables: int


class ModuleCoverageResponse(BaseModel):
    module: str
    has_view_map: bool
    object: CoverageObject
    views: list[CoverageView]
    dimension_by_view: dict[str, dict[str, int]]
    totals: ModuleTotals


@router.get("/rules/coverage", response_model=CoverageResponse)
async def rules_coverage(
    system: Optional[str] = Query(None, description="Rule category: ecc, successfactors, ..."),
    authority: Optional[str] = None,
    check_class: Optional[str] = None,
    enabled: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Rules per module and DAMA dimension for this tenant, from the same rows as /rules."""
    rows = await _tenant_rules(db, tenant)
    return rc.coverage(rows, await _last_runs(db, tenant), system=system, authority=authority,
                       check_class=check_class, enabled=enabled)


@router.get("/rules/coverage/{module}", response_model=ModuleCoverageResponse)
async def rules_coverage_module(
    module: str,
    enabled: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """One module: its matrix row and, where a view map ships, rules per view and table."""
    rows = await _tenant_rules(db, tenant)
    if not any(r["module"] == module for r in rows):
        raise HTTPException(status_code=404, detail="Module has no rules")
    return rc.module_views(module, rows, await _last_runs(db, tenant), enabled=enabled)


# ── rule by code ──────────────────────────────────────────────────────────────

_NARRATIVE_KEYS = (
    "id", "module", "field", "check_class", "severity", "dimension", "message", "why_it_matters",
    "rule_authority", "sap_impact", "fix_map", "record_fix_template", "grain", "id_field", "scope_field",
    "max_depth", "applies_when", "fail_when", "target_table", "target_fields", "reference_table",
    "reference_field", "pattern", "allowed_values", "valid_values_with_labels", "group_by",
    "max_age_hours", "baseline", "simplification_item", "transaction", "category",
)


class RuleDetail(BaseModel):
    id: str
    module: str
    category: Optional[str] = None
    field: Optional[str] = None
    check_class: Optional[str] = None
    severity: Optional[str] = None
    dimension: Optional[str] = None
    message: Optional[str] = None
    why_it_matters: Optional[str] = None
    rule_authority: Optional[str] = None
    sap_impact: Optional[str] = None
    fix_map: Optional[dict[str, str]] = None
    record_fix_template: Optional[str] = None
    grain: Optional[Any] = None
    id_field: Optional[str] = None
    scope_field: Optional[str] = None
    max_depth: Optional[int] = None
    applies_when: Optional[Any] = None
    fail_when: Optional[Any] = None
    target_table: Optional[str] = None
    target_fields: Optional[Any] = None
    reference_table: Optional[str] = None
    reference_field: Optional[str] = None
    pattern: Optional[str] = None
    allowed_values: Optional[Any] = None
    valid_values_with_labels: Optional[dict[str, str]] = None
    group_by: Optional[Any] = None
    max_age_hours: Optional[float] = None
    baseline: Optional[Any] = None
    simplification_item: Optional[str] = None
    transaction: Optional[str] = None
    extra: dict[str, Any] = Field(default_factory=dict, description="Remaining YAML keys, unchanged")
    rule_uuid: Optional[str] = None
    enabled: bool
    source: Optional[str] = None
    latest_finding_id: Optional[str] = None
    latest_version_id: Optional[str] = None


@router.get("/rules/by-code/{check_id}", response_model=RuleDetail)
async def rule_by_code(
    check_id: str,
    module: Optional[str] = Query(None, description="Needed only when a code exists in more than one module"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """The full YAML rule for a SAP-facing code. Exists whether or not the rule has ever run."""
    rows = [r for r in await _tenant_rules(db, tenant)
            if rc.rule_code(r["name"]) == check_id and (module is None or r["module"] == module)]
    ymods = [m for (rid, m) in rc.shipped() if rid == check_id and (module is None or m == module)]
    if not rows and not ymods:
        raise HTTPException(status_code=404, detail="Rule not found")
    modules = sorted({r["module"] for r in rows} | set(ymods))
    if len(modules) > 1:
        raise HTTPException(status_code=409, detail=f"Code is used in {', '.join(modules)}; pass module")
    mod = modules[0]
    row = next((r for r in rows if r["module"] == mod), None)
    y = rc.shipped().get((check_id, mod))
    if y:
        body = {k: y[k] for k in _NARRATIVE_KEYS if k in y}
        body["extra"] = {k: v for k, v in y.items() if k not in _NARRATIVE_KEYS}
        body["module"] = mod
    else:  # mined or custom rule: only what its own conditions say
        meta = rc.describe(row)  # type: ignore[arg-type]
        body = {"id": check_id, "module": mod, "field": meta["field"], "check_class": meta["check_class"],
                "severity": meta["severity"], "dimension": meta["dimension"], "message": meta["message"],
                "rule_authority": "customer_configured"}
    latest = (await db.execute(text("""
        SELECT id, version_id FROM findings
         WHERE tenant_id = :tid AND check_id = :c AND module = :m
         ORDER BY created_at DESC LIMIT 1"""), {"tid": str(tenant.id), "c": check_id, "m": mod})).fetchone()
    return RuleDetail(
        **body, rule_uuid=str(row["id"]) if row else None, enabled=bool(row and row["enabled"]),
        source=row["source"] if row else "yaml",
        latest_finding_id=str(latest.id) if latest else None,
        latest_version_id=str(latest.version_id) if latest else None)


# ── ddic fields ───────────────────────────────────────────────────────────────


class DdicField(BaseModel):
    table: str
    field: str
    description: Optional[str] = None
    data_element: Optional[str] = None
    domain: Optional[str] = None
    type: Optional[str] = None
    length: Optional[int] = None
    check_table: Optional[str] = None
    check_field: Optional[str] = None
    check_table_description: Optional[str] = None
    missing: bool = False


class DdicFieldsResponse(BaseModel):
    fields: list[DdicField]


@router.get("/ddic/fields", response_model=DdicFieldsResponse)
async def ddic_fields(fields: str = Query(..., description="Comma separated TABLE.FIELD, at most 100")):
    """Standard ECC 6.0 dictionary entries. No tenant data involved: it is the shipped bundle."""
    wanted = list(dict.fromkeys(f.strip().upper() for f in fields.split(",") if f.strip()))
    if not wanted or len(wanted) > 100 or any(w.count(".") != 1 for w in wanted):
        raise HTTPException(status_code=400, detail="fields must be 1-100 TABLE.FIELD names")
    d = get_dictionary("ecc6")
    out = []
    for q in wanted:
        table, name = q.split(".")
        f = d.field(table, name)
        if f is None:
            out.append(DdicField(table=table, field=name, missing=True))
            continue
        ct = d.table(f.check_table) if f.check_table else None
        out.append(DdicField(
            table=table, field=name, description=f.description or None, data_element=f.data_element,
            domain=f.domain, type=f.type, length=f.length, check_table=f.check_table,
            check_field=f.check_field, check_table_description=ct.description if ct else None))
    return DdicFieldsResponse(fields=out)
