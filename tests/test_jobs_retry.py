"""POST /api/v1/jobs/{id}/retry: only a failed job, only the kinds whose start endpoint can run again, with that
endpoint's permission, through that endpoint. No Postgres: the registry, the permission check and the Celery task
are stand-ins."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.routes import jobs as jobs_route
from api.services import jobs
from workers.tasks import run_extraction as run_extraction_mod

TENANT = SimpleNamespace(id=uuid.uuid4())
SYSTEM = str(uuid.uuid4())


class _Res:
    def __init__(self, value):
        self.value = value

    def scalar(self):
        return self.value


class _DB:
    """Answers the system-type lookup of the downloads route; every other statement is a no-op."""

    async def execute(self, stmt, params=None):
        return _Res("ecc" if "system_type" in str(stmt) else None)


def _request():
    return SimpleNamespace(state=SimpleNamespace())


@pytest.fixture
def registry(monkeypatch):
    store: dict[str, dict] = {}
    started: list[tuple] = []
    checked: list[tuple] = []
    monkeypatch.setattr(jobs, "get_job", lambda tid, jid: store.get(jid))
    monkeypatch.setattr(jobs, "start_job", lambda tid, jid, kind, label, **kw: started.append((jid, kind, label, kw)))

    async def require_scope(request, db, tenant, action, scope):
        checked.append((action, scope))

    monkeypatch.setattr(jobs_route, "require_scope", require_scope)
    return SimpleNamespace(store=store, started=started, checked=checked)


def _job(**kw) -> dict:
    return {"id": "j1", "kind": "extraction", "status": "failed", "label": "material_master", "system_id": SYSTEM, **kw}


@pytest.mark.asyncio
async def test_a_job_that_did_not_fail_is_not_retried(registry):
    registry.store["j1"] = _job(status="running")
    with pytest.raises(HTTPException) as e:
        await jobs_route.retry_job("j1", _request(), TENANT, _DB())
    assert e.value.status_code == 409
    assert registry.checked == []


@pytest.mark.asyncio
@pytest.mark.parametrize("job", [
    _job(kind="upload"),
    _job(kind="simulation"),
    _job(kind="config_sync"),
    _job(),  # an extraction its start route did not record (a process discovery download)
])
async def test_kinds_without_a_start_to_repeat_answer_422(registry, job):
    registry.store["j1"] = job
    with pytest.raises(HTTPException) as e:
        await jobs_route.retry_job("j1", _request(), TENANT, _DB())
    assert e.value.status_code == 422
    assert e.value.detail == "This kind of job cannot be retried; start it again from its page"


@pytest.mark.asyncio
async def test_unknown_job_is_404(registry):
    with pytest.raises(HTTPException) as e:
        await jobs_route.retry_job("nope", _request(), TENANT, _DB())
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_failed_download_runs_the_downloads_route_again_with_its_request(registry, monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(run_extraction_mod.run_extraction, "delay", lambda *a: calls.append(a))
    body = {"objects": ["material_master"], "scope": {"date_from": "2026-01-01"}, "label": "Q1", "analyse": True}
    registry.store["j1"] = _job(retry={"via": "downloads", "body": body})

    out = await jobs_route.retry_job("j1", _request(), TENANT, _DB())

    assert registry.checked == [("trigger_sync", jobs_route.Scope(uuid.UUID(SYSTEM), None))]
    assert len(calls) == 1
    tid, sid, objects, include_config, sync_type, scope, analyse, label, version_id = calls[0]
    assert (tid, sid, objects, analyse, label) == (str(TENANT.id), SYSTEM, ["material_master"], True, "Q1")
    assert scope["date_from"] == "2026-01-01"
    assert out["job_id"] == f"dl-{version_id}" and out["status"] == "queued"
    # the new job records the same request, so it can be retried in turn
    (jid, kind, _, kw), = registry.started
    assert (jid, kind, kw["retry"]["via"]) == (out["job_id"], "extraction", "downloads")


@pytest.mark.asyncio
async def test_retry_checks_the_permission_of_the_kinds_start(registry, monkeypatch):
    registry.store["j1"] = _job(kind="analysis", version_id=str(uuid.uuid4()))
    ran: list[dict] = []

    async def fake(job, request, db, tenant):
        ran.append(job)
        return {"status": "pending"}

    monkeypatch.setitem(jobs_route.RETRY, "analysis", ("analyse", fake))
    assert await jobs_route.retry_job("j1", _request(), TENANT, _DB()) == {"status": "pending"}
    assert registry.checked[0][0] == "analyse" and len(ran) == 1
