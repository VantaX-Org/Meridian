"""Tenant context middleware — sets app.tenant_id on request.state and a
ContextVar so get_db can set Postgres RLS automatically.
"""

import contextvars
import logging
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("meridian.tenant")

# ContextVar holds the current tenant_id for the duration of each request.
# Python propagates ContextVars to coroutines spawned within the same context,
# so get_db() can read it without receiving the Request object directly.
_tenant_id_var: contextvars.ContextVar[uuid.UUID | None] = contextvars.ContextVar(
    "meridian_tenant_id", default=None
)

# Dev tenant UUID — used when AUTH_MODE=local
_DEV_TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


def get_current_tenant_id() -> uuid.UUID | None:
    """Return the tenant ID for the current async context.

    Used by get_db() to set the Postgres RLS context variable before yielding
    the session. Returns None if called outside a request context.
    """
    return _tenant_id_var.get()


class TenantMiddleware(BaseHTTPMiddleware):
    """Middleware that resolves the current tenant and stores it on both
    ``request.state.tenant_id`` and a ContextVar readable by DB dependencies.

    Resolution order:
    1. request.state.tenant_id — set by upstream middleware (e.g. JWT decode)
    2. Dev tenant — when AUTH_MODE=local and no tenant is set
    """

    async def dispatch(self, request: Request, call_next):
        # Skip non-API routes (health, static files, etc.)
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        tenant_id: uuid.UUID | None = getattr(request.state, "tenant_id", None)

        if tenant_id is None:
            from api.config import settings  # deferred to avoid circular import

            if settings.auth_mode == "local":
                tenant_id = _DEV_TENANT_ID

        if tenant_id is not None:
            request.state.tenant_id = tenant_id

        token = _tenant_id_var.set(tenant_id)
        try:
            return await call_next(request)
        finally:
            _tenant_id_var.reset(token)
