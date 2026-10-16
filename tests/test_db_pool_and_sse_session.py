"""The API pool is sized from MERIDIAN_DB_POOL_* and the live job stream releases its
DB session before the first event, so open SSE tabs never pin pooled connections."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.config import Settings
from api.deps import Tenant, get_db, get_tenant
from api.routes import jobs


def test_pool_settings_default_and_parse(monkeypatch):
    for k in ("MERIDIAN_DB_POOL_SIZE", "MERIDIAN_DB_MAX_OVERFLOW", "MERIDIAN_DB_POOL_TIMEOUT"):
        monkeypatch.delenv(k, raising=False)
    s = Settings(_env_file=None)
    assert (s.db_pool_size, s.db_max_overflow, s.db_pool_timeout) == (20, 20, 30)
    monkeypatch.setenv("MERIDIAN_DB_POOL_SIZE", "40")
    monkeypatch.setenv("MERIDIAN_DB_MAX_OVERFLOW", "5")
    monkeypatch.setenv("MERIDIAN_DB_POOL_TIMEOUT", "7")
    s = Settings(_env_file=None)
    assert (s.db_pool_size, s.db_max_overflow, s.db_pool_timeout) == (40, 5, 7)


def test_engine_is_built_from_the_pool_settings():
    from api.config import settings
    from api.deps import engine

    assert engine.pool.size() == settings.db_pool_size
    assert engine.pool._max_overflow == settings.db_max_overflow
    assert engine.pool._timeout == settings.db_pool_timeout


class _Res:
    def fetchone(self):
        return None

    first = fetchone

    def fetchall(self):
        return []

    def scalar(self):
        return None


class _Session:
    def __init__(self):
        self.closed = False

    async def execute(self, *_a, **_k):
        return _Res()

    async def close(self):
        self.closed = True


def test_job_stream_closes_the_session_before_the_first_event(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    session = _Session()
    seen = {}

    async def _db():
        yield session
        seen["teardown_after_stream"] = True

    async def _fake_stream(channel: str):
        seen["closed_at_first_yield"] = session.closed
        seen["channel"] = channel
        yield "event: job\ndata: {}\n\n"

    monkeypatch.setattr(jobs, "_subscribe_redis", _fake_stream)
    app = FastAPI()
    app.include_router(jobs.router)
    tid = uuid.uuid4()
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(tid, "T", [])

    with TestClient(app) as c, c.stream("GET", "/api/v1/jobs/events", headers={"X-User-Role": "viewer"}) as r:
        assert r.status_code == 200
        body = b"".join(r.iter_bytes())
    assert body.startswith(b"event: job")
    assert seen["closed_at_first_yield"] is True
    assert seen["channel"] == f"events:{tid}:jobs"
