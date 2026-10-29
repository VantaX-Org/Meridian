"""Excel export of any v2 grid with the columns on screen.

POST /api/v1/export/grid   {title, route, columns: [{key, header, kind?}], rows: [{key: value}], filters?}
                           -> the branded workbook (cover sheet, one data sheet), the same writer as every export

The client sends what the grid shows: its visible columns in order and the rows it has loaded, already formatted
for reading. The server only writes them, through the formula-injection guard of the branded writer. Needs ``export``;
audited (route, row and column counts, never the values).
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.branded_xlsx import (
    ColumnSpec,
    SheetSpec,
    build_workbook,
    guard_formula_cell,
    xlsx_filename,
    xlsx_response,
)
from api.services.rbac import require_permission, write_audit

router = APIRouter(prefix="/api/v1/export", tags=["export"])

MAX_ROWS = 100_000


class GridColumn(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    header: str = Field(min_length=1, max_length=120)
    kind: Literal["text", "int", "pct", "money", "date", "mono"] = "text"


class GridExportIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    route: str = Field(min_length=1, max_length=64)
    columns: list[GridColumn] = Field(min_length=1, max_length=80)
    rows: list[dict[str, str | int | float | bool | None]] = Field(max_length=MAX_ROWS)
    filters: dict[str, str] = Field(default_factory=dict, max_length=30)


def sheet_rows(body: GridExportIn) -> list[dict[str, object]]:
    """Rows limited to the declared columns, text cells guarded against formula injection."""
    keys = [c.key for c in body.columns]
    return [{k: (guard_formula_cell(r.get(k)) if isinstance(r.get(k), str) else r.get(k)) for k in keys} for r in body.rows]


@router.post("/grid", dependencies=[Depends(require_permission("export"))])
async def export_grid(body: GridExportIn, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)):
    cols = [ColumnSpec(c.key, c.header, kind=c.kind) for c in body.columns]
    note = ("Filtered: " + ", ".join(f"{k} {v}" for k, v in sorted(body.filters.items()))) if body.filters else None
    data = build_workbook(tenant_name=tenant.name, run_label=None, run_id=None, title=body.title,
                          sheets=[SheetSpec(title=body.title[:31], columns=cols, rows=sheet_rows(body), note=note)])
    await write_audit(db, tenant.id, request, "export.grid", "grid", body.route, None,
                      {"rows": len(body.rows), "columns": [c.key for c in body.columns]})
    await db.commit()
    slug = "".join(ch if ch.isalnum() else "-" for ch in body.route.lower()).strip("-") or "grid"
    return xlsx_response(data, xlsx_filename(slug, body.title))
