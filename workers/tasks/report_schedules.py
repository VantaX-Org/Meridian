"""Celery tasks: generate scheduled reports, keep them in the history and deliver them.

Beat fires ``run_due_report_schedules`` every 15 minutes (workers/scheduler.py). For every tenant
it reads the enabled schedules whose ``next_run_at`` has come and, for each, claims the slot with

    INSERT INTO report_schedule_runs (schedule_id, due_at, ...) ON CONFLICT (schedule_id, due_at) DO NOTHING

so a slot is generated and delivered at most once however often (or however concurrently) the task
fires. The claimed slot renders the report with the same builders as the download routes
(api/services/report_history.generate_report), stores it in report_files, and delivers it:

  * users: an in-app "report" notification, and an email with the file attached (a link instead
    when the file is over MAX_ATTACHMENT_BYTES);
  * alert channels (/alert-channels): email channels get the attachment the same way; Slack, Teams
    and webhooks get a link to the report library (they carry no files). Webhook bodies are signed
    as alerts are (X-Meridian-Signature).

Then ``next_run_at`` moves to the first slot after now in the schedule's time zone; slots missed
while beat was down are not back-filled. ``run_report_schedule`` is the same path for "Run now".
Never raises from the beat task: one tenant or schedule failing must not stop the rest. No LLM.

Every query carries ``tenant_id`` (row-level security is the second line, not the only one: a
deployment whose database user bypasses RLS must still never run or deliver another tenant's
schedule). A slot is skipped, not sent, when the licence does not include export_reports or the
schedule's creator is gone, inactive or no longer holds ``export``; a user recipient without
``export`` is not sent the report.
"""

from __future__ import annotations

import json
import logging
import time as _time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import requests
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import report_history as rh
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.report_schedules")

REPORTS_LINK = "/insights/reports"
# The longest hard time limit of the tasks below (run_due_report_schedules): a run still 'running'
# after this cannot finish any more.
STUCK_AFTER_SECONDS = 1560
_COLS = ("id, tenant_id, name, kind, format, params, cadence, time_of_day, weekday, day_of_month, timezone, "
         "recipient_user_ids, recipient_channel_ids, enabled, next_run_at, created_by")


def due_schedules(session: Session, tenant_id: str, now: datetime) -> list[dict]:
    rows = session.execute(text(
        f"SELECT {_COLS} FROM report_schedules WHERE tenant_id = CAST(:t AS uuid) AND enabled "
        "AND next_run_at IS NOT NULL AND next_run_at <= :now ORDER BY next_run_at"),
        {"t": str(tenant_id), "now": now}).mappings().all()
    return [dict(r) for r in rows]


def load_schedule(session: Session, tenant_id: str, schedule_id: str) -> Optional[dict]:
    row = session.execute(text(f"SELECT {_COLS} FROM report_schedules "
                               "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                          {"id": str(schedule_id), "t": str(tenant_id)}).mappings().first()
    return dict(row) if row else None


def claim_slot(session: Session, tenant_id: str, schedule_id: str, due_at: datetime, manual: bool) -> Optional[str]:
    """The run id when this call took the (schedule, due_at) slot; None when it was already taken."""
    row = session.execute(text("""
        INSERT INTO report_schedule_runs (tenant_id, schedule_id, due_at, manual)
        VALUES (:t, CAST(:s AS uuid), :due, :manual)
        ON CONFLICT (schedule_id, due_at) DO NOTHING RETURNING id
    """), {"t": str(tenant_id), "s": str(schedule_id), "due": due_at, "manual": manual}).first()
    return str(row[0]) if row else None


def advance(session: Session, sched: dict, due_at: datetime, now: datetime) -> datetime:
    """Move next_run_at past now, only if no one moved it meanwhile (compare-and-swap)."""
    nxt = rh.schedule_next(sched, max(now, due_at))
    session.execute(text("UPDATE report_schedules SET next_run_at = :n WHERE id = CAST(:id AS uuid) "
                         "AND tenant_id = CAST(:t AS uuid) AND next_run_at = :due"),
                    {"n": nxt, "id": str(sched["id"]), "t": str(sched["tenant_id"]), "due": due_at})
    return nxt


# ── delivery ─────────────────────────────────────────────────────────────────

def _message(sched: dict, gen: rh.Generated, run_label: str, link: str) -> tuple[str, str]:
    name = sched["name"] or rh.report_name(sched["kind"])
    subject = f"Meridian report: {name}"
    line = f"{rh.report_name(sched['kind'])} for {run_label}" if run_label else rh.report_name(sched["kind"])
    return subject, f"{line} is ready ({gen.file_name}, {len(gen.data):,} bytes). Open it in Meridian: {link}"


def _email_html(sched: dict, gen: rh.Generated, tenant_name: str, run_label: str, link: str, attached: bool) -> str:
    from workers import email_templates as mail

    what = rh.report_name(sched["kind"])
    lead = (f"The scheduled {what.lower()}{' for ' + run_label if run_label else ''} is attached."
            if attached else
            f"The scheduled {what.lower()}{' for ' + run_label if run_label else ''} is ready. "
            "It is too large to attach; open it from the report library.")
    return mail.render_email(title=sched["name"] or what, tenant=tenant_name, preheader=what,
                             blocks=[mail.paragraph(lead), mail.button("Open reports", link)])


def post_channel(channel: dict, payload: dict, summary: str, link: str) -> bool:
    """Slack, Teams or a signed webhook: a link, never the file. Never logs the target (webhook
    URLs embed tokens) or the secret."""
    from workers.tasks.send_notifications import sign

    kind = channel["kind"]
    if kind == "slack":
        body_obj: dict = {"text": summary}
    elif kind == "teams":
        body_obj = {"type": "message", "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {"$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard",
                        "version": "1.4", "body": [{"type": "TextBlock", "wrap": True, "text": summary}],
                        "actions": [{"type": "Action.OpenUrl", "title": "Open reports", "url": link}]}}]}
    else:
        body_obj = payload
    body = json.dumps(body_obj, sort_keys=True, default=str).encode()
    headers = {"Content-Type": "application/json", "X-Meridian-Event": "meridian.report_ready"}
    if channel.get("secret"):
        ts = str(int(_time.time()))
        headers |= {"X-Meridian-Timestamp": ts, "X-Meridian-Signature": sign(channel["secret"], ts, body)}
    try:
        resp = requests.post(channel["target"], data=body, headers=headers, timeout=10)
        return bool(resp.ok)
    except requests.RequestException as e:
        logger.error(f"report channel {channel.get('id')} ({kind}) failed: {type(e).__name__}")
        return False


def deliver(session: Session, tenant_id: str, sched: dict, gen: rh.Generated, file_id: Optional[str], *,
            base_url: str, send_email: Callable[..., bool], post: Callable[..., bool]) -> tuple[int, int, list[str]]:
    """(delivered, failed, notes). Users always get the in-app notification; their email and every
    channel count as delivered or failed by what the backend said."""
    from api.services.notifications import create_notification_sync

    tenant_name = session.execute(text("SELECT name FROM tenants WHERE id = :t"), {"t": str(tenant_id)}).scalar() or ""
    run_label = ""
    if gen.version_id:
        row = session.execute(text("SELECT label, run_at FROM analysis_versions "
                                   "WHERE id = CAST(:v AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                              {"v": gen.version_id, "t": str(tenant_id)}).first()
        if row:
            run_label = row[0] or row[1].strftime("the run of %Y-%m-%d %H:%M")
    link = f"{base_url}{REPORTS_LINK}"
    subject, summary = _message(sched, gen, run_label, link)
    attach = len(gen.data) <= rh.MAX_ATTACHMENT_BYTES
    attachments = [(gen.file_name, gen.data, gen.content_type)] if attach else None
    html = _email_html(sched, gen, tenant_name, run_label, link, attach)
    delivered = failed = 0
    notes: list[str] = []

    user_ids = [str(u) for u in (sched.get("recipient_user_ids") or [])]
    if user_ids:
        from api.services.rbac import active_users_holding_sync

        # Send time: only active users of this tenant who still hold `export` get the report.
        allowed = sorted(active_users_holding_sync(session, tenant_id, user_ids, "export"))
        users = session.execute(text(
            "SELECT id, email FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active "
            "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": str(tenant_id), "ids": allowed}).fetchall() if allowed else []
        dropped = len(set(user_ids)) - len(users)
        if dropped:
            notes.append(f"{dropped} recipient(s) skipped (inactive or without the export permission)")
        for uid, address in users:
            create_notification_sync(str(tenant_id), str(uid), "report", subject, summary, REPORTS_LINK, session)
            try:
                ok = bool(send_email(address, subject, html, attachments))
            except SoftTimeLimitExceeded:
                raise
            except Exception as e:
                logger.error(f"report email to user {uid} raised: {type(e).__name__}")
                ok = False
            # The email is what counts: an in-app notice alone is not a delivered report.
            if ok:
                delivered += 1
            else:
                failed += 1
                notes.append(f"email to user {uid} not sent")
        session.commit()

    channel_ids = [str(c) for c in (sched.get("recipient_channel_ids") or [])]
    if channel_ids:
        channels = session.execute(text(
            "SELECT id, kind, target, secret FROM alert_channels WHERE tenant_id = CAST(:t AS uuid) AND enabled "
            "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": str(tenant_id), "ids": channel_ids}).mappings().all()
        payload = {"event": "meridian.report_ready", "schedule_id": str(sched["id"]), "report_file_id": file_id,
                   "kind": sched["kind"], "name": sched["name"], "format": sched["format"],
                   "version_id": gen.version_id, "file_name": gen.file_name, "size_bytes": len(gen.data),
                   "links": {"reports": link}, "sent_at": rh.utcnow().isoformat()}
        for ch in channels:
            try:
                if ch["kind"] == "email":
                    ok = bool(send_email(ch["target"], subject, html, attachments))
                else:
                    ok = bool(post(dict(ch), payload, summary, link))
            except SoftTimeLimitExceeded:
                raise
            except Exception as e:
                logger.error(f"report channel {ch['id']} raised: {type(e).__name__}")
                ok = False
            if ok:
                delivered += 1
            else:
                failed += 1
                notes.append(f"{rh.channel_label(ch['kind'], ch['target'])} not delivered")
    return delivered, failed, notes


# ── one slot ─────────────────────────────────────────────────────────────────

def export_licensed() -> bool:
    """The licence feature every report route needs (FEATURE_ROUTE_MAP: /api/v1/reports -> export_reports),
    decided the way LicenceMiddleware decides it."""
    from api.middleware.licence import feature_licensed

    return feature_licensed("export_reports")


def _blocked(session: Session, tenant_id: str, sched: dict) -> Optional[str]:
    """Why this slot must not be generated or sent (None when it may): the licence no longer includes
    report export, or the creator is gone, inactive or no longer holds ``export``, or the tenant is in sandbox mode
    (migration 115: nothing leaves; the held-back delivery is recorded)."""
    from api.services.rbac import active_users_holding_sync
    from api.services.sandbox import held_back_sync

    if held_back_sync(session, tenant_id, "report_schedule", "report", str(sched["id"])):
        return "held back: the tenant is in sandbox mode"

    try:
        licensed = export_licensed()
    except SoftTimeLimitExceeded:
        raise
    except Exception as e:
        logger.error(f"licence check for report schedules failed: {type(e).__name__}")
        licensed = False
    if not licensed:
        return "report export is not included in this deployment's licence"
    creator = sched.get("created_by")
    if not creator or str(creator) not in active_users_holding_sync(session, tenant_id, [str(creator)], "export"):
        return "the schedule's creator is inactive or no longer holds the export permission"
    return None


def run_slot(session: Session, tenant_id: str, sched: dict, due_at: datetime, *, manual: bool = False,
             base_url: str = "", send_email: Optional[Callable[..., bool]] = None,
             post: Callable[..., bool] = post_channel,
             generate: Callable[..., Optional[rh.Generated]] = rh.generate_report) -> Optional[dict]:
    """Claim, generate, store, deliver. None when the slot was already claimed (idempotent) or the
    schedule is not this tenant's (refused before anything is claimed)."""
    if str(sched.get("tenant_id")) != str(tenant_id):
        logger.error(f"report schedule {sched.get('id')} refused: not a schedule of the tenant being processed")
        return None
    if send_email is None:
        from workers.tasks.send_notifications import _deliver_email as send_email
    run_id = claim_slot(session, tenant_id, str(sched["id"]), due_at, manual)
    session.commit()
    if not run_id:
        return None
    file_id: Optional[str] = None
    delivered = failed = 0
    notes: list[str] = []
    params = dict(sched.get("params") or {})
    try:
        blocked = _blocked(session, tenant_id, sched)
        gen = None if blocked else generate(session, tenant_id, sched["kind"], params)
        if blocked:
            status, notes = "skipped", [blocked]
        elif gen is None:
            status, notes = "skipped", ["nothing to report on for this scope"]
        else:
            file_id = rh.store_report_file(
                session, tenant_id, kind=sched["kind"], data=gen.data, file_name=gen.file_name,
                content_type=gen.content_type, version_id=gen.version_id, params=params,
                source="run_now" if manual else "schedule", schedule_id=str(sched["id"]),
                created_by=str(sched["created_by"]) if sched.get("created_by") else None,
                name=sched["name"] or None)
            session.commit()
            if file_id is None:
                notes.append("not kept in history (storage unavailable or file too large)")
            delivered, failed, more = deliver(session, tenant_id, sched, gen, file_id, base_url=base_url,
                                              send_email=send_email, post=post)
            notes += more
            status = "failed" if failed and not delivered else "partial" if failed else "sent"
    except rh.NoRun:
        session.rollback()
        status, notes = "skipped", ["no finished run in this scope yet"]
    except SoftTimeLimitExceeded:
        raise  # the run row stays 'running'; reap_stuck_runs marks it failed on a later beat
    except Exception as e:
        session.rollback()
        logger.error(f"report schedule {sched['id']} failed: {type(e).__name__}")
        status, notes = "failed", [f"generation failed ({type(e).__name__})"]
    session.execute(text("""
        UPDATE report_schedule_runs SET status = :st, report_file_id = CAST(:f AS uuid), delivered = :d,
               failed = :x, detail = :detail, finished_at = now()
         WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)
    """), {"st": status, "f": file_id, "d": delivered, "x": failed, "detail": "; ".join(notes)[:2000] or None,
           "id": run_id, "t": str(tenant_id)})
    session.execute(text("UPDATE report_schedules SET last_run_at = now(), last_status = :st "
                         "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                    {"st": status, "id": str(sched["id"]), "t": str(tenant_id)})
    session.commit()
    return {"run_id": run_id, "status": status, "report_file_id": file_id, "delivered": delivered, "failed": failed}


def reap_stuck_runs(session: Session, tenant_id: str) -> int:
    """Runs left 'running' longer than any task that could hold them (the worker was killed at its
    hard time limit, or a soft limit was re-raised) are marked failed, so the slot is not lost silently."""
    res = session.execute(text(
        "UPDATE report_schedule_runs SET status = 'failed', finished_at = now(), "
        "detail = 'timed out: the worker stopped before the report was delivered' "
        "WHERE tenant_id = CAST(:t AS uuid) AND status = 'running' "
        "AND started_at < now() - make_interval(secs => :secs)"),
        {"t": str(tenant_id), "secs": STUCK_AFTER_SECONDS})
    session.commit()
    return res.rowcount or 0


def process_tenant(session: Session, tenant_id: str, now: datetime, **kw: Any) -> dict:
    """Every due schedule of one tenant (``session`` has the tenant set)."""
    out = {"due": 0, "ran": 0, "already_claimed": 0}
    for sched in due_schedules(session, tenant_id, now):
        out["due"] += 1
        due_at = sched["next_run_at"]
        try:
            res = run_slot(session, tenant_id, sched, due_at, **kw)
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:
            session.rollback()
            logger.error(f"report schedule {sched['id']} raised: {type(e).__name__}")
            res = None
        out["ran" if res else "already_claimed"] += 1
        advance(session, sched, due_at, now)
        session.commit()
    return out


@celery_app.task(name="workers.tasks.report_schedules.run_due_report_schedules",
                 soft_time_limit=1500, time_limit=1560)
def run_due_report_schedules() -> dict:
    """Beat, every 15 minutes: the scheduled reports that have come due, for every tenant."""
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    base_url = _resolve_app_base_url()
    engine = get_sync_engine()
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        tenants = [str(r[0]) for r in session.execute(text("SELECT id FROM tenants")).fetchall()]
    totals = {"due": 0, "ran": 0, "already_claimed": 0}
    for tid in tenants:
        try:
            with tenant_session(engine, tid) as session:
                reap_stuck_runs(session, tid)
                res = process_tenant(session, tid, now, base_url=base_url)
            for k in totals:
                totals[k] += res[k]
        except SoftTimeLimitExceeded:
            raise
        except Exception as e:
            logger.error(f"report schedules failed for tenant {tid}: {type(e).__name__}")
    return totals


@celery_app.task(name="workers.tasks.report_schedules.run_report_schedule",
                 soft_time_limit=900, time_limit=960)
def run_report_schedule(tenant_id: str, schedule_id: str, due_at_iso: str) -> dict:
    """Run now: the same claim (on the request's own timestamp), generation and delivery."""
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    due_at = datetime.fromisoformat(due_at_iso)
    with tenant_session(get_sync_engine(), tenant_id) as session:
        sched = load_schedule(session, tenant_id, schedule_id)
        if not sched:
            return {"status": "not_found"}
        res = run_slot(session, tenant_id, sched, due_at, manual=True, base_url=_resolve_app_base_url())
    return res or {"status": "already_claimed"}
