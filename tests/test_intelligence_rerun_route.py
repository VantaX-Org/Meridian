"""POST /config/discover/latest and /z-objects/detect/latest queue the intelligence worker on stored data."""

import sys
import types
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import config_intelligence, z_object_intelligence


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _DB:
    def __init__(self, row):
        self.row = row
        self.params = []
        self.stmts = []

    async def execute(self, stmt, params=None):
        self.params.append(params)
        self.stmts.append(stmt)
        return _Result(self.row)


def _client(row) -> tuple[TestClient, _DB]:
    api = FastAPI()
    api.include_router(config_intelligence.router)
    api.include_router(z_object_intelligence.router)
    db = _DB(row)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api), db


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


class _Redis:
    def __init__(self, free: bool = True) -> None:
        self.free = free
        self.keys: list[str] = []

    def set(self, key: str, _v, nx=False, ex=None) -> bool:
        self.keys.append(key)
        return self.free


@pytest.fixture
def redis_free(monkeypatch):
    from api.middleware import cache

    fake = _Redis()
    monkeypatch.setattr(cache, "get_redis", lambda: fake)
    return fake


@pytest.fixture
def queued(monkeypatch, redis_free):
    calls: list[tuple] = []
    task = types.SimpleNamespace(delay=lambda *a: calls.append(a))
    module = types.ModuleType("workers.tasks.run_config_intelligence")
    module.run_config_intelligence = task  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "workers.tasks.run_config_intelligence", module)
    return calls


@pytest.mark.parametrize("path", ["/api/v1/config/discover/latest", "/api/v1/z-objects/detect/latest"])
def test_queues_the_worker_on_the_latest_version(path, queued):
    vid = uuid.uuid4()
    client, _ = _client((vid, "/data/x/"))
    r = client.post(path, headers={"X-User-Role": "admin"})
    assert r.status_code == 202
    assert r.json() == {"queued": True, "version_id": str(vid)}
    assert queued[0][0] == str(vid) and queued[0][2] == "/data/x/"


def test_only_completed_versions_are_considered(queued):
    client, db = _client(("v1", "/data/v1.parquet"))
    client.post("/api/v1/config/discover/latest", headers={"X-User-Role": "admin"})
    sql = str(db.stmts[-1])
    assert "status NOT IN ('pending', 'queued', 'running', 'failed')" in sql
    assert "status = 'completed'" not in sql  # 'completed' is not a real analysis status (they are 'complete', 'agents_complete', ...)


def test_second_rerun_on_the_same_version_is_409(queued, redis_free):
    client, _ = _client(("v1", "/data/v1.parquet"))
    assert client.post("/api/v1/config/discover/latest", headers={"X-User-Role": "admin"}).status_code == 202
    redis_free.free = False  # the key is still held: the worker has not finished
    r = client.post("/api/v1/z-objects/detect/latest", headers={"X-User-Role": "admin"})
    assert r.status_code == 409 and len(queued) == 1
    assert all(k.startswith("meridian:ci-rerun:") and k.endswith(":v1") for k in redis_free.keys)


def test_without_redis_the_rerun_is_503(queued, monkeypatch):
    from api.middleware import cache

    monkeypatch.setattr(cache, "get_redis", lambda: None)
    client, _ = _client(("v1", "/data/v1.parquet"))
    assert client.post("/api/v1/config/discover/latest", headers={"X-User-Role": "admin"}).status_code == 503
    assert queued == []


def test_no_analysed_data_is_404(queued):
    client, _ = _client(None)
    r = client.post("/api/v1/config/discover/latest", headers={"X-User-Role": "admin"})
    assert r.status_code == 404 and queued == []


def test_system_scope_is_passed_through(queued):
    client, db = _client((uuid.uuid4(), "/d/"))
    client.post("/api/v1/config/discover/latest", params={"system_id": "S1"}, headers={"X-User-Role": "admin"})
    assert db.params[-1]["sid"] == "S1"
