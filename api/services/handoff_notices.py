"""Hand-off notices: the inbox line and the email that tell the next person their part of a journey is waiting.

A hand-off is a step where one person's work becomes another's: a fix batch starts waiting for its owners, an
approver sends it back or approves it, its load file waits for the SAP load, the next run verifies it, someone asks
for access. Each is told here, once:

* **in the inbox**: one ``notifications`` row per person (``api/services/notifications.create_notification_sync``),
  whose out-of-office delegate receives the usual "For <name>: ..." copy;
* **by email**: through the deployment's email backend (Microsoft Graph, the SMTP relay, Resend; the same chain as
  every other email), to the person and to their delegate while they are away. A hand-off is work waiting for that
  person, so it is emailed unless the person turned email off (``users.preferences.notifications.channels.email``
  set to false). The send runs in the worker (``workers/tasks/handoff_notices.py``) after the caller commits.

Idempotency: each notice has a key (``batch_waiting:<batch>:<round>``, ``batch_approved:<batch>:<instance>``, ...).
Before anything is written the key is claimed per person and channel in ``notification_deliveries`` (kind ``event``,
``ON CONFLICT DO NOTHING``), so the same hand-off never notifies a person twice, whatever retries or repeated calls
happen. A notice names objects, batches and counts only: never a field value or a record of SAP data.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from typing import Iterable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import delegation
from api.services.user_notifications import claim_delivery, email_backend_name, finish_delivery

logger = logging.getLogger("meridian.handoff_notices")


@dataclass(frozen=True)
class EmailJob:
    """One email to send after the caller's commit: the claimed delivery row it finishes and what it says."""
    tenant_id: str
    delivery_id: str
    user_id: str
    subject: str
    title: str
    body: str
    link: Optional[str]
    button: str


def _wants_email(prefs: object) -> bool:
    """Hand-off notices are emailed unless the person turned email off explicitly."""
    if isinstance(prefs, str):
        try:
            prefs = json.loads(prefs)
        except ValueError:
            prefs = {}
    channels = (prefs or {}).get("channels") if isinstance(prefs, dict) else None
    return not (isinstance(channels, dict) and channels.get("email") is False)


def _people(session: Session, tid: str, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    rows = session.execute(text(
        "SELECT id::text AS id, COALESCE(NULLIF(name, ''), email) AS name, email, "
        "preferences->'notifications' AS prefs FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active "
        "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": tid, "ids": ids}).mappings().all()
    return {r["id"]: dict(r) for r in rows}


def _valid_ids(user_ids: Iterable[Optional[str]]) -> list[str]:
    import uuid

    out: list[str] = []
    for u in user_ids:
        try:
            v = str(uuid.UUID(str(u))) if u else None
        except ValueError:
            v = None
        if v and v not in out:
            out.append(v)
    return out


def notify(session: Session, tenant_id: str, user_ids: Iterable[Optional[str]], *, type_: str, title: str, body: str,
           link: Optional[str], key: str, skip: Iterable[Optional[str]] = (), email: bool = True,
           button: str = "Open in Meridian") -> list[EmailJob]:
    """Tell each person once per ``key``: an inbox notification (copied to their delegate while they are away) and,
    with ``email``, an email to them and to that delegate. ``skip``: people never told (the person who acted).
    Returns the emails to send once the caller has committed (``dispatch``). Never raises: a notice must not cost
    the decision it reports; a failure is logged and the person is simply not told."""
    try:
        with session.begin_nested():
            return _notify(session, str(tenant_id), user_ids, type_, title, body, link, key, set(_valid_ids(skip)),
                           email, button)
    except Exception as exc:  # noqa: BLE001 - see the docstring
        logger.warning("hand-off notice %s not written: %s", type_, type(exc).__name__)
        return []


def _notify(session: Session, tid: str, user_ids: Iterable[Optional[str]], type_: str, title: str, body: str,
            link: Optional[str], key: str, skip: set[str], email: bool, button: str) -> list[EmailJob]:
    from api.services.notifications import create_notification_sync

    people = _people(session, tid, [u for u in _valid_ids(user_ids) if u not in skip])
    backend = email_backend_name()
    jobs: list[EmailJob] = []
    for uid, p in sorted(people.items()):
        claimed = claim_delivery(session, tid, uid, "in_app", "event", key)
        if claimed is None:
            continue  # already told about this hand-off
        create_notification_sync(tid, uid, type_, title, body, link, session)
        finish_delivery(session, claimed, "sent")
        recipients = [(uid, p, title)]
        away = delegation.delegate_for_sync(session, tid, uid)
        if away and away[0] != uid and away[0] not in skip:
            deputy = _people(session, tid, [away[0]]).get(away[0])
            if deputy:
                recipients.append((away[0], deputy, delegation.copy_title(title, p["name"] or "a colleague")))
        if not email:
            continue
        for rid, person, subject in recipients:
            if not person.get("email") or not _wants_email(person.get("prefs")):
                continue
            row = claim_delivery(session, tid, rid, "email", "event", key)
            if row is None:
                continue
            if backend is None:
                finish_delivery(session, row, "no_backend", "no email backend configured")
                continue
            jobs.append(EmailJob(tid, row, rid, subject, subject, body, link, button))
    return jobs


def dispatch(jobs: Iterable[EmailJob]) -> int:
    """Queue the emails of committed notices for the worker. A queue that is down leaves the delivery rows pending
    (logged), never an error for the caller. Returns how many were queued."""
    jobs = list(jobs)
    if not jobs:
        return 0
    try:
        from workers.tasks.handoff_notices import send_notice_email
    except Exception as exc:  # noqa: BLE001 - an API image without the worker package
        logger.warning("hand-off emails not queued: %s", type(exc).__name__)
        return 0
    n = 0
    for job in jobs:
        try:
            send_notice_email.delay(**asdict(job))
            n += 1
        except Exception as exc:  # noqa: BLE001 - the broker is down: the row stays pending
            logger.warning("hand-off email not queued: %s", type(exc).__name__)
    return n


# ── Who is told about a fix batch ────────────────────────────────────────────


def batch_owners(session: Session, tenant_id: str, batch_id: str) -> list[str]:
    """The owners of the objects a fix batch touches (Data owners, kind object; the steward where an object has no
    owner), sorted. Their delegates are reached through ``notify``."""
    rows = session.execute(text("""
        SELECT DISTINCT COALESCE(o.owner_user_id, o.steward_user_id)::text
          FROM data_owners o
         WHERE o.tenant_id = CAST(:t AS uuid) AND o.kind = 'object'
           AND o.ref IN (SELECT DISTINCT i.module FROM remediation_items i
                          WHERE i.tenant_id = CAST(:t AS uuid) AND i.batch_id = CAST(:b AS uuid))
           AND COALESCE(o.owner_user_id, o.steward_user_id) IS NOT NULL"""),
        {"t": str(tenant_id), "b": str(batch_id)}).fetchall()
    return sorted(r[0] for r in rows)


def batch_round(session: Session, tenant_id: str, batch_id: str) -> int:
    """How many times the batch was sent back: a batch that comes back and waits again is a new hand-off."""
    return int(session.execute(text(
        "SELECT count(*) FROM remediation_events WHERE tenant_id = CAST(:t AS uuid) AND batch_id = CAST(:b AS uuid) "
        "AND action = 'sent_back' AND item_id IS NULL"), {"t": str(tenant_id), "b": str(batch_id)}).scalar() or 0)


def batch_link(batch_id: str) -> str:
    from api.services.collab import link_for
    return link_for("batch", str(batch_id))


def batch_waiting(session: Session, tenant_id: str, batch_id: str) -> list[EmailJob]:
    """A fix batch starts waiting for approval: tell the owners of its objects (and their deputies), once per batch
    and round. Where the batch's approval is already in progress in the workflow engine, its pending step's deciders
    are told through the engine as well (``workflow.flush_notifications``, once per step). Never raises."""
    try:
        with session.begin_nested():
            return _batch_waiting(session, str(tenant_id), str(batch_id))
    except Exception as exc:  # noqa: BLE001 - a notice never costs the decision that raised it
        logger.warning("batch waiting notice not written: %s", type(exc).__name__)
        return []


def _batch_waiting(session: Session, tenant_id: str, batch_id: str) -> list[EmailJob]:
    from api.services import workflow

    tid = str(tenant_id)
    b = session.execute(text(
        "SELECT b.name, b.status, b.created_by::text AS created_by, COALESCE(NULLIF(u.name, ''), b.created_by_label) AS who "
        "FROM remediation_batches b LEFT JOIN users u ON u.id = b.created_by AND u.tenant_id = b.tenant_id "
        "WHERE b.id = CAST(:b AS uuid) AND b.tenant_id = CAST(:t AS uuid)"),
        {"b": str(batch_id), "t": tid}).mappings().first()
    if b is None or b["status"] != "draft":
        return []
    n = session.execute(text(
        "SELECT count(DISTINCT (scope, module, record_key)) FROM remediation_items WHERE tenant_id = CAST(:t AS uuid) "
        "AND batch_id = CAST(:b AS uuid)"), {"t": tid, "b": str(batch_id)}).scalar() or 0
    if not n:
        return []
    try:
        with session.begin_nested():
            inst = workflow.open_instance(session, tid, "fix_batch", str(batch_id))
            if inst is not None:
                workflow.flush_notifications(session, tid, inst["id"])
    except Exception as exc:  # noqa: BLE001 - the owners below are told either way
        logger.warning("workflow notices of batch not written: %s", type(exc).__name__)
    who = b["who"] or "A steward"
    title = f"Fix batch {b['name']} waits for your approval"
    body = (f"{who} built the fix batch {b['name']} with {n} record{'s' if n != 1 else ''} on an object you own. "
            "Open the batch to approve it or send it back.")
    return notify(session, tid, batch_owners(session, tid, str(batch_id)), type_="batch_waiting", title=title,
                  body=body, link=batch_link(str(batch_id)),
                  key=f"batch_waiting:{batch_id}:{batch_round(session, tid, str(batch_id))}",
                  skip=[b["created_by"]], button="Open the batch")
