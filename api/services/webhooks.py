"""Outbound webhooks: subscriptions, events and their signed delivery (migration 107).

An event is written as one ``webhook_deliveries`` row per active webhook subscribed to it (``emit``), in the caller's
transaction; workers/tasks/webhooks.py delivers due rows every minute (``deliver_one``), and POST /webhooks/{id}/test
delivers one at once. A delivery is a JSON POST of the envelope ``{id, event, created_at, tenant_id, data}`` with

  X-Meridian-Event       the event name
  X-Meridian-Delivery    the delivery id
  X-Meridian-Timestamp   unix seconds
  X-Meridian-Signature   sha256=<hex HMAC-SHA256 over "<timestamp>.<body>" with the webhook's secret>

(the same scheme as the alert channels, workers/tasks/send_notifications.sign). A 2xx answer delivers it; anything
else is retried with exponential backoff (1, 2, 4 and 8 minutes after attempts 1-4) and fails after 5 attempts.

Payloads carry ids, names and numbers only, never SAP field values: ``check_payload`` refuses the keys that would hold
one (record keys, field values, samples) before anything is written.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

EVENTS = ("run.finished", "run.failed", "batch.waiting", "batch.approved", "batch.sent", "score.dropped",
          "breach.new", "config.drift", "certificate.signed", "digest.sent",
          # master data change requests (api/services/change_requests.py)
          "change_request.submitted", "change_request.approved", "change_request.rejected",
          "change_request.created", "change_request.failed", "change_request.cancelled",
          # approval workflow steps (api/services/workflow.py)
          "workflow.started", "workflow.step_waiting", "workflow.step_decided", "workflow.escalated",
          "workflow.completed")
# The step-level workflow events reach a webhook that names them, or "workflow.*"; "*" covers every other event. A
# wildcard subscription made before workflows existed so receives exactly what it did (one batch.approved per batch).
WORKFLOW_WILDCARD = "workflow.*"
TEST_EVENT = "webhook.test"
MAX_ATTEMPTS = 5
BACKOFF_SECONDS = 60
TIMEOUT_SECONDS = 10
# Keys that would carry SAP data rather than ids, names and numbers.
FORBIDDEN_KEYS = frozenset({
    "record_key", "record_keys", "value", "values", "current_value", "proposed_value", "previous_value",
    "new_value", "old_value", "field_values", "sample", "samples", "sample_keys", "sample_values",
    "element_value", "failing_record_values", "config_data",
})
MAX_STRING = 300


class UnsafePayload(ValueError):
    pass


def check_payload(obj: Any, path: str = "data") -> None:
    """Raise UnsafePayload unless ``obj`` holds only ids, names and numbers (no key that carries SAP values)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if not isinstance(k, str) or k in FORBIDDEN_KEYS:
                raise UnsafePayload(f"{path}.{k} may not be sent in a webhook payload")
            check_payload(v, f"{path}.{k}")
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            check_payload(v, f"{path}[{i}]")
    elif isinstance(obj, str):
        if len(obj) > MAX_STRING:
            raise UnsafePayload(f"{path} is longer than {MAX_STRING} characters")
    elif obj is not None and not isinstance(obj, (int, float, bool)):
        raise UnsafePayload(f"{path} is not a JSON scalar")


# ── secrets ──────────────────────────────────────────────────────────────────


def new_secret() -> str:
    return "whsec_" + secrets.token_urlsafe(32)


def seal(tenant_id: str, secret: str) -> str:
    """The secret as stored: AES-GCM under the credential key when the deployment has one, else as given."""
    if os.getenv("CREDENTIAL_MASTER_KEY"):
        from api.services.credential_store import encrypt_password
        return "enc:" + encrypt_password(str(tenant_id), secret)
    return secret


def unseal(tenant_id: str, stored: str) -> str:
    if stored.startswith("enc:"):
        from api.services.credential_store import decrypt_password
        return decrypt_password(str(tenant_id), stored[4:])
    return stored


def sign(secret: str, timestamp: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def verify(secret: str, timestamp: str, body: bytes, signature: str) -> bool:
    """What a receiver does: recompute the signature and compare in constant time."""
    return hmac.compare_digest(sign(secret, timestamp, body), signature)


def backoff(attempts: int) -> timedelta:
    """Wait after failed attempt ``attempts`` (1-based): 1, 2, 4, 8 minutes."""
    return timedelta(seconds=BACKOFF_SECONDS * 2 ** (attempts - 1))


# ── events ───────────────────────────────────────────────────────────────────


def emit(session, tenant_id: str, event: str, data: dict, *, webhook_id: str | None = None) -> list[str]:
    """Queue ``event`` for every active webhook subscribed to it (or only ``webhook_id``). Returns the delivery ids.
    The caller commits; nothing is sent here."""
    if event not in EVENTS and event != TEST_EVENT:
        raise ValueError(f"unknown webhook event: {event}")
    check_payload(data)
    from api.services.sandbox import held_back_sync
    if held_back_sync(session, tenant_id, "webhook", event, webhook_id):  # sandbox: nothing leaves (migration 115)
        return []
    hooks = [r[0] for r in session.execute(text(
        "SELECT id::text FROM webhooks WHERE tenant_id = :t AND (CAST(:w AS uuid) IS NULL OR id = CAST(:w AS uuid)) "
        "AND (active OR CAST(:w AS uuid) IS NOT NULL) AND (:e = ANY(events) OR :e = :test "
        "OR ('*' = ANY(events) AND :e NOT LIKE 'workflow.%') OR (:e LIKE 'workflow.%' AND :ww = ANY(events)))"),
        {"t": str(tenant_id), "w": webhook_id, "e": event, "test": TEST_EVENT, "ww": WORKFLOW_WILDCARD}).fetchall()]
    if not hooks:
        return []
    event_id = str(uuid.uuid4())
    envelope = {"id": event_id, "event": event, "created_at": datetime.now(timezone.utc).isoformat(),
                "tenant_id": str(tenant_id), "data": data}
    ids = []
    for h in hooks:
        ids.append(session.execute(text(
            "INSERT INTO webhook_deliveries (tenant_id, webhook_id, event, event_id, payload) "
            "VALUES (:t, CAST(:w AS uuid), :e, CAST(:i AS uuid), CAST(:p AS jsonb)) RETURNING id::text"),
            {"t": str(tenant_id), "w": h, "e": event, "i": event_id, "p": json.dumps(envelope, default=str)}).scalar())
    return ids


def emit_safe(session, tenant_id: str, event: str, data: dict) -> list[str]:
    """``emit`` in a savepoint: a webhook problem never costs the caller's transaction."""
    import logging
    try:
        with session.begin_nested():
            return emit(session, tenant_id, event, data)
    except Exception as e:  # noqa: BLE001 - events are best effort; the log names the event, never the payload
        logging.getLogger("meridian.webhooks").warning(f"webhook event {event} not queued: {type(e).__name__}: {e}")
        return []


def body_of(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()


def deliver_one(session, tenant_id: str, delivery_id: str, post: Callable[..., Any] | None = None,
                now: datetime | None = None) -> dict | None:
    """One attempt at one due delivery (row-locked; another worker's lock skips it). Returns the outcome, or None when
    the delivery is not due or not this tenant's. The caller commits."""
    now = now or datetime.now(timezone.utc)
    row = session.execute(text("""
        SELECT d.id::text, d.event, d.payload, d.attempts, w.url, w.secret, w.active
          FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id AND w.tenant_id = d.tenant_id
         WHERE d.id = CAST(:d AS uuid) AND d.tenant_id = :t AND d.status IN ('pending', 'retrying')
         FOR UPDATE OF d SKIP LOCKED"""), {"d": delivery_id, "t": str(tenant_id)}).mappings().first()
    if row is None:
        return None
    attempts = int(row["attempts"]) + 1
    code: int | None = None
    error: str | None = None
    if not row["active"] and row["event"] != TEST_EVENT:
        error = "webhook is inactive"
        attempts = MAX_ATTEMPTS
    else:
        body = body_of(row["payload"])
        ts = str(int(time.time()))
        headers = {"Content-Type": "application/json", "User-Agent": "Meridian-Webhooks/1",
                   "X-Meridian-Event": row["event"], "X-Meridian-Delivery": row["id"], "X-Meridian-Timestamp": ts,
                   "X-Meridian-Signature": sign(unseal(tenant_id, row["secret"]), ts, body)}
        if post is None:
            import requests
            post = requests.post
        try:
            resp = post(row["url"], data=body, headers=headers, timeout=TIMEOUT_SECONDS)
            code = int(resp.status_code)
            if not 200 <= code < 300:
                error = f"HTTP {code}"
        except Exception as e:  # noqa: BLE001 - any transport failure is a failed attempt; the URL is never logged
            error = type(e).__name__
    if error is None:
        status, nxt = "delivered", None
    elif attempts >= MAX_ATTEMPTS:
        status, nxt = "failed", None
    else:
        status, nxt = "retrying", now + backoff(attempts)
    session.execute(text("""
        UPDATE webhook_deliveries SET status = :s, attempts = :a, last_attempt_at = :now, response_code = :c,
               error = :err, next_attempt_at = :nxt, delivered_at = CASE WHEN :s = 'delivered' THEN :now END
         WHERE id = CAST(:d AS uuid) AND tenant_id = :t"""),
        {"s": status, "a": attempts, "now": now, "c": code, "err": error, "nxt": nxt, "d": delivery_id,
         "t": str(tenant_id)})
    return {"id": delivery_id, "status": status, "attempts": attempts, "response_code": code, "error": error,
            "next_attempt_at": nxt.isoformat() if nxt else None}


def due(session, tenant_id: str, now: datetime | None = None, limit: int = 200) -> list[str]:
    """Deliveries whose attempt is due; none while the tenant is in sandbox mode (they wait for the exit)."""
    from api.services.sandbox import is_sandbox_sync
    if is_sandbox_sync(session, tenant_id):
        return []
    now = now or datetime.now(timezone.utc)
    return [r[0] for r in session.execute(text(
        "SELECT id::text FROM webhook_deliveries WHERE tenant_id = :t AND status IN ('pending', 'retrying') "
        "AND (next_attempt_at IS NULL OR next_attempt_at <= :now) ORDER BY next_attempt_at NULLS FIRST, created_at "
        "LIMIT :n"), {"t": str(tenant_id), "now": now, "n": limit}).fetchall()]


# ── event builders (ids, names and numbers only) ─────────────────────────────


def _system_name(session, sid: str | None) -> str | None:
    if not sid:
        return None
    try:
        uuid.UUID(str(sid))
    except ValueError:
        return None
    return session.execute(text("SELECT name FROM sap_systems WHERE id = CAST(:s AS uuid)"), {"s": sid}).scalar()


def run_events(session, tenant_id: str, version_id: str) -> dict[str, int]:
    """run.finished for a finished run, plus score.dropped and breach.new against the previous finished run of the
    same system (the score thresholds are the tenant's automation settings)."""
    from api.services import automation_settings
    from api.services.receipt_math import breach_ids
    from api.services.version_status import finished_sql

    run = session.execute(text(
        "SELECT id::text, label, run_at, status, dqs_summary, metadata->>'system_id' AS sid FROM analysis_versions "
        "WHERE id = CAST(:v AS uuid) AND tenant_id = :t"), {"v": version_id, "t": str(tenant_id)}).mappings().first()
    if run is None:
        return {}
    summary = run["dqs_summary"] if isinstance(run["dqs_summary"], dict) else {}
    system = {"system_id": run["sid"], "system_name": _system_name(session, run["sid"])}
    objects = [{"module": m, "score": s.get("composite_score"), "raw_score": s.get("raw_score"),
                "breaches": len(breach_ids(s))} for m, s in sorted(summary.items()) if isinstance(s, dict)]
    out = {"run.finished": len(emit_safe(session, tenant_id, "run.finished", {
        "run_id": run["id"], "label": run["label"], "status": run["status"], "run_at": run["run_at"].isoformat(),
        **system, "objects": objects}))}
    prev = session.execute(text(f"""
        SELECT id::text, dqs_summary FROM analysis_versions
         WHERE tenant_id = :t AND {finished_sql()} AND id <> CAST(:v AS uuid) AND run_at < :at
           AND metadata->>'system_id' IS NOT DISTINCT FROM :sid
           AND metadata->>'archived' IS DISTINCT FROM 'true'
           AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
         ORDER BY run_at DESC LIMIT 1"""), {"t": str(tenant_id), "v": version_id, "at": run["run_at"],
                                            "sid": run["sid"]}).mappings().first()
    if prev is None:
        return out
    before = prev["dqs_summary"] if isinstance(prev["dqs_summary"], dict) else {}
    cfg = automation_settings.load_sync(session, tenant_id)["score_drop"]
    below, points = cfg.get("below"), cfg.get("points")
    dropped, new_breaches = [], []
    for m, s in sorted(summary.items()):
        b = before.get(m)
        if not isinstance(s, dict) or not isinstance(b, dict):
            continue
        now_s, was = s.get("composite_score"), b.get("composite_score")
        if now_s is not None and was is not None:
            fell = round(float(was) - float(now_s), 2)
            under = below is not None and float(now_s) < float(below) <= float(was)
            if under or (points is not None and fell > float(points)):
                dropped.append({"module": m, "score": now_s, "previous_score": was, "drop": fell,
                                "below_threshold": bool(under)})
        added = [c for c in breach_ids(s) if c not in breach_ids(b)]
        if added:
            new_breaches.append({"module": m, "rules": added})
    base = {"run_id": run["id"], "previous_run_id": prev["id"], **system}
    if dropped:
        out["score.dropped"] = len(emit_safe(session, tenant_id, "score.dropped", {
            **base, "threshold": {"below": below, "points": points}, "objects": dropped}))
    if new_breaches:
        out["breach.new"] = len(emit_safe(session, tenant_id, "breach.new", {**base, "objects": new_breaches}))
    return out


def run_failed(session, tenant_id: str, version_id: str) -> int:
    row = session.execute(text(
        "SELECT id::text, label, status, metadata->>'system_id' AS sid FROM analysis_versions "
        "WHERE id = CAST(:v AS uuid) AND tenant_id = :t"), {"v": version_id, "t": str(tenant_id)}).mappings().first()
    if row is None:
        return 0
    return len(emit_safe(session, tenant_id, "run.failed", {
        "run_id": row["id"], "label": row["label"], "status": row["status"], "system_id": row["sid"],
        "system_name": _system_name(session, row["sid"])}))


def batch_event(session, tenant_id: str, batch_id: str, event: str) -> int:
    """batch.waiting / batch.approved / batch.sent: the batch, its size and the objects and rules it touches."""
    b = session.execute(text(
        "SELECT id::text, name, status, created_by_label, approved_by_label FROM remediation_batches "
        "WHERE id = CAST(:b AS uuid) AND tenant_id = :t"), {"b": batch_id, "t": str(tenant_id)}).mappings().first()
    if b is None:
        return 0
    agg = session.execute(text(
        "SELECT count(*) AS items, count(DISTINCT record_key) AS records, array_agg(DISTINCT module) AS modules, "
        "array_agg(DISTINCT check_id) AS rules FROM remediation_items WHERE batch_id = CAST(:b AS uuid) AND tenant_id = :t"),
        {"b": batch_id, "t": str(tenant_id)}).mappings().first()
    return len(emit_safe(session, tenant_id, event, {
        "batch_id": b["id"], "name": b["name"], "status": b["status"], "items": int(agg["items"] or 0),
        "records": int(agg["records"] or 0), "modules": sorted(m for m in (agg["modules"] or []) if m),
        "rules": sorted(c for c in (agg["rules"] or []) if c)[:100],
        "created_by": b["created_by_label"], "approved_by": b["approved_by_label"]}))
