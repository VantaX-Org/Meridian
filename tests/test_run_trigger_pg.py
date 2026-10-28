"""How a run started is stamped on it (analysis_versions.metadata.trigger and requested_by_label) against a real Postgres.

The scheduler enqueues run_sync as 'scheduled'; the systems sync route and the sync-trigger route are 'manual' and
carry the requester's email; run_sync writes both onto the version its extraction made.
"""
from __future__ import annotations

import json
import os
import uuid

import pandas as pd
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
USER = "00000000-0000-0000-0000-0000000000d7"


@pytest.fixture(scope="module")
def engine():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


@pytest.fixture
def profile(engine):
    tid, sid, pid = (str(uuid.uuid4()) for _ in range(3))
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'ERP')"), {"s": sid, "t": tid})
        c.execute(text("INSERT INTO sync_profiles (id, tenant_id, system_id, domain, schedule_cron, next_run_at) "
                       "VALUES (:p, :t, :s, 'material_master', '0 2 * * *', now() - interval '1 minute')"),
                  {"p": pid, "t": tid, "s": sid})
    return {"tid": tid, "sid": sid, "pid": pid}


@pytest.fixture
def sync_env(engine, monkeypatch):
    """run_sync with its extraction, anchor table, job store and check run replaced by fakes; the
    version rows are real."""
    from api.services import jobs
    from workers.tasks import run_extraction as extraction, run_sync as sync

    def fake_extraction(tenant_id, system_id, modules, analyse=False, label=None, version_id=None, delta=False, **_):
        with engine.begin() as c:  # what the real extraction stores: the version, stamped manual
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, label, metadata) "
                           "VALUES (:v, :t, 'extracted', :l, CAST(:m AS jsonb))"),
                      {"v": version_id, "t": tenant_id, "l": label, "m": json.dumps(
                          {"source": "extraction", "trigger": "manual", "system_id": system_id, "modules": modules})})
        return {"status": "success", "coverage": [{"table": "MARA", "status": "live", "rows": 3}]}

    monkeypatch.setattr(sync, "get_sync_engine", lambda: engine)
    monkeypatch.setattr(extraction, "run_extraction", fake_extraction)
    monkeypatch.setattr(sync, "_anchor_frame", lambda *a, **k: pd.DataFrame({"MATNR": ["1", "2", "3"]}))
    monkeypatch.setattr(jobs, "start_job", lambda *a, **k: None)
    monkeypatch.setattr(sync, "record_step", lambda *a, **k: None)
    monkeypatch.setattr("workers.tasks.run_checks.run_checks.delay", lambda *a, **k: None)
    return sync


def _metadata(engine, tid) -> dict:
    with engine.begin() as c:
        return c.execute(text("SELECT metadata FROM analysis_versions WHERE tenant_id = :t"), {"t": tid}).scalar_one()


def test_run_sync_defaults_to_scheduled(profile, sync_env, engine):
    out = sync_env.run_sync.apply(args=[profile["pid"], profile["tid"]]).get()
    assert out["status"] == "completed"
    md = _metadata(engine, profile["tid"])
    assert md["trigger"] == "scheduled" and "requested_by_label" not in md and md["source"] == "sync"


def test_run_sync_stamps_a_manual_run_with_the_requester(profile, sync_env, engine):
    sync_env.run_sync.apply(args=[profile["pid"], profile["tid"]],
                            kwargs={"trigger": "manual", "requested_by": "lead@example.com"}).get()
    md = _metadata(engine, profile["tid"])
    assert (md["trigger"], md["requested_by_label"]) == ("manual", "lead@example.com")


def test_run_sync_stamps_a_recheck(profile, sync_env, engine):
    sync_env.run_sync.apply(args=[profile["pid"], profile["tid"]],
                            kwargs={"trigger": "recheck", "requested_by": "lead@example.com"}).get()
    assert _metadata(engine, profile["tid"])["trigger"] == "recheck"


def test_scheduler_enqueues_due_profiles_as_scheduled(profile, engine, monkeypatch):
    from workers import scheduler
    from workers.tasks import run_sync as sync

    calls: list[tuple] = []
    monkeypatch.setattr(scheduler, "get_sync_engine", lambda: engine)
    monkeypatch.setattr(scheduler, "_get_tenants", lambda s: [{"id": profile["tid"]}])
    monkeypatch.setattr(sync.run_sync, "delay", lambda *a, **k: calls.append((a, k)))
    scheduler.sync_profile_scheduler()
    assert calls == [((profile["pid"], profile["tid"]), {"trigger": "scheduled"})]
    with engine.begin() as c:  # and the next slot is computed from the cron, never guessed
        nxt = c.execute(text("SELECT next_run_at > now() FROM sync_profiles WHERE id = :p"), {"p": profile["pid"]}).scalar()
    assert nxt


@pytest.fixture
def client_for(monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    def make(tid):
        monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
        monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                            lambda token, secret: {"sub": USER, "email": "lead@example.com", "role": "admin"})
        monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
        monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
        return api_deps, AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    return make


@pytest.mark.anyio
async def test_systems_sync_route_is_manual_and_names_the_requester(profile, client_for, monkeypatch):
    from workers.tasks import run_sync as sync

    calls: list[tuple] = []
    monkeypatch.setattr(sync.run_sync, "delay", lambda *a, **k: calls.append((a, k)) or type("R", (), {"id": "job-1"})())
    deps, client = client_for(profile["tid"])
    await deps.engine.dispose()
    async with client:
        r = await client.post(f"/api/v1/systems/{profile['sid']}/sync", headers=HEADERS)
    assert r.status_code == 200, r.text
    assert calls == [((profile["pid"], profile["tid"]), {"trigger": "manual", "requested_by": "lead@example.com"})]


@pytest.mark.anyio
async def test_sync_trigger_route_stamps_the_rerun_version(profile, engine, client_for, monkeypatch):
    queued: list[tuple] = []
    monkeypatch.setattr("workers.tasks.run_checks.run_checks.delay", lambda *a, **k: queued.append(a))
    vid = str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) VALUES (:v, :t, 'complete', "
                       "CAST(:m AS jsonb))"), {"v": vid, "t": profile["tid"], "m": json.dumps(
                           {"module": "material_master", "parquet_path": "staging/x/", "trigger": "scheduled"})})
    deps, client = client_for(profile["tid"])
    await deps.engine.dispose()
    async with client:
        r = await client.post("/api/v1/sync-trigger/trigger", json={"module_ids": ["material_master"]}, headers=HEADERS)
    assert r.status_code == 200, r.text
    assert r.json()["queued"] == ["material_master"] and queued == [(vid, profile["tid"], "staging/x/")]
    md = _metadata(engine, profile["tid"])
    assert (md["trigger"], md["requested_by_label"]) == ("manual", "lead@example.com")
    _, again = client_for(profile["tid"])
    async with again:
        r = await again.post("/api/v1/sync-trigger/trigger", json={"module_ids": ["material_master"], "trigger": "recheck"},
                              headers=HEADERS)
    assert r.status_code == 200, r.text
    assert _metadata(engine, profile["tid"])["trigger"] == "recheck"  # the object page's Re-check now
