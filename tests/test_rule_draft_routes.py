"""Rule draft edit, delete and publish routes (api/routes/rule_authoring.py)."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import rule_authoring


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _DB:
    def __init__(self, row):
        self.row = row
        self.statements: list[str] = []
        self.committed = False

    async def execute(self, stmt, _params=None):
        self.statements.append(str(stmt))
        return _Result(self.row)

    async def commit(self):
        self.committed = True


def _client(row) -> tuple[TestClient, _DB]:
    api = FastAPI()
    api.include_router(rule_authoring.router)
    db = _DB(row)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api), db


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


ADMIN = {"X-User-Role": "admin"}


def test_delete_removes_the_draft():
    client, db = _client((uuid.uuid4(), "dq_rule:business_partner", {}))
    r = client.delete(f"/api/v1/rule-authoring/drafts/{uuid.uuid4()}", headers=ADMIN)
    assert r.status_code == 204
    assert any("DELETE FROM ai_proposed_rules" in s for s in db.statements) and db.committed


def test_delete_unknown_draft_is_404():
    client, db = _client(None)
    r = client.delete(f"/api/v1/rule-authoring/drafts/{uuid.uuid4()}", headers=ADMIN)
    assert r.status_code == 404 and not db.committed


def test_publish_unknown_draft_is_404():
    client, _ = _client(None)
    r = client.post(f"/api/v1/rule-authoring/drafts/{uuid.uuid4()}/publish", headers=ADMIN)
    assert r.status_code == 404


def test_viewer_cannot_delete():
    client, _ = _client((uuid.uuid4(), "dq_rule:x", {}))
    r = client.delete(f"/api/v1/rule-authoring/drafts/{uuid.uuid4()}", headers={"X-User-Role": "viewer"})
    assert r.status_code == 403
