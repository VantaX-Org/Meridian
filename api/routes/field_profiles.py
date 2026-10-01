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
        SELECT table_name, determinant, dependent, support, populated_rows, violations, sample_keys
          FROM field_dependencies
         WHERE tenant_id = :tid AND version_id = :v AND module = :m
         ORDER BY table_name, support DESC, determinant, dependent
    """), {"tid": tid, "v": version_id, "m": module})).fetchall()
    return ProfileOut(
        version_id=str(version_id), object=module, objects=objects, tables=list(tables.values()),
        dependencies=[DependencyOut(table=d.table_name, determinant=d.determinant, dependent=d.dependent,
                                    support=float(d.support), rows=int(d.populated_rows),
                                    violations=int(d.violations), sample_keys=[str(k) for k in d.sample_keys or []])
                      for d in deps],
    )
