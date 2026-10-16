"""POST /api/v1/versions/{id}/analyse accepts an upload's stored dataset.

Extractions keep the data path under ``metadata.dataset_path``; uploads under
``metadata.parquet_path`` (api/routes/upload.py). The route once read only the first and
answered 409 "no stored dataset" for every upload, so an orphaned upload could never be
re-analysed."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import versions
from api.routes.versions import router
from workers.tasks import run_checks as rc

TID = uuid.uuid4()
VID = uuid.uuid4()


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _DB:
    """One analysis_versions row: (status, metadata) answered the way the route's SQL asks."""

    def __init__(self, status, meta):
        self.status, self.meta = status, meta
        self.sql = []
        self.commits = 0

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.sql.append((sql, params))
        if sql.startswith("SELECT status, COALESCE(metadata->>'dataset_path', metadata->>'parquet_path')"):
            m = self.meta
            return _Result((self.status, m.get("dataset_path") or m.get("parquet_path"), m.get("system_id"),
                            m.get("label"), m.get("purpose")))
        if sql.startswith("UPDATE analysis_versions SET status = 'pending'"):
            self.status = "pending"
        return _Result(None)

    async def commit(self):
        self.commits += 1


def _client(db) -> TestClient:
    api = FastAPI()
    api.include_router(router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return TestClient(api)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(versions.jobs, "start_job", lambda *a, **k: None)


def _post(client):
    return client.post(f"/api/v1/versions/{VID}/analyse", headers={"X-User-Role": "admin"})


def _queue(monkeypatch):
    calls = []

    class _Job:
        id = "task-9"

    monkeypatch.setattr(rc.run_checks, "delay", lambda *a, **k: calls.append((a, k)) or _Job())
    return calls


def test_orphaned_upload_is_reanalysed_from_its_parquet_path(monkeypatch):
    calls = _queue(monkeypatch)
    db = _DB("failed", {"parquet_path": "staging/t/f.parquet", "modules": ["fi_gl"]})
    r = _post(_client(db))
    assert r.status_code == 202, r.text
    assert r.json() == {"version_id": str(VID), "task_id": "task-9", "job_id": str(VID), "status": "pending"}
    assert calls == [((str(VID), str(TID), "staging/t/f.parquet"), {"reanalyse": True})]
    assert db.status == "pending" and db.commits == 1


def test_extraction_dataset_path_is_preferred(monkeypatch):
    calls = _queue(monkeypatch)
    db = _DB("extracted", {"dataset_path": "ds/v.parquet", "parquet_path": "staging/old.parquet"})
    assert _post(_client(db)).status_code == 202
    assert calls[0][0][2] == "ds/v.parquet" and calls[0][1] == {"reanalyse": False}


def test_version_without_any_stored_dataset_is_409(monkeypatch):
    calls = _queue(monkeypatch)
    db = _DB("complete", {"modules": ["fi_gl"]})
    r = _post(_client(db))
    assert r.status_code == 409 and "no stored dataset" in r.json()["detail"]
    assert calls == [] and db.commits == 0


def test_running_version_is_409(monkeypatch):
    calls = _queue(monkeypatch)
    r = _post(_client(_DB("running", {"parquet_path": "staging/t/f.parquet"})))
    assert r.status_code == 409 and "already running" in r.json()["detail"]
    assert calls == []
