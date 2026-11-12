"""Post one chat alert to Slack or Teams. The webhook URL is read from the environment here, at send time, so it
never travels through the broker; the task arguments are the channel kind, the event, aggregate counts and a path."""
from __future__ import annotations

import os

import requests  # type: ignore[import-untyped]

from api.services import chat_alerts
from workers.celery_app import celery_app


class DeliveryError(RuntimeError):
    pass


def send(kind: str, event: str, counts: dict, path: str) -> bool:
    """True when the channel took the message; False when it is not configured. Raises on a failed post."""
    url = os.getenv(chat_alerts.ENV[kind], "").strip()
    if not url:
        return False
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    body = chat_alerts.message(kind, event, counts, _resolve_app_base_url() + path)
    r = requests.post(url, json=body, timeout=10)
    if r.status_code >= 300:
        raise DeliveryError(f"{kind} answered HTTP {r.status_code}")  # never the URL
    return True


@celery_app.task(name="workers.tasks.chat_alerts.post", soft_time_limit=30, time_limit=45,
                 autoretry_for=(requests.RequestException, DeliveryError), retry_backoff=True, retry_backoff_max=600,
                 retry_jitter=True, max_retries=5)
def post(kind: str, event: str, counts: dict, path: str) -> bool:
    return send(kind, event, counts, path)
