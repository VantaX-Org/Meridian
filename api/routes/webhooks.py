"""Outbound webhooks and the tenant's automation settings.

GET    /api/v1/webhooks                         the tenant's webhooks (the secret is never returned)
POST   /api/v1/webhooks                         add one; the secret is returned once (generated when not given)
PATCH  /api/v1/webhooks/{id}                    url, events, active, description, a new secret
DELETE /api/v1/webhooks/{id}
POST   /api/v1/webhooks/{id}/test               send a signed webhook.test event now and report the answer
GET    /api/v1/webhooks/{id}/deliveries         the delivery log: event, status, attempts, response code
GET    /api/v1/webhooks/events                  the events a webhook can subscribe to
GET    /api/v1/settings/automation              drift alerts, rule mining and score.dropped thresholds
PUT    /api/v1/settings/automation

Everything here needs ``manage_settings`` and is audited (audit_log). See api/services/webhooks.py for the signature.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import automation_settings, webhooks
from api.services.rbac import current_user_id, require_permission, write_audit

router = APIRouter(prefix="/api/v1", tags=["webhooks"])
Event = Literal["*", "run.finished", "run.failed", "batch.waiting", "batch.approved", "batch.sent", "score.dropped",
                "breach.new", "config.drift", "certificate.signed", "digest.sent"]
_COLS = "id::text, url, events, active, description, created_by::text, created_at, updated_at"


def _https(url: str) -> str:
    url = url.strip()
    if not url.startswith("https://") or len(url) < 12:
        raise ValueError("url must be an https:// URL")
    return url


class WebhookCreate(BaseModel):
    url: str = Field(max_length=2048)
    events: list[Event] = Field(min_length=1, max_length=20)
    secret: str | None = Field(None, min_length=16, max_length=256)
    description: str | None = Field(None, max_length=500)
    active: bool = True

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        return _https(v)


class WebhookUpdate(BaseModel):
    url: str | None = Field(None, max_length=2048)
    events: list[Event] | None = Field(None, min_length=1, max_length=20)
    secret: str | None = Field(None, min_length=16, max_length=256)
    description: str | None = Field(None, max_length=500)
    active: bool | None = None

    @field_validator("url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        return None if v is None else _https(v)


class ScoreDrop(BaseModel):
    below: float | None = Field(None, ge=0, le=100)
    points: float | None = Field(None, ge=0, le=100)


class DriftAlerts(BaseModel):
    enabled: bool = True


class RuleMining(BaseModel):
    min_records: int = Field(25, ge=2, le=100000)


class AutomationSettings(BaseModel):
    drift_alerts: DriftAlerts | None = None
    rule_mining: RuleMining | None = None
    score_drop: ScoreDrop | None = None


def _redact(url: str) -> str:
    """The host only: webhook URLs often embed a token in the path."""
    parts = url.split("/")
    return parts[2] if len(parts) > 2 else "?"


def _out(r) -> dict:
    d = dict(r._mapping)
    return {**d, "url": _redact(d["url"]), "events": list(d["events"] or [])}


async def _one(db: AsyncSession, tenant: Tenant, wid: uuid.UUID):
    row = (await db.execute(text(f"SELECT {_COLS} FROM webhooks WHERE id = :w AND tenant_id = :t"),
                            {"w": str(wid), "t": str(tenant.id)})).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return row


@router.get("/webhooks/events", dependencies=[Depends(require_permission("manage_settings"))])
async def list_events() -> dict:
    return {"events": list(webhooks.EVENTS)}


@router.get("/webhooks", dependencies=[Depends(require_permission("manage_settings"))])
async def list_webhooks(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    rows = (await db.execute(text(f"SELECT {_COLS} FROM webhooks WHERE tenant_id = :t ORDER BY created_at"),
                             {"t": str(tenant.id)})).fetchall()
    return {"webhooks": [_out(r) for r in rows]}


@router.post("/webhooks", status_code=201, dependencies=[Depends(require_permission("manage_settings"))])
async def create_webhook(body: WebhookCreate, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    secret = body.secret or webhooks.new_secret()
    row = (await db.execute(text(f"""
        INSERT INTO webhooks (tenant_id, url, secret, events, active, description, created_by)
        VALUES (:t, :u, :s, :e, :a, :d, CAST(:by AS uuid)) RETURNING {_COLS}"""),
        {"t": str(tenant.id), "u": body.url, "s": webhooks.seal(str(tenant.id), secret), "e": sorted(set(body.events)),
         "a": body.active, "d": body.description, "by": current_user_id(request)})).fetchone()
    out = _out(row)
    await write_audit(db, tenant.id, request, "webhook_created", "webhook", out["id"], None,
                      {"host": out["url"], "events": out["events"], "active": out["active"]})
    await db.commit()
    return {**out, "secret": secret}  # shown once


@router.patch("/webhooks/{webhook_id}", dependencies=[Depends(require_permission("manage_settings"))])
async def update_webhook(webhook_id: uuid.UUID, body: WebhookUpdate, request: Request,
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    before = _out(await _one(db, tenant, webhook_id))
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No changes")
    params = {"w": str(webhook_id), "t": str(tenant.id)}
    sets = []
    for k, v in changes.items():  # keys come from the model, never from the caller's free text
        if k == "secret":
            v = webhooks.seal(str(tenant.id), v)
        elif k == "events":
            v = sorted(set(v))
        sets.append(f"{k} = :{k}")
        params[k] = v
    row = (await db.execute(text(f"UPDATE webhooks SET {', '.join(sets)}, updated_at = now() "
                                 f"WHERE id = :w AND tenant_id = :t RETURNING {_COLS}"), params)).fetchone()
    out = _out(row)
    await write_audit(db, tenant.id, request, "webhook_updated", "webhook", out["id"],
                      {k: before[k] for k in ("url", "events", "active")},
                      {**{k: out[k] for k in ("url", "events", "active")}, "secret_changed": "secret" in changes})
    await db.commit()
    return out


@router.delete("/webhooks/{webhook_id}", status_code=204, dependencies=[Depends(require_permission("manage_settings"))])
async def delete_webhook(webhook_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> None:
    await _rls(db, tenant)
    before = _out(await _one(db, tenant, webhook_id))
    await db.execute(text("DELETE FROM webhooks WHERE id = :w AND tenant_id = :t"),
                     {"w": str(webhook_id), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "webhook_deleted", "webhook", str(webhook_id),
                      {"host": before["url"], "events": before["events"]}, None)
    await db.commit()


def _deliver_now(tenant_id: str, delivery_id: str) -> dict | None:
    from workers.db import get_sync_engine, tenant_session

    with tenant_session(get_sync_engine(), tenant_id) as s:
        out = webhooks.deliver_one(s, tenant_id, delivery_id)
        s.commit()
        return out


@router.post("/webhooks/{webhook_id}/test", dependencies=[Depends(require_permission("manage_settings"))])
async def test_webhook(webhook_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)) -> dict:
    """Queue a signed webhook.test event for this webhook and send it now (one attempt; retried like any other)."""
    await _rls(db, tenant)
    await _one(db, tenant, webhook_id)
    t = str(tenant.id)
    ids = await db.run_sync(lambda s: webhooks.emit(s, t, webhooks.TEST_EVENT, {
        "message": "Test event from Meridian", "webhook_id": str(webhook_id)}, webhook_id=str(webhook_id)))
    await db.commit()
    if not ids:  # sandbox mode: held back and recorded (api/services/sandbox.py)
        return {"delivery_id": None, "status": "skipped", "reason": "sandbox"}
    out = await asyncio.to_thread(_deliver_now, t, ids[0])
    return {"delivery_id": ids[0], **(out or {"status": "pending"})}


@router.get("/webhooks/{webhook_id}/deliveries", dependencies=[Depends(require_permission("manage_settings"))])
async def list_deliveries(webhook_id: uuid.UUID, status: Literal["pending", "retrying", "delivered", "failed"] | None = None,
                          limit: int = Query(50, ge=1, le=500), db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    await _one(db, tenant, webhook_id)
    rows = (await db.execute(text("""
        SELECT id::text, event, event_id::text, status, attempts, response_code, error, created_at, last_attempt_at,
               next_attempt_at, delivered_at
          FROM webhook_deliveries WHERE tenant_id = :t AND webhook_id = :w AND (CAST(:s AS text) IS NULL OR status = :s)
         ORDER BY created_at DESC LIMIT :n"""), {"t": str(tenant.id), "w": str(webhook_id), "s": status, "n": limit})).mappings().all()
    return {"deliveries": [dict(r) for r in rows]}


@router.get("/settings/automation", dependencies=[Depends(require_permission("view"))])
async def get_automation(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    return await automation_settings.load(db, str(tenant.id))


@router.put("/settings/automation", dependencies=[Depends(require_permission("manage_settings"))])
async def put_automation(body: AutomationSettings, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> dict:
    from api.services.tenant_settings import put_setting

    await _rls(db, tenant)
    before = await automation_settings.load(db, str(tenant.id))
    after = {**before, **{k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}}
    after = automation_settings.merged(after)
    await put_setting(db, tenant.id, automation_settings.KEY, after, current_user_id(request))
    await write_audit(db, tenant.id, request, "automation_settings", "tenant_settings", automation_settings.KEY,
                      before, after)
    await db.commit()
    return after
