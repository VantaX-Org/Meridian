"""The signed-in user's own notification delivery: a test send and the delivery log.

POST /api/v1/me/notifications/test        — an in-app notification addressed to the caller,
                                            plus a test email when a backend is configured
GET  /api/v1/me/notifications/deliveries  — the caller's own notification_deliveries rows

Both are self-service (any signed-in user, no role guard); the test send is limited to
three per hour per user.

The test send commits the in-app notification and a pending delivery row (key
``test:<uuid>``) first, then emails, then records the outcome in a second transaction;
when that second write fails the email has still gone out, so the response says
``sent_unrecorded`` instead of failing.
"""

import asyncio
import logging
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import app_links
from api.services.notifications import create_notification
from api.services.rate_limiter import rate_limit
from api.services.rbac import current_user_id
from api.services.user_notifications import (
    claim_delivery_async, email_backend_name, finish_delivery_async, record_delivery_async, test_key,
)

logger = logging.getLogger("meridian.api.me_notifications")

router = APIRouter(prefix="/api/v1", tags=["notifications"])

TEST_TITLE = "Test notification"
TEST_BODY = "This is a test from Me > Preferences. Notifications reach you here."


EmailStatus = Literal["sent", "no_backend", "failed", "sent_unrecorded"]


class TestResult(BaseModel):
    #: sent_unrecorded: the email went out but the delivery log could not be updated
    email: EmailStatus
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
    key = test_key()

    # First transaction: the in-app notification and the claimed (pending) email row.
    await create_notification(str(tenant.id), str(uid), "info", TEST_TITLE, TEST_BODY, app_links.PREFERENCES, db)
    await record_delivery_async(db, str(tenant.id), str(uid), "in_app", "test", "sent")
    email_row = None
    if email_backend_name() is None or not email:
        await record_delivery_async(db, str(tenant.id), str(uid), "email", "test", "no_backend",
                                    "no email backend configured" if email else "user has no email address")
    else:
        email_row = await claim_delivery_async(db, str(tenant.id), str(uid), "email", "test", key)
    await db.commit()
    if email_row is None:
        return TestResult(email="no_backend", in_app=True)

    # Then the send, outside any transaction.
    error = None
    try:
        ok = await asyncio.to_thread(_send_test_email, email)
    except Exception as e:  # a raise inside a backend; never the address or the message
        ok, error = False, type(e).__name__
    email_status: EmailStatus = "sent" if ok else "failed"

    # Second transaction: the outcome. The email has gone out either way, so a failure here
    # is reported, not raised.
    try:
        await _set_rls(db, tenant)
        await finish_delivery_async(db, email_row, email_status, error)
        await db.commit()
    except Exception as e:
        logger.error(f"test notification for user {uid}: delivery outcome not recorded: {type(e).__name__}")
        try:
            await db.rollback()
        except Exception:
            pass
        if ok:
            email_status = "sent_unrecorded"
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
