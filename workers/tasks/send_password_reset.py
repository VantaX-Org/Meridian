"""Celery task: send password-reset email.

Sent in response to /api/v1/auth/forgot-password. Never raises — email
failures must not bubble back to the requester (it also helps avoid leaking
"account exists / doesn't" signals through error vs success behaviour).
"""

import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests

from workers import email_templates as mail
from workers.celery_app import celery_app
from workers.email_backends.microsoft_graph import create_graph_client

logger = logging.getLogger("meridian.worker.password_reset")

RESEND_API_URL = "https://api.resend.com/emails"


def _resolve_app_base_url() -> str:
    """Same derivation as send_user_invitation.py — keeps URLs consistent."""
    override = os.getenv("MERIDIAN_APP_URL", "").strip().rstrip("/")
    if override:
        return override
    host = os.getenv("SERVER_DOMAIN", "").strip() or "localhost"
    proto = "http" if os.getenv("SSL_MODE", "1").strip() == "1" else "https"
    return f"{proto}://{host}"


def _build_reset_email(
    recipient_name: str,
    reset_url: str,
) -> tuple[str, str]:
    """Build subject + HTML body for the password reset email.

    All styling is inline — best compatibility with Outlook desktop. Same
    Meridian brand palette as the invitation email.
    """
    subject = "Reset your Meridian password"

    body = mail.render_email(
        title="Reset your password",
        preheader="Choose a new password for your Meridian account. The link expires in 1 hour.",
        blocks=[
            mail.greeting(recipient_name),
            mail.paragraph("We received a request to reset the password on your Meridian account. "
                           "Choose a new one with the button below. The link expires in 1 hour."),
            mail.button("Reset password", reset_url),
            mail.link_fallback(reset_url),
            mail.paragraph("If you did not ask for this, ignore this email and your password stays as it is.", muted=True),
        ],
    )
    return subject, body


def _send_email_smtp(recipient: str, subject: str, body: str):
    """Send via local SMTP relay (air-gapped deployments)."""
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
        logger.info(f"Password-reset email sent via SMTP to {recipient}")
    except Exception as e:
        logger.error(f"SMTP send failed for {recipient}: {e}")


def _send_email_resend(recipient: str, subject: str, body: str):
    """Send via Resend API (standard mode)."""
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
                "from": "Meridian <no-reply@meridian.vantax.co.za>",
                "to": [recipient],
                "subject": subject,
                "html": body,
            },
            timeout=10,
        )
        logger.info(f"Password-reset email sent via Resend to {recipient}: status={resp.status_code}")
    except Exception as e:
        logger.error(f"Resend send failed for {recipient}: {e}")


@celery_app.task(
    bind=True,
    name="workers.tasks.send_password_reset.send_password_reset_email",
    soft_time_limit=30,
    time_limit=60,
)
def send_password_reset_email(
    self,
    user_id: str,
    tenant_id: str,
    recipient_email: str,
    recipient_name: str,
    reset_token: str,
):
    """Send the password-reset email to a user who's hit Forgot password.

    Never raises: any failure is logged and swallowed, so the originating API
    response (always 200) doesn't leak account-existence signals.
    """
    logger.info(
        f"send_password_reset_email: user={user_id}, tenant={tenant_id}, email={recipient_email}"
    )

    try:
        reset_url = f"{_resolve_app_base_url()}/reset-password?token={reset_token}"
        subject, body = _build_reset_email(recipient_name, reset_url)

        # Microsoft Graph first when configured.
        graph_client = create_graph_client()
        if graph_client:
            if graph_client.send_email(
                recipient_email, subject, body, sender_name="Meridian"
            ):
                return
            logger.warning(
                "Microsoft Graph password-reset send failed, falling back to SMTP/Resend"
            )

        if os.getenv("SMTP_HOST"):
            _send_email_smtp(recipient_email, subject, body)
        else:
            _send_email_resend(recipient_email, subject, body)

    except Exception as e:
        logger.error(f"send_password_reset_email failed: {e}")
        # Swallow — never raise from this task.
