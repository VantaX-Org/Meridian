"""Field Mappings API — SAP field mapping configuration.

Supports two modes controlled by the licence manifest feature flag
'field_mapping_self_service':
  - false (default): read-only for all customers
  - true: customer admins can update their field mappings locally

Customer admins can GET all mappings and PUT updates (when self-service enabled).
Mappings are synced back to Meridian HQ on the next licence check-in.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission, write_audit

router = APIRouter(prefix="/api/v1", tags=["field-mappings"])

# Field names that may be updated by customers when self-service is enabled
ALLOWED_UPDATE_FIELDS: dict[str, str] = {
    "customer_field": "customer_field",
    "customer_label": "customer_label",
    "data_type": "data_type",
    "is_mapped": "is_mapped",
    "notes": "notes",
}

ALLOWED_DATA_TYPES = {"string", "number", "date", "boolean"}


class UpdateMappingBody(BaseModel):
    customer_field: Optional[str] = None
    customer_label: Optional[str] = None
    data_type: Optional[str] = None
    is_mapped: Optional[bool] = None
    notes: Optional[str] = None


class CreateMappingBody(BaseModel):
    """A mapping for a field the standard catalogue does not hold (or that a tenant removed)."""
    module: str = Field(min_length=1, max_length=100)
    standard_field: str = Field(min_length=1, max_length=255)
    standard_label: Optional[str] = Field(None, max_length=255)
    customer_field: Optional[str] = Field(None, max_length=255)
    customer_label: Optional[str] = Field(None, max_length=255)
    data_type: str = "string"
    is_mapped: bool = False
    notes: Optional[str] = None


class BulkUpdateBody(BaseModel):
    updates: list[dict]  # [{id: str, customer_field: str, ...}]


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


def _is_self_service_enabled(request=None) -> bool:
    """Check if field_mapping_self_service feature is enabled for this tenant.

    In production this comes from the licence manifest. For dev/local mode
    it defaults to True so the admin page is always accessible.
    """
    from api.config import settings

    if settings.auth_mode == "local":
        return True
    # Production: check cached licence features
    # Middleware stores features on request.state.licensed_features
    if request is not None:
        features = getattr(getattr(request, "state", None), "licensed_features", [])
        if "*" in features or "field_mapping_self_service" in features:
            return True
    return False


# ── GET /api/v1/field-mappings ────────────────────────────────────────────────


@router.get("/field-mappings")
async def list_field_mappings(
    request: Request,
    module: Optional[str] = Query(None, description="Filter by SAP module"),
    is_mapped: Optional[bool] = Query(None, description="Filter by mapped status"),
    search: Optional[str] = Query(None, description="Search standard_field or standard_label"),
    limit: int = Query(1000, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List all SAP field mappings for this tenant. Admin role required."""
    await _set_rls(db, tenant.id)

    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}

    if module:
        conditions.append("module = :module")
        params["module"] = module

    if is_mapped is not None:
        conditions.append("is_mapped = :is_mapped")
        params["is_mapped"] = is_mapped

    if search:
        conditions.append(
            "(standard_field ILIKE :search OR standard_label ILIKE :search "
            "OR customer_field ILIKE :search)"
        )
        params["search"] = f"%{search}%"

    where_clause = " AND ".join(conditions)
    params["limit"] = limit
    params["offset"] = offset

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM field_mappings WHERE {where_clause}"), params
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        text(f"""
            SELECT id, module, standard_field, standard_label,
                   customer_field, customer_label, data_type, is_mapped,
                   notes, updated_at
            FROM field_mappings
            WHERE {where_clause}
            ORDER BY module, standard_field
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    mappings = [_row_to_dict(r) for r in result.fetchall()]

    for m in mappings:
        if m.get("id"):
            m["id"] = str(m["id"])
        if m.get("updated_at"):
            m["updated_at"] = m["updated_at"].isoformat()

    return {
        "mappings": mappings,
        "total": total,
        "self_service_enabled": _is_self_service_enabled(request),
    }


# ── GET /api/v1/field-mappings/{module} ───────────────────────────────────────


@router.get("/field-mappings/module/{module_name}")
async def list_module_mappings(
    module_name: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return all field mappings for a specific SAP module."""
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("""
            SELECT id, module, standard_field, standard_label,
                   customer_field, customer_label, data_type, is_mapped,
                   notes, updated_at
            FROM field_mappings
            WHERE tenant_id = :tid AND module = :module
            ORDER BY standard_field
        """),
        {"tid": str(tenant.id), "module": module_name},
    )
    mappings = [_row_to_dict(r) for r in result.fetchall()]
    for m in mappings:
        if m.get("id"):
            m["id"] = str(m["id"])
        if m.get("updated_at"):
            m["updated_at"] = m["updated_at"].isoformat()

    return {"module": module_name, "mappings": mappings}


# ── PUT /api/v1/field-mappings/{id} ──────────────────────────────────────────


@router.put("/field-mappings/{mapping_id}")
async def update_field_mapping(
    mapping_id: str,
    body: UpdateMappingBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_field_mappings")),
):
    """Update a field mapping. Requires admin role and self-service enabled."""
    if not _is_self_service_enabled(request):
        raise HTTPException(
            status_code=403,
            detail="Field mapping self-service is not enabled for this tenant",
        )

    try:
        uid = uuid.UUID(mapping_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid mapping ID")

    await _set_rls(db, tenant.id)

    if body.data_type is not None and body.data_type not in ALLOWED_DATA_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid data_type. Allowed: {sorted(ALLOWED_DATA_TYPES)}",
        )

    updates: list[str] = []
    params: dict = {"uid": str(uid), "tid": str(tenant.id)}

    for field_name, col_name in ALLOWED_UPDATE_FIELDS.items():
        value = getattr(body, field_name, None)
        if value is not None:
            updates.append(f"{col_name} = :{field_name}")
            params[field_name] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("updated_at = now()")
    set_clause = ", ".join(updates)

    result = await db.execute(
        text(
            f"UPDATE field_mappings SET {set_clause} "
            "WHERE id = :uid AND tenant_id = :tid RETURNING id"
        ),
        params,
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Field mapping not found")

    await db.commit()

    row = await db.execute(
        text("""
            SELECT id, module, standard_field, standard_label,
                   customer_field, customer_label, data_type, is_mapped,
                   notes, updated_at
            FROM field_mappings
            WHERE id = :uid AND tenant_id = :tid
        """),
        {"uid": str(uid), "tid": str(tenant.id)},
    )
    mapping = _row_to_dict(row.fetchone())
    mapping["id"] = str(mapping["id"])
    if mapping.get("updated_at"):
        mapping["updated_at"] = mapping["updated_at"].isoformat()
    return mapping


_COLUMNS = ("id, module, standard_field, standard_label, customer_field, customer_label, data_type, is_mapped, "
            "notes, updated_at")


def _public(row) -> dict:
    out = _row_to_dict(row)
    out["id"] = str(out["id"])
    if out.get("updated_at"):
        out["updated_at"] = out["updated_at"].isoformat()
    return out


# ── POST /api/v1/field-mappings ───────────────────────────────────────────────


@router.post("/field-mappings", status_code=201)
async def create_field_mapping(
    body: CreateMappingBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_field_mappings")),
):
    """Create a field mapping. One per module and standard field (409 when it exists). customer_field defaults to the
    standard field. Requires self-service enabled, like the update."""
    if not _is_self_service_enabled(request):
        raise HTTPException(status_code=403, detail="Field mapping self-service is not enabled for this tenant")
    if body.data_type not in ALLOWED_DATA_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid data_type. Allowed: {sorted(ALLOWED_DATA_TYPES)}")
    module, field = body.module.strip(), body.standard_field.strip()
    if not module or not field:
        raise HTTPException(status_code=422, detail="module and standard_field cannot be blank")
    await _set_rls(db, tenant.id)
    row = (await db.execute(
        text(f"""
            INSERT INTO field_mappings (tenant_id, module, standard_field, standard_label, customer_field,
                                        customer_label, data_type, is_mapped, notes)
            VALUES (:tid, :module, :field, :label, :cfield, :clabel, :dtype, :mapped, :notes)
            ON CONFLICT (tenant_id, module, standard_field) DO NOTHING
            RETURNING {_COLUMNS}
        """),
        {"tid": str(tenant.id), "module": module, "field": field, "label": body.standard_label,
         "cfield": body.customer_field or field, "clabel": body.customer_label or body.standard_label,
         "dtype": body.data_type, "mapped": body.is_mapped, "notes": body.notes},
    )).fetchone()
    if row is None:
        raise HTTPException(status_code=409, detail="A mapping for this module and field already exists")
    mapping = _public(row)
    await write_audit(db, tenant.id, request, "field_mapping.create", "field_mapping", mapping["id"], None, mapping)
    await db.commit()
    return mapping


# ── DELETE /api/v1/field-mappings/{id} ────────────────────────────────────────


@router.delete("/field-mappings/{mapping_id}")
async def delete_field_mapping(
    mapping_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_field_mappings")),
):
    """Delete a field mapping. Requires self-service enabled, like the update."""
    if not _is_self_service_enabled(request):
        raise HTTPException(status_code=403, detail="Field mapping self-service is not enabled for this tenant")
    try:
        uid = uuid.UUID(mapping_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid mapping ID")
    await _set_rls(db, tenant.id)
    row = (await db.execute(
        text(f"DELETE FROM field_mappings WHERE id = :uid AND tenant_id = :tid RETURNING {_COLUMNS}"),
        {"uid": str(uid), "tid": str(tenant.id)},
    )).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Field mapping not found")
    mapping = _public(row)
    await write_audit(db, tenant.id, request, "field_mapping.delete", "field_mapping", mapping["id"], mapping, None)
    await db.commit()
    return {"id": mapping["id"], "status": "deleted"}


# ── POST /api/v1/field-mappings/reset ────────────────────────────────────────


@router.post("/field-mappings/reset")
async def reset_field_mappings(
    request: Request,
    module: Optional[str] = Query(None, description="Reset only this module"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_field_mappings")),
):
    """Reset all field mappings to their standard defaults (customer_field = standard_field).
    Requires admin role and self-service enabled.
    """
    if not _is_self_service_enabled(request):
        raise HTTPException(
            status_code=403,
            detail="Field mapping self-service is not enabled for this tenant",
        )

    await _set_rls(db, tenant.id)

    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}

    if module:
        conditions.append("module = :module")
        params["module"] = module

    where_clause = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            UPDATE field_mappings
            SET customer_field = standard_field,
                customer_label = standard_label,
                is_mapped = false,
                notes = null,
                updated_at = now()
            WHERE {where_clause}
            RETURNING id
        """),
        params,
    )
    count = len(result.fetchall())
    await db.commit()
    return {"reset_count": count, "module": module or "all"}
