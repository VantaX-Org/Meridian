"""Per-user notification delivery: who gets what, and a record of every attempt.

The user's choices live in ``users.preferences->'notifications'`` (validated by
api/routes/preferences.py: ``digest`` daily|weekly|off, ``immediate_critical``,
``channels`` {email: bool, teams: bool}). Nothing is sent to a user who has not
opted in: an absent ``immediate_critical`` or ``digest`` means no delivery, an absent
``channels`` means in-app only. ``teams`` is accepted by the preference document but
there is no per-user Teams delivery, so it is ignored here.

Email goes through the same backends as the tenant alert channels
(workers/tasks/send_notifications.py: Microsoft Graph, else the SMTP relay, else
Resend); ``email_backend_name`` reports which one the environment selects so the
worker can write one ``no_backend`` row per run and ``/health`` can tell the UI.
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from typing import Literal, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

Kind = Literal["critical", "daily", "weekly"]
Channel = Literal["email", "in_app"]
DeliveryKind = Literal["critical", "digest", "test"]
DeliveryStatus = Literal["sent", "failed", "no_backend", "skipped"]
EmailBackend = Literal["graph", "smtp", "resend"]

#: create_graph_client() in workers/email_backends/microsoft_graph.py needs all four.
_GRAPH_ENV = ("MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "EMAIL_FROM")


@dataclass(frozen=True)
class Recipient:
    user_id: str
    name: str
    email: Optional[str]
    #: True when the user opted into email and has an address; in-app is always on.
    wants_email: bool


_RECIPIENTS_SQL = """
    SELECT id, name, email, preferences->'notifications' AS notifications
      FROM users
     WHERE tenant_id = CAST(:tid AS uuid) AND is_active
       AND {condition}
"""

_CONDITIONS = {
    "critical": "COALESCE((preferences->'notifications'->>'immediate_critical')::boolean, false)",
    "daily": "preferences->'notifications'->>'digest' = 'daily'",
    "weekly": "preferences->'notifications'->>'digest' = 'weekly'",
}


def wants_email(notifications: Optional[dict]) -> bool:
    """``channels.email`` is true; an absent ``channels`` means in-app only."""
    channels = (notifications or {}).get("channels")
    return isinstance(channels, dict) and channels.get("email") is True


def resolve_recipients(session: Session, tenant_id: str, kind: Kind) -> list[Recipient]:
    """Active users of one tenant who opted into ``kind`` ("critical", "daily", "weekly"), in one query.

    Each recipient always gets an in-app notification; ``wants_email`` adds the email when
    the user asked for it and has an address. Users without an email are in-app only.
    """
    if kind not in _CONDITIONS:
        raise ValueError(f"unknown recipient kind: {kind}")
    rows = session.execute(
        text(_RECIPIENTS_SQL.format(condition=_CONDITIONS[kind])), {"tid": str(tenant_id)}
    ).fetchall()
    out: list[Recipient] = []
    for row in rows:
        user_id, name, email, notifications = row[0], row[1], row[2], row[3]
        if isinstance(notifications, str):
            try:
                notifications = json.loads(notifications)
            except ValueError:
                notifications = {}
        email = (email or "").strip() or None
        out.append(Recipient(
            user_id=str(user_id), name=name or "", email=email,
            wants_email=bool(email) and wants_email(notifications if isinstance(notifications, dict) else None),
        ))
    return out


def email_backend_name() -> Optional[EmailBackend]:
    """Which email backend the environment selects, in the order ``_deliver_email`` tries them:
    Microsoft Graph, then the SMTP relay, then Resend. None when nothing is configured."""
    if all(os.getenv(k) for k in _GRAPH_ENV):
        return "graph"
    if os.getenv("SMTP_HOST"):
        return "smtp"
    if os.getenv("RESEND_API_KEY"):
        return "resend"
    return None


_INSERT_SQL = """
    INSERT INTO notification_deliveries (id, tenant_id, user_id, channel, kind, status, error, created_at)
    VALUES (:id, :tid, :uid, :channel, :kind, :status, :error, now())
"""


def record_delivery(session: Session, tenant_id: str, user_id: Optional[str], channel: Channel,
                    kind: DeliveryKind, status: DeliveryStatus, error: Optional[str] = None) -> str:
    """Write one notification_deliveries row (sync session; the caller commits). ``error`` holds an
    exception type or a short reason, never an address or a message body."""
    row_id = str(uuid.uuid4())
    session.execute(text(_INSERT_SQL), {
        "id": row_id, "tid": str(tenant_id), "uid": str(user_id) if user_id else None,
        "channel": channel, "kind": kind, "status": status, "error": (error or None) and str(error)[:500],
    })
    return row_id


async def record_delivery_async(db, tenant_id: str, user_id: Optional[str], channel: Channel,
                                kind: DeliveryKind, status: DeliveryStatus, error: Optional[str] = None) -> str:
    """``record_delivery`` for FastAPI routes (AsyncSession)."""
    row_id = str(uuid.uuid4())
    await db.execute(text(_INSERT_SQL), {
        "id": row_id, "tid": str(tenant_id), "uid": str(user_id) if user_id else None,
        "channel": channel, "kind": kind, "status": status, "error": (error or None) and str(error)[:500],
    })
    return row_id
