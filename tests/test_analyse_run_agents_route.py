"""POST /api/v1/versions/{id}/run-agents: the manual AI re-run on the run page.

It registers an analysis job and seeds the run's progress before the worker starts (so the
progress banner and the jobs tray show it at once), and enqueues the agents with ``force`` so
an ``agents_complete`` run is re-run instead of skipped as a duplicate delivery."""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes.analyse import router
from api.services import jobs, task_progress
from workers.tasks import run_agents as ra

TID = uuid.uuid4()
VID = uuid.uuid4()


class _Result:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


class _DB:
    def __init__(self, version):
        self.version = version

    async def execute(self, stmt, params=None):
        return _Result(self.version if "FROM analysis_versions" in str(stmt) else None)


def _client(db) -> TestClient:
    api = FastAPI()
    api.include_router(router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return TestClient(api)


@pytest.fixture
def calls(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    seen: dict = {"jobs": [], "progress": [], "delay": []}
    monkeypatch.setattr(jobs, "start_job", lambda *a, **k: seen["jobs"].append((a, k)))
    monkeypatch.setattr(task_progress, "update_task_progress", lambda *a, **k: seen["progress"].append((a, k)))

    class _Job:
        id = "task-1"

    monkeypatch.setattr(ra.run_agents, "delay", lambda *a, **k: seen["delay"].append((a, k)) or _Job())
    return seen


def _version(status: str):
    return SimpleNamespace(id=VID, tenant_id=TID, status=status, label="Oct run", metadata_={"system_id": "sys-1"})


def _post(client, role="analyst"):
    return client.post(f"/api/v1/versions/{VID}/run-agents", headers={"X-User-Role": role})


@pytest.mark.parametrize("status", ["complete", "agents_complete", "agents_failed"])
def test_enqueues_forced_rerun_with_job_and_progress(calls, status):
    r = _post(_client(_DB(_version(status))))
    assert r.status_code == 200, r.text
    assert r.json() == {"version_id": str(VID), "job_id": "task-1", "status": "agents_enqueued"}
    assert calls["delay"] == [((str(VID), str(TID)), {"force": True})]
    (args, kwargs), = calls["jobs"]
    assert args == (str(TID), str(VID), "analysis", "AI analysis | Oct run")
    assert kwargs["status"] == "queued" and kwargs["progress_key"] == str(VID) and kwargs["system_id"] == "sys-1"
    (pargs, pkw), = calls["progress"]
    assert pargs == (str(VID),) and pkw["status"] == "queued"


def test_refuses_a_run_whose_checks_have_not_finished(calls):
    r = _post(_client(_DB(_version("running"))))
    assert r.status_code == 409
    assert calls["delay"] == [] and calls["jobs"] == []


def test_needs_the_analyse_permission(calls):
    r = _post(_client(_DB(_version("complete"))), role="viewer")
    assert r.status_code == 403
    assert calls["delay"] == []


def test_worker_skips_agents_complete_only_without_force():
    import inspect

    src = inspect.getsource(ra.run_agents.run)
    assert 'row[0] == "agents_complete" and not force' in src
    assert "force: bool = False" in src
