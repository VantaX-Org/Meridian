"""Unit tests for the unified rate limiter.

Uses a fake Redis (in-memory dict) injected via monkeypatch so we can
drive the counter deterministically without spinning up a real Redis.
"""

from __future__ import annotations

import time
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


class _FakeRedis:
    """Minimal Redis stand-in: incr + expire + get, nothing else."""

    def __init__(self) -> None:
        self.store: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    def incr(self, key: str) -> int:
        self.store[key] = self.store.get(key, 0) + 1
        return self.store[key]

    def expire(self, key: str, seconds: int) -> None:
        self.ttls[key] = seconds


def _make_request(state: dict[str, Any] | None = None, ip: str = "1.2.3.4"):
    r = MagicMock()
    r.state.tenant_id = (state or {}).get("tenant_id")
    r.client.host = ip
    # headers acts like an immutable mapping in Starlette
    r.headers = {}
    return r


@pytest.mark.asyncio
async def test_allows_under_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services import rate_limiter

    fake = _FakeRedis()
    monkeypatch.setattr(rate_limiter, "get_redis", lambda: fake)

    dep = rate_limiter.rate_limit("test_allow", limit=5, window_s=60)
    request = _make_request(state={"tenant_id": "t-1"})

    for _ in range(5):
        await dep(request)  # type: ignore[operator]
    # Sixth call exceeds
    with pytest.raises(HTTPException) as excinfo:
        await dep(request)  # type: ignore[operator]
    assert excinfo.value.status_code == 429
    assert excinfo.value.detail["name"] == "test_allow"
    assert "Retry-After" in excinfo.value.headers


@pytest.mark.asyncio
async def test_separate_tenants_have_separate_buckets(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services import rate_limiter

    fake = _FakeRedis()
    monkeypatch.setattr(rate_limiter, "get_redis", lambda: fake)

    dep = rate_limiter.rate_limit("tenant_iso", limit=2, window_s=60)

    r1 = _make_request(state={"tenant_id": "t-a"})
    r2 = _make_request(state={"tenant_id": "t-b"})

    # Tenant A exhausts its bucket
    await dep(r1)  # type: ignore[operator]
    await dep(r1)  # type: ignore[operator]
    with pytest.raises(HTTPException):
        await dep(r1)  # type: ignore[operator]

    # Tenant B must still be admitted
    await dep(r2)  # type: ignore[operator]
    await dep(r2)  # type: ignore[operator]


@pytest.mark.asyncio
async def test_key_by_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services import rate_limiter

    fake = _FakeRedis()
    monkeypatch.setattr(rate_limiter, "get_redis", lambda: fake)

    dep = rate_limiter.rate_limit("by_ip", limit=1, window_s=60, key_by="ip")

    r1 = _make_request(ip="1.1.1.1")
    r2 = _make_request(ip="2.2.2.2")

    await dep(r1)  # type: ignore[operator]
    with pytest.raises(HTTPException):
        await dep(r1)  # type: ignore[operator]

    # Different IP gets its own bucket
    await dep(r2)  # type: ignore[operator]


@pytest.mark.asyncio
async def test_failure_open_when_redis_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    """A Redis outage mustn't take the API down — limiter should allow."""
    from api.services import rate_limiter

    monkeypatch.setattr(rate_limiter, "get_redis", lambda: None)

    dep = rate_limiter.rate_limit("outage", limit=1, window_s=60)
    request = _make_request(state={"tenant_id": "t-1"})

    # Infinite calls allowed — no exception.
    for _ in range(100):
        await dep(request)  # type: ignore[operator]


@pytest.mark.asyncio
async def test_window_rollover_resets_counter(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services import rate_limiter

    fake = _FakeRedis()
    monkeypatch.setattr(rate_limiter, "get_redis", lambda: fake)

    dep = rate_limiter.rate_limit("rollover", limit=1, window_s=60)
    request = _make_request(state={"tenant_id": "t-1"})

    # Freeze time at start of window
    t0 = 1_700_000_000.0
    monkeypatch.setattr(time, "time", lambda: t0)
    await dep(request)  # type: ignore[operator]
    with pytest.raises(HTTPException):
        await dep(request)  # type: ignore[operator]

    # Advance to the next window — new bucket key, counter resets
    monkeypatch.setattr(time, "time", lambda: t0 + 61)
    await dep(request)  # type: ignore[operator]
