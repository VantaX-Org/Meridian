"""Notification centre API routes."""

import asyncio
import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["notifications"])


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


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



# ── Alert channels (outbound webhook / Slack / Teams / email) ────────────────
# Delivery lives in workers/tasks/send_notifications.py. The HMAC secret is
# write-only: it is never returned by the API.

_CHANNEL_COLS = "id, kind, digest, immediate_critical, enabled, created_at, (secret IS NOT NULL) AS has_secret"


class AlertChannelCreate(BaseModel):
    kind: Literal["webhook", "slack", "teams", "email"]
    target: str = Field(min_length=3, max_length=2048)
    secret: Optional[str] = Field(default=None, min_length=16, max_length=256)
    digest: Literal["daily", "weekly", "off"] = "daily"
    immediate_critical: bool = False


def _redact(kind: str, target: str) -> str:
    """Webhook URLs embed tokens: show the host only."""
    return target if kind == "email" else target.split("/")[2] if target.count("/") >= 2 else "?"


@router.get("/alert-channels", dependencies=[Depends(require_permission("view"))])
async def list_alert_channels(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _set_rls(db, tenant.id)
    rows = (await db.execute(text(f"SELECT {_CHANNEL_COLS}, target FROM alert_channels ORDER BY created_at")
                             )).mappings().all()
    return {"channels": [{**{k: v for k, v in r.items() if k != "target"},
                          "target": _redact(r["kind"], r["target"])} for r in rows]}


@router.post("/alert-channels", status_code=201, dependencies=[Depends(require_permission("manage_settings"))])
async def create_alert_channel(body: AlertChannelCreate, db: AsyncSession = Depends(get_db),
                               tenant: Tenant = Depends(get_tenant)):
    target = body.target.strip()
    if body.kind == "email":
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", target):
            raise HTTPException(status_code=400, detail="target must be an email address")
    elif not target.startswith("https://"):
        raise HTTPException(status_code=400, detail="target must be an https:// URL")
    if body.digest == "off" and not body.immediate_critical:
        raise HTTPException(status_code=400, detail="channel would never fire: set a digest or immediate_critical")
    await _set_rls(db, tenant.id)
    row = (await db.execute(text(f"""
        INSERT INTO alert_channels (tenant_id, kind, target, secret, digest, immediate_critical)
        VALUES (:tid, :k, :t, :s, :d, :i) RETURNING {_CHANNEL_COLS}
    """), {"tid": str(tenant.id), "k": body.kind, "t": target, "s": body.secret, "d": body.digest,
           "i": body.immediate_critical})).mappings().one()
    await db.commit()
    return {**row, "target": _redact(body.kind, target)}


@router.delete("/alert-channels/{channel_id}", status_code=204,
               dependencies=[Depends(require_permission("manage_settings"))])
async def delete_alert_channel(channel_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                               tenant: Tenant = Depends(get_tenant)):
    await _set_rls(db, tenant.id)
    res = await db.execute(text("DELETE FROM alert_channels WHERE id = :id"), {"id": str(channel_id)})
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="Alert channel not found")
    await db.commit()


@router.post("/alert-channels/{channel_id}/test", dependencies=[Depends(require_permission("manage_settings"))])
async def send_test_alert(channel_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)):
    """Send a sample alert through the channel so an admin can confirm the target and secret.
    The payload has the real shape; the rule id is a placeholder, never a real finding."""
    from workers.tasks import send_notifications as sn
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    await _set_rls(db, tenant.id)
    row = (await db.execute(text("SELECT id, kind, target, secret FROM alert_channels WHERE id = :id"),
                            {"id": str(channel_id)})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert channel not found")
    alert = sn.build_alert("test", None, None, None, {"SAMPLE-001"}, 0, 0, _resolve_app_base_url())
    alert["system_name"] = "Sample system"
    try:
        delivered = await asyncio.to_thread(sn.deliver, dict(row), alert)
    except Exception:  # e.g. email backend not configured; deliver() never logs the target or secret
        delivered = False
    return {"delivered": bool(delivered)}
