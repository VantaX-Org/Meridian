"""Audit middleware — logs every state-changing API request to the audit_log table.

Fires after the handler returns so it can capture the final status code.
Runs the DB insert in a background thread (fire-and-forget) so it never
blocks the response, and tracks in-flight writes so `flush_pending_audits`
can drain them on shutdown (called from FastAPI's lifespan teardown).

Scope: POST, PUT, PATCH, DELETE on /api/v1/* (excluding auth + licence).
Entity type / id are derived from the URL path when possible
(e.g. /api/v1/rules/abc-123 -> entity_type="rules", entity_id="abc-123").
"""

import asyncio
import json
import logging
import os
import re
import uuid
from typing import Any

from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("meridian.audit")

# Tracks in-flight fire-and-forget audit tasks so graceful shutdown can
# await them rather than dropping the tail of the log. Tasks remove
# themselves via a done-callback when they finish.
_pending_audit_tasks: set[asyncio.Task[None]] = set()


async def flush_pending_audits(timeout: float = 10.0) -> int:
    """Wait for outstanding audit writes to finish. Returns count drained.

    Called from the FastAPI lifespan's shutdown branch so workers can
    finish before the process exits. Bounded by `timeout` (seconds) so a
    stuck DB can't hang the pod indefinitely."""
    if not _pending_audit_tasks:
        return 0
    pending = list(_pending_audit_tasks)
    try:
        await asyncio.wait_for(
            asyncio.gather(*pending, return_exceptions=True),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        logger.warning(
            f"audit flush timed out after {timeout}s with "
            f"{len(_pending_audit_tasks)} tasks still pending"
        )
    return len(pending) - len(_pending_audit_tasks)

_AUDITED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Paths we never want to audit — login/logout flood + high-volume feedback loops.
_EXCLUDED_PREFIXES = (
    "/api/v1/auth/",
    "/api/v1/licence",
    "/api/v1/events",
)

# UUID-like segment so we can pull entity id out of REST paths.
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _derive_entity(path: str) -> tuple[str | None, str | None]:
    """Extract entity_type and entity_id from a REST path."""
    parts = [p for p in path.split("/") if p]
    # Expected shape: api v1 <resource> [<id>] [<sub>]
    if len(parts) < 3 or parts[0] != "api" or parts[1] != "v1":
        return (None, None)
    entity_type = parts[2]
    entity_id: str | None = None
    if len(parts) >= 4:
        cand = parts[3]
        if _UUID_RE.match(cand) or cand.isdigit():
            entity_id = cand
    return (entity_type, entity_id)


def _derive_action(method: str, path: str, status_code: int) -> str:
    """Derive a human-readable verb from the HTTP method + path tail."""
    parts = [p for p in path.split("/") if p]
    tail = parts[-1] if parts else ""
    # Map trailing verbs like /test, /retry, /register, /invite to the verb.
    if method == "POST" and tail and not _UUID_RE.match(tail) and not tail.isdigit():
        return tail
    verb_map = {
        "POST": "create",
        "PUT": "update",
        "PATCH": "update",
        "DELETE": "delete",
    }
    return verb_map.get(method, method.lower())


def _should_audit(request: Request) -> bool:
    if request.method not in _AUDITED_METHODS:
        return False
    path = request.url.path
    if not path.startswith("/api/v1/"):
        return False
    for prefix in _EXCLUDED_PREFIXES:
        if path.startswith(prefix):
            return False
    return True


def _truncate_json(body: bytes | None, limit: int = 16_000) -> Any:
    """Best-effort parse + truncate for audit storage. Never raises."""
    if not body:
        return None
    if len(body) > limit:
        return {"_truncated": True, "bytes": len(body)}
    try:
        return json.loads(body.decode("utf-8"))
    except Exception:
        return None


def _insert_audit_row(row: dict) -> None:
    """Synchronous insert via the shared workers engine. Fire-and-forget."""
    try:
        from workers.db import get_sync_engine

        engine = get_sync_engine()
        with engine.begin() as conn:
            # RLS: set tenant context so the audit_log_rls policy admits the row.
            conn.execute(
                text("SET LOCAL app.tenant_id = :tid"),
                {"tid": str(row["tenant_id"])},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO audit_log (
                        tenant_id, actor_user_id, actor_email, action,
                        entity_type, entity_id, method, path, status_code,
                        ip, user_agent, before_json, after_json
                    ) VALUES (
                        :tenant_id, :actor_user_id, :actor_email, :action,
                        :entity_type, :entity_id, :method, :path, :status_code,
                        :ip, :user_agent,
                        CAST(:before_json AS JSONB), CAST(:after_json AS JSONB)
                    )
                    """
                ),
                {
                    **row,
                    "before_json": json.dumps(row["before_json"])
                    if row.get("before_json") is not None
                    else None,
                    "after_json": json.dumps(row["after_json"])
                    if row.get("after_json") is not None
                    else None,
                },
            )
    except Exception as e:
        # Auditing must never break the request. Log and swallow.
        logger.warning(f"audit_log insert failed: {e}")


class AuditMiddleware(BaseHTTPMiddleware):
    """Append an audit_log row after every state-changing request."""

    async def dispatch(self, request: Request, call_next):
        if not _should_audit(request):
            return await call_next(request)

        # Capture request body for before/after snapshot. Starlette consumes
        # the receive-stream as it parses the body, so we have to re-inject it.
        raw_body = await request.body()

        async def _receive():
            return {"type": "http.request", "body": raw_body, "more_body": False}

        request._receive = _receive  # type: ignore[attr-defined]

        response: Response = await call_next(request)

        # Skip non-2xx writes — failed writes don't reflect a real state change.
        # 4xx/5xx still show in LLM/other logs; keep audit focused on success.
        if response.status_code >= 400:
            return response

        tenant_id: uuid.UUID | None = getattr(request.state, "tenant_id", None)
        if tenant_id is None:
            return response

        # Actor — populated by LocalAuthMiddleware when AUTH_MODE=local.
        actor_user_id = getattr(request.state, "local_user_id", None)
        actor_email = getattr(request.state, "local_user_email", None)

        # Response body: buffer it so we can re-serve it while keeping a copy.
        # Starlette's response is already built; we only need it when small.
        response_body = b""
        if hasattr(response, "body_iterator"):
            chunks = []
            async for chunk in response.body_iterator:  # type: ignore[attr-defined]
                chunks.append(chunk)
            response_body = b"".join(chunks)

            async def _new_iterator():
                yield response_body

            response.body_iterator = _new_iterator()  # type: ignore[attr-defined]

        entity_type, entity_id = _derive_entity(request.url.path)
        action = _derive_action(request.method, request.url.path, response.status_code)

        ip = request.client.host if request.client else None
        # Respect X-Forwarded-For when behind a proxy (customer deployments).
        xff = request.headers.get("x-forwarded-for")
        if xff:
            ip = xff.split(",")[0].strip()

        row = {
            "tenant_id": tenant_id,
            "actor_user_id": uuid.UUID(actor_user_id) if actor_user_id else None,
            "actor_email": actor_email,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "ip": ip,
            "user_agent": request.headers.get("user-agent"),
            "before_json": _truncate_json(raw_body),
            "after_json": _truncate_json(response_body)
            if os.environ.get("AUDIT_STORE_RESPONSE", "false").lower() == "true"
            else None,
        }

        # Fire-and-forget so we don't block the response, but track it so
        # flush_pending_audits() can drain on shutdown.
        task = asyncio.create_task(asyncio.to_thread(_insert_audit_row, row))
        _pending_audit_tasks.add(task)
        task.add_done_callback(_pending_audit_tasks.discard)

        return response
