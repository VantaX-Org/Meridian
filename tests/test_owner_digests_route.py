"""POST /api/v1/owners/digests/send: thin wrapper over send_digests_for_tenant."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_tenant
from api.routes import owner_digests


def _client() -> TestClient:
    api = FastAPI()
    api.include_router(owner_digests.router)
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def test_sends_to_every_owner(monkeypatch):
    calls = []
    monkeypatch.setattr(owner_digests, "_send", lambda tid, owner: calls.append((tid, owner)) or 3)
    r = _client().post("/api/v1/owners/digests/send", json={}, headers={"X-User-Role": "admin"})
    assert r.status_code == 200 and r.json() == {"sent": 3, "owner": None}
    assert calls[0][1] is None


def test_sends_to_one_owner(monkeypatch):
    monkeypatch.setattr(owner_digests, "_send", lambda tid, owner: 1)
    r = _client().post("/api/v1/owners/digests/send", json={"owner": "P. Naidoo"}, headers={"X-User-Role": "admin"})
    assert r.status_code == 200 and r.json() == {"sent": 1, "owner": "P. Naidoo"}


def test_unknown_owner_is_404(monkeypatch):
    monkeypatch.setattr(owner_digests, "_send", lambda tid, owner: 0)
    r = _client().post("/api/v1/owners/digests/send", json={"owner": "Nobody"}, headers={"X-User-Role": "admin"})
    assert r.status_code == 404


def test_viewer_cannot_send(monkeypatch):
    monkeypatch.setattr(owner_digests, "_send", lambda tid, owner: 1)
    r = _client().post("/api/v1/owners/digests/send", json={}, headers={"X-User-Role": "viewer"})
    assert r.status_code == 403
