"""Unified rate limiter — FastAPI dependency backed by a Redis fixed-window counter.

Replaces the three ad-hoc Redis rate-limit snippets previously scattered
across api/routes/connect.py, api/routes/glossary.py, and
api/services/ai_glossary_enricher.py — those remain (backwards-compatible)
but any *new* route should use `rate_limit(...)` as a FastAPI dependency.

Usage:

    from api.services.rate_limiter import rate_limit

    @router.post("/upload", dependencies=[Depends(rate_limit("upload", limit=60, window_s=60))])
    async def upload(...):
        ...

The default keying is tenant_id; pass `key_by="ip"` for unauthenticated
endpoints (login, health-probe introspection). Failure-open semantics:
when Redis is unreachable the limiter logs a warning and allows the
request, so a Redis outage never hard-fails the API — we'd rather accept
the abuse risk than take the whole product down.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Callable, Literal

from fastapi import HTTPException, Request

from api.middleware.cache import get_redis

logger = logging.getLogger("meridian.rate_limit")

KeyBy = Literal["tenant", "ip"]


def _current_window(window_s: int) -> int:
    """Fixed-window bucket index — all requests in the same N-second window share a counter."""
    return int(time.time() // window_s)


def _resolve_key(request: Request, name: str, key_by: KeyBy, window_s: int) -> str | None:
    """Build the Redis key for this request's bucket, or return None when we
    can't identify a caller (e.g. tenant key_by with no tenant_id yet)."""
    window = _current_window(window_s)

    if key_by == "tenant":
        tenant_id = getattr(request.state, "tenant_id", None)
        if tenant_id is None:
            # No tenant context — fall back to IP so unauthenticated callers
            # still get bounded.
            identifier = _client_ip(request) or "anon"
            return f"ratelimit:{name}:ip:{identifier}:{window}"
        return f"ratelimit:{name}:tenant:{tenant_id}:{window}"

    if key_by == "ip":
        identifier = _client_ip(request) or "anon"
        return f"ratelimit:{name}:ip:{identifier}:{window}"

    return None


# Number of trusted reverse proxies in front of the API (1 = the bundled
# nginx). The real client IP is the Nth entry from the RIGHT of
# X-Forwarded-For — every entry further left is appended by an untrusted hop
# and is attacker-controllable, so trusting the leftmost entry let anyone
# spoof their IP and dodge per-IP rate limits. Override only if you add proxy
# layers (e.g. Cloudflare in front of nginx → 2).
_TRUSTED_PROXY_HOPS = max(0, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))


def _client_ip(request: Request) -> str | None:
    if _TRUSTED_PROXY_HOPS > 0:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            chain = [p.strip() for p in xff.split(",") if p.strip()]
            if chain:
                # Nth from the right; clamp to the leftmost if the chain is
                # shorter than expected (misconfigured proxy) — still bounded.
                idx = min(_TRUSTED_PROXY_HOPS, len(chain))
                return chain[-idx]
    if request.client is not None:
        return request.client.host
    return None


def rate_limit(
    name: str,
    *,
    limit: int,
    window_s: int = 60,
    key_by: KeyBy = "tenant",
) -> Callable:
    """Return a FastAPI dependency that enforces `limit` requests per `window_s` seconds.

    - `name` namespaces the counter so two routes don't collide.
    - `limit` is a hard ceiling; the (limit+1)th call in the same window
      raises 429 with a Retry-After header pointing at the next window edge.
    - `key_by="tenant"` is per-tenant (falls back to IP for unauth calls);
      `key_by="ip"` is strict per-IP for login-style endpoints.
    """

    async def _dependency(request: Request) -> None:
        key = _resolve_key(request, name, key_by, window_s)
        if key is None:
            return

        redis_client = get_redis()
        if redis_client is None:
            logger.debug(f"rate_limit[{name}]: Redis unavailable — allowing request")
            return

        try:
            count = redis_client.incr(key)
            if count == 1:
                # First hit in this window — set the TTL so the key expires
                # when the window ends, +1s grace to avoid clock-skew edge cases.
                redis_client.expire(key, window_s + 1)
        except Exception as e:
            logger.warning(f"rate_limit[{name}] Redis error: {e} — allowing request")
            return

        if count > limit:
            retry_after = window_s - int(time.time() % window_s)
            # Emit a Prometheus counter if the metrics module is loaded (no-op otherwise).
            try:
                from api.utils.metrics import HTTP_REQUESTS_TOTAL  # noqa: F401
            except Exception:
                pass
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limited",
                    "limit": limit,
                    "window_s": window_s,
                    "retry_after": retry_after,
                    "name": name,
                },
                headers={"Retry-After": str(retry_after)},
            )

    _dependency.__name__ = f"rate_limit_{name}"
    return _dependency
