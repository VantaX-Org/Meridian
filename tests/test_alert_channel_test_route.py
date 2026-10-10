"""POST /api/v1/alert-channels/{id}/test — sends a sample alert through the real deliver()."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes.notifications import router
from workers.tasks import send_notifications as sn

CHANNEL = {"id": "c1", "kind": "slack", "target": "https://hooks.example/x", "secret": None}


class _Result:
    def __init__(self, row):
        self._row = row

    def mappings(self):
        return self

    def first(self):
        return self._row


class _DB:
    def __init__(self, row):
        self.row = row

    async def execute(self, _stmt, _params=None):
        return _Result(self.row)


def _client(row) -> TestClient:
    api = FastAPI()
    api.include_router(router)
    db = _DB(row)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setenv("MERIDIAN_APP_URL", "https://app")


def _post(client, role="admin"):
    return client.post(f"/api/v1/alert-channels/{uuid.uuid4()}/test", headers={"X-User-Role": role})


def test_sends_a_sample_alert(monkeypatch):
    calls = []
    monkeypatch.setattr(sn, "deliver", lambda ch, alert: calls.append((ch, alert)) or True)
    r = _post(_client(CHANNEL))
    assert r.status_code == 200 and r.json() == {"delivered": True}
    ch, alert = calls[0]
    assert ch["kind"] == "slack" and ch["target"] == CHANNEL["target"]
    assert alert["mode"] == "test" and alert["triggers"] == ["new_critical"]
    assert alert["links"]["findings"] == "https://app/findings"


def test_delivery_failure_is_reported_not_raised(monkeypatch):
    def boom(_ch, _alert):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(sn, "deliver", boom)
    assert _post(_client(CHANNEL)).json() == {"delivered": False}


def test_unknown_channel_is_404():
    assert _post(_client(None)).status_code == 404


def test_needs_manage_settings():
    assert _post(_client(CHANNEL), role="analyst").status_code == 403
