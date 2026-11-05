"""Local authentication middleware — JWT verification for AUTH_MODE=local.

Checks every /api/* request (except excluded paths) for a valid Bearer token
signed with the jwt_secret of the tenant its ``tenant_id`` claim names, and makes that
verified claim the request's tenant (request.state.tenant_id / verified_tenant_id).
"""

import contextvars
import hmac
import logging
import os
import threading
import time
import uuid

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from api.services.api_keys import KEY_SCHEME, KeyRejected, resolve_key_sync
from api.services.local_auth import decode_access_token, token_version_claim
from api.services.rate_limiter import rate_limit

logger = logging.getLogger("meridian.local_auth")

AUTH_COOKIE = "mn_auth_token"  # the httponly session cookie the browser rides on
CSRF_COOKIE = "mn_csrf"  # readable by the page, which echoes it in CSRF_HEADER (double submit)
CSRF_HEADER = "x-csrf-token"
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Signing out needs no CSRF proof: forcing a sign-out is harmless, and a user whose CSRF cookie is lost must still
# be able to end the session and clear the cookie.
_CSRF_EXEMPT = {"/api/v1/auth/logout"}

DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001"  # the development tenant (api/deps.py DEV_TENANT_ID)

_EXCLUDED_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/accept-invite",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
    "/api/v1/auth/invite/preview",
    # OIDC sign-in: the browser is signed out until the callback, so these three are public (the callback
    # authenticates through the IdP; start and callback bind to a signed, 10-minute state cookie).
    "/api/v1/auth/oidc/config",
    "/api/v1/auth/oidc/start",
    "/api/v1/auth/oidc/callback",
    "/api/v1/licence",
    "/health",
    # Public before sign-in: the sign-in page's theme and logo, and the status page (api/routes/theme.py,
    # api/routes/status_page.py). They resolve the deployment's tenant themselves and disclose no user or record.
    "/api/v1/theme",
    "/api/v1/theme/logo",
    "/api/v1/status/page",
}

# Requests per minute per API key (a scheduler polling a job, not a bulk client).
_API_KEY_RATE_LIMIT = max(1, int(os.environ.get("API_KEY_RATE_LIMIT_PER_MIN", "600")))
_api_key_rate_limit = rate_limit("api_key", limit=_API_KEY_RATE_LIMIT, window_s=60, key_by="api_key")



def is_public_path(path: str) -> bool:
    """The paths this middleware serves without a token (sign-in, invite, theme, status page, licence)."""
    return path in _EXCLUDED_PATHS


# tenants.jwt_secret per tenant id, cached in memory so a request costs no DB read. Each tenant signs its own
# sessions; a token is verified with the secret of the tenant its tenant_id claim names, and the claim it then
# carries is the request's tenant. A rotated secret applies after a restart or forget_jwt_secret().
_jwt_secret_cache: dict[str, str] = {}
_jwt_secret_lock = threading.Lock()


def forget_jwt_secret(tenant_id: str | None = None) -> None:
    """Drop the cached signing secret of one tenant (or all), after a rotation in this process."""
    with _jwt_secret_lock:
        if tenant_id is None:
            _jwt_secret_cache.clear()
        else:
            _jwt_secret_cache.pop(str(tenant_id), None)


def _deployment_tenant() -> str:
    from api.deps import deployment_tenant_id

    return str(deployment_tenant_id())


def _load_jwt_secret_for(tenant_id: str) -> str | None:
    """tenants.jwt_secret of ``tenant_id`` from the DB (sync, cached); None when the tenant has none."""
    with _jwt_secret_lock:
        cached = _jwt_secret_cache.get(tenant_id)
    if cached:
        return cached
    try:
        import psycopg2

        db_url = os.environ.get("DATABASE_URL_SYNC", "")
        if not db_url:
            db_url = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "")
        if not db_url:
            return None
        conn = psycopg2.connect(db_url)
        try:
            cur = conn.cursor()
            cur.execute("SELECT jwt_secret FROM tenants WHERE id = %s", (tenant_id,))
            row = cur.fetchone()
            if row and row[0]:
                with _jwt_secret_lock:
                    _jwt_secret_cache[tenant_id] = row[0]
                return row[0]
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"Failed to load jwt_secret: {type(e).__name__}")
    return None


def _load_jwt_secret() -> str | None:
    """The signing secret of this deployment's own tenant (the single-tenant install's only tenant)."""
    return _load_jwt_secret_for(_deployment_tenant())


def _claimed_tenant(token: str) -> str | None:
    """The tenant_id claim of a token, read WITHOUT verification: only to choose whose secret verifies it.
    None when the token is not a JWT or names no valid tenant id."""
    try:
        import jwt as pyjwt

        claim = pyjwt.decode(token, options={"verify_signature": False}).get("tenant_id")
    except Exception:  # noqa: BLE001 - not a JWT: verification below refuses it
        return None
    return str(claim) if claim and _valid_uuid(claim) else None


def _secret_for(token: str) -> tuple[str | None, str | None]:
    """(secret, claimed tenant) for verifying ``token``: the claimed tenant's own secret; a token that names no
    tenant, or this deployment's tenant, is verified with the deployment tenant's secret."""
    claimed = _claimed_tenant(token)
    if claimed is None or claimed == _deployment_tenant():
        return _load_jwt_secret(), claimed
    return _load_jwt_secret_for(claimed), claimed


# users.token_version per user id, cached briefly so session revocation costs at most one indexed
# lookup per user every few seconds rather than one per request. A bump in this process drops the
# entry at once (forget_token_version); other API processes see it within the TTL.
_TOKEN_VERSION_TTL_S = 5.0
_token_version_cache: dict[str, tuple[int | None, float]] = {}
_token_version_lock = threading.Lock()


class TokenVersionUnavailable(Exception):
    """The users row could not be read (database down, schema not migrated)."""


def forget_token_version(user_id: str) -> None:
    """Drop a cached token version after the column changed in this process."""
    with _token_version_lock:
        _token_version_cache.pop(str(user_id), None)


def _lookup_token_version(user_id: str, tenant_id: str) -> int | None:
    """users.token_version for the user, or None when no such user exists."""
    from sqlalchemy import text

    from api.deps import get_sync_engine_or_create

    try:
        with get_sync_engine_or_create().begin() as conn:
            conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tenant_id})
            row = conn.execute(
                text("SELECT token_version FROM users WHERE id = :uid AND tenant_id = :tid"),
                {"uid": user_id, "tid": tenant_id},
            ).fetchone()
    except Exception as e:
        raise TokenVersionUnavailable(str(e)) from e
    return int(row[0]) if row else None


def _current_token_version(user_id: str, tenant_id: str) -> int | None:
    """The user's current token version (cached for _TOKEN_VERSION_TTL_S), or None for no such user."""
    now = time.monotonic()
    with _token_version_lock:
        hit = _token_version_cache.get(user_id)
    if hit and hit[1] > now:
        return hit[0]
    version = _lookup_token_version(user_id, tenant_id)
    with _token_version_lock:
        _token_version_cache[user_id] = (version, now + _TOKEN_VERSION_TTL_S)
    return version


def _valid_uuid(value: object) -> bool:
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


# Authenticated user for the current request — lets services attribute
# approvals/audit rows to the real user without threading `request` through.
_current_user: contextvars.ContextVar[dict | None] = contextvars.ContextVar("current_user", default=None)


def get_current_user() -> dict | None:
    return _current_user.get()


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

        # Extract Bearer token (header first). A cookie-authenticated request is the browser's session: it must
        # also prove it came from our own page (CSRF) unless it only reads. Bearer-authenticated requests
        # (API keys, SCIM, scripts) carry no ambient credential, so they need no such proof.
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer " + KEY_SCHEME):
            return await self._dispatch_api_key(request, call_next, auth_header[7:])
        if auth_header.startswith("Bearer "):
            return await self._session(request, call_next, auth_header[7:])

        token = request.cookies.get(AUTH_COOKIE, "")
        if not token:
            return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
        if request.method not in _SAFE_METHODS and path not in _CSRF_EXEMPT:
            sent, have = request.headers.get(CSRF_HEADER, ""), request.cookies.get(CSRF_COOKIE, "")
            if not have or not hmac.compare_digest(sent.encode(), have.encode()):
                return JSONResponse(status_code=403, content={
                    "detail": "Your session could not be confirmed. Reload the page and try again."})
        reached = False

        async def forward(req):
            nonlocal reached
            reached = True
            return await call_next(req)

        resp = await self._session(request, forward, token)
        if resp.status_code == 401 and not reached:
            # This middleware refused the cookie (expired, revoked): drop it so the browser is cleanly signed out.
            # A 401 from a route behind us is that route's business and leaves the session alone.
            for name in (AUTH_COOKIE, CSRF_COOKIE):
                resp.delete_cookie(name, path="/", samesite="lax", httponly=name == AUTH_COOKIE)
        return resp

    async def _session(self, request, call_next, token: str):
        """Verify a session JWT and run the request as its user (the tenant is the token's)."""
        # The secret of the tenant the token names (each tenant signs its own sessions)
        secret, claimed = _secret_for(token)
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

        # Single-purpose tokens (invite, password reset) are never session tokens.
        if payload.get("purpose"):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired token"},
            )

        # Session revocation: a password change or reset, or deactivation, bumps users.token_version;
        # a token issued before that (a lower ``tv``; none counts as 0) is no longer a session.
        user_id = payload.get("sub")
        tenant_id = payload.get("tenant_id")
        if not tenant_id:
            # Every session token names its tenant. One without the claim is accepted only by a development
            # deployment, for its own tenant; anywhere else it could land in a tenant it was never issued for.
            from api.config import settings

            if settings.env != "development":
                return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})
            tenant_id = _deployment_tenant()
        if not _valid_uuid(user_id) or not _valid_uuid(tenant_id):
            return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})
        if claimed is not None and str(tenant_id) != claimed:
            return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})
        try:
            current = await run_in_threadpool(_current_token_version, str(user_id), str(tenant_id))
        except TokenVersionUnavailable as e:
            # Not a 401: the frontend signs the user out on any 401, and this is the server's fault.
            logger.warning(f"Could not check session revocation: {e}")
            return JSONResponse(status_code=503, content={"detail": "Authentication check unavailable"})
        if current is None or token_version_claim(payload) < current:
            return JSONResponse(
                status_code=401,
                content={"detail": "Session has been revoked. Sign in again."},
            )

        # The verified tenant: TenantMiddleware sets RLS from it and get_tenant returns it.
        request.state.tenant_id = uuid.UUID(str(tenant_id))
        request.state.verified_tenant_id = request.state.tenant_id
        # Set user info on request state for downstream use
        request.state.local_user_id = payload.get("sub")
        request.state.local_user_email = payload.get("email")
        # Informational only: the role claim is a sign-in snapshot. Authorisation reads users.role and the
        # grants from the database on every request (rbac._get_user_role), so a grant change applies at once.
        request.state.local_user_role = payload.get("role")
        _current_user.set({"id": payload.get("sub"), "email": payload.get("email")})

        return await call_next(request)


    async def _dispatch_api_key(self, request, call_next, token: str):
        """Authenticate ``Bearer mk_<prefix>.<secret>`` as the key's service user.

        Sets the same request state as a session, so every guard (require_permission, scopes) reads the service
        user's own grants from the database; a key adds no permission of its own and has no cookie or token
        version. Revoked, expired and suspended keys answer 401 with a plain sentence."""
        try:
            # API keys belong to this deployment's tenant (the key carries no tenant of its own).
            key = await run_in_threadpool(resolve_key_sync, token, _deployment_tenant())
        except KeyRejected as e:
            return JSONResponse(status_code=401, content={"detail": e.detail})
        except Exception as e:  # noqa: BLE001 - database down or not migrated: the server's fault, not a 401
            logger.warning(f"Could not check API key: {type(e).__name__}")
            return JSONResponse(status_code=503, content={"detail": "Authentication check unavailable"})

        request.state.api_key_id = key.key_id
        request.state.tenant_id = uuid.UUID(key.tenant_id)
        request.state.verified_tenant_id = request.state.tenant_id
        try:
            await _api_key_rate_limit(request)
        except HTTPException as e:
            return JSONResponse(status_code=e.status_code, headers=e.headers,
                                content={"detail": "Too many requests for this API key. Try again in a minute."})

        request.state.local_user_id = key.user_id
        request.state.local_user_email = key.email
        request.state.local_user_role = key.role
        _current_user.set({"id": key.user_id, "email": key.email})
        return await call_next(request)
