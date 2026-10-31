"""Celery task: send the email of one hand-off notice (api/services/handoff_notices.py).

The notice was claimed (a ``pending`` row of notification_deliveries, kind ``event``) in the same transaction as its
inbox notification; this task sends that one email and finishes the row ``sent`` or ``failed``. Idempotent: it acts
only on a row still ``pending`` (locked FOR UPDATE SKIP LOCKED), so a redelivered or repeated task sends nothing twice.
A failed send is not retried automatically, as for every per-user email. Logs carry ids and outcomes only, never an
address.
"""
from __future__ import annotations

import logging
from typing import Optional

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.handoff_notices")


def render(title: str, body: str, link: Optional[str], button: str, tenant: Optional[str]) -> str:
    """The email body: the branded sheet with the sentence and one button into Meridian."""
    from workers import email_templates as mail
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    blocks = [mail.paragraph(body)]
    if link:
        href = f"{_resolve_app_base_url()}{link}"
        blocks += [mail.button(button, href), mail.link_fallback(href)]
    return mail.render_email(title=title, blocks=blocks, tenant=tenant, preheader=body[:140])


def send(engine, tenant_id: str, delivery_id: str, user_id: str, subject: str, title: str, body: str,
         link: Optional[str], button: str) -> str:
    """Send one claimed notice. Returns the outcome: sent, failed, skipped (not pending any more) or no_address."""
    from workers.tasks.send_notifications import _deliver_email

    with tenant_session(engine, tenant_id) as s:
        row = s.execute(text(
            "SELECT d.status, u.email, t.name FROM notification_deliveries d "
            "JOIN users u ON u.id = d.user_id AND u.tenant_id = d.tenant_id "
            "JOIN tenants t ON t.id = d.tenant_id "
            "WHERE d.id = CAST(:d AS uuid) AND d.tenant_id = CAST(:t AS uuid) AND d.user_id = CAST(:u AS uuid) "
            "FOR UPDATE OF d SKIP LOCKED"), {"d": delivery_id, "t": tenant_id, "u": user_id}).first()
        if row is None or row[0] != "pending":
            s.rollback()
            return "skipped"
        address = (row[1] or "").strip()
        if not address:
            outcome, error = "failed", "user has no email address"
        else:
            try:
                ok = _deliver_email(address, subject, render(title, body, link, button, row[2]))
            except Exception as exc:  # noqa: BLE001 - the outcome is recorded either way
                ok, error = False, type(exc).__name__
            else:
                error = None if ok else "every email backend refused the message"
            outcome = "sent" if ok else "failed"
        s.execute(text("UPDATE notification_deliveries SET status = :s, error = :e WHERE id = CAST(:d AS uuid) "
                       "AND tenant_id = CAST(:t AS uuid)"), {"s": outcome, "e": error, "d": delivery_id, "t": tenant_id})
        s.commit()
        return outcome


@celery_app.task(name="workers.tasks.handoff_notices.send_notice_email", soft_time_limit=60, time_limit=90)
def send_notice_email(tenant_id: str, delivery_id: str, user_id: str, subject: str, title: str, body: str,
                      link: Optional[str] = None, button: str = "Open in Meridian") -> str:
    try:
        out = send(get_sync_engine(), tenant_id, delivery_id, user_id, subject, title, body, link, button)
    except SoftTimeLimitExceeded:
        logger.warning("hand-off email %s timed out", delivery_id)
        return "timeout"
    logger.info("hand-off email %s: %s", delivery_id, out)
    return out
