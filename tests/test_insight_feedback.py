"""POST /insights/feedback: gated by `view`, tenant-scoped, validated (mocked session)."""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import get_db, get_tenant
from api.routes import insight_feedback as routes
from api.services import rbac

TENANT = SimpleNamespace(id=uuid.uuid4(), name="t")


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.committed = False

    async def execute(self, stmt, params=None):
        self.calls.append((str(stmt), params or {}))
        return MagicMock()

    async def commit(self) -> None:
        self.committed = True


def _client(monkeypatch, role: str | None) -> tuple[TestClient, _Recorder]:
    async def fake_role(*a, **k):
        return role

    monkeypatch.setattr(rbac, "_get_user_role", fake_role)
    rec = _Recorder()
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_tenant] = lambda: TENANT
    app.dependency_overrides[get_db] = lambda: rec
    return TestClient(app), rec


def test_vote_is_recorded_for_the_tenant(monkeypatch) -> None:
    client, rec = _client(monkeypatch, "viewer")
    r = client.post("/api/v1/insights/feedback", json={"surface": "home", "run_id": "v1", "vote": "up"})
    assert r.status_code == 200 and r.json()["status"] == "recorded"
    assert str(TENANT.id) in rec.calls[0][0]  # SET app.tenant_id first
    insert = rec.calls[1]
    assert "INSERT INTO insight_feedback" in insert[0]
    assert insert[1]["tid"] == str(TENANT.id) and insert[1]["vote"] == "up"
    assert rec.committed


def test_bad_vote_is_rejected_and_nothing_written(monkeypatch) -> None:
    client, rec = _client(monkeypatch, "viewer")
    r = client.post("/api/v1/insights/feedback", json={"surface": "home", "vote": "meh"})
    assert r.status_code == 422
    assert rec.calls == []


def test_forbidden_without_a_role(monkeypatch) -> None:
    client, rec = _client(monkeypatch, None)
    r = client.post("/api/v1/insights/feedback", json={"surface": "home", "vote": "down"})
    assert r.status_code in (401, 403)
    assert rec.calls == []
