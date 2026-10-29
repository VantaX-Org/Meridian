"""GET /runs/predict against a real Postgres (MERIDIAN_TEST_DB_URL): duration and records from the tenant's own past
runs, the delta basis, the cost in the tenant's cost model, and the queue position from the broker and the job
registry (a local Redis on REDIS_URL when one answers). Another tenant's runs never count."""
from __future__ import annotations

import os
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_step10_seed import RUN_AT, seed_run, seed_tenant

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def _seed(owner) -> dict:
    s = seed_tenant(owner)
    a = seed_run(owner, s["tid"], s["ecc"], run_at=RUN_AT - timedelta(days=3), seconds=100)
    b = seed_run(owner, s["tid"], s["ecc"], run_at=RUN_AT - timedelta(days=2), seconds=120)
    c = seed_run(owner, s["tid"], s["ecc"], run_at=RUN_AT - timedelta(days=1), seconds=80)
    with owner.begin() as conn:  # c was a delta extraction
        conn.execute(text("INSERT INTO extraction_changes (tenant_id, version_id, table_name, mode, rows_read) "
                          "VALUES (:t, :v, 'LFBK', 'change_date', 12)"), {"t": s["tid"], "v": c})
    return {**s, "runs": [a, b, c]}


@pytest.mark.anyio
async def test_predict(owner, monkeypatch):
    s = _seed(owner)
    other = seed_tenant(owner)
    seed_run(owner, other["tid"], other["ecc"], seconds=10_000)

    deps, client = make_client(monkeypatch, s["tid"], s["ann"])
    await deps.engine.dispose()
    async with client:
        r = await client.get(f"/api/v1/runs/predict?system_id={s['ecc']}", headers=headers("viewer"))
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["modules"] == ["accounts_payable"] and p["delta"] is False
        o = p["objects"][0]
        # full runs a (100 s) and b (120 s), 200 records each: 0.5 and 0.6 s per record
        assert (o["runs"], o["records"], o["seconds"], o["seconds_low"], o["seconds_high"], o["confidence"], o["basis"]) \
            == (2, 200, 110.0, 100.0, 120.0, "low", "full")
        assert p["total"] == {"records": 200, "seconds": 110.0, "seconds_low": 100.0, "seconds_high": 120.0,
                              "confidence": "low"}
        assert p["cost"] is None
        assert p["queue"]["position"] >= 1

        d = (await client.get("/api/v1/runs/predict?modules=accounts_payable&delta=true", headers=headers())).json()
        assert d["objects"][0]["basis"] == "delta" and d["objects"][0]["seconds"] == 80.0 and d["objects"][0]["runs"] == 1

        with owner.begin() as conn:
            conn.execute(text("UPDATE tenants SET cost_model = CAST(:m AS jsonb) WHERE id = :t"),
                         {"m": '{"currency": "EUR", "run_cost": {"per_hour": 36}}', "t": s["tid"]})
        c = (await client.get("/api/v1/runs/predict", headers=headers())).json()["cost"]
        assert c == {"amount": 1.1, "low": 1.0, "high": 1.2, "currency": "EUR", "per_hour": 36.0,
                     "per_million_records": None}

        assert (await client.get(f"/api/v1/runs/predict?system_id={other['ecc']}", headers=headers())).status_code == 404
        r = await client.put("/api/v1/settings/cost-model", headers=headers(),
                             json={"currency": "EUR", "run_cost": {"per_hour": -1}})
        assert r.status_code == 422

    deps, client = make_client(monkeypatch, other["tid"], other["ann"])
    async with client:
        p = (await client.get("/api/v1/runs/predict?modules=material_master", headers=headers())).json()
        assert p["objects"][0]["runs"] == 0 and p["total"]["seconds"] is None
        p = (await client.get("/api/v1/runs/predict", headers=headers())).json()
        assert p["objects"][0]["seconds"] == 10_000.0  # only its own run


def _local_redis():
    try:
        import redis
        r = redis.from_url("redis://127.0.0.1:6399/0", socket_connect_timeout=1)
        r.ping()
        return r
    except Exception:  # noqa: BLE001
        return None


@pytest.mark.anyio
async def test_queue_position(owner, monkeypatch):
    r = _local_redis()
    if r is None:
        pytest.skip("no local Redis on 6399")
    from api.services import jobs, task_progress

    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6399/0")
    monkeypatch.setattr(task_progress, "_redis_instance", None)
    s = seed_tenant(owner)
    tid = s["tid"]
    r.delete("celery")
    r.rpush("celery", "t1", "t2", "t3")
    try:
        jobs.start_job(tid, "job-run", "analysis", "Running", status="running")
        jobs.start_job(tid, "job-q1", "extraction", "First", status="queued")
        jobs.start_job(tid, "job-q2", "extraction", "Second", status="queued")
        deps, client = make_client(monkeypatch, tid, s["ann"])
        await deps.engine.dispose()
        async with client:
            listed = {j["id"]: j.get("queue_position") for j in
                      (await client.get("/api/v1/jobs?active=true", headers=headers("viewer"))).json()["jobs"]}
            assert listed == {"job-run": None, "job-q1": 1, "job-q2": 2}
            one = (await client.get("/api/v1/jobs/job-q2", headers=headers("viewer"))).json()
            assert one["queue_position"] == 2
            q = (await client.get("/api/v1/runs/predict", headers=headers("viewer"))).json()["queue"]
            assert q["broker"]["celery"] == 3 and q["waiting"] == 3 and q["running_jobs"] == 1
            assert q["queued_jobs"] == 2 and q["position"] == 4
    finally:
        r.delete("celery")
        monkeypatch.setattr(task_progress, "_redis_instance", None)
