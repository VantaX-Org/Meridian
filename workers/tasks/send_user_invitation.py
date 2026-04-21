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


def _build_invitation_email(
    recipient_email: str,
    recipient_name: str,
    role: str,
    tenant_name: str,
    login_url: str = "https://meridian.vantax.co.za/login",
) -> tuple[str, str]:
    """Build subject and HTML body for invitation email."""
    
    subject = f"Welcome to Meridian — {tenant_name} Data Quality Platform"
    
    body = f"""
    <html>
    <head>
      <style>
        body {{ font-family: Arial, sans-serif; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: #0F6E56; color: white; padding: 20px; border-radius: 4px 4px 0 0; }}
        .content {{ background-color: #f7f8fa; padding: 20px; border-radius: 0 0 4px 4px; }}
        .button {{ display: inline-block; background-color: #0F6E56; color: white; padding: 12px 24px; 
                   text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold; }}
        .footer {{ color: #666; font-size: 12px; margin-top: 24px; text-align: center; }}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2 style="margin: 0;">Meridian Data Quality</h2>
        </div>
        <div class="content">
          <p>Hi {recipient_name},</p>
          
          <p>You've been invited to join <strong>{tenant_name}</strong> on the Meridian SAP Data Quality platform.</p>
          
          <p><strong>Your Role:</strong> {role.replace('_', ' ').title()}</p>
          
          <p>Log in to access your tenant environment and start working with your data quality dashboards:</p>
          
          <a href="{login_url}" class="button">Access Meridian</a>
          
          <p style="font-size: 12px; color: #666;">
            If the button doesn't work, copy this link:<br>
            <code>{login_url}</code>
          </p>
          
          <p>If you have any questions, contact your administrator.</p>
          
          <div class="footer">
            <p>This is an automated message from Meridian. Please do not reply to this email.</p>
            <p>© 2026 VantaX. All rights reserved.</p>
          </div>
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
):
    """Send invitation email via Microsoft Graph, SMTP, or Resend API."""
    subject, body = _build_invitation_email(recipient_email, recipient_name, role, tenant_name)

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
):
    """Send invitation email to newly invited user.
    
    Args:
        user_id: The newly created user ID
        tenant_id: The tenant ID
        recipient_email: Email address to send invitation to
        recipient_name: Name of the invited user
        role: Role assigned to the user
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
            )

            logger.info(f"Invitation email sent for user={user_id}")

    except Exception as e:
        logger.error(f"send_invitation_email failed: {e}")
        # Never raise — email failures must not affect user creation
