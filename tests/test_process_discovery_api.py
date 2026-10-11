"""Process discovery API (spec §5.3) against a real Postgres, with Redis, Celery and the audit insert faked.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_process_designer_api.py); skipped otherwise.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import uuid
import zipfile
from datetime import date, timedelta

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

    def get(self, key):
        return self.data.get(key)

    def setex(self, key, ttl, value):
        self.data[key] = value

    def delete(self, key):
        self.data.pop(key, None)


class FakeChain:
    calls: list = []

    def __init__(self, *sigs) -> None:
        self.sigs = sigs

    def apply_async(self, link_error=None):
        FakeChain.calls.append((self.sigs, link_error))


@pg
def test_process_discovery_api(app_engine, monkeypatch):  # noqa: F811
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import process_discovery as route
    from api.services import rbac
    from tests.test_process_discovery_jobs import COVERAGE, _frames
    from workers.db import tenant_session
    from workers.tasks import run_process_discovery as rpd

    # Until Task 28 adds them to the role table.
    monkeypatch.setitem(rbac.PERMISSIONS, "analyst",
                        rbac.PERMISSIONS["analyst"] | {"run_process_discovery", "export_process"})
    redis, audit, started = FakeRedis(), [], []
    monkeypatch.setattr(route, "_redis_client", lambda: redis)
    monkeypatch.setattr(rpd, "_redis_client", lambda: redis)
    monkeypatch.setattr(route, "_insert_audit_row", audit.append)
    monkeypatch.setattr(route, "chain", FakeChain)
    monkeypatch.setattr(route.jobs, "start_job", lambda *a, **k: started.append((a, k)))
    monkeypatch.setattr(route.jobs, "update_job", lambda *a, **k: None)
    FakeChain.calls = []

    owner, app_eng = app_engine
    tid, sid, vid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDA-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'S', 'ecc')"),
                  {"s": sid, "t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'completed', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"dataset_path": "mem", "coverage": COVERAGE})})
        rid = str(c.execute(text("INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status) "
                                 "VALUES (:t, :s, 'PTP', 'full', 'queued') RETURNING id"),
                            {"t": tid, "s": sid}).scalar())
    s = tenant_session(owner, tid)
    assert rpd.discover(s, tid, sid, [rid], vid, frames_for=_frames, today=date(2026, 10, 11)) == {rid: "completed"}
    s.close()
    with owner.connect() as c:
        watermark = c.execute(text("SELECT watermark FROM process_discovery_runs WHERE id = :r"), {"r": rid}).scalar()

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
        h, viewer = {"X-User-Role": "analyst"}, {"X-User-Role": "viewer"}
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            cat = (await c.get(f"{BASE}/systems/{sid}/catalogue", headers=viewer)).json()
            assert len(cat) == 13
            by = {r["l1"]: r for r in cat}
            assert by["PTP"]["coverage"] == "partial" and by["PTP"]["reason"] is None
            assert by["PTP"]["last_run"]["id"] == rid and by["PTP"]["last_run"]["cases"] == 2
            assert {"table": "EKKO", "rows": 1, "partial": False} in by["PTP"]["sources"]
            assert by["SFX"]["coverage"] == "reference" and by["SFX"]["last_run"] is None
            assert by["SFX"]["reason"].startswith("Connect the SuccessFactors")
            assert (await c.get(f"{BASE}/systems/{uuid.uuid4()}/catalogue", headers=h)).status_code == 404

            # start: PTP incremental from the watermark, SFX completes as reference without a job
            assert (await c.post(f"{BASE}/systems/{sid}/runs", headers=viewer, json={"l1s": ["PTP"]})).status_code == 403
            assert (await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["NOPE"]})).status_code == 422
            r = await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["SFX", "PTP"], "mode": "incremental"})
            assert r.status_code == 200, r.text
            started_ids = r.json()["run_ids"]
            assert r.json()["job_id"] == f"pd-{started_ids[0]}" and len(started_ids) == 2
            (sigs, errback), = FakeChain.calls
            extract, disc = sigs
            want_from = (watermark.astimezone(route.ZoneInfo("Africa/Johannesburg")).date() - timedelta(days=14))
            assert extract.args[2] == ["process_events_ptp"]
            assert extract.kwargs["scope"]["date_from"] == want_from.isoformat()
            assert extract.kwargs["include_config"] is False and extract.kwargs["analyse"] is False
            assert disc.args[2] == [started_ids[0]] and errback.args[2] == [started_ids[0]]  # l1s sorted: PTP, SFX
            assert started[0][0][2] == "process_discovery"
            assert (await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["PTP"]})).status_code == 409
            redis.delete(rpd.lock_key(tid, sid))

            runs = (await c.get(f"{BASE}/systems/{sid}/runs", headers=viewer, params={"l1": "SFX"})).json()
            assert runs[0]["status"] == "completed" and runs[0]["coverage"] == "reference"
            assert runs[0]["stats"]["reason"].startswith("Connect the SuccessFactors")
            ptp_new = (await c.get(f"{BASE}/runs/{started_ids[0]}", headers=viewer)).json()
            assert ptp_new["status"] == "queued" and ptp_new["mode"] == "incremental"
            assert ptp_new["window_from"] == want_from.isoformat()

            r = await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["SFX"]})
            assert r.json()["job_id"] is None and rpd.lock_key(tid, sid) not in redis.data
            assert len(FakeChain.calls) == 1

            # stored views
            model = (await c.get(f"{BASE}/runs/{rid}/model", headers=viewer)).json()
            assert model["source"] == "discovered" and [x["id"] for x in model["l1"]] == ["PTP"]
            assert (await c.get(f"{BASE}/runs/{rid}", headers=viewer)).json()["coverage"] == "partial"
            assert (await c.get(f"{BASE}/runs/{uuid.uuid4()}", headers=viewer)).status_code == 404
            assert (await c.get(f"{BASE}/runs/not-a-uuid", headers=viewer)).status_code == 422

            g = (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer)).json()
            assert g["level"] == 2 and g["node"]["id"] == "PTP" and g["cached"] is False
            assert g["edges"] and {e["source"] for e in g["edges"]} >= {"START"}
            f = {"doc_type": "NB"}
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()["cached"] is False
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()["cached"] is True
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params={"node_id": "NOPE"})).status_code == 404

            v = (await c.get(f"{BASE}/runs/{rid}/variants", headers=viewer)).json()
            assert v["case_type"] == "po_item" and v["total"] == len(v["items"]) > 0
            vf = (await c.get(f"{BASE}/runs/{rid}/variants", headers=viewer, params=f)).json()
            assert [x["hash"] for x in vf["items"]] == [x["hash"] for x in v["items"]]
            conf = (await c.get(f"{BASE}/runs/{rid}/conformance", headers=viewer)).json()
            assert conf["case_type"] == "po_item" and conf["steps"]

            # case explorer and export need export_process
            assert (await c.get(f"{BASE}/runs/{rid}/cases", headers=viewer)).status_code == 403
            cases = (await c.get(f"{BASE}/runs/{rid}/cases", headers=h)).json()
            assert cases["total"] == 2
            one = cases["items"][0]
            assert (await c.get(f"{BASE}/runs/{rid}/cases", headers=h,
                                params={"variant": one["variant"]})).json()["items"][0]["case_id"] == one["case_id"]
            ev = (await c.get(f"{BASE}/runs/{rid}/cases/{one['case_id']}", headers=h)).json()
            assert ev["events"] and ev["events"][0]["source_table"]
            assert (await c.get(f"{BASE}/runs/{rid}/cases/nope", headers=h)).status_code == 404

            assert (await c.get(f"{BASE}/runs/{rid}/export/signavio", headers=viewer)).status_code == 403
            z = await c.get(f"{BASE}/runs/{rid}/export/signavio", headers=h)
            assert z.status_code == 200, z.text
            assert z.headers["content-disposition"].startswith('attachment; filename="meridian-asis-PTP-')
            zf = zipfile.ZipFile(io.BytesIO(z.content))
            manifest = json.loads(zf.read(next(n for n in zf.namelist() if n.endswith("/manifest.json"))))
            assert manifest["discovery"]["run_id"] == rid
            assert audit[-1]["action"] == "process_discovery.export"
            assert audit[-1]["before_json"] == {"run_id": rid, "l1": "PTP", "node_id": None,
                                                "filters": json.loads(route.ProcessFilter().model_dump_json())}
            x = await c.get(f"{BASE}/runs/{rid}/export/bpmn/PTP", headers=h)
            assert x.headers["content-type"].startswith("application/xml") and b"<bpmn:definitions" in x.content
            assert audit[-1]["before_json"]["node_id"] == "PTP" and len(audit) == 2
            assert (await c.get(f"{BASE}/runs/{rid}/export/bpmn/NOPE", headers=h)).status_code == 404

            # Redis down: no lock, no run
            monkeypatch.setattr(route, "_redis_client", lambda: None)
            assert (await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["PTP"]})).status_code == 503

    asyncio.run(scenario())
    asyncio.run(aeng.dispose())
