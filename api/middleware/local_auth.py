"""Local authentication middleware — JWT verification for AUTH_MODE=local.

Checks every /api/* request (except excluded paths) for a valid Bearer token
signed with the tenant's jwt_secret.
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from api.services.local_auth import decode_access_token

logger = logging.getLogger("meridian.local_auth")

DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001"

_EXCLUDED_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/licence",
    "/health",
}

# Cache jwt_secret in memory to avoid DB hit on every request
_jwt_secret_cache: dict[str, str] = {}


def _load_jwt_secret() -> str | None:
    """Load jwt_secret from DB (sync) and cache it."""
    cached = _jwt_secret_cache.get(DEV_TENANT_ID)
    if cached:
        return cached

    try:
        import psycopg2
        import os

        db_url = os.environ.get("DATABASE_URL_SYNC", "")
        if not db_url:
            db_url = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "")
        if not db_url:
            return None

        # Parse the SQLAlchemy URL to psycopg2 format
        # postgresql://user:pass@host:port/db -> same format works for psycopg2
        conn = psycopg2.connect(db_url)
        try:
            cur = conn.cursor()
            cur.execute("SELECT jwt_secret FROM tenants WHERE id = %s", (DEV_TENANT_ID,))
            row = cur.fetchone()
            if row and row[0]:
                _jwt_secret_cache[DEV_TENANT_ID] = row[0]
                return row[0]
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"Failed to load jwt_secret: {e}")

    return None


class LocalAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path

        # Skip non-API paths
        if not path.startswith("/api/"):
            return await call_next(request)

        # Skip excluded paths
        if path in _EXCLUDED_PATHS:
            return await call_next(request)
        
        # Allow CORS preflight requests through
        if request.method == "OPTIONS":
            return await call_next(request)

        # Extract Bearer token
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"detail": "Not authenticated"},
            )

        token = auth_header[7:]

        # Get jwt_secret
        secret = _load_jwt_secret()
        if not secret:
            return JSONResponse(
                status_code=401,
                content={"detail": "Not authenticated"},
            )

        # Decode and verify
        payload = decode_access_token(token, secret)
        if not payload:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired token"},
            )

        # Set user info on request state for downstream use
        request.state.local_user_id = payload.get("sub")
        request.state.local_user_email = payload.get("email")
        request.state.local_user_role = payload.get("role")

        return await call_next(request)
