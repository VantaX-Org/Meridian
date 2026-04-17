"""Notification centre API routes."""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

router = APIRouter(prefix="/api/v1", tags=["notifications"])


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))


# ── GET /api/v1/notifications ────────────────────────────────────────────────


@router.get("/notifications")
async def list_notifications(
    is_read: Optional[bool] = None,
    type: Optional[str] = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}

    if is_read is not None:
        conditions.append("is_read = :is_read")
        params["is_read"] = is_read
    if type:
        conditions.append("type = :type")
        params["type"] = type

    where = " AND ".join(conditions)

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM notifications WHERE {where}"), params
    )
    total = count_result.scalar()

    params["limit"] = limit
    params["offset"] = offset

    result = await db.execute(
        text(f"""
            SELECT id, tenant_id, user_id, type, title, body, link, is_read, created_at
            FROM notifications
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [_row_to_dict(r) for r in result.fetchall()]

    return {"items": items, "total": total}


# ── PUT /api/v1/notifications/{id}/read ─────────────────────────────────────


@router.put("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("""
            UPDATE notifications SET is_read = true
            WHERE id = :nid AND tenant_id = :tid
            RETURNING id
        """),
        {"nid": notification_id, "tid": str(tenant.id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Notification not found")

    await db.commit()
    return {"id": notification_id, "is_read": True}


# ── PUT /api/v1/notifications/read-all ──────────────────────────────────────


@router.put("/notifications/read-all")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("""
            UPDATE notifications SET is_read = true
            WHERE tenant_id = :tid AND is_read = false
        """),
        {"tid": str(tenant.id)},
    )
    await db.commit()

    return {"status": "ok"}


# ── GET /api/v1/notifications/unread-count ──────────────────────────────────


@router.get("/notifications/unread-count")
async def unread_count(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("SELECT COUNT(*) FROM notifications WHERE tenant_id = :tid AND is_read = false"),
        {"tid": str(tenant.id)},
    )
    count = result.scalar() or 0

    return {"count": count}


# ── DELETE /api/v1/notifications/{id} ───────────────────────────────────────


@router.delete("/notifications/{notification_id}")
async def delete_notification(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Delete a notification."""
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("""
            DELETE FROM notifications
            WHERE id = :nid AND tenant_id = :tid
            RETURNING id
        """),
        {"nid": notification_id, "tid": str(tenant.id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Notification not found")

    await db.commit()
    return {"id": notification_id, "deleted": True}
