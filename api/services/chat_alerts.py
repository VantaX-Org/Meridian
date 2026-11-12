"""Chat alerts to Slack and Microsoft Teams through incoming-webhook URLs held in environment variables only.

The URLs are secrets: they come from MERIDIAN_SLACK_WEBHOOK_URL and MERIDIAN_TEAMS_WEBHOOK_URL, are read inside the
worker at send time, and never reach the database, the broker, the API or the screen. The tenant setting
(tenant_settings key ``chat_alerts``) only says which events go to chat. A message carries aggregate counts and a
link back into Meridian, never record values (``webhooks.check_payload`` guards the counts).

  dqs_drop             an object's score fell past the automation threshold (from score.dropped)
  threshold_breach     a run broke a contract or rule threshold it did not break before (from breach.new)
  run_failed           a run ended in error (from run.failed)
  sla_breach           the triage sweep found work past its SLA
  firewall_rejections  the data quality firewall blocked records at entry
"""
from __future__ import annotations

import os
from typing import Any

from sqlalchemy import text

KEY = "chat_alerts"
EVENTS = ("dqs_drop", "threshold_breach", "run_failed", "sla_breach", "firewall_rejections")
ENV = {"slack": "MERIDIAN_SLACK_WEBHOOK_URL", "teams": "MERIDIAN_TEAMS_WEBHOOK_URL"}
TITLES = {
    "dqs_drop": "Data quality score dropped",
    "threshold_breach": "New threshold breaches",
    "run_failed": "A run failed",
    "sla_breach": "Work past its SLA",
    "firewall_rejections": "Records blocked at entry",
    "test": "Meridian test message",
}
# webhook event -> chat event, and the link path for each chat event
FROM_WEBHOOK = {"score.dropped": "dqs_drop", "breach.new": "threshold_breach", "run.failed": "run_failed"}
PATHS = {"sla_breach": "/work", "firewall_rejections": "/admin/dqfirewall", "test": "/admin/webhooks"}


def configured() -> dict[str, bool]:
    return {kind: bool(os.getenv(var, "").strip()) for kind, var in ENV.items()}


def merged(stored: dict | None) -> dict[str, Any]:
    stored = stored if isinstance(stored, dict) else {}
    chosen = stored.get("events")
    return {"events": [e for e in EVENTS if e in chosen] if isinstance(chosen, list) else list(EVENTS)}


def load_sync(session, tenant_id: str) -> dict[str, Any]:
    row = session.execute(text("SELECT value FROM tenant_settings WHERE tenant_id = :t AND key = :k"),
                          {"t": str(tenant_id), "k": KEY}).fetchone()
    return merged(row[0] if row else None)


async def load(db, tenant_id: str) -> dict[str, Any]:
    row = (await db.execute(text("SELECT value FROM tenant_settings WHERE tenant_id = :t AND key = :k"),
                            {"t": str(tenant_id), "k": KEY})).fetchone()
    return merged(row[0] if row else None)


def counts_of(webhook_event: str, data: dict) -> tuple[dict[str, Any], str]:
    """Aggregate counts and the link path for a webhook event's data; nothing record-level survives."""
    objects = data.get("objects") or []
    run = data.get("run_id")
    path = f"/run/{run}" if run else "/runs"
    if webhook_event == "score.dropped":
        drops = [float(o.get("drop") or 0) for o in objects]
        return {"objects": len(objects), "largest_drop_points": round(max(drops), 2) if drops else 0}, path
    if webhook_event == "breach.new":
        return {"objects": len(objects), "new_breaches": sum(len(o.get("rules") or []) for o in objects)}, path
    return {"runs": 1}, path


def message(kind: str, event: str, counts: dict[str, Any], link: str) -> dict:
    """The Slack Block Kit or Teams Adaptive Card body: a title, count facts and one link."""
    from api.services.webhooks import check_payload

    check_payload(counts, "counts")
    title = TITLES.get(event, event)
    facts = [(k.replace("_", " ").capitalize(), str(v)) for k, v in counts.items()]
    if kind == "slack":
        lines = "\n".join(f"*{k}:* {v}" for k, v in facts)
        return {"text": title, "blocks": [
            {"type": "section", "text": {"type": "mrkdwn", "text": f"*{title}*\n{lines}".strip()}},
            {"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Open in Meridian"},
                                              "url": link}]}]}
    return {"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard", "version": "1.4",
        "body": [{"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True},
                 {"type": "FactSet", "facts": [{"title": k, "value": v} for k, v in facts]}],
        "actions": [{"type": "Action.OpenUrl", "title": "Open in Meridian", "url": link}]}}]}


def notify_sync(session, tenant_id: str, event: str, counts: dict[str, Any], path: str | None = None) -> int:
    """Queue one chat message per configured channel when the tenant sends this event to chat. Best effort: returns
    the number queued and never raises into the caller."""
    import logging

    try:
        kinds = [k for k, on in configured().items() if on]
        if not kinds or event not in load_sync(session, tenant_id)["events"]:
            return 0
        from api.services.sandbox import held_back_sync
        if held_back_sync(session, tenant_id, "chat", event):
            return 0
        from workers.tasks.chat_alerts import post
        for kind in kinds:
            post.delay(kind, event, counts, path or PATHS.get(event, "/"))
        return len(kinds)
    except Exception as e:  # noqa: BLE001 - alerts are best effort; the log names the event only
        logging.getLogger("meridian.chat_alerts").warning(f"chat alert {event} not queued: {type(e).__name__}")
        return 0


def throttled(tenant_id: str, event: str, scope: str, seconds: int = 900) -> bool:
    """True when this event already went to chat for this scope inside the window.
    ponytail: Redis SET NX EX; without Redis nothing is throttled (alerts stay best effort)."""
    from api.services.task_progress import _redis_client

    r = _redis_client()
    if r is None:
        return False
    try:
        return not r.set(f"chat_alerts:{tenant_id}:{event}:{scope}", "1", nx=True, ex=seconds)
    except Exception:  # noqa: BLE001
        return False


async def notify(db, tenant_id: str, event: str, counts: dict[str, Any], path: str | None = None) -> int:
    """``notify_sync`` for the async API routes."""
    import logging

    try:
        kinds = [k for k, on in configured().items() if on]
        if not kinds or event not in (await load(db, tenant_id))["events"]:
            return 0
        from api.services.sandbox import held_back
        if await held_back(db, tenant_id, "chat", event):
            return 0
        from workers.tasks.chat_alerts import post
        for kind in kinds:
            post.delay(kind, event, counts, path or PATHS.get(event, "/"))
        return len(kinds)
    except Exception as e:  # noqa: BLE001
        logging.getLogger("meridian.chat_alerts").warning(f"chat alert {event} not queued: {type(e).__name__}")
        return 0
