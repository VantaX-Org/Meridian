"""Notification centre API routes."""

import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import current_user_id, require_permission

router = APIRouter(prefix="/api/v1", tags=["notifications"])


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


def _own(request: Request, params: dict) -> str:
    """Tenant-wide rows (user_id NULL) plus the caller's own; only tenant-wide when no user is known."""
    uid = current_user_id(request)
    if not uid:
        return "user_id IS NULL"
    params["uid"] = uid
    return "(user_id IS NULL OR user_id = :uid)"


# Tenant-wide rows are shared, so their is_read column cannot say whether *this* user has
# read them. Each user's read state for those rows lives on users.preferences under
# "notifications_read": a read-all watermark ("before") plus ids read one by one since.
# The caller's own rows keep using is_read.
_READ_KEY = "notifications_read"
_READ_IDS_CAP = 500  # ponytail: oldest single reads fall off past this; read-all resets the list
_READ = ("(CASE WHEN user_id IS NULL THEN COALESCE(created_at <= CAST(:read_before AS timestamptz), false)"
         " OR CAST(id AS text) = ANY(CAST(:read_ids AS text[])) ELSE is_read END)")


async def _load_reads(db: AsyncSession, tenant: Tenant, uid: str, *, for_update: bool = False) -> dict:
    row = (await db.execute(
        text("SELECT preferences FROM users WHERE id = :uid AND tenant_id = :tid" + (" FOR UPDATE" if for_update else "")),
        {"uid": uid, "tid": str(tenant.id)},
    )).first()
    prefs = row[0] if row is not None else None
    if isinstance(prefs, str):
        prefs = json.loads(prefs)
    return prefs if isinstance(prefs, dict) else {}


async def _read_filter(db: AsyncSession, tenant: Tenant, request: Request, params: dict) -> str:
    """SQL for "the caller has read this row", binding the caller's read state into params."""
    uid = current_user_id(request)
    if not uid:
        return "is_read"
    reads = (await _load_reads(db, tenant, uid)).get(_READ_KEY) or {}
    before = reads.get("before")
    params["read_before"] = datetime.fromisoformat(before) if before else None
    params["read_ids"] = [str(i) for i in reads.get("ids") or []]
    return _READ


async def _save_reads(db: AsyncSession, tenant: Tenant, uid: str, prefs: dict) -> None:
    await db.execute(
        text("UPDATE users SET preferences = CAST(:p AS JSONB) WHERE id = :uid AND tenant_id = :tid"),
        {"p": json.dumps(prefs), "uid": uid, "tid": str(tenant.id)},
    )


class NotificationOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    user_id: uuid.UUID | None = None
    type: str
    title: str
    body: str | None = None
    link: str | None = None
    is_read: bool
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    total: int


class NotificationReadOut(BaseModel):
    id: str
    is_read: bool


class StatusOut(BaseModel):
    status: str


class UnreadCountOut(BaseModel):
    count: int


# ── GET /api/v1/notifications ────────────────────────────────────────────────


@router.get("/notifications", response_model=NotificationList, dependencies=[Depends(require_permission("view"))])
async def list_notifications(
    request: Request,
    is_read: Optional[bool] = None,
    type: Optional[str] = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    params: dict = {"tid": str(tenant.id)}
    conditions = ["tenant_id = :tid", _own(request, params)]
    read = await _read_filter(db, tenant, request, params)

    if is_read is not None:
        conditions.append(f"{read} = :is_read")
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
            SELECT id, tenant_id, user_id, type, title, body, link, {read} AS is_read, created_at
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


@router.put("/notifications/{notification_id}/read", response_model=NotificationReadOut, dependencies=[Depends(require_permission("view"))])
async def mark_notification_read(
    notification_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    uid = current_user_id(request)
    if not uid:  # no user to key on: the shared flag is the only read state there is
        params = {"nid": notification_id, "tid": str(tenant.id)}
        found = (await db.execute(text(
            "UPDATE notifications SET is_read = true WHERE id = :nid AND tenant_id = :tid AND user_id IS NULL RETURNING id"
        ), params)).fetchone()
    else:
        params = {"nid": notification_id, "tid": str(tenant.id), "uid": uid}
        found = (await db.execute(text(
            "UPDATE notifications SET is_read = true WHERE id = :nid AND tenant_id = :tid AND user_id = :uid RETURNING id"
        ), params)).fetchone()
        if not found:  # a tenant-wide row: record the read for this user only
            found = (await db.execute(text(
                "SELECT id FROM notifications WHERE id = :nid AND tenant_id = :tid AND user_id IS NULL"
            ), {"nid": notification_id, "tid": str(tenant.id)})).fetchone()
            if found:
                prefs = await _load_reads(db, tenant, uid, for_update=True)
                reads = dict(prefs.get(_READ_KEY) or {})
                ids = [i for i in reads.get("ids") or [] if i != str(found[0])] + [str(found[0])]
                reads["ids"] = ids[-_READ_IDS_CAP:]
                await _save_reads(db, tenant, uid, {**prefs, _READ_KEY: reads})
    if not found:
        raise HTTPException(status_code=404, detail="Notification not found")

    await db.commit()
    return {"id": notification_id, "is_read": True}


# ── PUT /api/v1/notifications/read-all ──────────────────────────────────────


@router.put("/notifications/read-all", response_model=StatusOut, dependencies=[Depends(require_permission("view"))])
async def mark_all_read(
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    uid = current_user_id(request)
    if not uid:  # no user to key on: the shared flag is the only read state there is
        await db.execute(text(
            "UPDATE notifications SET is_read = true WHERE tenant_id = :tid AND is_read = false AND user_id IS NULL"
        ), {"tid": str(tenant.id)})
    else:
        await db.execute(text(
            "UPDATE notifications SET is_read = true WHERE tenant_id = :tid AND is_read = false AND user_id = :uid"
        ), {"tid": str(tenant.id), "uid": uid})
        prefs = await _load_reads(db, tenant, uid, for_update=True)
        now = (await db.execute(text("SELECT now()"))).scalar()
        before = now.isoformat() if isinstance(now, datetime) else datetime.now(timezone.utc).isoformat()
        await _save_reads(db, tenant, uid, {**prefs, _READ_KEY: {"before": before, "ids": []}})
    await db.commit()

    return {"status": "ok"}


# ── GET /api/v1/notifications/unread-count ──────────────────────────────────


@router.get("/notifications/unread-count", response_model=UnreadCountOut, dependencies=[Depends(require_permission("view"))])
async def unread_count(
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    params: dict = {"tid": str(tenant.id)}
    own = _own(request, params)
    read = await _read_filter(db, tenant, request, params)
    result = await db.execute(
        text(f"SELECT COUNT(*) FROM notifications WHERE tenant_id = :tid AND NOT {read} AND {own}"),
        params,
    )
    count = result.scalar() or 0

    return {"count": count}



# ── Alert channels (outbound webhook / Slack / Teams / email) ────────────────
# Delivery lives in workers/tasks/send_notifications.py. The HMAC secret is
# write-only: it is never returned by the API.

_CHANNEL_COLS = ("id, kind, digest, report_pack, immediate_critical, enabled, created_at, "
                 "(secret IS NOT NULL) AS has_secret")


class AlertChannelCreate(BaseModel):
    kind: Literal["webhook", "slack", "teams", "email"]
    target: str = Field(min_length=3, max_length=2048)
    secret: Optional[str] = Field(default=None, min_length=16, max_length=256)
    digest: Literal["daily", "weekly", "off"] = "daily"
    immediate_critical: bool = False
    #: board pack + analyst workbook by email on this cadence (email channels only)
    report_pack: Literal["off", "weekly", "monthly"] = "off"


class AlertChannelUpdate(BaseModel):
    """Any subset of the settings; what is left out stays as it is."""
    digest: Optional[Literal["daily", "weekly", "off"]] = None
    immediate_critical: Optional[bool] = None
    enabled: Optional[bool] = None
    report_pack: Optional[Literal["off", "weekly", "monthly"]] = None


class AlertChannelOut(BaseModel):
    """A channel as the API returns it: the target is redacted to its host, the secret never leaves."""
    id: uuid.UUID | str
    kind: str
    digest: str
    report_pack: str
    immediate_critical: bool
    enabled: bool
    created_at: datetime | None = None
    has_secret: bool
    target: str


class AlertChannelList(BaseModel):
    channels: list[AlertChannelOut]


class AlertTestOut(BaseModel):
    delivered: bool


_REPORT_PACK_EMAIL_ONLY = "the board pack can only be sent to an email channel"
_NEVER_FIRES = "channel would never fire: set a digest, immediate_critical or report_pack"


def _redact(kind: str, target: str) -> str:
    """Webhook URLs embed tokens: show the host only."""
    return target if kind == "email" else target.split("/")[2] if target.count("/") >= 2 else "?"


@router.get("/alert-channels", response_model=AlertChannelList, dependencies=[Depends(require_permission("view"))])
async def list_alert_channels(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _set_rls(db, tenant.id)
    rows = (await db.execute(text(f"SELECT {_CHANNEL_COLS}, target FROM alert_channels ORDER BY created_at")
                             )).mappings().all()
    return {"channels": [{**{k: v for k, v in r.items() if k != "target"},
                          "target": _redact(r["kind"], r["target"])} for r in rows]}


@router.post("/alert-channels", status_code=201, response_model=AlertChannelOut,
             dependencies=[Depends(require_permission("manage_settings"))])
async def create_alert_channel(body: AlertChannelCreate, db: AsyncSession = Depends(get_db),
                               tenant: Tenant = Depends(get_tenant)):
    target = body.target.strip()
    if body.kind == "email":
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", target):
            raise HTTPException(status_code=400, detail="target must be an email address")
    elif not target.startswith("https://"):
        raise HTTPException(status_code=400, detail="target must be an https:// URL")
    if body.report_pack != "off" and body.kind != "email":
        raise HTTPException(status_code=400, detail=_REPORT_PACK_EMAIL_ONLY)
    if body.digest == "off" and not body.immediate_critical and body.report_pack == "off":
        raise HTTPException(status_code=400, detail=_NEVER_FIRES)
    await _set_rls(db, tenant.id)
    row = (await db.execute(text(f"""
        INSERT INTO alert_channels (tenant_id, kind, target, secret, digest, immediate_critical, report_pack)
        VALUES (:tid, :k, :t, :s, :d, :i, :r) RETURNING {_CHANNEL_COLS}
    """), {"tid": str(tenant.id), "k": body.kind, "t": target, "s": body.secret, "d": body.digest,
           "i": body.immediate_critical, "r": body.report_pack})).mappings().one()
    await db.commit()
    return {**row, "target": _redact(body.kind, target)}


@router.put("/alert-channels/{channel_id}", response_model=AlertChannelOut, dependencies=[Depends(require_permission("manage_settings"))])
async def update_alert_channel(channel_id: uuid.UUID, body: AlertChannelUpdate, db: AsyncSession = Depends(get_db),
                               tenant: Tenant = Depends(get_tenant)):
    """Change a channel's digest, critical-alert, on/off or board pack setting. The target and
    secret are write-once: remove the channel and add it again to change them."""
    await _set_rls(db, tenant.id)
    cur = (await db.execute(text("SELECT kind, digest, immediate_critical, enabled, report_pack, target "
                                 "FROM alert_channels WHERE id = :id"), {"id": str(channel_id)})).mappings().first()
    if not cur:
        raise HTTPException(status_code=404, detail="Alert channel not found")
    new = {**cur, **body.model_dump(exclude_none=True)}
    if new["report_pack"] != "off" and cur["kind"] != "email":
        raise HTTPException(status_code=400, detail=_REPORT_PACK_EMAIL_ONLY)
    if new["digest"] == "off" and not new["immediate_critical"] and new["report_pack"] == "off":
        raise HTTPException(status_code=400, detail=_NEVER_FIRES)
    row = (await db.execute(text(f"""
        UPDATE alert_channels SET digest = :d, immediate_critical = :i, enabled = :e, report_pack = :r
        WHERE id = :id RETURNING {_CHANNEL_COLS}, target
    """), {"d": new["digest"], "i": new["immediate_critical"], "e": new["enabled"], "r": new["report_pack"],
           "id": str(channel_id)})).mappings().one()
    await db.commit()
    return {**{k: v for k, v in row.items() if k != "target"}, "target": _redact(row["kind"], row["target"])}


@router.delete("/alert-channels/{channel_id}", status_code=204,
               dependencies=[Depends(require_permission("manage_settings"))])
async def delete_alert_channel(channel_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                               tenant: Tenant = Depends(get_tenant)):
    await _set_rls(db, tenant.id)
    res = await db.execute(text("DELETE FROM alert_channels WHERE id = :id"), {"id": str(channel_id)})
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="Alert channel not found")
    await db.commit()


@router.post("/alert-channels/{channel_id}/test", response_model=AlertTestOut,
             dependencies=[Depends(require_permission("manage_settings"))])
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
    except Exception:  # deliver() itself reports false on a backend-not-configured or send failure;
        delivered = False  # this only catches an unexpected raise. Never logs the target or secret.
    return {"delivered": bool(delivered)}
