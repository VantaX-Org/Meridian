"""The signed-in user's own notification delivery: a test send and the delivery log.

POST /api/v1/me/notifications/test        — an in-app notification addressed to the caller,
                                            plus a test email when a backend is configured
GET  /api/v1/me/notifications/deliveries  — the caller's own notification_deliveries rows

Both are self-service (any signed-in user, no role guard); the test send is limited to
three per hour per user.
"""

import asyncio
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.notifications import create_notification
from api.services.rate_limiter import rate_limit
from api.services.rbac import current_user_id
from api.services.user_notifications import email_backend_name, record_delivery_async

router = APIRouter(prefix="/api/v1", tags=["notifications"])

TEST_TITLE = "Test notification"
TEST_BODY = "This is a test from Me > Preferences. Notifications reach you here."


class TestResult(BaseModel):
    email: Literal["sent", "no_backend", "failed"]
    in_app: bool


def _user(request: Request) -> uuid.UUID:
    uid = current_user_id(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        return uuid.UUID(uid)
    except ValueError:
        raise HTTPException(status_code=401, detail="Authentication required")


async def _set_rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))


def _send_test_email(recipient: str) -> bool:
    """Runs in a thread: the worker's backend chain (Graph, SMTP relay, Resend)."""
    from workers import email_templates as mail
    from workers.tasks.send_notifications import _deliver_email

    body = mail.render_email(title=TEST_TITLE, blocks=[mail.paragraph(TEST_BODY)])
    return bool(_deliver_email(recipient, "Meridian test notification", body))


@router.post("/me/notifications/test",
             dependencies=[Depends(rate_limit("me_notifications_test", limit=3, window_s=3600, key_by="user"))])
async def send_test_notification(
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> TestResult:
    """Writes an in-app notification addressed to the caller and, when an email backend is
    configured, emails the caller's address. Every attempt lands in notification_deliveries."""
    uid = _user(request)
    await _set_rls(db, tenant)
    row = (await db.execute(
        text("SELECT email FROM users WHERE id = :uid AND tenant_id = :tid"),
        {"uid": str(uid), "tid": str(tenant.id)},
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    email = (row[0] or "").strip()

    await create_notification(str(tenant.id), str(uid), "info", TEST_TITLE, TEST_BODY, "/me/preferences", db)
    await record_delivery_async(db, str(tenant.id), str(uid), "in_app", "test", "sent")

    email_status: Literal["sent", "no_backend", "failed"]
    if email_backend_name() is None or not email:
        email_status = "no_backend"
        await record_delivery_async(db, str(tenant.id), str(uid), "email", "test", "no_backend",
                                    "no email backend configured" if email else "user has no email address")
    else:
        error = None
        try:
            ok = await asyncio.to_thread(_send_test_email, email)
        except Exception as e:  # a raise inside a backend; never the address or the message
            ok, error = False, type(e).__name__
        email_status = "sent" if ok else "failed"
        await record_delivery_async(db, str(tenant.id), str(uid), "email", "test", email_status, error)
    await db.commit()
    return TestResult(email=email_status, in_app=True)


@router.get("/me/notifications/deliveries")
async def list_my_deliveries(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict[str, Any]:
    """The caller's own delivery rows, newest first."""
    uid = _user(request)
    await _set_rls(db, tenant)
    rows = (await db.execute(
        text("""
            SELECT id, channel, kind, status, error, created_at
              FROM notification_deliveries
             WHERE tenant_id = :tid AND user_id = :uid
             ORDER BY created_at DESC
             LIMIT :limit
        """),
        {"tid": str(tenant.id), "uid": str(uid), "limit": limit},
    )).fetchall()
    return {"items": [dict(r._mapping) for r in rows]}
