"""GET/PATCH /api/v1/me/preferences: validated, merged, current user only."""

import json
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import preferences
from api.routes.preferences import router

UID = uuid.uuid4()


class _Result:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class _DB:
    """Holds one user's preferences document and records the UPDATE."""

    def __init__(self, prefs=None, exists=True):
        self.prefs = prefs if prefs is not None else {}
        self.exists = exists
        self.commits = 0
        self.update_params = None

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if sql.startswith("SELECT preferences"):
            return _Result((self.prefs,) if self.exists else None)
        if sql.startswith("UPDATE users"):
            self.update_params = params
            self.prefs = json.loads(params["p"])
        return _Result(None)

    async def commit(self):
        self.commits += 1


def _client(db: _DB, monkeypatch, uid=str(UID)) -> TestClient:
    monkeypatch.setattr(preferences, "current_user_id", lambda _r=None: uid)
    api = FastAPI()
    api.include_router(router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api)


def test_get_returns_stored_document(monkeypatch):
    c = _client(_DB({"theme": "dark"}), monkeypatch)
    r = c.get("/api/v1/me/preferences")
    assert r.status_code == 200 and r.json() == {"theme": "dark"}


def test_get_defaults_to_empty_object(monkeypatch):
    assert _client(_DB(), monkeypatch).get("/api/v1/me/preferences").json() == {}


def test_unauthenticated_is_401(monkeypatch):
    c = _client(_DB(), monkeypatch, uid=None)
    assert c.get("/api/v1/me/preferences").status_code == 401
    assert c.patch("/api/v1/me/preferences", json={"theme": "dark"}).status_code == 401


def test_unknown_user_is_404(monkeypatch):
    assert _client(_DB(exists=False), monkeypatch).get("/api/v1/me/preferences").status_code == 404


def test_patch_merges_nested_objects_and_scopes_to_user(monkeypatch):
    db = _DB({"theme": "light", "notifications": {"digest": "daily", "immediate_critical": True}})
    c = _client(db, monkeypatch)
    r = c.patch("/api/v1/me/preferences", json={"density": "compact", "notifications": {"digest": "weekly"}})
    assert r.status_code == 200
    assert r.json() == {
        "theme": "light",
        "density": "compact",
        "notifications": {"digest": "weekly", "immediate_critical": True},
    }
    assert db.update_params["uid"] == str(UID) and db.commits == 1


def test_null_removes_a_key(monkeypatch):
    c = _client(_DB({"theme": "dark", "locale": "en-GB"}), monkeypatch)
    assert c.patch("/api/v1/me/preferences", json={"locale": None}).json() == {"theme": "dark"}


def test_saved_views_are_per_table_and_replace_the_list(monkeypatch):
    db = _DB({"saved_views": {"runs": [{"name": "a"}], "rules": [{"name": "b"}]}})
    c = _client(db, monkeypatch)
    r = c.patch("/api/v1/me/preferences", json={"saved_views": {"runs": [{"name": "c", "dense": True}], "rules": None}})
    assert r.json() == {"saved_views": {"runs": [{"name": "c", "dense": True}]}}


@pytest.mark.parametrize("body", [
    {"theme": "neon"},
    {"density": "tiny"},
    {"locale": "not a locale"},
    {"timezone": "Europe/London; DROP TABLE users"},
    {"notifications": {"digest": "hourly"}},
    {"notifications": {"surprise": True}},
    {"tours_done": "steward"},
    {"saved_views": {"runs": [{"dense": True}]}},
    {"password_hash": "x"},
])
def test_invalid_patch_is_422_and_writes_nothing(monkeypatch, body):
    db = _DB()
    r = _client(db, monkeypatch).patch("/api/v1/me/preferences", json=body)
    assert r.status_code == 422
    assert db.update_params is None


def test_accepts_every_documented_key(monkeypatch):
    body = {
        "theme": "system", "density": "comfortable", "locale": "de-DE", "timezone": "Europe/Berlin",
        "saved_views": {"runs": [{"name": "v"}]}, "tours_done": ["steward", "first-run"], "seen_version": "1.4.0",
        "notifications": {"digest": "off", "immediate_critical": False, "channels": {"email": True}},
    }
    r = _client(_DB(), monkeypatch).patch("/api/v1/me/preferences", json=body)
    assert r.status_code == 200 and r.json() == body


def test_migration_081_follows_080_and_the_model_has_the_column():
    import importlib.util
    from pathlib import Path

    from db.schema import User

    path = Path(__file__).resolve().parents[1] / "db/migrations/versions/081_user_preferences.py"
    spec = importlib.util.spec_from_file_location("m081", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert (mod.revision, mod.down_revision) == ("081", "080")
    col = User.__table__.c.preferences
    assert not col.nullable and "'{}'" in str(col.server_default.arg)
