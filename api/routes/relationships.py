"""Cross-domain relationship API routes.

Endpoints:
  GET /relationships  — returns all related objects across domains for a given object key
"""

import copy
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission, has_permission, _get_user_role

router = APIRouter(prefix="/api/v1", tags=["relationships"])
logger = logging.getLogger("meridian.relationships")


# ── Response models ───────────────────────────────────────────────────────────


class RelationshipItem(BaseModel):
    id: str
    from_domain: str
    from_key: str
    to_domain: str
    to_key: str
    relationship_type: str
    sap_link_table: Optional[str] = None
    discovered_at: str
    active: bool
    ai_inferred: bool
    ai_confidence: Optional[float] = None
    impact_score: Optional[float] = None


class RelationshipListResponse(BaseModel):
    relationships: list[RelationshipItem]
    total: int


class RelationshipTypeItem(BaseModel):
    id: str
    from_table: str
    to_table: str
    relationship_type: str
    description: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/relationships", response_model=RelationshipListResponse)
async def get_relationships(
    domain: Optional[str] = Query(None, description="Filter by domain"),
    key: Optional[str] = Query(None, description="Filter by object key"),
    include_inactive: bool = Query(False),
    role: str = Depends(require_permission("view")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return all related objects across domains for a given domain/key.

    impact_score is stripped from the response unless the caller has
    view_ai_confidence permission.
    """
    tenant_id = str(tenant.id)
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": tenant_id}

    if not include_inactive:
        conditions.append("active = true")

    if domain and key:
        # Search both directions
        conditions.append(
            "((from_domain = :domain AND from_key = :key) OR "
            "(to_domain = :domain AND to_key = :key))"
        )
        params["domain"] = domain
        params["key"] = key
    elif domain:
        conditions.append("(from_domain = :domain OR to_domain = :domain)")
        params["domain"] = domain

    where = " AND ".join(conditions)

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM record_relationships WHERE {where}"),
        params,
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        text(f"""
            SELECT id, from_domain, from_key, to_domain, to_key,
                   relationship_type, sap_link_table, discovered_at,
                   active, ai_inferred, ai_confidence, impact_score
            FROM record_relationships
            WHERE {where}
            ORDER BY discovered_at DESC
            LIMIT 200
        """),
        params,
    )

    can_view_ai = has_permission(role, "view_ai_confidence")

    relationships = []
    for row in result.fetchall():
        item = RelationshipItem(
            id=str(row[0]),
            from_domain=row[1],
            from_key=row[2],
            to_domain=row[3],
            to_key=row[4],
            relationship_type=row[5],
            sap_link_table=row[6],
            discovered_at=row[7].isoformat(),
            active=row[8],
            ai_inferred=row[9],
            ai_confidence=float(row[10]) if row[10] is not None and can_view_ai else None,
            impact_score=float(row[11]) if row[11] is not None and can_view_ai else None,
        )
        relationships.append(item)

    return RelationshipListResponse(relationships=relationships, total=total)


@router.get("/relationship-types", response_model=list[RelationshipTypeItem])
async def list_relationship_types(
    role: str = Depends(require_permission("view")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return all known SAP cross-domain relationship types (shared reference data)."""
    result = await db.execute(
        text("SELECT id, from_table, to_table, relationship_type, description FROM relationship_types")
    )

    return [
        RelationshipTypeItem(
            id=str(row[0]),
            from_table=row[1],
            to_table=row[2],
            relationship_type=row[3],
            description=row[4],
        )
        for row in result.fetchall()
    ]
