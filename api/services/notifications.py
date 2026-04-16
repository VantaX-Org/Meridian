"""Notification service — create_notification utility for use across API and workers."""

import json
import logging
import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

logger = logging.getLogger("meridian.notifications")


async def create_notification(
    tenant_id: str,
    user_id: Optional[str],
    type: str,
    title: str,
    body: str,
    link: Optional[str],
    db: AsyncSession,
) -> str:
    """Create a notification record (async — for use in FastAPI routes)."""
    notif_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO notifications (id, tenant_id, user_id, type, title, body, link, is_read, created_at)
            VALUES (:id, :tid, :uid, :type, :title, :body, :link, false, now())
        """),
        {
            "id": notif_id,
            "tid": tenant_id,
            "uid": user_id,
            "type": type,
            "title": title,
            "body": body,
            "link": link,
        },
    )
    return notif_id


def create_notification_sync(
    tenant_id: str,
    user_id: Optional[str],
    type: str,
    title: str,
    body: str,
    link: Optional[str],
    session: Session,
) -> str:
    """Create a notification record (sync — for use in Celery workers)."""
    notif_id = str(uuid.uuid4())
    session.execute(
        text("""
            INSERT INTO notifications (id, tenant_id, user_id, type, title, body, link, is_read, created_at)
            VALUES (:id, :tid, :uid, :type, :title, :body, :link, false, now())
        """),
        {
            "id": notif_id,
            "tid": tenant_id,
            "uid": user_id,
            "type": type,
            "title": title,
            "body": body,
            "link": link,
        },
    )
    return notif_id
