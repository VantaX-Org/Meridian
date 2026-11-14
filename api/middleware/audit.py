"""Audit middleware — logs every state-changing API request to the audit_log table.

Mutations (POST, PUT, PATCH, DELETE on /api/v1/*, excluding auth + licence): the row fires after the handler
returns so it can capture the final status code, in a background thread tracked so `flush_pending_audits` can
drain it on shutdown. Security events (_SECURITY_PREFIXES) also get a write-ahead row before the handler runs; when
it cannot be written the request is refused with 503.

Downloads (a GET answering a file): the row is written before the body is released; when it cannot be, the
download is withheld with 503.

Every row joins the tenant's hash chain (migration 175, api/services/audit_chain.py).
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
from starlette.responses import JSONResponse, Response

logger = logging.getLogger("meridian.audit")

# Tracks in-flight fire-and-forget audit tasks so graceful shutdown can
# await them rather than dropping the tail of the log. Tasks remove
# themselves via a done-callback when they finish.
_pending_audit_tasks: set[asyncio.Task[bool]] = set()


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
        # wait_for cancels the gather (and its child tasks) on timeout, so the
        # stuck writes are abandoned here. Count them from `pending` directly —
        # the done-callback may already have discarded them from the set.
        logger.warning(
            f"audit flush timed out after {timeout}s with "
            f"{sum(1 for t in pending if not t.done())} tasks still pending"
        )
    # Only tasks whose write genuinely finished count as drained — a task
    # cancelled by the timeout above did NOT persist its audit row, so it must
    # not inflate the count.
    return sum(
        1 for t in pending if t.done() and not t.cancelled() and t.exception() is None
    )

_AUDITED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Paths we never want to audit — login/logout flood + high-volume feedback loops.
_EXCLUDED_PREFIXES = (
    "/api/v1/auth/",
    "/api/v1/licence",
    "/api/v1/events",
    # The route writes its own client_error row.
    "/api/v1/client-errors",
    # The create response carries the one-time API key; the routes write their own api_key.* rows.
    "/api/v1/admin/api-keys",
    # The body carries the data subject's record key; the routes write their own rows with a keyed hash only.
    "/api/v1/admin/subject-requests",
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
    return _audited_path(request.url.path)


def _audited_path(path: str) -> bool:
    if not path.startswith("/api/v1/"):
        return False
    for prefix in _EXCLUDED_PREFIXES:
        if path.startswith(prefix):
            return False
    return True


# Keys whose value is a secret: masked before the body reaches audit_log. "credentials" holds the SAP password and
# the OAuth client id/secret of a system (POST/PUT /systems, the test-connection routes), so all its values go.
_SECRET_KEY_RE = re.compile(r"(password|passwd|secret|api_?key|private_?key|(^|_)token$|^credentials$|^client_id$)",
                            re.IGNORECASE)


def _redact(value: Any) -> Any:
    """``value`` with every secret-named key's value replaced by "****", at any depth."""
    if isinstance(value, dict):
        return {k: ("****" if value[k] not in (None, "") else value[k]) if _SECRET_KEY_RE.search(str(k))
                else _redact(value[k]) for k in value}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


def _truncate_json(body: bytes | None, limit: int = 16_000) -> Any:
    """Best-effort parse + truncate + secret redaction for audit storage. Never raises."""
    if not body:
        return None
    if len(body) > limit:
        return {"_truncated": True, "bytes": len(body)}
    try:
        return _redact(json.loads(body.decode("utf-8")))
    except Exception:
        return None


def _insert_audit_row(row: dict) -> None:
    """Synchronous insert via the shared workers engine. Raises when the row is not written: a caller that must not
    fail on it (the server-error handler, the post-commit mutation row) uses ``_insert_audit_row_quiet``.

    An actor id with no users row (a token for a removed or never-provisioned user) is written as NULL with the
    email kept, so the row is never lost to the actor foreign key."""
    from sqlalchemy.exc import IntegrityError

    try:
        _insert_audit_row_once(row)
    except IntegrityError as e:
        if row.get("actor_user_id") is None or "audit_log_actor_user_id_fkey" not in str(e.orig):
            raise
        _insert_audit_row_once({**row, "actor_user_id": None})


def _insert_audit_row_once(row: dict) -> None:
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


def _insert_audit_row_quiet(row: dict) -> bool:
    """``_insert_audit_row`` that logs a failure at ERROR instead of raising. True when the row was written."""
    try:
        _insert_audit_row(row)
        return True
    except Exception as e:
        logger.error("audit_log insert failed for %s %s: %s", row.get("method"), row.get("path"), type(e).__name__)
        return False


# Mutations under these prefixes are security events: the middleware writes their audit row BEFORE the handler runs
# (status_code 0 = attempted) and refuses the request with 503 when it cannot, so no such change happens unaudited.
# The outcome row follows after the handler as for every other mutation.
_SECURITY_PREFIXES = (
    "/api/v1/admin/",
    "/api/v1/users",
    "/api/v1/roles",
    "/api/v1/rbac",
    "/api/v1/systems",
    "/api/v1/settings",
    "/api/v1/retention",
    "/api/v1/webhooks",
    "/api/v1/sso",
    "/api/v1/scim",
    "/api/v1/audit",
)

# A GET whose response is one of these (or carries Content-Disposition) is a download: who took it, what and how
# many rows are written to audit_log before the body is released.
_DOWNLOAD_TYPES = (
    "application/pdf", "text/csv", "application/zip", "application/octet-stream", "application/xml",
    "application/vnd.", "application/x-ndjson", "image/",
)


# /export, /export/<format>, /export.json, /download: not /exports/options or /export-options.
_EXPORT_PATH_RE = re.compile(r"/(export|download)(/|\.|$)")


def _is_download(response: Response, path: str) -> bool:
    ctype = (response.headers.get("content-type") or "").lower()
    if ctype.startswith("text/event-stream"):
        return False
    disposition = (response.headers.get("content-disposition") or "").lower()
    return ("attachment" in disposition or "filename" in disposition or ctype.startswith(_DOWNLOAD_TYPES)
            or bool(_EXPORT_PATH_RE.search(path)) or path.endswith((".pdf", ".xlsx", ".csv", ".zip", ".pptx")))


def _filename(disposition: str) -> str | None:
    m = re.search(r'filename="?([^";]+)"?', disposition or "")
    return m.group(1) if m else None


def _row_count(response: Response, body: bytes) -> int | None:
    """Rows in the download: the route's X-Row-Count / X-Total-Count header, else the CSV data lines."""
    for h in ("x-row-count", "x-total-count"):
        v = response.headers.get(h)
        if v and v.isdigit():
            return int(v)
    if (response.headers.get("content-type") or "").lower().startswith("text/csv"):
        lines = body.count(b"\n") + (0 if body.endswith(b"\n") or not body else 1)
        return max(lines - 1, 0)  # minus the header line
    return None


def _query(request: Request) -> dict[str, Any]:
    return _redact(dict(request.query_params))


def _base_row(request: Request, tenant_id: uuid.UUID, status_code: int, action: str) -> dict:
    actor_user_id = getattr(request.state, "local_user_id", None)
    entity_type, entity_id = _derive_entity(request.url.path)
    ip = request.client.host if request.client else None
    # Respect X-Forwarded-For when behind a proxy (customer deployments).
    xff = request.headers.get("x-forwarded-for")
    if xff:
        ip = xff.split(",")[0].strip()
    return {
        "tenant_id": tenant_id,
        "actor_user_id": uuid.UUID(str(actor_user_id)) if actor_user_id else None,
        "actor_email": getattr(request.state, "local_user_email", None),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "method": request.method,
        "path": request.url.path,
        "status_code": status_code,
        "ip": ip,
        "user_agent": request.headers.get("user-agent"),
        "before_json": None,
        "after_json": None,
    }


def _refused() -> Response:
    return JSONResponse(status_code=503, content={"detail": "The audit log cannot be written, so this request was "
                                                            "not carried out. Try again shortly."})


async def _buffer(response: Response) -> bytes:
    body = b""
    if hasattr(response, "body_iterator"):
        chunks = [chunk async for chunk in response.body_iterator]  # type: ignore[attr-defined]
        body = b"".join(chunks)

        async def _again():
            yield body

        response.body_iterator = _again()  # type: ignore[attr-defined]
    return body


class AuditMiddleware(BaseHTTPMiddleware):
    """Append an audit_log row after every state-changing request."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method == "GET" and _audited_path(path):
            return await self._download(request, call_next)
        if not _should_audit(request):
            return await call_next(request)

        # Capture request body for before/after snapshot. Starlette consumes
        # the receive-stream as it parses the body, so we have to re-inject it.
        raw_body = await request.body()

        async def _receive():
            return {"type": "http.request", "body": raw_body, "more_body": False}

        request._receive = _receive  # type: ignore[attr-defined]

        action = _derive_action(request.method, path, 200)
        tenant_id: uuid.UUID | None = getattr(request.state, "tenant_id", None)
        if tenant_id is not None and path.startswith(_SECURITY_PREFIXES):
            attempt = {**_base_row(request, tenant_id, 0, action), "before_json": _truncate_json(raw_body)}
            try:
                await asyncio.to_thread(_insert_audit_row, attempt)
            except Exception as e:
                logger.error("audit write-ahead failed for %s %s (%s): refused", request.method, path,
                             type(e).__name__)
                return _refused()

        response: Response = await call_next(request)

        # Skip non-2xx writes — failed writes don't reflect a real state change.
        # 4xx/5xx still show in LLM/other logs; keep audit focused on success.
        if response.status_code >= 400:
            return response

        tenant_id = getattr(request.state, "tenant_id", None)
        if tenant_id is None:
            return response

        response_body = await _buffer(response)
        row = {
            **_base_row(request, tenant_id, response.status_code,
                        _derive_action(request.method, path, response.status_code)),
            "before_json": _truncate_json(raw_body),
            "after_json": _truncate_json(response_body)
            if os.environ.get("AUDIT_STORE_RESPONSE", "false").lower() == "true"
            else None,
        }

        # The change is committed by now, so a failed row cannot undo it: it is logged at ERROR. Security events
        # already have their write-ahead row. Tracked so flush_pending_audits() can drain on shutdown.
        task = asyncio.create_task(asyncio.to_thread(_insert_audit_row_quiet, row))
        _pending_audit_tasks.add(task)
        task.add_done_callback(_pending_audit_tasks.discard)

        return response

    async def _download(self, request: Request, call_next) -> Response:
        """Audit a GET download before its body leaves: who, what (path, query, file) and how many rows. A download
        whose row cannot be written is withheld with 503. A route that wrote its own export row sets
        ``request.state.audit_written`` and is not counted twice."""
        response: Response = await call_next(request)
        tenant_id: uuid.UUID | None = getattr(request.state, "tenant_id", None)
        if (response.status_code >= 400 or tenant_id is None or getattr(request.state, "audit_written", False)
                or not _is_download(response, request.url.path)):
            return response
        # ponytail: buffers the whole download in memory to count its rows and release it only after the audit
        # row is in; stream with a header-only row count if exports grow past a few hundred MB.
        body = await _buffer(response)
        disposition = response.headers.get("content-disposition") or ""
        row = {**_base_row(request, tenant_id, response.status_code, "download"),
               "after_json": {"query": _query(request), "filename": _filename(disposition),
                              "content_type": response.headers.get("content-type"), "bytes": len(body),
                              "row_count": _row_count(response, body)}}
        try:
            await asyncio.to_thread(_insert_audit_row, row)
        except Exception as e:
            logger.error("download audit failed for %s (%s): withheld", request.url.path, type(e).__name__)
            return _refused()
        return response
