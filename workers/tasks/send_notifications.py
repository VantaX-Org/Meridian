"""Celery task: send email and Teams notifications after analysis completes.

Supports triggers: critical_found, dqs_drop, thresholds, scheduled_daily, scheduled_weekly, scheduled_monthly.
``thresholds`` runs after the deterministic checks: every breach of the tenant's
alert thresholds becomes an in-app notification.
Per-user delivery (users.preferences.notifications) rides on the same two entry
points: ``_send_immediate_critical`` and ``send_alert_digest`` — see the section
"Per-user delivery" below.
Never raises — notification failures must not affect analysis results.
"""

import hashlib
import hmac
import html

from workers import email_templates as mail
import json
import logging
import os
import time
import traceback
import uuid
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine
from workers.email_backends.microsoft_graph import create_graph_client

logger = logging.getLogger("meridian.worker.notifications")

RESEND_API_URL = "https://api.resend.com/emails"


def _load_tenant_config(session: Session, tenant_id: str) -> dict:
    """Load tenant notification config, alert thresholds, and name."""
    result = session.execute(
        text("SELECT name, dqs_weights, alert_thresholds FROM tenants WHERE id = :tid"),
        {"tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        return {}

    dqs_weights = row[1] or {}
    notification_config = dqs_weights.get("notification_config", {})

    return {
        "tenant_name": row[0],
        "email": notification_config.get("email", ""),
        "teams_webhook": notification_config.get("teams_webhook", ""),
        "daily_digest": notification_config.get("daily_digest", False),
        "weekly_summary": notification_config.get("weekly_summary", False),
        "monthly_report": notification_config.get("monthly_report", False),
        "critical_threshold": (row[2] or {}).get("critical_threshold", 1),
        "high_threshold": (row[2] or {}).get("high_threshold", 10),
        "dqs_drop_threshold": (row[2] or {}).get("dqs_drop_threshold", 5),
        "module_floors": (row[2] or {}).get("module_floors") or {},
    }


def _load_version_data(session: Session, version_id: str, tenant_id: str) -> dict:
    """Load DQS summary, findings summary, and report JSON for a version."""
    result = session.execute(
        text("""
            SELECT av.dqs_summary, av.metadata, r.report_json, av.run_at
            FROM analysis_versions av
            LEFT JOIN reports r ON r.version_id = av.id AND r.tenant_id = av.tenant_id
            WHERE av.id = :vid AND av.tenant_id = :tid
        """),
        {"vid": version_id, "tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        return {}

    # Load top critical findings
    findings_result = session.execute(
        text("""
            SELECT check_id, module, severity, affected_count, pass_rate, details, remediation_text
            FROM findings
            WHERE version_id = :vid AND tenant_id = :tid AND severity = 'critical' AND affected_count > 0
            ORDER BY affected_count DESC
            LIMIT 5
        """),
        {"vid": version_id, "tid": tenant_id},
    )
    critical_findings = [
        {
            "check_id": f[0],
            "module": f[1],
            "severity": f[2],
            "affected_count": f[3],
            "pass_rate": float(f[4]) if f[4] else None,
            "message": (f[5] or {}).get("message", ""),
            "remediation": f[6] or "",
        }
        for f in findings_result.fetchall()
    ]

    # failing checks per severity (findings also holds the checks that passed)
    counts = dict(session.execute(
        text("""
            SELECT severity, COUNT(*) FROM findings
            WHERE version_id = :vid AND tenant_id = :tid AND affected_count > 0
            GROUP BY severity
        """),
        {"vid": version_id, "tid": tenant_id},
    ).fetchall())

    dqs_summary = row[0] or {}
    report_json = row[2] or {}

    # Compute overall DQS
    overall_dqs = _overall(dqs_summary)

    return {
        "dqs_summary": dqs_summary,
        "overall_dqs": overall_dqs,
        "report_json": report_json,
        "critical_findings": critical_findings,
        "critical_count": counts.get("critical", 0),
        "high_count": counts.get("high", 0),
        "scope": (row[1] or {}).get("system_id") or "upload",
        "run_at": row[3],
    }


def _previous_dqs(session: Session, version_id: str, tenant_id: str, version_data: dict) -> dict:
    """dqs_summary of the analysed version before this one from the same source
    (system, or file upload) — a drop is only meaningful against the same data."""
    row = session.execute(
        text("""
            SELECT dqs_summary FROM analysis_versions
            WHERE tenant_id = :tid AND id <> :vid AND dqs_summary IS NOT NULL
              AND COALESCE(metadata->>'system_id', 'upload') = :scope
              AND status NOT IN ('pending', 'running', 'failed')
              AND run_at < :run_at
            ORDER BY run_at DESC LIMIT 1
        """),
        {"tid": tenant_id, "vid": version_id, "scope": version_data.get("scope", "upload"),
         "run_at": version_data.get("run_at")},
    ).fetchone()
    return (row[0] if row and isinstance(row[0], dict) else {}) or {}


def threshold_breaches(config: dict, dqs: dict, prev_dqs: dict, counts: dict) -> list[dict]:
    """Every alert threshold this analysis crosses. Pure — the caller loads the data."""
    out: list[dict] = []
    crit, high = counts.get("critical", 0), counts.get("high", 0)
    if crit and crit >= config.get("critical_threshold", 1):
        out.append({"kind": "critical",
                    "message": f"{crit} critical checks failing (threshold {config.get('critical_threshold', 1)})"})
    if high and high >= config.get("high_threshold", 10):
        out.append({"kind": "high",
                    "message": f"{high} high checks failing (threshold {config.get('high_threshold', 10)})"})
    drop_limit = config.get("dqs_drop_threshold", 5)
    floors = config.get("module_floors") or {}
    for module, cur in sorted((dqs or {}).items()):
        score = (cur or {}).get("composite_score")
        if score is None:
            continue
        before = ((prev_dqs or {}).get(module) or {}).get("composite_score")
        if before is not None and before - score > drop_limit:
            out.append({"kind": "dqs_drop", "module": module,
                        "message": f"{module}: DQS fell {before - score:.1f} points to {score:.1f} (threshold {drop_limit:g})"})
        floor = floors.get(module)
        if floor is not None and score < floor:
            out.append({"kind": "floor", "module": module,
                        "message": f"{module}: DQS {score:.1f} is below its floor of {floor:g}"})
    return out


def _check_trigger(trigger: str, config: dict, version_data: dict, session: Session, version_id: str, tenant_id: str) -> bool:
    """Check if the trigger condition is met."""
    if trigger == "critical_found":
        return version_data.get("critical_count", 0) >= config.get("critical_threshold", 1)

    if trigger == "dqs_drop":
        prev = _previous_dqs(session, version_id, tenant_id, version_data)
        return any(b["kind"] == "dqs_drop" for b in
                   threshold_breaches(config, version_data.get("dqs_summary", {}), prev, {}))

    if trigger == "thresholds":
        prev = _previous_dqs(session, version_id, tenant_id, version_data)
        version_data["breaches"] = threshold_breaches(
            config, version_data.get("dqs_summary", {}), prev,
            {"critical": version_data.get("critical_count", 0), "high": version_data.get("high_count", 0)})
        return bool(version_data["breaches"])

    if trigger.startswith("scheduled_"):
        schedule_key = {
            "scheduled_daily": "daily_digest",
            "scheduled_weekly": "weekly_summary",
            "scheduled_monthly": "monthly_report",
        }.get(trigger, "")
        return config.get(schedule_key, False)

    return False


def _build_email_content(config: dict, version_data: dict, trigger: str) -> tuple[str, str]:
    """Build subject and HTML body for notification email."""
    tenant_name = config.get("tenant_name", "Meridian")
    critical_count = version_data.get("critical_count", 0)
    overall_dqs = version_data.get("overall_dqs")
    overall_dqs = "Not measured" if overall_dqs is None else overall_dqs

    if trigger == "critical_found":
        subject = f"Meridian DQ Alert — {critical_count} Critical findings"
    elif trigger == "thresholds":
        subject = f"Meridian DQ Alert — {len(version_data.get('breaches', []))} alert thresholds crossed"
    elif trigger.startswith("scheduled_"):
        from datetime import date
        subject = f"Meridian {trigger.replace('scheduled_', '').title()} DQ Summary — {date.today()}"
    else:
        subject = "Meridian Data Quality Alert"

    findings = version_data.get("critical_findings", [])[:5]
    report_json = version_data.get("report_json", {})
    executive_summary = report_json.get("executive_summary", "No summary available.")
    blocks: list[str] = []
    if version_data.get("breaches"):
        blocks.append(mail.note("<br>".join(html.escape(b["message"]) for b in version_data["breaches"]), raw=True))
    else:
        blocks.append(mail.paragraph(executive_summary, muted=True))
    blocks.append(mail.stats([
        mail.stat("Data quality score", overall_dqs),
        mail.stat("Critical findings", critical_count, tone="critical" if critical_count else "pass"),
    ]))
    if findings:
        blocks.append(mail.section("Fix first"))
        blocks.append(mail.table(
            ["Rule", "Object", "What fails", "Records"],
            [(f["check_id"], str(f["module"]).replace("_", " ").capitalize(), f["message"][:100], f"{f['affected_count']:,}")
             for f in findings],
            numeric_last=True,
        ))
    from workers.tasks.send_user_invitation import _resolve_app_base_url
    blocks.append(mail.button("Open in Meridian", f"{_resolve_app_base_url()}/insights/exec"))
    title = subject.split(" — ", 1)[-1] if " — " in subject else subject
    body = mail.render_email(
        title=title.replace("Critical findings", "critical findings"),
        tenant=tenant_name,
        preheader=f"{critical_count} critical findings, DQS {overall_dqs}",
        blocks=blocks,
    )
    return subject, body


Attachment = tuple[str, bytes, str]  # (filename, content, mime type)


def _send_email_smtp(recipient: str, subject: str, body: str,
                     attachments: list[Attachment] | None = None) -> bool:
    """Send email via local SMTP relay (air-gapped deployments). True only on a confirmed send.
    ``attachments`` are (filename, bytes, mime type) triples, attached as base64 parts."""
    import smtplib
    from email import encoders
    from email.mime.base import MIMEBase
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    msg = MIMEMultipart()
    msg["From"] = os.getenv("SMTP_FROM", "noreply@meridian.local")
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "html"))
    for filename, content, mime in attachments or []:
        maintype, _, subtype = mime.partition("/")
        part = MIMEBase(maintype or "application", subtype or "octet-stream")
        part.set_payload(content)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(part)

    try:
        with smtplib.SMTP(os.getenv("SMTP_HOST"), int(os.getenv("SMTP_PORT", "587"))) as smtp:
            smtp.starttls()
            if os.getenv("SMTP_USER"):
                smtp.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD", ""))
            smtp.sendmail(msg["From"], recipient, msg.as_string())
        logger.info(f"Email sent via SMTP to {recipient}")
        return True
    except Exception as e:
        logger.error(f"SMTP send failed: {e}")
        return False


def _send_email_resend(recipient: str, subject: str, body: str,
                       attachments: list[Attachment] | None = None) -> bool:
    """Send email via Resend API (standard mode). True only on a confirmed send.
    ``attachments`` go in Resend's ``attachments`` field with base64 ``content``."""
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key:
        logger.info("Skipping email — no RESEND_API_KEY configured")
        return False

    payload: dict = {
        "from": "Meridian DQ Agent <notifications@meridian.vantax.co.za>",
        "to": [recipient],
        "subject": subject,
        "html": body,
    }
    if attachments:
        import base64
        payload["attachments"] = [{"filename": name, "content": base64.b64encode(content).decode("ascii")}
                                  for name, content, _mime in attachments]
    try:
        resp = requests.post(
            RESEND_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60 if attachments else 10,
        )
        logger.info(f"Email sent via Resend: status={resp.status_code}")
        return resp.ok
    except Exception as e:
        logger.error(f"Resend email send failed: {e}")
        return False


def _send_email(config: dict, version_data: dict, trigger: str) -> bool:
    """Send notification email via Microsoft Graph, SMTP relay, or Resend API."""
    recipient = config.get("email")
    if not recipient:
        logger.info("Skipping email — no email configured")
        return False

    subject, body = _build_email_content(config, version_data, trigger)
    return _deliver_email(recipient, subject, body)


def _deliver_email(recipient: str, subject: str, body: str,
                   attachments: list[Attachment] | None = None) -> bool:
    """Microsoft Graph, else the SMTP relay (SMTP_HOST), else Resend. False when no backend is
    configured or every attempt fails — the single source of truth every caller relies on.
    A message with attachments skips Graph (its sender here has no attachment support) so the
    files are never dropped silently."""
    # Try Microsoft Graph first
    graph_client = None if attachments else create_graph_client()
    if graph_client:
        if graph_client.send_email(recipient, subject, body, sender_name="Meridian Data Quality"):
            return True
        logger.warning("Microsoft Graph email send failed, falling back to SMTP/Resend")

    # Fall back to SMTP or Resend
    if os.getenv("SMTP_HOST"):
        return _send_email_smtp(recipient, subject, body, attachments)
    return _send_email_resend(recipient, subject, body, attachments)


def _send_teams_card(config: dict, version_data: dict):
    """Send Teams Adaptive Card notification."""
    webhook = config.get("teams_webhook", "")
    if not webhook:
        return

    report_json = version_data.get("report_json", {})
    readiness = report_json.get("migration_readiness", {})

    card = {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": [
                        {
                            "type": "TextBlock",
                            "size": "Large",
                            "weight": "Bolder",
                            "text": f"Meridian DQ Alert — {version_data.get('critical_count', 0)} Critical findings",
                        },
                        {
                            "type": "TextBlock",
                            "wrap": True,
                            "text": "\n\n".join(b["message"] for b in version_data["breaches"])
                            if version_data.get("breaches") else report_json.get("executive_summary", "Analysis complete."),
                        },
                        {
                            "type": "FactSet",
                            "facts": [
                                {"title": "Overall DQS", "value": str(version_data.get("overall_dqs") if version_data.get("overall_dqs") is not None
                                                              else "Not measured")},
                                {"title": "Critical findings", "value": str(version_data.get("critical_count", 0))},
                                {"title": "Readiness status", "value": readiness.get("overall_status", "unknown")},
                            ],
                        },
                    ],
                },
            }
        ],
    }

    try:
        resp = requests.post(webhook, json=card, timeout=10)
        logger.info(f"Teams card sent: status={resp.status_code}")
    except Exception as e:
        logger.error(f"Teams card send failed: {e}")


def _notify_in_app(session: Session, tenant_id: str, version_id: str, breaches: list[dict]) -> None:
    """One tenant-wide notification per analysis listing every breach."""
    from api.services.notifications import create_notification_sync
    modules = sorted({b["module"] for b in breaches if b.get("module")})
    title = (f"DQ alert — {len(breaches)} thresholds crossed" if len(breaches) > 1
             else f"DQ alert — {breaches[0]['message']}")
    link = f"/findings?version_id={version_id}" + (f"&module={modules[0]}" if len(modules) == 1 else "")
    create_notification_sync(tenant_id, None, "dq_alert", title[:200],
                             "\n".join(b["message"] for b in breaches), link, session)
    session.commit()


@celery_app.task(bind=True, name="workers.tasks.send_notifications.send_notification",
                 soft_time_limit=60, time_limit=90)
def send_notification(self, version_id: str, tenant_id: str, trigger: str):
    """Send notification for a completed analysis version.

    trigger: critical_found | dqs_drop | thresholds | scheduled_daily | scheduled_weekly | scheduled_monthly
    """
    logger.info(f"send_notification: version={version_id}, tenant={tenant_id}, trigger={trigger}")

    try:
        engine = get_sync_engine()
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

            config = _load_tenant_config(session, tenant_id)
            if not config:
                logger.warning(f"Tenant {tenant_id} not found, skipping notification")
                return

            if trigger == "critical_found":  # alert channels: new critical findings go out immediately
                _send_immediate_critical(session, tenant_id, version_id)

            version_data = _load_version_data(session, version_id, tenant_id)
            if not version_data:
                logger.warning(f"Version {version_id} not found, skipping notification")
                return

            if not _check_trigger(trigger, config, version_data, session, version_id, tenant_id):
                logger.info(f"Trigger condition not met for {trigger}, skipping")
                return

            if trigger == "thresholds":
                _notify_in_app(session, tenant_id, version_id, version_data["breaches"])
                # critical-only runs are already emailed by run_agents' critical_found
                if all(b["kind"] == "critical" for b in version_data["breaches"]):
                    return

            _send_email(config, version_data, trigger)
            _send_teams_card(config, version_data)

            logger.info(f"Notifications sent for version={version_id}, trigger={trigger}")

    except Exception:
        logger.error(f"send_notification failed: {traceback.format_exc()}")
        # Never raise — notification failures must not affect analysis


# ── Alert channels (alert_channels, migration 057) ───────────────────────────
# Payloads carry counts, rule ids and links only — never finding messages,
# record keys or values. Digest (daily/weekly) is the default; a channel may
# opt into immediate delivery of new critical findings only.

DIGEST_WINDOW = {"daily": timedelta(days=1), "weekly": timedelta(days=7)}
MAX_RULE_IDS = 50


def sign(secret: str, timestamp: str, body: bytes) -> str:
    """X-Meridian-Signature: HMAC-SHA256 over "<timestamp>.<body>" (receivers reject stale timestamps)."""
    return "sha256=" + hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def build_alert(mode: str, version_id: str | None, score: float | None, previous_score: float | None,
                new_critical: set[str], sla_breaches: int, drop_threshold: float, base_url: str,
                regressed_records: int = 0) -> dict | None:
    """The alert payload, or None when no trigger fires. ``regressed_records``: records failing
    again since the system's pinned post-cleanup baseline (api/services/monitor.py)."""
    drop = round(previous_score - score, 1) if score is not None and previous_score is not None else None
    triggers = [t for t, hit in (("score_drop", drop is not None and drop > drop_threshold),
                                 ("new_critical", bool(new_critical)), ("sla_breach", sla_breaches > 0),
                                 ("baseline_regression", regressed_records > 0)) if hit]
    if not triggers:
        return None
    return {
        "event": "meridian.dq_alert", "mode": mode, "triggers": triggers,
        "version_id": version_id, "score": score, "previous_score": previous_score, "score_drop": drop,
        "new_critical_count": len(new_critical), "new_critical_rules": sorted(new_critical)[:MAX_RULE_IDS],
        "sla_breaches": sla_breaches, "regressed_records": regressed_records,
        "links": {"findings": f"{base_url}/findings", "exceptions": f"{base_url}/exceptions",
                  "versions": f"{base_url}/versions", "batches": f"{base_url}/workbench?tab=batches"},
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }


def alert_text(alert: dict) -> str:
    parts = []
    if "score_drop" in alert["triggers"]:
        parts.append(f"DQS fell {alert['score_drop']} points to {alert['score']}")
    if alert["new_critical_count"]:
        parts.append(f"{alert['new_critical_count']} new critical rule(s) failing: "
                     + ", ".join(alert["new_critical_rules"][:10]))
    if alert["sla_breaches"]:
        parts.append(f"{alert['sla_breaches']} exception SLA breach(es)")
    if alert.get("regressed_records"):
        parts.append(f"{alert['regressed_records']} record(s) failing again since the post-cleanup baseline "
                     f"({alert['links']['batches']})")
    where = f" for {alert['system_name']}" if alert.get("system_name") else ""
    return f"Meridian {alert['mode']} alert{where} — " + "; ".join(parts) + f". {alert['links']['findings']}"


def render(kind: str, alert: dict) -> dict:
    if kind == "slack":
        return {"text": alert_text(alert)}
    if kind == "teams":
        return {"type": "message", "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard",
                "version": "1.4",
                "body": [{"type": "TextBlock", "wrap": True, "text": alert_text(alert)}],
                "actions": [{"type": "Action.OpenUrl", "title": "Open findings", "url": alert["links"]["findings"]}],
            }}]}
    return alert


def deliver(channel: dict, alert: dict) -> bool:
    """Send one alert. Never logs the target (webhook URLs embed tokens) or the secret."""
    kind = channel["kind"]
    if kind == "email":
        return _deliver_email(channel["target"], f"Meridian DQ {alert['mode']} alert",
                              mail.render_email(title=f"{alert['mode'].capitalize()} alert",
                                                blocks=[mail.paragraph(alert_text(alert)),
                                                        mail.button("Open findings", alert["links"]["findings"])]))
    body = json.dumps(render(kind, alert), sort_keys=True, default=str).encode()
    headers = {"Content-Type": "application/json", "X-Meridian-Event": alert["event"]}
    if channel.get("secret"):
        ts = str(int(time.time()))
        headers |= {"X-Meridian-Timestamp": ts, "X-Meridian-Signature": sign(channel["secret"], ts, body)}
    try:
        resp = requests.post(channel["target"], data=body, headers=headers, timeout=10)
        logger.info(f"alert channel {channel.get('id')} ({kind}): HTTP {resp.status_code}")
        return resp.ok
    except requests.RequestException as e:
        logger.error(f"alert channel {channel.get('id')} ({kind}) failed: {type(e).__name__}")
        return False


def _deliver_safe(channel: dict, alert: dict) -> bool:
    """`deliver`, but a raise (e.g. an expired Graph token) is caught so one bad channel never
    stops the rest of a tenant's digest or immediate alert. Logs only the exception type and the
    channel id — never the target URL/address."""
    try:
        return deliver(channel, alert)
    except Exception as e:
        logger.error(f"alert channel {channel.get('id')} ({channel.get('kind')}) raised: {type(e).__name__}")
        return False


def _channels(session: Session, where: str, params: dict | None = None) -> list[dict]:
    try:
        rows = session.execute(text(f"SELECT id, kind, target, secret FROM alert_channels WHERE enabled AND {where}"),
                               params or {}).mappings().all()
    except Exception:  # table absent before migration 057
        session.rollback()
        return []
    return [dict(r) for r in rows]


def _overall(dqs_summary) -> float | None:
    scores = ([m.get("composite_score") for m in dqs_summary.values() if m.get("composite_score") is not None]
              if isinstance(dqs_summary, dict) else [])
    return round(sum(scores) / len(scores), 1) if scores else None


def _critical_rules(session: Session, version_id) -> set[str]:
    """Critical rules failing in a version, suppressed ones excluded."""
    return {r[0] for r in session.execute(text("""
        SELECT DISTINCT check_id FROM findings
         WHERE version_id = :v AND severity = 'critical' AND affected_count > 0
           AND details->>'error' IS NULL AND NOT COALESCE((details->>'suppressed')::boolean, false)
    """), {"v": str(version_id)}).fetchall()}


_SCOPE = "COALESCE(metadata->>'system_id', 'upload')"


def _completed(session: Session, scope: str, before: datetime | None = None, skip: str | None = None):
    """Latest completed analysis version (id, run_at, dqs_summary) of one source — a system id,
    or 'upload' — optionally before a time / not `skip`. Runs of other systems never compare."""
    return session.execute(text(f"""
        SELECT id, run_at, dqs_summary FROM analysis_versions
         WHERE status IN ('complete', 'agents_complete') AND {_SCOPE} = :scope
           AND (CAST(:before AS timestamptz) IS NULL OR run_at < :before)
           AND (CAST(:skip AS uuid) IS NULL OR id <> CAST(:skip AS uuid))
         ORDER BY run_at DESC LIMIT 1
    """), {"scope": scope, "before": before, "skip": skip}).fetchone()


def _system_name(session: Session, scope: str) -> str:
    if scope == "upload":
        return "File uploads"
    try:
        uuid.UUID(scope)
    except ValueError:
        return scope  # malformed metadata.system_id — never cast, never raise
    row = session.execute(text("SELECT name FROM sap_systems WHERE id = CAST(:s AS uuid)"), {"s": scope}).fetchone()
    return row[0] if row else scope


def _drop_threshold(session: Session, tenant_id: str) -> float:
    row = session.execute(text("SELECT alert_thresholds FROM tenants WHERE id = :t"), {"t": tenant_id}).fetchone()
    return float(((row[0] if row else None) or {}).get("dqs_drop_threshold", 5))


def _send_immediate_critical(session: Session, tenant_id: str, version_id: str) -> None:
    """Tenant alert channels opted into immediate delivery, then every user who asked to be
    told at once (users.preferences.notifications.immediate_critical)."""
    channels = _channels(session, "immediate_critical")
    recipients = _recipients_safe(session, tenant_id, "critical")
    if not channels and not recipients:
        return
    from workers.tasks.send_user_invitation import _resolve_app_base_url
    run = session.execute(text(f"SELECT run_at, {_SCOPE} FROM analysis_versions WHERE id = :v"),
                          {"v": str(version_id)}).fetchone()
    if not run:
        return
    prev = _completed(session, run[1], before=run[0], skip=version_id)
    new = _critical_rules(session, version_id) - (_critical_rules(session, prev[0]) if prev else set())
    alert = build_alert("immediate", version_id, None, None, new, 0, 0, _resolve_app_base_url())
    if alert:
        alert["system_name"] = _system_name(session, run[1])
    for ch in channels if alert else []:
        _deliver_safe(ch, alert)
    if alert and recipients:
        _notify_users_critical(session, tenant_id, alert, recipients)


# ── Per-user delivery (users.preferences.notifications, migration 083) ───────
# Each opted-in user gets an addressed in-app notification; email only when they asked
# for it (channels.email) and a backend is configured. Every attempt is recorded in
# notification_deliveries; a run with no email backend writes one no_backend row per
# tenant instead of one per user.
#
# Delivery is idempotent: before anything goes out the sender claims the delivery key
# (the version id for a critical alert, the period for a digest) per user and channel
# with INSERT ... ON CONFLICT DO NOTHING; a recipient whose key is already claimed is
# skipped entirely, so a task run twice sends once. A failed external send keeps its
# key with status "failed" and is not retried automatically; the test-send button on
# Me > Preferences is the manual path.

USER_DIGEST_TITLE = {"daily": "Your daily data quality digest", "weekly": "Your weekly data quality digest"}


def _commit(session: Session, tenant_id: str) -> None:
    """Commit, then set the tenant again. The SET at the top of the task lives on one pooled
    connection; after a commit the session can check out another one (workers.db.tenant_session
    carries the same note), and the next statement would then run without a tenant, so RLS
    would hide the tenant's own channels and runs."""
    session.commit()
    session.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant_id)})


def _recipients_safe(session: Session, tenant_id: str, kind: str) -> list:
    """resolve_recipients, but a missing column or table (deployment behind migration 081/083)
    reads as "nobody opted in" so the tenant channels still go out."""
    from api.services.user_notifications import resolve_recipients
    try:
        return resolve_recipients(session, tenant_id, kind)
    except Exception as e:
        logger.warning(f"per-user recipients unavailable for tenant {tenant_id}: {type(e).__name__}")
        session.rollback()
        return []


def _email_user(session: Session, row_id: str, user_id: str, email: str, kind: str,
                subject: str, body: str) -> bool:
    """One email to one user on an already claimed delivery row, finished as sent or failed.
    Never logs the address."""
    from api.services.user_notifications import finish_delivery
    try:
        ok = bool(_deliver_email(email, subject, body))
        error = None
    except Exception as e:  # a raise inside a backend (e.g. an expired Graph token)
        ok, error = False, type(e).__name__
        logger.error(f"per-user email ({kind}) to user {user_id} raised: {error}")
    finish_delivery(session, row_id, "sent" if ok else "failed", error)
    return ok


def _record_no_backend(session: Session, tenant_id: str, kind: str) -> None:
    from api.services.user_notifications import record_delivery
    record_delivery(session, tenant_id, None, "email", kind, "no_backend", "no email backend configured")


def _deliver_to_user(session: Session, tenant_id: str, r, kind: str, key: str, title: str, body: str,
                     link: str, notification_type: str, subject: str, html_body: str, backend,
                     no_backend_written: bool) -> tuple[bool, bool, bool]:
    """Claim ``key`` for one recipient, write the addressed in-app notification in the same
    transaction, then send the email on its own claimed row. Returns (delivered, emailed,
    no_backend_written); delivered is False when the key was already claimed."""
    from api.services.notifications import create_notification_sync
    from api.services.user_notifications import claim_delivery, finish_delivery

    in_app_row = claim_delivery(session, tenant_id, r.user_id, "in_app", kind, key)
    if in_app_row is None:  # already delivered (or failed) for this key: send nothing
        return False, False, no_backend_written
    create_notification_sync(tenant_id, r.user_id, notification_type, title[:200], body, link, session)
    finish_delivery(session, in_app_row, "sent")
    email_row = None
    if r.wants_email:
        if backend is None:
            if not no_backend_written:
                _record_no_backend(session, tenant_id, kind)
                no_backend_written = True
        else:
            email_row = claim_delivery(session, tenant_id, r.user_id, "email", kind, key)
    _commit(session, tenant_id)  # the claims and the notification land before the external send
    emailed = False
    if email_row is not None:
        emailed = _email_user(session, email_row, r.user_id, r.email, kind, subject, html_body)
        _commit(session, tenant_id)
    return True, emailed, no_backend_written


def _notify_users_critical(session: Session, tenant_id: str, alert: dict, recipients: list) -> int:
    """Addressed in-app notification per opted-in user, plus the email for those who asked for
    it; keyed on the version id so the same alert never goes out twice. Returns the number of
    emails sent."""
    from api.services.user_notifications import email_backend_name

    backend = email_backend_name()
    count = alert["new_critical_count"]
    where = alert.get("system_name") or "your SAP data"
    title = f"{where}: {count} new critical rule(s) failing"
    body = alert_text(alert)
    link = f"/findings?version_id={alert['version_id']}" if alert.get("version_id") else "/findings"
    subject = f"Meridian critical alert — {where}"
    html_body = mail.render_email(title="Critical findings", blocks=[
        mail.paragraph(body), mail.button("Open findings", alert["links"]["findings"])])
    key = str(alert["version_id"])

    emailed = 0
    no_backend_written = False
    for r in recipients:
        _, sent, no_backend_written = _deliver_to_user(
            session, tenant_id, r, "critical", key, title, body, link, "dq_alert", subject, html_body,
            backend, no_backend_written)
        emailed += sent
    return emailed


_OPEN_SQL = "status NOT IN ('resolved', 'accepted')"


def _user_open_items(session: Session, tenant_id: str, user_id: str) -> dict[str, int]:
    """Open triage items assigned to one user: record issues by severity plus stewardship items."""
    issues = session.execute(text(f"""
        SELECT severity, COUNT(*) FROM record_issues
         WHERE tenant_id = CAST(:tid AS uuid) AND assigned_to = CAST(:uid AS uuid) AND {_OPEN_SQL}
         GROUP BY severity
    """), {"tid": str(tenant_id), "uid": user_id}).fetchall()
    queue = session.execute(text(f"""
        SELECT COUNT(*) FROM stewardship_queue
         WHERE tenant_id = CAST(:tid AS uuid) AND assigned_to = CAST(:uid AS uuid) AND {_OPEN_SQL}
    """), {"tid": str(tenant_id), "uid": user_id}).scalar() or 0
    out = {str(sev): int(n) for sev, n in issues if n}
    if queue:
        out["stewardship"] = int(queue)
    return out


def _owner_cards(session: Session, tenant_id: str) -> dict:
    """Owner scorecards by display name (api/services/insights_owners.py), once per tenant;
    only owners with something open."""
    from api.services.insights_owners import OWNER_ISSUE_SQL, baseline_cutoff, build_owner_card, load_owner_aggregates
    rows = session.execute(text(OWNER_ISSUE_SQL), {"tid": str(tenant_id), "cutoff": baseline_cutoff()}).fetchall()
    aggregates = load_owner_aggregates([dict(r._mapping) for r in rows])
    return {name: build_owner_card(name, agg["score"], agg["delta"], agg["open_by_severity"],
                                   agg["fixed_since_baseline"], agg["oldest_item_age_days"])
            for name, agg in aggregates.items() if agg["open_by_severity"]}


def personal_digest(name: str, items: dict[str, int], card) -> tuple[str, str]:
    """Title and body of one user's digest. Pure: ``items`` is {severity|stewardship: count} of the
    triage items assigned to the user, ``card`` the owner scorecard matched on the display name (or None)."""
    total = sum(items.values())
    parts = [f"{n} {sev}" for sev, n in items.items() if sev != "stewardship"]
    if items.get("stewardship"):
        parts.append(f"{items['stewardship']} stewardship")
    lines = [f"You have {total} open item(s) assigned to you" + (f": {', '.join(parts)}." if parts else ".")]
    if card is not None:
        lines.append(card.digest)
    return f"{total} open item(s)", "\n".join(lines)


def _send_user_digests(session: Session, tenant_id: str, period: str, recipients: list, base_url: str) -> int:
    """One personal digest per opted-in user with open items; users with nothing open get no
    notification and no email. Keyed on the period (daily:<date>, weekly:<year>-W<week>) so a
    beat task fired twice delivers once. Returns the number of emails sent."""
    from api.services.user_notifications import digest_key, email_backend_name

    backend = email_backend_name()
    cards = _owner_cards(session, tenant_id)
    heading = USER_DIGEST_TITLE.get(period, "Your data quality digest")
    key = digest_key(period)
    no_backend_written = False
    emailed = 0
    for r in recipients:
        items = _user_open_items(session, tenant_id, r.user_id)
        card = cards.get(r.name) if r.name else None
        if not items and card is None:
            continue
        title, body = personal_digest(r.name, items, card)
        html_body = mail.render_email(title=heading, blocks=[
            mail.paragraph(body), mail.button("Open Meridian", f"{base_url}/inbox")])
        _, sent, no_backend_written = _deliver_to_user(
            session, tenant_id, r, "digest", key, heading, body, "/inbox", "digest",
            f"Meridian {period} digest — {title}", html_body, backend, no_backend_written)
        emailed += sent
    return emailed


@celery_app.task(name="workers.tasks.send_notifications.send_alert_digest",
                 soft_time_limit=600, time_limit=660)
def send_alert_digest(period: str) -> dict:
    """Daily / weekly digest per tenant: one alert per system (or file uploads) analysed in the
    window — score drop beyond the tenant's threshold against that system's last run before the
    window, critical rules newly failing, records regressed since its baseline — plus one
    tenant-level alert for exception SLAs breached (exceptions carry no system). Silent when
    nothing fired. Also one personal digest per user whose preference names this period
    (their own assigned triage items and owner scorecard), skipping users with nothing open."""
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    since = datetime.now(timezone.utc) - DIGEST_WINDOW[period]
    base_url = _resolve_app_base_url()
    engine = get_sync_engine()
    sent = 0
    with Session(engine) as session:
        tenants = [str(r[0]) for r in session.execute(text("SELECT id FROM tenants")).fetchall()]
    for tid in tenants:
        try:
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": tid})
                channels = _channels(session, "digest = :p", {"p": period})
                recipients = _recipients_safe(session, tid, period)
                if recipients:  # personal digests: each user's own open items
                    sent += _send_user_digests(session, tid, period, recipients, base_url)
                if not channels:
                    continue
                drop_limit = _drop_threshold(session, tid)
                scopes = [r[0] for r in session.execute(text(f"""
                    SELECT DISTINCT {_SCOPE} FROM analysis_versions
                     WHERE status IN ('complete', 'agents_complete') AND run_at >= :since
                """), {"since": since}).fetchall()]
                alerts = []
                for scope in sorted(scopes):
                    cur = _completed(session, scope)
                    base = _completed(session, scope, before=since)
                    new = (_critical_rules(session, cur[0]) - _critical_rules(session, base[0])) if base else set()
                    # records failing again since this system's post-cleanup baseline (api/services/monitor.py)
                    regressed = session.execute(text(
                        "SELECT COALESCE((metadata->'monitor'->>'new_records')::int, 0) FROM analysis_versions "
                        "WHERE id = :v"), {"v": str(cur[0])}).scalar() or 0
                    alert = build_alert(period, str(cur[0]), _overall(cur[2]), _overall(base[2]) if base else None,
                                        new, 0, drop_limit, base_url, regressed_records=int(regressed))
                    if alert:
                        alerts.append({**alert, "system_name": _system_name(session, scope)})
                sla = session.execute(text("""
                    SELECT count(*) FROM exceptions WHERE status NOT IN ('resolved', 'closed')
                       AND sla_deadline > :since AND sla_deadline <= now()
                """), {"since": since}).scalar() or 0
                tenant_alert = build_alert(period, None, None, None, set(), int(sla), drop_limit, base_url)
                alerts += [tenant_alert] if tenant_alert else []
                for alert in alerts:
                    for ch in channels:
                        sent += _deliver_safe(ch, alert)
        except Exception as e:
            logger.error(f"alert digest failed for tenant {tid}: {type(e).__name__}")
    return {"period": period, "sent": sent}
