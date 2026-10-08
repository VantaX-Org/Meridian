"""Generalized record fix sheet — api/routes/object_records.py.

GET /api/v1/objects/{object}/records/{key} is the object-agnostic entry point the
new /objects/[object]/records/[key] page calls. For Wave 1b, only
material_master is wired — it delegates to the existing, unchanged
api/services/material_360.py logic that api/routes/materials.py already
exposes at /api/v1/materials/{matnr}. Any other object returns 501 so the
frontend shows "not yet available" rather than guessing at a shape.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.materials import Material360Out, _norm, _tables
from api.services import material_360 as m360
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/objects", tags=["objects"])

_SUPPORTED = {"material_master"}


@router.get("/{object}/records/{key}", response_model=Material360Out,
            dependencies=[Depends(require_permission("view"))])
async def get_object_record(object: str, key: str, version_id: Optional[uuid.UUID] = None,
                            plant: Optional[str] = None,
                            db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    if object not in _SUPPORTED:
        raise HTTPException(501, f"Record fix sheet not yet available for object '{object}'")
    vid, tables = await _tables(db, tenant, version_id, set(m360.CORE_TABLES) | set(m360.OPTIONAL_TABLES))
    out = m360.build_material(tables, _norm(key))
    if out is None:
        raise HTTPException(404, "Record not found")
    out["levels"], out["levels_total"] = m360.cap_levels(out["levels"], plant)
    shown = {lv["id"] for lv in out["levels"]}
    for row in out["views"]:
        row["cells"] = [c for c in row["cells"] if c["level"] in shown]
    return {**out, "version_id": vid}
