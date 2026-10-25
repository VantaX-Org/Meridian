"""POST /api/v1/licence/validate: a licence admin checks the licence with HQ now; the
middleware's caches are refreshed through the same revalidate() it uses on a cache miss."""

from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.middleware import licence as lic
from api.routes import licence as routes

TENANT = uuid.uuid4()


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(lic, "_cache", {"response": None, "expires_at": 0.0})
    monkeypatch.setattr(lic, "_manifest_cache", {})
    monkeypatch.setattr(lic, "_sync_manifest_to_db", lambda result: None)


class _DB:
    async def execute(self, stmt, params=None):
        class _R:
            def scalar(self):
                return 4

        return _R()


def _client(role: str) -> TestClient:
    app = FastAPI()
    app.include_router(routes.router)

    async def _db():
        yield _DB()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TENANT, "Acme", [])
    c = TestClient(app)
    c.headers.update({"X-User-Role": role})
    return c


def _hq(monkeypatch, result):
    async def _validate():
        return result

    monkeypatch.setattr(lic, "_validate_licence", _validate)


def test_validate_refreshes_the_cache_and_returns_the_manifest_with_seats(monkeypatch):
    _hq(monkeypatch, {"valid": True, "tier": "enterprise", "status": "active", "enabled_modules": ["fi_gl"], "max_users": 25})
    r = _client("admin").post("/api/v1/licence/validate")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["valid"] is True and body["tier"] == "enterprise" and body["enabled_modules"] == ["fi_gl"]
    assert body["seats_used"] == 4
    # the middleware serves the fresh result from now on
    assert lic._cache["response"]["tier"] == "enterprise" and lic._cache["expires_at"] > 0
    assert lic.get_cached_manifest()["tier"] == "enterprise"


def test_an_invalid_verdict_is_recorded_not_an_error(monkeypatch):
    _hq(monkeypatch, {"valid": False, "reason": "suspended"})
    r = _client("admin").post("/api/v1/licence/validate")
    assert r.status_code == 200, r.text
    assert r.json()["valid"] is False and r.json()["status"] == "suspended"
    assert lic._cache["response"] == {"valid": False, "reason": "suspended"}


@pytest.mark.parametrize("result", [None, {"valid": False, "reason": "licence_server_unreachable_cutoff"}])
def test_unreachable_hq_is_503_with_a_plain_message(monkeypatch, result):
    _hq(monkeypatch, result)
    r = _client("admin").post("/api/v1/licence/validate")
    assert r.status_code == 503
    assert r.json()["detail"] == "Meridian HQ could not be reached. Try again shortly"
    assert lic._cache["response"] is None


def test_only_a_licence_admin_may_validate(monkeypatch):
    called = []

    async def _validate():
        called.append(1)
        return {"valid": True}

    monkeypatch.setattr(lic, "_validate_licence", _validate)
    r = _client("steward").post("/api/v1/licence/validate")
    assert r.status_code == 403
    assert called == []
