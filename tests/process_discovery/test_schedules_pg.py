"""Process discovery schedules and health against a real Postgres: CRUD, 403, one run per slot, RLS.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_process_designer_api.py); skipped otherwise.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from tests.test_process_designer_api import app_engine  # noqa: F401  (module fixture: app role + owner engine)

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
BASE = "/api/v1/process-discovery"


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    def eval(self, _script, _numkeys, key, token):
        if self.data.get(key) == token:
            del self.data[key]
            return 1
        return 0


class FakeChain:
    calls: list = []

    def __init__(self, *sigs) -> None:
        self.sigs = sigs

    def apply_async(self, link_error=None):
        FakeChain.calls.append((self.sigs, link_error))


@pg
def test_schedules_crud_health_and_403(app_engine, monkeypatch):  # noqa: F811
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import process_discovery as route

    owner, app_eng = app_engine
    tid, sid, sf = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDS-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'S', 'ecc')"),
                  {"s": sid, "t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'F', 'successfactors')"),
                  {"s": sf, "t": tid})
        for i, (fit, age) in enumerate(((0.9, 48), (0.8, 2))):
            c.execute(text(
                "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status, started_at, finished_at, "
                "stats) VALUES (:t, :s, 'PTP', 'full', 'completed', now() - make_interval(hours => :a), "
                "now() - make_interval(hours => :a), CAST(:st AS jsonb))"),
                {"t": tid, "s": sid, "a": age, "st": f'{{"conformance": {{"fitness": {fit}}}}}'})

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as sess:
            yield sess

    api = FastAPI()
    api.include_router(route.router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "D", [])

    async def scenario():
        h, viewer = {"X-User-Role": "process_analyst"}, {"X-User-Role": "viewer"}
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            url = f"{BASE}/systems/{sid}/schedules"
            body = {"l1": "PTP", "schedule_cron": "0 6 * * *"}
            assert (await c.post(url, headers=viewer, json=body)).status_code == 403
            assert (await c.get(url, headers=viewer)).json() == []
            assert (await c.post(url, headers=h, json={**body, "schedule_cron": "not a cron"})).status_code == 422
            assert (await c.post(url, headers=h, json={**body, "l1": "NOPE"})).status_code == 422
            assert (await c.post(url, headers=h, json={**body, "l1": "SFX"})).status_code == 422  # not minable on ECC
            assert (await c.post(f"{BASE}/systems/{uuid.uuid4()}/schedules", headers=h, json=body)).status_code == 404

            r = await c.post(url, headers=h, json=body)
            assert r.status_code == 201, r.text
            sch = r.json()
            assert sch["l1"] == "PTP" and sch["active"] and sch["mode"] == "incremental"
            first = datetime.fromisoformat(sch["next_run_at"])
            assert first > datetime.now(timezone.utc) and first.minute == 0 and first.hour == 6
            assert (await c.post(url, headers=h, json=body)).status_code == 409  # one schedule per (system, l1)
            assert [x["id"] for x in (await c.get(url, headers=viewer)).json()] == [sch["id"]]

            one = f"{url}/{sch['id']}"
            assert (await c.patch(one, headers=viewer, json={"active": False})).status_code == 403
            assert (await c.patch(one, headers=h, json={"schedule_cron": "x"})).status_code == 422
            assert (await c.patch(f"{url}/{uuid.uuid4()}", headers=h, json={"active": False})).status_code == 404
            r = await c.patch(one, headers=h, json={"schedule_cron": "30 7 * * *"})
            assert r.status_code == 200 and datetime.fromisoformat(r.json()["next_run_at"]).minute == 30
            r = await c.patch(one, headers=h, json={"active": False})
            assert r.json()["active"] is False

            ph = {x["l1"]: x for x in (await c.get(f"{BASE}/systems/{sid}/health", headers=viewer)).json()}
            assert set(ph) == {"PTP", "OTC", "R2R", "PP", "PM", "QM", "PS", "WH", "HTR", "MDG"}
            ptp = ph["PTP"]
            assert ptp["last_run"]["fitness"] == 0.8 and ptp["previous_fitness"] == 0.9
            assert ptp["fitness_drift"] == -0.1 and ptp["freshness"] == "paused"
            assert ptp["schedule"]["cron"] == "30 7 * * *" and ptp["schedule"]["active"] is False
            assert ph["OTC"]["last_run"] is None and ph["OTC"]["schedule"] is None
            assert ph["OTC"]["freshness"] == "manual" and ph["OTC"]["fitness_drift"] is None
            assert (await c.get(f"{BASE}/systems/{uuid.uuid4()}/health", headers=viewer)).status_code == 404

            assert (await c.delete(one, headers=viewer)).status_code == 403
            assert (await c.delete(one, headers=h)).status_code == 204
            assert (await c.delete(one, headers=h)).status_code == 404

    asyncio.run(scenario())
    asyncio.run(aeng.dispose())


@pg
def test_due_schedule_enqueues_one_run_per_slot(app_engine, monkeypatch):  # noqa: F811
    from sqlalchemy import text

    from workers.db import tenant_session
    from api.services import jobs
    from workers.tasks import process_schedules as ps

    redis = FakeRedis()
    started: list = []
    monkeypatch.setattr(ps, "_redis_client", lambda: redis)
    monkeypatch.setattr(ps, "chain", FakeChain)
    monkeypatch.setattr(jobs, "start_job", lambda *a, **k: started.append((a, k)))
    monkeypatch.setattr(jobs, "update_job", lambda *a, **k: None)
    FakeChain.calls = []

    owner, app_eng = app_engine
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDW-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'S', 'ecc')"),
                  {"s": sid, "t": tid})
        for l1, cron, active, due in (("PTP", "0 6 * * *", True, -10), ("OTC", "0 6 * * *", False, -10),
                                      ("R2R", "0 6 * * *", True, 600)):
            c.execute(text("INSERT INTO process_discovery_schedules (tenant_id, system_id, l1, schedule_cron, active, "
                           "next_run_at) VALUES (:t, :s, :l1, :c, :a, :n)"),
                      {"t": tid, "s": sid, "l1": l1, "c": cron, "a": active, "n": now + timedelta(minutes=due)})

    def tick() -> dict:
        s = tenant_session(app_eng, tid)
        try:
            return ps.process_tenant(s, tid, now)
        finally:
            s.close()

    assert tick() == {"due": 1, "started": 1}  # PTP only: OTC is paused, R2R is not due
    assert len(FakeChain.calls) == 1 and len(started) == 1
    (sigs, errback), = FakeChain.calls
    assert sigs[0].args[2] == ["process_events_ptp"] and errback is not None
    with owner.connect() as c:
        runs = c.execute(text("SELECT l1, mode, status FROM process_discovery_runs WHERE tenant_id = :t"),
                         {"t": tid}).all()
        nxt = c.execute(text("SELECT next_run_at FROM process_discovery_schedules WHERE tenant_id = :t AND l1 = 'PTP'"),
                        {"t": tid}).scalar()
    assert [tuple(r) for r in runs] == [("PTP", "full", "queued")]  # no watermark yet: a full first run
    assert nxt > now and nxt.hour == 6 and nxt.minute == 0

    # the same tick again, and a tick after the lock is released: the slot is already taken
    assert tick() == {"due": 0, "started": 0}
    redis.data.clear()
    assert tick() == {"due": 0, "started": 0}
    assert len(FakeChain.calls) == 1

    # a held system lock skips the slot but still advances it
    with owner.begin() as c:
        c.execute(text("UPDATE process_discovery_schedules SET next_run_at = :n WHERE tenant_id = :t AND l1 = 'PTP'"),
                  {"n": now - timedelta(minutes=1), "t": tid})
    redis.data[f"pd:lock:{tid}:{sid}"] = "other"
    assert tick() == {"due": 1, "started": 0}
    assert tick() == {"due": 0, "started": 0} and len(FakeChain.calls) == 1


@pg
def test_rls_on_process_discovery_schedules(app_engine):  # noqa: F811
    from sqlalchemy import text

    from workers.db import tenant_session

    owner, app_eng = app_engine
    a, b, sa_, sb = (str(uuid.uuid4()) for _ in range(4))
    with owner.begin() as c:
        for t, s in ((a, sa_), (b, sb)):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": t, "n": f"PDR-{t[:8]}"})
            c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'S')"), {"s": s, "t": t})
            c.execute(text("INSERT INTO process_discovery_schedules (tenant_id, system_id, l1, schedule_cron) "
                           "VALUES (:t, :s, 'PTP', '0 6 * * *')"), {"t": t, "s": s})
    s = tenant_session(app_eng, a)
    assert s.execute(text("SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user")).scalar() is False
    assert [str(x) for x in s.execute(text("SELECT tenant_id FROM process_discovery_schedules")).scalars()] == [a]
    with pytest.raises(Exception):  # WITH CHECK defaults to the USING clause: no row for another tenant
        s.execute(text("INSERT INTO process_discovery_schedules (tenant_id, system_id, l1, schedule_cron) "
                       "VALUES (:t, :s, 'OTC', '0 6 * * *')"), {"t": b, "s": sb})
    s.rollback()
    s.close()
    forced = owner.connect().execute(text(
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'process_discovery_schedules'")).one()
    assert tuple(forced) == (True, True)
