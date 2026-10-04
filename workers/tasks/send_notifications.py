"""Celery task: send email and Teams notifications after analysis completes.

Supports triggers: critical_found, dqs_drop, scheduled_daily, scheduled_weekly, scheduled_monthly.
Never raises — notification failures must not affect analysis results.
"""

import hashlib
import hmac
import html
import json
import logging
import os
import time
import traceback
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
    }


def _load_version_data(session: Session, version_id: str, tenant_id: str) -> dict:
    """Load DQS summary, findings summary, and report JSON for a version."""
    result = session.execute(
        text("""
            SELECT av.dqs_summary, av.metadata, r.report_json
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
            WHERE version_id = :vid AND tenant_id = :tid AND severity = 'critical'
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

    dqs_summary = row[0] or {}
    report_json = row[2] or {}

    # Compute overall DQS
    scores = [m.get("composite_score", 0) for m in dqs_summary.values()] if isinstance(dqs_summary, dict) else []
    overall_dqs = round(sum(scores) / len(scores), 1) if scores else 0

    return {
        "dqs_summary": dqs_summary,
        "overall_dqs": overall_dqs,
        "report_json": report_json,
        "critical_findings": critical_findings,
        "critical_count": len(critical_findings),
    }


def _check_trigger(trigger: str, config: dict, version_data: dict, session: Session, version_id: str, tenant_id: str) -> bool:
    """Check if the trigger condition is met."""
    if trigger == "critical_found":
        return version_data.get("critical_count", 0) >= config.get("critical_threshold", 1)

    if trigger == "dqs_drop":
        # Compare with previous version
        result = session.execute(
            text("""
                SELECT dqs_summary FROM analysis_versions
                WHERE tenant_id = :tid AND status = 'agents_complete' AND id != :vid
                ORDER BY run_at DESC LIMIT 1
            """),
            {"tid": tenant_id, "vid": version_id},
        )
        prev = result.fetchone()
        if not prev or not prev[0]:
            return False
        prev_summary = prev[0]
        prev_scores = [m.get("composite_score", 0) for m in prev_summary.values()] if isinstance(prev_summary, dict) else []
        prev_overall = sum(prev_scores) / len(prev_scores) if prev_scores else 0
        drop = prev_overall - version_data.get("overall_dqs", 0)
        return drop > config.get("dqs_drop_threshold", 5)

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
    overall_dqs = version_data.get("overall_dqs", 0)

    if trigger == "critical_found":
        subject = f"Meridian DQ Alert — {critical_count} Critical findings"
    elif trigger.startswith("scheduled_"):
        from datetime import date
        subject = f"Meridian {trigger.replace('scheduled_', '').title()} DQ Summary — {date.today()}"
    else:
        subject = "Meridian Data Quality Alert"

    # Build HTML body. All styling is inline (no <style> block) — best
    # compatibility with Outlook desktop and other clients that strip <head>.
    # Brand colors match the Meridian design system: --mn-primary (#F97316),
    # ink tones #0F172A / #475569 / #94A3B8.
    findings_rows = ""
    for f in version_data.get("critical_findings", [])[:5]:
        findings_rows += f"""
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #F1F5F9;color:#334155;">{f['check_id']}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #F1F5F9;color:#334155;">{f['module']}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #F1F5F9;color:#334155;">{f['message'][:100]}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #F1F5F9;color:#334155;">{f['affected_count']}</td>
        </tr>"""

    report_json = version_data.get("report_json", {})
    executive_summary = report_json.get("executive_summary", "No summary available.")
    critical_color = "#BB0000" if critical_count > 0 else "#0F172A"

    if findings_rows:
        findings_section = (
            '<h3 style="font-size:13px;font-weight:700;letter-spacing:0.08em;'
            'text-transform:uppercase;color:#475569;margin:18px 0 8px;">'
            'Top Critical Findings</h3>'
            '<table cellspacing="0" cellpadding="0" border="0" '
            'style="border-collapse:collapse;width:100%;font-size:12.5px;">'
            '<thead><tr>'
            '<th style="background:#F1F5F9;padding:8px 10px;text-align:left;'
            'font-weight:600;color:#475569;border-bottom:1px solid #E5E7EB;">Check</th>'
            '<th style="background:#F1F5F9;padding:8px 10px;text-align:left;'
            'font-weight:600;color:#475569;border-bottom:1px solid #E5E7EB;">Module</th>'
            '<th style="background:#F1F5F9;padding:8px 10px;text-align:left;'
            'font-weight:600;color:#475569;border-bottom:1px solid #E5E7EB;">Message</th>'
            '<th style="background:#F1F5F9;padding:8px 10px;text-align:left;'
            'font-weight:600;color:#475569;border-bottom:1px solid #E5E7EB;">Affected</th>'
            f'</tr></thead><tbody>{findings_rows}</tbody></table>'
        )
    else:
        findings_section = ""

    body = f"""
    <html>
    <body style="margin:0;padding:0;background-color:#F7F8FA;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0F172A;">
      <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
        <div style="padding:18px 24px;background:#F97316;border-radius:10px 10px 0 0;">
          <div style="color:#FFFFFF;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">Meridian &middot; Data Quality</div>
          <h1 style="color:#FFFFFF;font-size:20px;font-weight:700;letter-spacing:-0.01em;margin:6px 0 0;">{tenant_name}</h1>
        </div>
        <div style="background:#FFFFFF;padding:24px;border-radius:0 0 10px 10px;border:1px solid #E5E7EB;border-top:none;">
          <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 18px;">{executive_summary}</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 18px;border-collapse:separate;border-spacing:8px 0;">
            <tr>
              <td style="padding:14px 16px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;vertical-align:top;width:50%;">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748B;margin:0 0 6px;">Overall DQS</div>
                <div style="font-size:22px;font-weight:700;color:#0F172A;font-family:'JetBrains Mono',Menlo,Consolas,monospace;letter-spacing:-0.01em;">{overall_dqs}</div>
              </td>
              <td style="padding:14px 16px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;vertical-align:top;width:50%;">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748B;margin:0 0 6px;">Critical findings</div>
                <div style="font-size:22px;font-weight:700;color:{critical_color};font-family:'JetBrains Mono',Menlo,Consolas,monospace;letter-spacing:-0.01em;">{critical_count}</div>
              </td>
            </tr>
          </table>
          {findings_section}
        </div>
        <div style="margin-top:18px;text-align:center;font-size:11px;color:#94A3B8;letter-spacing:0.06em;">
          AUTOMATED REPORT &middot; MERIDIAN &middot; &copy; 2026 VANTAX
        </div>
      </div>
    </body>
    </html>
    """

    return subject, body


def _send_email_smtp(recipient: str, subject: str, body: str):
    """Send email via local SMTP relay (air-gapped deployments)."""
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    msg = MIMEMultipart()
    msg["From"] = os.getenv("SMTP_FROM", "noreply@meridian.local")
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "html"))

    try:
        with smtplib.SMTP(os.getenv("SMTP_HOST"), int(os.getenv("SMTP_PORT", "587"))) as smtp:
            smtp.starttls()
            if os.getenv("SMTP_USER"):
                smtp.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD", ""))
            smtp.sendmail(msg["From"], recipient, msg.as_string())
        logger.info(f"Email sent via SMTP to {recipient}")
    except Exception as e:
        logger.error(f"SMTP send failed: {e}")


def _send_email_resend(recipient: str, subject: str, body: str):
    """Send email via Resend API (standard mode)."""
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key:
        logger.info("Skipping email — no RESEND_API_KEY configured")
        return

    try:
        resp = requests.post(
            RESEND_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": "Meridian DQ Agent <notifications@meridian.vantax.co.za>",
                "to": [recipient],
                "subject": subject,
                "html": body,
            },
            timeout=10,
        )
        logger.info(f"Email sent via Resend: status={resp.status_code}")
    except Exception as e:
        logger.error(f"Resend email send failed: {e}")


def _send_email(config: dict, version_data: dict, trigger: str):
    """Send notification email via Microsoft Graph, SMTP relay, or Resend API."""
    recipient = config.get("email")
    if not recipient:
        logger.info("Skipping email — no email configured")
        return

    subject, body = _build_email_content(config, version_data, trigger)
    _deliver_email(recipient, subject, body)


def _deliver_email(recipient: str, subject: str, body: str):
    """Microsoft Graph, else the SMTP relay (SMTP_HOST), else Resend."""
    # Try Microsoft Graph first
    graph_client = create_graph_client()
    if graph_client:
        if graph_client.send_email(recipient, subject, body, sender_name="Meridian Data Quality"):
            return
        logger.warning("Microsoft Graph email send failed, falling back to SMTP/Resend")

    # Fall back to SMTP or Resend
    if os.getenv("SMTP_HOST"):
        _send_email_smtp(recipient, subject, body)
    else:
        _send_email_resend(recipient, subject, body)


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
                            "text": report_json.get("executive_summary", "Analysis complete."),
                        },
                        {
                            "type": "FactSet",
                            "facts": [
                                {"title": "Overall DQS", "value": str(version_data.get("overall_dqs", 0))},
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


@celery_app.task(bind=True, name="workers.tasks.send_notifications.send_notification",
                 soft_time_limit=60, time_limit=90)
def send_notification(self, version_id: str, tenant_id: str, trigger: str):
    """Send notification for a completed analysis version.

    trigger: critical_found | dqs_drop | scheduled_daily | scheduled_weekly | scheduled_monthly
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

            _send_email(config, version_data, trigger)
            _send_teams_card(config, version_data)

            logger.info(f"Notifications sent for version={version_id}, trigger={trigger}")

    except Exception:
        logger.error(f"send_notification failed: {traceback.format_exc()}")
        # Never raise — notification failures must not affect analysis


# ── Alert channels (alert_channels, migration 054) ───────────────────────────
# Payloads carry counts, rule ids and links only — never finding messages,
# record keys or values. Digest (daily/weekly) is the default; a channel may
# opt into immediate delivery of new critical findings only.

DIGEST_WINDOW = {"daily": timedelta(days=1), "weekly": timedelta(days=7)}
MAX_RULE_IDS = 50


def sign(secret: str, timestamp: str, body: bytes) -> str:
    """X-Meridian-Signature: HMAC-SHA256 over "<timestamp>.<body>" (receivers reject stale timestamps)."""
    return "sha256=" + hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def build_alert(mode: str, version_id: str | None, score: float | None, previous_score: float | None,
                new_critical: set[str], sla_breaches: int, drop_threshold: float, base_url: str) -> dict | None:
    """The alert payload, or None when no trigger fires."""
    drop = round(previous_score - score, 1) if score is not None and previous_score is not None else None
    triggers = [t for t, hit in (("score_drop", drop is not None and drop > drop_threshold),
                                 ("new_critical", bool(new_critical)), ("sla_breach", sla_breaches > 0)) if hit]
    if not triggers:
        return None
    return {
        "event": "meridian.dq_alert", "mode": mode, "triggers": triggers,
        "version_id": version_id, "score": score, "previous_score": previous_score, "score_drop": drop,
        "new_critical_count": len(new_critical), "new_critical_rules": sorted(new_critical)[:MAX_RULE_IDS],
        "sla_breaches": sla_breaches,
        "links": {"findings": f"{base_url}/findings", "exceptions": f"{base_url}/exceptions",
                  "versions": f"{base_url}/versions"},
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
    return f"Meridian {alert['mode']} alert — " + "; ".join(parts) + f". {alert['links']['findings']}"


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
        _deliver_email(channel["target"], f"Meridian DQ {alert['mode']} alert",
                       f"<p>{html.escape(alert_text(alert))}</p>")
        return True
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


def _channels(session: Session, where: str, params: dict | None = None) -> list[dict]:
    try:
        rows = session.execute(text(f"SELECT id, kind, target, secret FROM alert_channels WHERE enabled AND {where}"),
                               params or {}).mappings().all()
    except Exception:  # table absent before migration 054
        session.rollback()
        return []
    return [dict(r) for r in rows]


def _overall(dqs_summary) -> float | None:
    scores = [m.get("composite_score", 0) for m in dqs_summary.values()] if isinstance(dqs_summary, dict) else []
    return round(sum(scores) / len(scores), 1) if scores else None


def _critical_rules(session: Session, version_id) -> set[str]:
    """Critical rules failing in a version, suppressed ones excluded."""
    return {r[0] for r in session.execute(text("""
        SELECT DISTINCT check_id FROM findings
         WHERE version_id = :v AND severity = 'critical' AND affected_count > 0
           AND details->>'error' IS NULL AND NOT COALESCE((details->>'suppressed')::boolean, false)
    """), {"v": str(version_id)}).fetchall()}


def _completed(session: Session, before: datetime | None = None, skip: str | None = None):
    """Latest completed analysis version (id, run_at, dqs_summary) — optionally before a time / not `skip`."""
    return session.execute(text("""
        SELECT id, run_at, dqs_summary FROM analysis_versions
         WHERE status IN ('complete', 'agents_complete')
           AND (CAST(:before AS timestamptz) IS NULL OR run_at < :before)
           AND (CAST(:skip AS uuid) IS NULL OR id <> CAST(:skip AS uuid))
         ORDER BY run_at DESC LIMIT 1
    """), {"before": before, "skip": skip}).fetchone()


def _drop_threshold(session: Session, tenant_id: str) -> float:
    row = session.execute(text("SELECT alert_thresholds FROM tenants WHERE id = :t"), {"t": tenant_id}).fetchone()
    return float(((row[0] if row else None) or {}).get("dqs_drop_threshold", 5))


def _send_immediate_critical(session: Session, tenant_id: str, version_id: str) -> None:
    channels = _channels(session, "immediate_critical")
    if not channels:
        return
    from workers.tasks.send_user_invitation import _resolve_app_base_url
    prev = _completed(session, skip=version_id)
    new = _critical_rules(session, version_id) - (_critical_rules(session, prev[0]) if prev else set())
    alert = build_alert("immediate", version_id, None, None, new, 0, 0, _resolve_app_base_url())
    for ch in channels if alert else []:
        deliver(ch, alert)


@celery_app.task(name="workers.tasks.send_notifications.send_alert_digest",
                 soft_time_limit=600, time_limit=660)
def send_alert_digest(period: str) -> dict:
    """Daily / weekly digest per tenant: score drop beyond the tenant's threshold, critical
    rules newly failing, exception SLAs breached in the window. Silent when nothing fired."""
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
                if not channels:
                    continue
                cur = _completed(session)
                base = _completed(session, before=since)
                fresh = cur is not None and cur[1] >= since
                new = (_critical_rules(session, cur[0]) - (_critical_rules(session, base[0]) if base else set())
                       if fresh and base else set())
                sla = session.execute(text("""
                    SELECT count(*) FROM exceptions WHERE status NOT IN ('resolved', 'closed')
                       AND sla_deadline > :since AND sla_deadline <= now()
                """), {"since": since}).scalar() or 0
                alert = build_alert(period, str(cur[0]) if fresh else None,
                                    _overall(cur[2]) if fresh else None,
                                    _overall(base[2]) if fresh and base else None,
                                    new, int(sla), _drop_threshold(session, tid), base_url)
                for ch in channels if alert else []:
                    sent += deliver(ch, alert)
        except Exception as e:
            logger.error(f"alert digest failed for tenant {tid}: {type(e).__name__}: {e}")
    return {"period": period, "sent": sent}
