"""Celery task: email the board pack (and the analyst workbook) on a schedule.

Each email alert channel carries ``report_pack`` = off | weekly | monthly (migration 085).
Beat fires ``send_report_pack("weekly")`` on Monday mornings SAST and
``send_report_pack("monthly")`` on the 1st. For every tenant the task renders the pack once
from the tenant's latest finished run, with the same builders the /reports/board and
/reports/{id}/workbook.xlsx routes use (api/services/pdf_reports.py, workbook_report.py), then
emails it to each enabled email channel whose ``report_pack`` matches the cadence and records one
"report" notification per send, so it shows in the inbox like the digests.

Idempotent: a channel claims ``<period>:<run id>`` in ``alert_channels.report_pack_key`` with one
UPDATE before it sends. A second firing in the same period finds the key taken and sends nothing;
a failed send gives the key back so the next firing retries. Every number comes from stored data
or a Python function; no LLM is involved. Never raises: one tenant failing must not stop the rest.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers import email_templates as mail
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.report_pack")

CADENCES = ("weekly", "monthly")
_SAST = ZoneInfo("Africa/Johannesburg")
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF_MIME = "application/pdf"
REPORTS_LINK = "/insights/reports"


def period_key(cadence: str, when: Optional[datetime] = None) -> str:
    """``weekly:<ISO year>-W<week>`` or ``monthly:<YYYY-MM>``, by the SAST calendar."""
    now = (when or datetime.now(timezone.utc)).astimezone(_SAST)
    if cadence == "weekly":
        iso = now.isocalendar()
        return f"weekly:{iso[0]}-W{iso[1]:02d}"
    if cadence == "monthly":
        return f"monthly:{now.strftime('%Y-%m')}"
    raise ValueError(f"unknown report pack cadence: {cadence}")


def _mask(address: str) -> str:
    """j***@example.com: enough to tell channels apart in the inbox, without the full address."""
    local, _, domain = str(address).partition("@")
    return f"{local[:1]}***@{domain}" if domain else "an email channel"


def pack_summary(ctx: dict) -> dict:
    """Run label, score and the three biggest blockers, read off the board context."""
    from api.services.pdf_reports import fmt_module

    meta = dict(ctx.get("meta") or [])
    blockers = [{"check_id": b["check_id"], "name": b.get("name") or b["check_id"],
                 "module": fmt_module(b["module"]), "affected": int(b["affected"])}
                for b in (ctx.get("blockers") or [])[:3]]
    return {"run": meta.get("Run") or "", "score": (ctx.get("overall") or {}).get("composite"),
            "blocker_total": int(ctx.get("blocker_total") or 0), "blockers": blockers}


def compose_email(summary: dict, tenant_name: str, base_url: str, *, with_workbook: bool = True) -> tuple[str, str]:
    """(subject, html body): plain speech, naming the run, the score and the three biggest blockers."""
    run, score = summary["run"], summary["score"]
    score_text = f"{score:.1f} out of 100" if score is not None else "no score"
    subject = f"Meridian board pack: {run}" if run else "Meridian board pack"
    blocks = [mail.paragraph(f"The board pack for {run or 'the latest run'} is attached"
                             f"{', with the analyst workbook' if with_workbook else ''}. "
                             f"The run scored {score_text}.")]
    if summary["blockers"]:
        total = summary["blocker_total"]
        blocks.append(mail.paragraph(
            "The three biggest blockers are below." if total >= 3 else
            "The blocker holding the run back is below." if total == 1 else
            "The blockers holding the run back are below."))
        blocks.append(mail.table(["Rule", "Object", "Records failing"],
                                 [(b["check_id"], b["module"], f"{b['affected']:,}") for b in summary["blockers"]],
                                 numeric_last=True))
    else:
        blocks.append(mail.paragraph("No blockers were found in this run."))
    blocks.append(mail.button("Open reports", f"{base_url}{REPORTS_LINK}"))
    return subject, mail.render_email(title="Board pack", blocks=blocks, tenant=tenant_name,
                                      preheader=f"{run} scored {score_text}")


def latest_run_id(session: Session, tenant_id: str) -> Optional[str]:
    row = session.execute(text(
        "SELECT id FROM analysis_versions WHERE tenant_id = :tid AND status IN ('complete', 'agents_complete') "
        "ORDER BY run_at DESC LIMIT 1"), {"tid": tenant_id}).first()
    return str(row[0]) if row else None


def build_pack(session: Session, tenant_id: str, version_id: str) -> Optional[dict]:
    """Render the board PDF (and, best effort, the workbook) for one run, the way the report
    routes do. None when the run is not found. ``attachments`` are (filename, bytes, mime)."""
    from api.services import pdf_reports as pr

    tenant_name = session.execute(text("SELECT name FROM tenants WHERE id = :t"), {"t": tenant_id}).scalar() or ""
    data = pr.load_board(session, tenant_id, version_id, None)
    if not data:
        return None
    ctx = pr.board_context(data, tenant_name=tenant_name, scoring=pr.load_scoring(session, tenant_id),
                           ai_summary=data["ai_summary"], app_version=pr._app_version())
    attachments = [(f"meridian_board_{version_id}.pdf", pr.render("board_report.html", ctx), PDF_MIME)]
    try:
        from api.services.workbook_report import build as build_workbook

        book = build_workbook(session, tenant_id, version_id)
        if book:
            attachments.append((book[1], book[0], XLSX_MIME))
    except Exception as e:  # the board pack still goes out
        logger.warning(f"analyst workbook not built for tenant {tenant_id}: {type(e).__name__}")
    return {"summary": pack_summary(ctx), "tenant_name": tenant_name, "attachments": attachments}


def _email_channels(session: Session, cadence: str) -> list[dict]:
    rows = session.execute(text(
        "SELECT id, target, report_pack_key FROM alert_channels "
        "WHERE enabled AND kind = 'email' AND report_pack = :c ORDER BY created_at"), {"c": cadence}).mappings().all()
    return [dict(r) for r in rows]


def _claim(session: Session, channel_id: str, key: str, previous: Optional[str]) -> bool:
    """Take ``key`` for the channel with a compare-and-swap on the key read earlier: False when
    another worker changed it meanwhile, so two workers cannot both send."""
    res = session.execute(text(
        "UPDATE alert_channels SET report_pack_key = :k "
        "WHERE id = :id AND report_pack_key IS NOT DISTINCT FROM CAST(:prev AS text) RETURNING id"),
        {"k": key, "id": channel_id, "prev": previous})
    return res.first() is not None


def _release(session: Session, channel_id: str, key: str, previous: Optional[str]) -> None:
    """Give the key back after a failed send, so the next firing retries."""
    session.execute(text("UPDATE alert_channels SET report_pack_key = CAST(:prev AS text) "
                         "WHERE id = :id AND report_pack_key = :k"), {"prev": previous, "id": channel_id, "k": key})


def send_for_tenant(session: Session, tenant_id: str, cadence: str, *, base_url: str,
                    when: Optional[datetime] = None,
                    build: Callable[..., Optional[dict]] = build_pack,
                    deliver: Optional[Callable[..., bool]] = None) -> int:
    """One tenant: returns the number of packs emailed. ``session`` has the tenant set."""
    from api.services.notifications import create_notification_sync

    if deliver is None:
        from workers.tasks.send_notifications import _deliver_email as deliver
    channels = _email_channels(session, cadence)
    if not channels:
        return 0
    run_id = latest_run_id(session, tenant_id)
    if not run_id:
        return 0
    key = f"{period_key(cadence, when)}:{run_id}"
    due = [c for c in channels if c["report_pack_key"] != key]
    if not due:  # every channel already has this run's pack for this period
        return 0
    pack = build(session, tenant_id, run_id)
    if not pack:
        return 0
    summary = pack["summary"]
    subject, body = compose_email(summary, pack["tenant_name"], base_url,
                                  with_workbook=len(pack["attachments"]) > 1)
    sent = 0
    for ch in due:
        previous = ch["report_pack_key"]
        claimed = _claim(session, str(ch["id"]), key, previous)
        session.commit()
        if not claimed:  # another worker got there first
            continue
        try:
            ok = bool(deliver(ch["target"], subject, body, pack["attachments"]))
        except Exception as e:  # a raise inside a backend; never log the address
            logger.error(f"report pack email for channel {ch['id']} raised: {type(e).__name__}")
            ok = False
        if not ok:
            _release(session, str(ch["id"]), key, previous)  # the next firing retries
            session.commit()
            continue
        score = summary["score"]
        create_notification_sync(
            tenant_id, None, "report", f"Board pack sent: {summary['run'] or 'latest run'}",
            f"The {cadence} board pack for {summary['run'] or 'the latest run'} "
            f"({'score ' + format(score, '.1f') if score is not None else 'no score'}) "
            f"was emailed to {_mask(ch['target'])}.", REPORTS_LINK, session)
        session.commit()
        sent += 1
    return sent


@celery_app.task(name="workers.tasks.send_report_pack.send_report_pack",
                 soft_time_limit=1800, time_limit=1860)
def send_report_pack(cadence: str) -> dict:
    """Weekly (Monday mornings SAST) or monthly (the 1st): the board pack to the email channels
    set to that cadence. Silent for tenants with no matching channel or no finished run."""
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    if cadence not in CADENCES:
        raise ValueError(f"unknown report pack cadence: {cadence}")
    base_url = _resolve_app_base_url()
    engine = get_sync_engine()
    with Session(engine) as session:
        tenants = [str(r[0]) for r in session.execute(text("SELECT id FROM tenants")).fetchall()]
    sent = 0
    for tid in tenants:
        try:
            with tenant_session(engine, tid) as session:
                sent += send_for_tenant(session, tid, cadence, base_url=base_url)
        except Exception as e:
            logger.error(f"report pack failed for tenant {tid}: {type(e).__name__}")
    return {"cadence": cadence, "sent": sent}
