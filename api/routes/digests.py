"""Scheduled digests and executive mailouts (migration 114; api/services/digests.py).

GET    /api/v1/digests                       the tenant's digest schedules (manage_settings)
POST   /api/v1/digests                       add one (manage_settings, audited); next_run_at from its cron
GET    /api/v1/digests/{id}                  one schedule (manage_settings)
PATCH  /api/v1/digests/{id}                  change it (manage_settings, audited)
DELETE /api/v1/digests/{id}                  remove it (manage_settings, audited)
POST   /api/v1/digests/{id}/send-now         build and send it now, outside its schedule (manage_settings)
GET    /api/v1/digests/{id}/deliveries       its slots: sent, failed or skipped, with the reason (manage_settings)
GET    /api/v1/digests/{id}/preview          the digest as HTML (view; without manage_settings only a role digest of
                                             the caller's own role)
GET    /api/v1/digests/{id}/preview.json     the numbers the digest is rendered from (same permission as preview)
"""
from __future__ import annotations

import asyncio
import re
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import digests
from api.services.rbac import (VALID_ROLES, current_user_id, persona_for, require_permission, write_audit)

router = APIRouter(prefix="/api/v1/digests", tags=["digests"])

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
Channel = Literal["email", "webhook", "alert_channel"]
_OUT_COLS = ("id::text, name, audience, role, wave_id::text, cron, timezone, channel, recipients, "
             "recipient_user_ids::text[] AS recipient_user_ids, alert_channel_id::text, attach_pdf, enabled, "
             "last_sent_at, next_run_at, created_by::text, created_at, updated_at")


def _cron(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    v = " ".join(v.split())
    if not digests.valid_cron(v):
        raise ValueError("cron must be a five-field cron expression, e.g. '0 7 * * 1' (Mondays 07:00)")
    return v


def _tz(v: Optional[str]) -> Optional[str]:
    if v is not None and not digests.valid_zone(v):
        raise ValueError("timezone must be an IANA time zone, e.g. Africa/Johannesburg")
    return v


def _emails(v: Optional[list[str]]) -> Optional[list[str]]:
    if v is None:
        return v
    out = [a.strip() for a in v if a and a.strip()]
    bad = [a for a in out if not _EMAIL.match(a)]
    if bad:
        raise ValueError(f"not an email address: {len(bad)} recipient(s)")
    return list(dict.fromkeys(out))


class DigestCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    audience: Literal["role", "wave"]
    role: Optional[str] = Field(None, max_length=64)
    wave_id: Optional[uuid.UUID] = None
    cron: str = Field(max_length=120)
    timezone: str = Field("UTC", max_length=64)
    channel: Channel = "email"
    recipients: list[str] = Field(default_factory=list, max_length=200)
    recipient_user_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    alert_channel_id: Optional[uuid.UUID] = None
    attach_pdf: bool = True
    enabled: bool = True

    @field_validator("cron")
    @classmethod
    def _c(cls, v: Optional[str]) -> Optional[str]:
        return _cron(v)

    @field_validator("timezone")
    @classmethod
    def _z(cls, v: Optional[str]) -> Optional[str]:
        return _tz(v)

    @field_validator("recipients")
    @classmethod
    def _e(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        return _emails(v)


class DigestUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    role: Optional[str] = Field(None, max_length=64)
    wave_id: Optional[uuid.UUID] = None
    cron: Optional[str] = Field(None, max_length=120)
    timezone: Optional[str] = Field(None, max_length=64)
    channel: Optional[Channel] = None
    recipients: Optional[list[str]] = Field(None, max_length=200)
    recipient_user_ids: Optional[list[uuid.UUID]] = Field(None, max_length=200)
    alert_channel_id: Optional[uuid.UUID] = None
    attach_pdf: Optional[bool] = None
    enabled: Optional[bool] = None

    @field_validator("cron")
    @classmethod
    def _c(cls, v: Optional[str]) -> Optional[str]:
        return _cron(v)

    @field_validator("timezone")
    @classmethod
    def _z(cls, v: Optional[str]) -> Optional[str]:
        return _tz(v)

    @field_validator("recipients")
    @classmethod
    def _e(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        return _emails(v)


class DigestOut(BaseModel):
    id: str = Field(description="Digest id.")
    name: str = Field(description="Digest name.")
    audience: str = Field(description="Who receives it: users, role or wave.")
    role: Optional[str] = Field(None, description="Role whose members receive it (audience role).")
    wave_id: Optional[str] = Field(None, description="Migration wave it reports on (audience wave).")
    cron: str = Field(description="Five-field cron schedule.")
    timezone: str = Field(description="IANA time zone the cron is read in.")
    channel: str = Field(description="Delivery channel: email or an alert channel.")
    recipients: list[str] = Field(description="Email addresses that receive it.")
    recipient_user_ids: list[str] = Field(description="User ids that receive it.")
    alert_channel_id: Optional[str] = Field(None, description="Alert channel used when the channel is not email.")
    attach_pdf: bool = Field(description="True to attach the PDF report.")
    enabled: bool = Field(description="False pauses the schedule.")
    last_sent_at: Optional[datetime] = Field(None, description="When it was last sent.")
    next_run_at: Optional[datetime] = Field(None, description="When it is next due.")
    created_by: Optional[str] = Field(None, description="Who created it.")
    created_at: datetime = Field(description="When it was created.")
    updated_at: datetime = Field(description="When it was last changed.")


class SendOut(BaseModel):
    delivery_id: Optional[str] = Field(None, description="Delivery record id.")
    status: str = Field(description="Delivery status: sent, failed or skipped.")
    reason: Optional[str] = Field(None, description="Why it failed or was skipped.")
    delivered: int = Field(description="Recipients it reached.")
    failed: int = Field(description="Recipients it did not reach.")


async def _one(db: AsyncSession, tenant: Tenant, digest_id: uuid.UUID) -> dict:
    row = (await db.execute(text(f"SELECT {_OUT_COLS} FROM digest_schedules WHERE id = :d AND tenant_id = :t"),
                            {"d": str(digest_id), "t": str(tenant.id)})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Digest not found")
    return _out(row)


def _out(row) -> dict:
    d = dict(row)
    return {**d, "recipients": list(d["recipients"] or []), "recipient_user_ids": list(d["recipient_user_ids"] or [])}


async def _check(db: AsyncSession, tenant: Tenant, v: dict) -> None:
    """422 for a schedule whose target, channel or recipients do not hold together or are not this tenant's."""
    t = str(tenant.id)
    if v["audience"] == "role":
        if not v.get("role") or v["role"] not in VALID_ROLES:
            raise HTTPException(status_code=422, detail="A role digest needs a known role")
    elif not v.get("wave_id") or not (await db.execute(text(
            "SELECT 1 FROM migration_waves WHERE id = :w AND tenant_id = :t"), {"w": str(v["wave_id"]), "t": t})).scalar():
        raise HTTPException(status_code=422, detail="A wave digest needs a wave of this tenant")
    if v["channel"] == "alert_channel":
        if not v.get("alert_channel_id") or not (await db.execute(text(
                "SELECT 1 FROM alert_channels WHERE id = :c AND tenant_id = :t"),
                {"c": str(v["alert_channel_id"]), "t": t})).scalar():
            raise HTTPException(status_code=422, detail="Pick an alert channel of this tenant")
    if v["channel"] == "email" and v["audience"] == "wave" and not v.get("recipients") and not v.get("recipient_user_ids"):
        raise HTTPException(status_code=422, detail="An email digest for a wave needs recipients")
    ids = [str(u) for u in v.get("recipient_user_ids") or []]
    if ids:
        n = (await db.execute(text("SELECT count(*) FROM users WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[]))"),
                              {"t": t, "ids": ids})).scalar()
        if n != len(set(ids)):
            raise HTTPException(status_code=422, detail="Every recipient user must be a user of this tenant")


@router.get("", dependencies=[Depends(require_permission("manage_settings"))])
async def list_digests(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    rows = (await db.execute(text(f"SELECT {_OUT_COLS} FROM digest_schedules WHERE tenant_id = :t "
                                  "ORDER BY name, created_at"), {"t": str(tenant.id)})).mappings().all()
    return {"digests": [_out(r) for r in rows]}


@router.post("", status_code=201, response_model=DigestOut, dependencies=[Depends(require_permission("manage_settings"))])
async def create_digest(body: DigestCreate, request: Request, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    v = body.model_dump()
    await _check(db, tenant, v)
    nxt = digests.next_run(body.cron, body.timezone, datetime.now(timezone.utc)) if body.enabled else None
    row = (await db.execute(text(f"""
        INSERT INTO digest_schedules (tenant_id, name, audience, role, wave_id, cron, timezone, channel, recipients,
                                      recipient_user_ids, alert_channel_id, attach_pdf, enabled, next_run_at, created_by)
        VALUES (:t, :n, :a, :r, CAST(:w AS uuid), :c, :tz, :ch, CAST(:rc AS text[]), CAST(:ru AS uuid[]),
                CAST(:ac AS uuid), :pdf, :en, :nxt, CAST(:by AS uuid)) RETURNING {_OUT_COLS}"""),
        {"t": str(tenant.id), "n": body.name, "a": body.audience, "r": body.role if body.audience == "role" else None,
         "w": str(body.wave_id) if body.audience == "wave" and body.wave_id else None, "c": body.cron,
         "tz": body.timezone, "ch": body.channel, "rc": body.recipients, "ru": [str(u) for u in body.recipient_user_ids],
         "ac": str(body.alert_channel_id) if body.alert_channel_id else None, "pdf": body.attach_pdf,
         "en": body.enabled, "nxt": nxt, "by": current_user_id(request)})).mappings().first()
    out = _out(row)
    await write_audit(db, tenant.id, request, "digest_created", "digest_schedule", out["id"], None,
                      {k: out[k] for k in ("name", "audience", "role", "wave_id", "cron", "timezone", "channel")}
                      | {"recipients": len(out["recipients"]) + len(out["recipient_user_ids"])})
    await db.commit()
    return out


@router.get("/{digest_id}", response_model=DigestOut, dependencies=[Depends(require_permission("manage_settings"))])
async def get_digest(digest_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    return await _one(db, tenant, digest_id)


@router.patch("/{digest_id}", response_model=DigestOut, dependencies=[Depends(require_permission("manage_settings"))])
async def update_digest(digest_id: uuid.UUID, body: DigestUpdate, request: Request, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    before = await _one(db, tenant, digest_id)
    changes = body.model_dump(exclude_unset=True)
    changes = {k: v for k, v in changes.items() if v is not None or k in ("alert_channel_id", "wave_id")}
    if not changes:
        raise HTTPException(status_code=400, detail="No changes")
    merged = {**before, **changes}
    await _check(db, tenant, merged)
    casts = {"wave_id": "CAST(:wave_id AS uuid)", "alert_channel_id": "CAST(:alert_channel_id AS uuid)",
             "recipients": "CAST(:recipients AS text[])", "recipient_user_ids": "CAST(:recipient_user_ids AS uuid[])"}
    params: dict = {"d": str(digest_id), "t": str(tenant.id)}
    sets = []
    for k, v in changes.items():  # keys come from the model, never from the caller's free text
        sets.append(f"{k} = {casts.get(k, ':' + k)}")
        if k == "recipient_user_ids":
            v = [str(u) for u in v or []]
        elif k in ("wave_id", "alert_channel_id"):
            v = str(v) if v else None
        params[k] = v
    if {"cron", "timezone", "enabled"} & set(changes):
        sets.append("next_run_at = :nxt")
        params["nxt"] = (digests.next_run(merged["cron"], merged["timezone"], datetime.now(timezone.utc))
                         if merged["enabled"] else None)
    row = (await db.execute(text(f"UPDATE digest_schedules SET {', '.join(sets)}, updated_at = now() "
                                 f"WHERE id = :d AND tenant_id = :t RETURNING {_OUT_COLS}"), params)).mappings().first()
    out = _out(row)
    keys = ("name", "role", "wave_id", "cron", "timezone", "channel", "enabled", "attach_pdf", "alert_channel_id")
    await write_audit(db, tenant.id, request, "digest_updated", "digest_schedule", out["id"],
                      {k: before[k] for k in keys}, {k: out[k] for k in keys})
    await db.commit()
    return out


@router.delete("/{digest_id}", status_code=204, dependencies=[Depends(require_permission("manage_settings"))])
async def delete_digest(digest_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)) -> None:
    await _rls(db, tenant)
    before = await _one(db, tenant, digest_id)
    await db.execute(text("DELETE FROM digest_schedules WHERE id = :d AND tenant_id = :t"),
                     {"d": str(digest_id), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "digest_deleted", "digest_schedule", str(digest_id),
                      {"name": before["name"], "channel": before["channel"]}, None)
    await db.commit()


def _send_now(tenant_id: str, digest_id: str) -> Optional[dict]:
    from workers.db import get_sync_engine, tenant_session
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    with tenant_session(get_sync_engine(), tenant_id) as s:
        sched = digests.load(s, tenant_id, digest_id)
        if sched is None:
            return None
        return digests.send(s, tenant_id, sched, datetime.now(timezone.utc), manual=True,
                            base_url=_resolve_app_base_url())


@router.post("/{digest_id}/send-now", response_model=SendOut,
             dependencies=[Depends(require_permission("manage_settings"))])
async def send_now(digest_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Build and send the digest now (its schedule is not moved). In sandbox mode it is recorded as skipped."""
    await _rls(db, tenant)
    await _one(db, tenant, digest_id)
    await db.commit()
    out = await asyncio.to_thread(_send_now, str(tenant.id), str(digest_id))
    if out is None:
        raise HTTPException(status_code=409, detail="The digest is being sent; try again in a moment")
    return out


@router.get("/{digest_id}/deliveries", dependencies=[Depends(require_permission("manage_settings"))])
async def list_deliveries(digest_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    await _one(db, tenant, digest_id)
    rows = (await db.execute(text(
        "SELECT id::text, due_at, manual, status, reason, delivered, failed, created_at, finished_at "
        "FROM digest_deliveries WHERE tenant_id = :t AND schedule_id = :d ORDER BY created_at DESC LIMIT 100"),
        {"t": str(tenant.id), "d": str(digest_id)})).mappings().all()
    return {"deliveries": [dict(r) for r in rows]}


async def _previewable(request: Request, db: AsyncSession, tenant: Tenant, role: str, digest_id: uuid.UUID) -> dict:
    from api.routes.work import _allowed

    await _rls(db, tenant)
    d = await _one(db, tenant, digest_id)
    if await _allowed(db, tenant, request, role, "manage_settings"):
        return d
    if d["audience"] == "role" and d["role"] and persona_for(d["role"]) == persona_for(role):
        return d
    raise HTTPException(status_code=403, detail="Only your own role's digest can be previewed")


async def _numbers(db: AsyncSession, tenant: Tenant, d: dict) -> dict:
    sched = {**d, "tenant_id": str(tenant.id)}
    return await db.run_sync(lambda s: digests.build(s, str(tenant.id), sched))


@router.get("/{digest_id}/preview", response_class=HTMLResponse)
async def preview(digest_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                  tenant: Tenant = Depends(get_tenant), role: str = Depends(require_permission("view"))):
    """The digest as its email would read now (HTML)."""
    d = await _previewable(request, db, tenant, role, digest_id)
    return HTMLResponse(digests.html(await _numbers(db, tenant, d)))


@router.get("/{digest_id}/preview.json")
async def preview_json(digest_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant), role: str = Depends(require_permission("view"))) -> dict:
    """The numbers the digest is rendered from."""
    d = await _previewable(request, db, tenant, role, digest_id)
    return await _numbers(db, tenant, d)
