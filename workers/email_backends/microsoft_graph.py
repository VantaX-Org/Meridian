"""Microsoft Graph API email backend for sending emails via Azure."""

import json
import logging
import os
from typing import Optional

import requests

logger = logging.getLogger("meridian.email.graph")


class MicrosoftGraphEmailClient:
    """Client for sending emails via Microsoft Graph API."""

    def __init__(
        self,
        tenant_id: str,
        client_id: str,
        client_secret: str,
        from_email: str,
    ):
        """Initialize Microsoft Graph email client.
        
        Args:
            tenant_id: Azure tenant ID
            client_id: Azure app registration client ID
            client_secret: Azure app registration client secret
            from_email: Email address to send from (must be registered in tenant)
        """
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.from_email = from_email
        self._access_token: Optional[str] = None
        self._token_expiry: Optional[int] = None

    def _get_access_token(self) -> str:
        """Get OAuth2 access token from Microsoft Graph API."""
        if self._access_token:
            import time
            if self._token_expiry and time.time() < self._token_expiry - 60:
                return self._access_token

        url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"

        payload = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": "https://graph.microsoft.com/.default",
        }

        try:
            resp = requests.post(url, data=payload, timeout=10)
            resp.raise_for_status()
            data = resp.json()

            self._access_token = data["access_token"]
            if "expires_in" in data:
                import time
                self._token_expiry = time.time() + data["expires_in"]

            return self._access_token
        except Exception as e:
            logger.error(f"Failed to get Microsoft Graph access token: {e}")
            raise

    def send_email(
        self,
        recipient: str,
        subject: str,
        html_body: str,
        sender_name: str = "Meridian",
    ) -> bool:
        """Send email via Microsoft Graph API.
        
        Args:
            recipient: Email address to send to
            subject: Email subject
            html_body: Email body in HTML format
            sender_name: Display name for sender
            
        Returns:
            True if email was sent successfully, False otherwise
        """
        try:
            token = self._get_access_token()

            # Prepare email message
            message = {
                "message": {
                    "subject": subject,
                    "body": {
                        "contentType": "HTML",
                        "content": html_body,
                    },
                    "toRecipients": [
                        {
                            "emailAddress": {
                                "address": recipient,
                            }
                        }
                    ],
                    "from": {
                        "emailAddress": {
                            "address": self.from_email,
                            "name": sender_name,
                        }
                    },
                }
            }

            # Send via Graph API
            # Use /users/{email}/sendMail for app-level permissions (client credentials flow)
            url = f"https://graph.microsoft.com/v1.0/users/{self.from_email}/sendMail"
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }

            resp = requests.post(url, headers=headers, json=message, timeout=10)

            if resp.status_code in (200, 202):
                logger.info(f"Email sent via Microsoft Graph to {recipient}")
                return True
            else:
                logger.error(
                    f"Microsoft Graph API error: status={resp.status_code}, "
                    f"response={resp.text}"
                )
                return False

        except Exception as e:
            logger.error(f"Failed to send email via Microsoft Graph: {e}")
            return False


def create_graph_client() -> Optional[MicrosoftGraphEmailClient]:
    """Factory function to create a Microsoft Graph email client from env vars."""
    tenant_id = os.getenv("MICROSOFT_TENANT_ID")
    client_id = os.getenv("MICROSOFT_CLIENT_ID")
    client_secret = os.getenv("MICROSOFT_CLIENT_SECRET")
    from_email = os.getenv("EMAIL_FROM")

    if not all([tenant_id, client_id, client_secret, from_email]):
        logger.debug("Microsoft Graph credentials not fully configured")
        return None

    try:
        return MicrosoftGraphEmailClient(tenant_id, client_id, client_secret, from_email)
    except Exception as e:
        logger.error(f"Failed to initialize Microsoft Graph client: {e}")
        return None
