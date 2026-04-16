"""Redis response caching decorator for API endpoints.

Provides a @cached decorator that stores API response dicts in Redis with
configurable TTL. Gracefully degrades when Redis is unavailable — the
decorated function runs normally without caching.
"""

import hashlib
import json
import logging
from functools import wraps
from typing import Optional

import redis

from api.config import settings

logger = logging.getLogger("meridian.cache")

_redis_client: Optional[redis.Redis] = None


def get_redis() -> Optional[redis.Redis]:
    """Return a Redis client, or None if unavailable."""
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = redis.from_url(settings.redis_url, decode_responses=True)
            _redis_client.ping()
        except Exception as e:
            logger.warning(f"Redis cache unavailable: {e}")
            _redis_client = None
    return _redis_client


def _build_cache_key(tenant_id: str, prefix: str, func_name: str, args_hash: str) -> str:
    """Build a namespaced cache key."""
    parts = ["meridian", "cache"]
    if prefix:
        parts.append(prefix)
    parts.extend([tenant_id, func_name, args_hash])
    return ":".join(parts)


def _hash_args(*args, **kwargs) -> str:
    """Produce a stable hash of the function arguments."""
    raw = json.dumps({"a": [str(a) for a in args], "k": {k: str(v) for k, v in sorted(kwargs.items())}}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def cached(ttl_seconds: int = 60, key_prefix: str = ""):
    """Decorator that caches API response dicts in Redis.

    The decorated function must accept ``tenant_id`` as a keyword argument
    (or have it as the first positional arg) so the cache can be scoped
    per tenant.

    Usage::

        @cached(ttl_seconds=300, key_prefix="findings")
        def get_findings(tenant_id: str, module: str) -> dict:
            ...
    """

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            r = get_redis()
            tenant_id = kwargs.get("tenant_id") or (args[0] if args else "global")
            tenant_id = str(tenant_id)
            ah = _hash_args(*args[1:], **{k: v for k, v in kwargs.items() if k != "tenant_id"})
            cache_key = _build_cache_key(tenant_id, key_prefix, func.__name__, ah)

            # Try cache read
            if r is not None:
                try:
                    cached_val = r.get(cache_key)
                    if cached_val is not None:
                        logger.debug(f"Cache hit: {cache_key}")
                        return json.loads(cached_val)
                except Exception as e:
                    logger.warning(f"Cache read failed: {e}")

            # Execute the wrapped function
            result = func(*args, **kwargs)

            # Try cache write
            if r is not None and result is not None:
                try:
                    r.setex(cache_key, ttl_seconds, json.dumps(result, default=str))
                    logger.debug(f"Cached: {cache_key} (TTL {ttl_seconds}s)")
                except Exception as e:
                    logger.warning(f"Cache write failed: {e}")

            return result

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            r = get_redis()
            tenant_id = kwargs.get("tenant_id") or (args[0] if args else "global")
            tenant_id = str(tenant_id)
            ah = _hash_args(*args[1:], **{k: v for k, v in kwargs.items() if k != "tenant_id"})
            cache_key = _build_cache_key(tenant_id, key_prefix, func.__name__, ah)

            # Try cache read
            if r is not None:
                try:
                    cached_val = r.get(cache_key)
                    if cached_val is not None:
                        logger.debug(f"Cache hit: {cache_key}")
                        return json.loads(cached_val)
                except Exception as e:
                    logger.warning(f"Cache read failed: {e}")

            # Execute the wrapped async function
            result = await func(*args, **kwargs)

            # Try cache write
            if r is not None and result is not None:
                try:
                    r.setex(cache_key, ttl_seconds, json.dumps(result, default=str))
                    logger.debug(f"Cached: {cache_key} (TTL {ttl_seconds}s)")
                except Exception as e:
                    logger.warning(f"Cache write failed: {e}")

            return result

        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return wrapper

    return decorator


def invalidate_tenant_cache(tenant_id: str, prefix: str = "") -> int:
    """Invalidate all cached responses for a tenant.

    Returns the number of keys deleted, or 0 if Redis is unavailable.
    """
    r = get_redis()
    if r is None:
        return 0

    pattern_parts = ["meridian", "cache"]
    if prefix:
        pattern_parts.append(prefix)
    pattern_parts.append(str(tenant_id))
    pattern = ":".join(pattern_parts) + ":*"

    deleted = 0
    try:
        cursor = 0
        while True:
            cursor, keys = r.scan(cursor=cursor, match=pattern, count=200)
            if keys:
                deleted += r.delete(*keys)
            if cursor == 0:
                break
        if deleted:
            logger.info(f"Invalidated {deleted} cache keys for tenant {tenant_id}")
    except Exception as e:
        logger.warning(f"Cache invalidation failed: {e}")

    return deleted
