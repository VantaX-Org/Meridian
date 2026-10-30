"""Central handler for unhandled exceptions: a reference code instead of a bare 500."""

from __future__ import annotations

import asyncio
import logging
import secrets
import uuid

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger("meridian.server_error")


def _write_audit(tenant_id: uuid.UUID, request: Request, code: str) -> None:
    from api.middleware.audit import _insert_audit_row  # swallows its own DB failures

    _insert_audit_row({
        "tenant_id": tenant_id,
        "actor_user_id": None,
        "actor_email": getattr(request.state, "local_user_email", None),
        "action": "server_error",
        "entity_type": "request",
        "entity_id": code,
        "method": request.method,
        "path": request.url.path,
        "status_code": 500,
        "ip": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
        "before_json": None,
        "after_json": {"reference": code},
    })


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log the traceback under a short code, audit it, and answer with JSON (never the stack)."""
    code = secrets.token_hex(4)
    tenant_id = getattr(request.state, "tenant_id", None)
    logger.error(
        "Unhandled server error ref=%s tenant=%s path=%s",
        code, tenant_id, request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    if tenant_id is not None:
        try:
            await asyncio.to_thread(_write_audit, tenant_id, request, code)
        except Exception:  # the DB may be the failure; the response must still go out
            logger.warning("server_error audit write failed ref=%s", code)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Something went wrong on the server. Reference {code}.", "reference": code},
    )


def server_failure(message: str, *, log: logging.Logger | None = None, what: str = "request") -> HTTPException:
    """A 500 for a handled failure: log the active traceback under a short code, answer a sentence and the code.

    Call it inside ``except``: ``raise server_failure("The PDF could not be built.", log=logger, what="pdf") from None``.
    The caller reads ``"<message> Reference <code>."``; the traceback stays in the log under the same code.
    """
    code = secrets.token_hex(4)
    (log or logger).exception("Handled server error ref=%s (%s)", code, what)
    return HTTPException(status_code=500, detail=f"{message} Reference {code}.")
