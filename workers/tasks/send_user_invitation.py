"""Celery task: send user invitation email.

Sends invitation emails to newly invited users with login credentials/link.
Never raises — email failures must not affect user creation.
"""

import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine
from workers.email_backends.microsoft_graph import create_graph_client

logger = logging.getLogger("meridian.worker.invitation")

RESEND_API_URL = "https://api.resend.com/emails"


def _load_tenant_config(session: Session, tenant_id: str) -> dict:
    """Load tenant name and notification email config."""
    result = session.execute(
        text("SELECT name, dqs_weights FROM tenants WHERE id = :tid"),
        {"tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        return {}

    dqs_weights = row[1] or {}
    notification_config = dqs_weights.get("notification_config", {})

    return {
        "tenant_name": row[0],
        "admin_email": notification_config.get("email", ""),  # Admin email for references
    }


def _resolve_app_base_url() -> str:
    """Derive the customer-facing base URL for this deployment.

    Order: ``MERIDIAN_APP_URL`` (explicit override) → ``SERVER_DOMAIN`` +
    ``SSL_MODE`` (set by ``meridian-deploy.sh`` at install) → ``localhost``.
    """
    override = os.getenv("MERIDIAN_APP_URL", "").strip().rstrip("/")
    if override:
        return override
    host = os.getenv("SERVER_DOMAIN", "").strip() or "localhost"
    # SSL_MODE: 1=none/http, 2=self-signed/https, 3=letsencrypt/https
    # (matches meridian-deploy.sh's PROTO derivation).
    proto = "http" if os.getenv("SSL_MODE", "1").strip() == "1" else "https"
    return f"{proto}://{host}"


def _build_invitation_email(
    recipient_email: str,
    recipient_name: str,
    role: str,
    tenant_name: str,
    invite_token: str = "",
    login_url: str | None = None,
) -> tuple[str, str]:
    """Build subject and HTML body for invitation email.

    If ``invite_token`` is provided the link goes to ``/accept-invite?token=…``
    so the user lands on a set-password page first. Otherwise (legacy / no
    token) it falls back to ``/sign-in``. ``login_url`` (if passed) overrides
    URL construction wholesale — used by tests.
    """
    if login_url is None:
        base = _resolve_app_base_url()
        if invite_token:
            login_url = f"{base}/accept-invite?token={invite_token}"
        else:
            login_url = f"{base}/sign-in"

    # Button copy changes with the flow: first-time invite vs already-active.
    if invite_token:
        cta_label = "Set your password"
        cta_help = (
            "Click the button to set your password. Once that's done, "
            "you'll be sent to the sign-in page."
        )
    else:
        cta_label = "Sign in to Meridian"
        cta_help = "Sign in to access your dashboards and start working with your data:"

    subject = f"Welcome to Meridian — {tenant_name} Data Quality Platform"
    
    # All styling is inline (no <style> block) — best compatibility with
    # Outlook desktop and other clients that strip <head> styles. Brand colors
    # follow the Meridian design system: --mn-primary (#F97316), --mn-primary-50
    # (#FFF7ED), ink tones #0F172A / #475569 / #94A3B8.
    role_pretty = role.replace('_', ' ').title()
    body = f"""
    <html>
    <body style="margin:0;padding:0;background-color:#F7F8FA;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0F172A;">
      <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
        <div style="padding:20px 24px;background:#F97316;border-radius:10px 10px 0 0;">
          <div style="color:#FFFFFF;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">Meridian &middot; Data Quality</div>
          <h1 style="color:#FFFFFF;font-size:22px;font-weight:700;letter-spacing:-0.01em;margin:6px 0 0;">Welcome to {tenant_name}</h1>
        </div>
        <div style="background:#FFFFFF;padding:28px 24px;border-radius:0 0 10px 10px;border:1px solid #E5E7EB;border-top:none;">
          <p style="font-size:16px;font-weight:600;color:#0F172A;margin:0 0 12px;">Hi {recipient_name},</p>
          <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 14px;">
            You&rsquo;ve been invited to join <strong style="color:#0F172A;">{tenant_name}</strong> on the Meridian SAP Data Quality platform.
          </p>
          <div style="font-size:13px;color:#475569;background:#FFF7ED;padding:12px 14px;border-radius:8px;border-left:3px solid #F97316;margin:18px 0;">
            <strong style="color:#0F172A;">Role:</strong> {role_pretty}
          </div>
          <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 14px;">
            {cta_help}
          </p>
          <p style="margin:8px 0 18px;">
            <a href="{login_url}" style="display:inline-block;background:#F97316;color:#FFFFFF;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px;">{cta_label}</a>
          </p>
          <p style="font-size:12px;color:#64748B;margin:0 0 14px;">
            Button not working? Copy this link:<br>
            <code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;font-family:'JetBrains Mono',Menlo,Consolas,monospace;font-size:11px;color:#334155;word-break:break-all;">{login_url}</code>
          </p>
          <p style="font-size:13px;line-height:1.6;color:#475569;margin:18px 0 0;">
            Questions? Contact your administrator.
          </p>
        </div>
        <div style="margin-top:24px;text-align:center;font-size:11px;color:#94A3B8;letter-spacing:0.06em;">
          AUTOMATED MESSAGE &middot; MERIDIAN &middot; &copy; 2026 VANTAX
        </div>
      </div>
    </body>
    </html>
    """
    
    return subject, body


def _send_email_smtp(recipient: str, subject: str, body: str):
    """Send email via local SMTP relay (air-gapped deployments)."""
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
        logger.info(f"Invitation email sent via SMTP to {recipient}")
    except Exception as e:
        logger.error(f"SMTP send failed for {recipient}: {e}")


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
                "from": "Meridian Invitations <invitations@meridian.vantax.co.za>",
                "to": [recipient],
                "subject": subject,
                "html": body,
            },
            timeout=10,
        )
        logger.info(f"Invitation email sent via Resend to {recipient}: status={resp.status_code}")
    except Exception as e:
        logger.error(f"Resend email send failed for {recipient}: {e}")


def _send_invitation_email(
    recipient_email: str,
    recipient_name: str,
    role: str,
    tenant_name: str,
    invite_token: str = "",
):
    """Send invitation email via Microsoft Graph, SMTP, or Resend API."""
    subject, body = _build_invitation_email(
        recipient_email, recipient_name, role, tenant_name, invite_token=invite_token,
    )

    # Try Microsoft Graph first
    graph_client = create_graph_client()
    if graph_client:
        if graph_client.send_email(recipient_email, subject, body, sender_name="Meridian"):
            return
        logger.warning("Microsoft Graph email send failed, falling back to SMTP/Resend")

    # Fall back to SMTP or Resend
    if os.getenv("SMTP_HOST"):
        _send_email_smtp(recipient_email, subject, body)
    else:
        _send_email_resend(recipient_email, subject, body)


@celery_app.task(bind=True, name="workers.tasks.send_user_invitation.send_invitation_email",
                 soft_time_limit=30, time_limit=60)
def send_invitation_email(
    self,
    user_id: str,
    tenant_id: str,
    recipient_email: str,
    recipient_name: str,
    role: str,
    invite_token: str = "",
):
    """Send invitation email to newly invited user.

    Args:
        user_id: The newly created user ID
        tenant_id: The tenant ID
        recipient_email: Email address to send invitation to
        recipient_name: Name of the invited user
        role: Role assigned to the user
        invite_token: Signed JWT for the /accept-invite page. If empty (legacy
            callers, mid-rollout workers), the email links to /sign-in instead.
    """
    logger.info(f"send_invitation_email: user={user_id}, tenant={tenant_id}, email={recipient_email}")

    try:
        engine = get_sync_engine()
        with Session(engine) as session:
            session.execute(text(f"SET LOCAL app.tenant_id = '{str(tenant_id)}'"))

            config = _load_tenant_config(session, tenant_id)
            if not config:
                logger.warning(f"Tenant {tenant_id} not found, skipping invitation email")
                return

            tenant_name = config.get("tenant_name", "Meridian")

            _send_invitation_email(
                recipient_email,
                recipient_name,
                role,
                tenant_name,
                invite_token=invite_token,
            )

            logger.info(f"Invitation email sent for user={user_id}")

    except Exception as e:
        logger.error(f"send_invitation_email failed: {e}")
        # Never raise — email failures must not affect user creation
