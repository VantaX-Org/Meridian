"""Field profile of an analysed version, per object (module).

  GET /systems/{system_id}/versions/{version_id}/profile?object=<module>
      tables → fields → stats (blanks, distinct, lengths, ranges, shapes, top
      values for non-sensitive code fields) plus candidate hidden rules
      (A → B holding for ≥ 99 % but not all records) — checks/profiling.py
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.branded_xlsx import ColumnSpec, SheetSpec, build_workbook, xlsx_filename, xlsx_response
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/systems", tags=["field-profiles"])


class ShapeCount(BaseModel):
    shape: str
    count: int
    share: float


class ValueCount(BaseModel):
    value: str
    count: int


class NumericRange(BaseModel):
    min: Optional[float] = None
    max: Optional[float] = None
    mean: Optional[float] = None
    non_numeric: int = 0


class DateRange(BaseModel):
    min: Optional[str] = None
    max: Optional[str] = None
    invalid: int = 0


class FieldStats(BaseModel):
    rows: int
    table_rows: int
    sampled: bool = False
    blank: int
    blank_pct: float
    distinct: int
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    ddic_type: Optional[str] = None
    ddic_length: Optional[int] = None
    description: Optional[str] = None
    numeric: Optional[NumericRange] = None
    dates: Optional[DateRange] = None
    shapes: list[ShapeCount] = []
    shape_count: int = 0
    masked: bool = True
    mask_reason: Optional[str] = None  # privacy | not_code_like
    top_values: Optional[list[ValueCount]] = None


class FieldProfileOut(BaseModel):
    field: str
    stats: FieldStats


class TableProfileOut(BaseModel):
    table: str
    rows: int
    table_rows: int
    sampled: bool
    fields: list[FieldProfileOut]


class DependencyOut(BaseModel):
    table: str
    determinant: str
    dependent: str
    support: float
    rows: int
    violations: int
    sample_keys: list[str]
    accepted: bool = False  # already a check (rules.source = 'mined')


class ProfileOut(BaseModel):
    version_id: str
    object: Optional[str]
    objects: list[str]
    tables: list[TableProfileOut]
    dependencies: list[DependencyOut]


@router.get("/{system_id}/versions/{version_id}/profile", response_model=ProfileOut,
            dependencies=[Depends(require_permission("view"))])
async def version_profile(system_id: uuid.UUID, version_id: uuid.UUID,
                          object: Optional[str] = Query(None, max_length=80),
                          db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> ProfileOut:
    tid = str(tenant.id)
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": tid})
    found = (await db.execute(text(
        "SELECT 1 FROM analysis_versions WHERE id = :v AND tenant_id = :tid AND metadata->>'system_id' = :sid"),
        {"v": version_id, "tid": tid, "sid": str(system_id)})).scalar()
    if not found:
        raise HTTPException(status_code=404, detail="Version not found for this system")

    objects = list((await db.execute(text(
        "SELECT DISTINCT module FROM field_profiles WHERE tenant_id = :tid AND version_id = :v ORDER BY module"),
        {"tid": tid, "v": version_id})).scalars().all())
    module = object if object is not None else (objects[0] if objects else None)
    if module is None:
        return ProfileOut(version_id=str(version_id), object=None, objects=objects, tables=[], dependencies=[])

    rows = (await db.execute(text("""
        SELECT table_name, field, stats FROM field_profiles
         WHERE tenant_id = :tid AND version_id = :v AND module = :m
         ORDER BY table_name, (stats->>'position')::int NULLS LAST, field
    """), {"tid": tid, "v": version_id, "m": module})).fetchall()
    tables: dict[str, TableProfileOut] = {}
    for r in rows:
        stats = FieldStats.model_validate(r.stats or {})
        t = tables.get(r.table_name)
        if t is None:
            t = tables[r.table_name] = TableProfileOut(table=r.table_name, rows=stats.rows,
                                                        table_rows=stats.table_rows, sampled=stats.sampled, fields=[])
        t.fields.append(FieldProfileOut(field=r.field, stats=stats))

    deps = (await db.execute(text("""
        SELECT table_name, determinant, dependent, support, populated_rows, violations, sample_keys,
               EXISTS (SELECT 1 FROM rules r WHERE r.tenant_id = d.tenant_id AND r.module = d.module
                          AND r.source = 'mined' AND r.enabled
                          AND r.conditions->>'determinant' = d.determinant
                          AND r.conditions->>'field' = d.dependent) AS accepted
          FROM field_dependencies d
         WHERE tenant_id = :tid AND version_id = :v AND module = :m
         ORDER BY table_name, support DESC, determinant, dependent
    """), {"tid": tid, "v": version_id, "m": module})).fetchall()
    return ProfileOut(
        version_id=str(version_id), object=module, objects=objects, tables=list(tables.values()),
        dependencies=[DependencyOut(table=d.table_name, determinant=d.determinant, dependent=d.dependent,
                                    support=float(d.support), rows=int(d.populated_rows),
                                    violations=int(d.violations), sample_keys=[str(k) for k in d.sample_keys or []],
                                    accepted=bool(d.accepted))
                      for d in deps],
    )


_FIELD_PROFILE_COLUMNS = [
    ColumnSpec("field", "Field", kind="mono"),
    ColumnSpec("rows", "Rows", kind="int"),
    ColumnSpec("blank_pct", "Blank %"),
    ColumnSpec("distinct", "Distinct", kind="int"),
    ColumnSpec("min_length", "Min length", kind="int"),
    ColumnSpec("max_length", "Max length", kind="int"),
    ColumnSpec("ddic_type", "DDIC type"),
    ColumnSpec("masked", "Masked"),
    ColumnSpec("top_values", "Top values"),
]

_DEPENDENCIES_COLUMNS = [
    ColumnSpec("table", "Table", kind="mono"),
    ColumnSpec("determinant", "Determinant", kind="mono"),
    ColumnSpec("dependent", "Dependent", kind="mono"),
    ColumnSpec("support", "Support", kind="pct", scale=100.0),
    ColumnSpec("rows", "Rows", kind="int"),
    ColumnSpec("violations", "Violations", kind="int"),
    ColumnSpec("accepted", "Accepted"),
]


def _top_values_cell(stats: FieldStats) -> str:
    # masked (privacy-sensitive) fields never show their raw top values in the
    # export, even if a caller somehow populated them — same rule the API
    # response already enforces via FieldStats.masked/top_values.
    if stats.masked or not stats.top_values:
        return "masked" if stats.masked else ""
    return "; ".join(f"{v.value} ({v.count})" for v in stats.top_values)


@router.get("/{system_id}/versions/{version_id}/profile/export", dependencies=[Depends(require_permission("export"))])
async def export_version_profile(
    system_id: uuid.UUID, version_id: uuid.UUID,
    object: Optional[str] = Query(None, max_length=80),
    format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
):
    """One sheet per table (field stats) plus a Dependencies sheet, as CSV or XLSX.

    Masked (privacy-sensitive) fields show "masked", never a raw value.
    """
    profile = await version_profile(system_id=system_id, version_id=version_id, object=object, db=db, tenant=tenant)

    sheets = []
    for t in profile.tables:
        rows = [
            {
                "field": f.field,
                "rows": f.stats.rows,
                "blank_pct": f.stats.blank_pct,
                "distinct": f.stats.distinct,
                "min_length": f.stats.min_length,
                "max_length": f.stats.max_length,
                "ddic_type": f.stats.ddic_type,
                "masked": f.stats.masked,
                "top_values": _top_values_cell(f.stats),
            }
            for f in t.fields
        ]
        sheets.append(SheetSpec(title=t.table, columns=_FIELD_PROFILE_COLUMNS, rows=rows))

    dep_rows = [
        {
            "table": d.table, "determinant": d.determinant, "dependent": d.dependent,
            "support": d.support, "rows": d.rows, "violations": d.violations, "accepted": d.accepted,
        }
        for d in profile.dependencies
    ]
    sheets.append(SheetSpec(title="Dependencies", columns=_DEPENDENCIES_COLUMNS, rows=dep_rows))

    if format == "csv":
        # ponytail: CSV flattens all sheets into one file (one "sheet" column
        # prefix) rather than a zip of files — add a zip if a caller needs
        # per-table CSVs; no caller does yet.
        import csv
        import io as io_mod

        from fastapi.responses import StreamingResponse

        buf = io_mod.StringIO()
        all_keys = [c.key for c in _FIELD_PROFILE_COLUMNS]
        all_keys += [k for k in (c.key for c in _DEPENDENCIES_COLUMNS) if k not in all_keys]
        fieldnames = ["sheet"] + all_keys
        writer = csv.DictWriter(buf, fieldnames=fieldnames)
        writer.writeheader()
        for sheet in sheets:
            for row in sheet.rows:
                writer.writerow({"sheet": sheet.title, **{k: row.get(k) for k in all_keys}})
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=profile.csv"})

    data = build_workbook(
        tenant_name=tenant.name,
        run_label=str(version_id),
        run_id=str(version_id),
        title=f"{profile.object or 'object'} profile export",
        sheets=sheets,
    )
    return xlsx_response(data, xlsx_filename("profile", str(version_id)))
