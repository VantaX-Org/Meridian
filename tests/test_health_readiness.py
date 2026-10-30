"""GET /health probes Postgres and Redis and answers 503 when either is down (D-26); /health/live stays shallow."""

from __future__ import annotations

import os
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

UP = {"status": "up", "latency_ms": 1, "detail": None}
DOWN = {"status": "down", "latency_ms": None, "detail": "OperationalError"}


def _client(monkeypatch: pytest.MonkeyPatch, db: dict[str, Any] | None = None,
            redis: dict[str, Any] | None = None) -> TestClient:
    from api.routes import health

    monkeypatch.setattr(health, "email_backend_name", lambda: None)
    monkeypatch.setattr(health, "get_cached_licence", lambda: {})
    if db is not None:
        monkeypatch.setattr(health, "_probe_db", lambda: db)
    if redis is not None:
        monkeypatch.setattr(health, "_probe_redis", lambda: redis)
    app = FastAPI()
    app.include_router(health.router)
    return TestClient(app)


def test_ready_when_both_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    r = _client(monkeypatch, UP, UP).get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"  # scripts/update.sh greps for "status":"ok"
    assert body["components"] == {"db": UP, "redis": UP}
    assert {"version", "llm_provider", "licence", "email_backend", "timestamp"} <= set(body)


@pytest.mark.parametrize("db,redis,down", [(DOWN, UP, "db"), (UP, DOWN, "redis"), (DOWN, DOWN, None)])
def test_503_with_per_component_status_when_one_is_down(monkeypatch: pytest.MonkeyPatch, db: dict[str, Any],
                                                        redis: dict[str, Any], down: str | None) -> None:
    r = _client(monkeypatch, db, redis).get("/health")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "degraded"
    assert body["components"]["db"]["status"] == db["status"]
    assert body["components"]["redis"]["status"] == redis["status"]
    if down:
        assert body["components"][down]["detail"] == "OperationalError"


def test_live_touches_no_dependency(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> dict[str, Any]:
        raise AssertionError("liveness must not probe dependencies")

    r = _client(monkeypatch, boom, boom).get("/health/live")  # type: ignore[arg-type]
    assert r.status_code == 200 and r.json()["status"] == "ok" and "version" in r.json()


def test_unreachable_redis_is_down_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:1/0")
    r = _client(monkeypatch, db=UP).get("/health")
    assert r.status_code == 503
    redis = r.json()["components"]["redis"]
    assert redis["status"] == "down" and "127.0.0.1" not in (redis["detail"] or "")


@pytest.mark.skipif(not (os.environ.get("MERIDIAN_TEST_DB_URL") and os.environ.get("REDIS_URL")),
                    reason="needs the test Postgres (MERIDIAN_TEST_DB_URL) and Redis (REDIS_URL)")
def test_real_probes_against_the_test_services(monkeypatch: pytest.MonkeyPatch) -> None:
    r = _client(monkeypatch).get("/health")
    assert r.status_code == 200, r.text
    assert {c["status"] for c in r.json()["components"].values()} == {"up"}
