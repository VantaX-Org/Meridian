"""Cancellation protocol for long-running analyses.

CancelToken backed by Redis key `meridian:cancel:<version_id>`.
Checked three times per chunk: before scan, after collect, after sink flush.
Maximum delay from cancel to worker stop is one chunk (~3 sec).

Usage:
    from checks.cancel import CancelToken
    
    token = CancelToken("version_123")
    
    # In worker task:
    while processing:
        token.raise_if_set()  # Raises CancelRequested if cancelled
        
        # Do work...
        
        token.raise_if_set()  # Check again after each step
    
    # Caller can cancel:
    token.cancel()  # Sets Redis key
"""

from __future__ import annotations

import logging
import time
from typing import Optional

import redis

logger = logging.getLogger("meridian.checks.cancel")

# Redis key prefix for cancellation tokens
CANCEL_KEY_PREFIX = "meridian:cancel:"
# How long a cancel request remains valid (24 hours)
CANCEL_KEY_TTL = 86400


class CancelRequested(Exception):
    """Raised when a cancellation has been requested."""
    pass


class CancelToken:
    """Redis-backed cancellation token for long-running analyses.
    
    The token checks a Redis key for cancellation requests. When the key
    exists and contains the current version_id, the token is considered
    cancelled and will raise CancelRequested.
    
    Thread-safe: multiple workers can hold tokens for the same analysis.
    """
    
    def __init__(
        self,
        version_id: str,
        redis_url: str | None = None,
        check_interval: float = 1.0,
    ):
        """Initialize a cancellation token.
        
        Args:
            version_id: Unique identifier for the analysis/version
            redis_url: Redis connection URL. If None, uses REDIS_URL env var.
            check_interval: How often to check for cancellation (seconds)
        """
        self.version_id = version_id
        self._redis_url = redis_url or "redis://localhost:6379"
        self._check_interval = check_interval
        self._last_check = 0.0
        self._cancelled = False
        self._redis: Optional[redis.Redis] = None
    
    def _get_redis(self) -> redis.Redis:
        """Lazy Redis connection."""
        if self._redis is None:
            self._redis = redis.from_url(self._redis_url, decode_responses=True)
        return self._redis
    
    @property
    def key(self) -> str:
        """Redis key for this cancellation token."""
        return f"{CANCEL_KEY_PREFIX}{self.version_id}"
    
    def is_set(self) -> bool:
        """Check if cancellation has been requested."""
        if self._cancelled:
            return True
        
        # Rate-limit Redis calls
        now = time.time()
        if now - self._last_check < self._check_interval:
            return self._cancelled
        
        self._last_check = now
        
        try:
            r = self._get_redis()
            exists = r.exists(self.key)
            if exists:
                self._cancelled = True
            return self._cancelled
        except redis.RedisError as e:
            logger.warning(f"Redis error checking cancel token: {e}")
            return False
    
    def raise_if_set(self) -> None:
        """Check for cancellation and raise if requested.
        
        Raises:
            CancelRequested: If cancellation has been requested
        
        This should be called:
        - Before starting a chunk
        - After collecting results
        - After flushing to sink
        """
        if self.is_set():
            logger.info(f"Cancellation requested for version {self.version_id}")
            raise CancelRequested(
                f"Analysis {self.version_id} cancelled by user"
            )
    
    def cancel(self, ttl: int = CANCEL_KEY_TTL) -> bool:
        """Request cancellation of this analysis.
        
        Args:
            ttl: How long the cancel request remains valid (seconds)
        
        Returns:
            True if cancel was set, False if already cancelled
        """
        try:
            r = self._get_redis()
            # Use SETNX semantics: only set if not already set
            was_set = r.set(self.key, "1", ex=ttl, nx=True)
            if was_set:
                logger.info(f"Cancellation requested for version {self.version_id}")
                self._cancelled = True
                return True
            # Already cancelled
            self._cancelled = True
            return False
        except redis.RedisError as e:
            logger.error(f"Redis error setting cancel token: {e}")
            # On Redis failure, mark as cancelled locally
            self._cancelled = True
            return True
    
    def uncancel(self) -> bool:
        """Clear the cancellation request.
        
        Returns:
            True if cleared, False if not set
        """
        try:
            r = self._get_redis()
            deleted = r.delete(self.key)
            self._cancelled = False
            return deleted > 0
        except redis.RedisError as e:
            logger.error(f"Redis error clearing cancel token: {e}")
            return False
    
    def __enter__(self) -> "CancelToken":
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.uncancel()
    
    def __repr__(self) -> str:
        status = "CANCELLED" if self._cancelled else "ACTIVE"
        return f"CancelToken(version_id={self.version_id!r}, status={status})"


class CancelTokenPool:
    """Pool of cancellation tokens for multiple analyses.
    
    Manages multiple CancelToken instances and provides batch
    cancellation operations.
    """
    
    def __init__(self, redis_url: str | None = None):
        self._tokens: dict[str, CancelToken] = {}
        self._redis_url = redis_url
    
    def get_token(self, version_id: str) -> CancelToken:
        """Get or create a token for a version."""
        if version_id not in self._tokens:
            self._tokens[version_id] = CancelToken(version_id, self._redis_url)
        return self._tokens[version_id]
    
    def cancel_all(self) -> list[str]:
        """Cancel all active tokens.
        
        Returns:
            List of version_ids that were cancelled
        """
        cancelled = []
        for version_id, token in self._tokens.items():
            if token.cancel():
                cancelled.append(version_id)
        return cancelled
    
    def cancel_version(self, version_id: str) -> bool:
        """Cancel a specific version."""
        token = self.get_token(version_id)
        return token.cancel()
    
    def active_count(self) -> int:
        """Count of active (non-cancelled) tokens."""
        return sum(1 for t in self._tokens.values() if not t.is_set())


def create_cancel_token(
    version_id: str,
    redis_host: str = "localhost",
    redis_port: int = 6379,
    redis_db: int = 0,
) -> CancelToken:
    """Factory function for creating a cancel token.
    
    Args:
        version_id: Analysis version ID
        redis_host: Redis host
        redis_port: Redis port
        redis_db: Redis database number
    
    Returns:
        Configured CancelToken
    """
    redis_url = f"redis://{redis_host}:{redis_port}/{redis_db}"
    return CancelToken(version_id, redis_url)


def cancel_analysis(version_id: str, redis_url: str | None = None) -> bool:
    """Convenience function to cancel an analysis.
    
    Args:
        version_id: Analysis version ID to cancel
        redis_url: Optional Redis URL
    
    Returns:
        True if cancelled, False if already cancelled
    """
    token = CancelToken(version_id, redis_url)
    return token.cancel()