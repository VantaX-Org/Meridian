"""Out of office: delegations (migration 104).

A delegation hands one person's approvals and assigned work to another between two dates, inclusive. While it is
active:

  * every notification addressed to the person away is copied to the delegate, titled "For <name>: ..."
    (``route_copy`` below, called by api/services/notifications.py), so approvals waiting, SLA breaches, mentions and
    assignments reach someone who is in;
  * the batch and person inspectors show a banner on both sides (GET /api/v1/delegations/mine);
  * four eyes still holds: a delegate never approves a batch they built.

``active_on`` is the one definition of "active" (the routes, the notification copy and the tests use it).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import text

logger = logging.getLogger("meridian.delegation")

# Notification types copied to a delegate. A digest or a system warning is the tenant's, not the person's.
ROUTED_TYPES: frozenset[str] = frozenset({
    "approval", "batch_waiting", "mention", "assignment", "sla_at_risk", "sla_breached", "sla_ack_breached",
    "comment", "critical_breach", "score_dropped", "run_finished",
})

ACTIVE_SQL = "d.revoked_at IS NULL AND d.starts_on <= CAST(:today AS date) AND d.ends_on >= CAST(:today AS date)"


def utc_today() -> date:
    """Today in UTC: the day a delegation is checked against (dates are whole days, no time zone of their own)."""
    return datetime.now(timezone.utc).date()


def active_on(d: dict[str, Any], today: date) -> bool:
    """True when a delegation row (starts_on, ends_on, revoked_at) covers ``today``."""
    if d.get("revoked_at"):
        return False
    start, end = d["starts_on"], d["ends_on"]
    start = date.fromisoformat(start) if isinstance(start, str) else start
    end = date.fromisoformat(end) if isinstance(end, str) else end
    return start <= today <= end


def state_of(d: dict[str, Any], today: date) -> str:
    """scheduled | active | ended | revoked."""
    if d.get("revoked_at"):
        return "revoked"
    if active_on(d, today):
        return "active"
    start = d["starts_on"]
    start = date.fromisoformat(start) if isinstance(start, str) else start
    return "scheduled" if start > today else "ended"


def delegate_for_sync(session, tenant_id: str, user_id: str, today: date | None = None) -> tuple[str, str] | None:
    """(delegate id, name of the person away) when ``user_id`` has an active delegation today, else None."""
    row = session.execute(text(
        f"SELECT d.to_user_id::text, COALESCE(u.name, u.email) FROM delegations d JOIN users u ON u.id = d.from_user_id "
        f"WHERE d.tenant_id = CAST(:t AS uuid) AND d.from_user_id = CAST(:u AS uuid) AND {ACTIVE_SQL} "
        f"ORDER BY d.created_at DESC LIMIT 1"),
        {"t": tenant_id, "u": user_id, "today": today or utc_today()}).fetchone()
    return (row[0], row[1]) if row else None


def copy_title(title: str, away_name: str) -> str:
    return f"For {away_name}: {title}"


_ASYNC_SQL = (f"SELECT d.to_user_id::text, COALESCE(u.name, u.email) FROM delegations d "
              f"JOIN users u ON u.id = d.from_user_id WHERE d.tenant_id = CAST(:t AS uuid) "
              f"AND d.from_user_id = CAST(:u AS uuid) AND {ACTIVE_SQL} ORDER BY d.created_at DESC LIMIT 1")


def route_copy_sync(session, tenant_id: str, user_id: str | None, type_: str) -> tuple[str, str] | None:
    """(delegate id, away name) to copy a notification to, or None. Never raises: on any error (no table yet in an
    old database, a test double) the notification simply is not copied."""
    if not user_id or type_ not in ROUTED_TYPES:
        return None
    try:
        with session.begin_nested():
            return delegate_for_sync(session, tenant_id, str(user_id))
    except Exception:
        logger.debug("delegation lookup skipped", exc_info=True)
        return None


async def route_copy(db, tenant_id: str, user_id: str | None, type_: str) -> tuple[str, str] | None:
    """The async twin of route_copy_sync for routes."""
    if not user_id or type_ not in ROUTED_TYPES:
        return None
    try:
        async with db.begin_nested():
            row = (await db.execute(text(_ASYNC_SQL), {"t": tenant_id, "u": str(user_id),
                                                        "today": utc_today()})).fetchone()
        return (row[0], row[1]) if row else None
    except Exception:
        logger.debug("delegation lookup skipped", exc_info=True)
        return None
