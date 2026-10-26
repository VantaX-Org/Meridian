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

    def eval(self, _script, _numkeys, key, token):  # the compare-and-delete release script
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
def test_process_discovery_api(app_engine, monkeypatch):  # noqa: F811
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import process_discovery as route
    from tests.test_process_discovery_jobs import COVERAGE, _frames
    from workers.db import tenant_session
    from workers.tasks import run_process_discovery as rpd

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

    @api.middleware("http")
    async def _licence(request, call_next):  # what LicenceMiddleware sets from the manifest
        if lic := request.headers.get("X-Test-Licensed"):
            request.state.licensed_modules = lic.split(",")
        return await call_next(request)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "D", [])

    async def scenario():
        h, viewer = {"X-User-Role": "process_analyst"}, {"X-User-Role": "viewer"}
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            cat = (await c.get(f"{BASE}/systems/{sid}/catalogue", headers=viewer)).json()
            assert len(cat) == 13
            by = {r["l1"]: r for r in cat}
            assert by["PTP"]["coverage"] == "partial" and by["PTP"]["reason"] is None
            assert by["PTP"]["last_run"]["id"] == rid and by["PTP"]["last_run"]["cases"] == 2
            last = by["PTP"]["last_run"]
            assert last["variants"] >= 1 and "error" not in last and "job_id" not in last
            assert "median_seconds" in last and "automation_rate" in last
            assert by["PTP"]["in_progress"] is None and by["PTP"]["failed"] is None
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
            token = redis.data[rpd.lock_key(tid, sid)]  # the lock holds an owner token that the whole chain carries
            assert sigs[0].kwargs["purpose"] == rpd.PURPOSE
            assert sigs[1].args[-1] == token and errback.args[-1] == token and rpd.LOCK_TTL > 6 * 3600
            extract, disc = sigs
            want_from = (watermark.astimezone(route.ZoneInfo("Africa/Johannesburg")).date() - timedelta(days=14))
            assert extract.args[2] == ["process_events_ptp"]
            assert extract.kwargs["scope"]["date_from"] == want_from.isoformat()
            assert extract.kwargs["include_config"] is False and extract.kwargs["analyse"] is False
            assert disc.args[2] == [started_ids[0]] and errback.args[2] == [started_ids[0]]  # l1s sorted: PTP, SFX
            assert started[0][0][2] == "process_discovery"
            assert (await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["PTP"]})).status_code == 409
            redis.delete(rpd.lock_key(tid, sid))

            # an L1 whose module the licence does not entitle is refused before any lock or run
            n_runs = len((await c.get(f"{BASE}/systems/{sid}/runs", headers=viewer)).json())
            r = await c.post(f"{BASE}/systems/{sid}/runs", json={"l1s": ["PTP"]}, headers={**h, "X-Test-Licensed": "fi_gl"})
            assert r.status_code == 402 and rpd.lock_key(tid, sid) not in redis.data
            assert len((await c.get(f"{BASE}/systems/{sid}/runs", headers=viewer)).json()) == n_runs

            runs = (await c.get(f"{BASE}/systems/{sid}/runs", headers=viewer, params={"l1": "SFX"})).json()
            assert runs[0]["status"] == "completed" and runs[0]["coverage"] == "reference"
            assert runs[0]["stats"]["reason"].startswith("Connect the SuccessFactors")
            ptp_new = (await c.get(f"{BASE}/runs/{started_ids[0]}", headers=viewer)).json()
            assert ptp_new["status"] == "queued" and ptp_new["mode"] == "incremental"
            assert ptp_new["window_from"] == want_from.isoformat()

            # the catalogue keeps the latest COMPLETED run's data and reports the queued run separately
            ptp = {r["l1"]: r for r in (await c.get(f"{BASE}/systems/{sid}/catalogue", headers=viewer)).json()}["PTP"]
            assert ptp["last_run"]["id"] == rid and ptp["last_run"]["status"] == "completed"
            assert ptp["coverage"] == "partial" and ptp["failed"] is None
            assert ptp["in_progress"]["id"] == started_ids[0] and ptp["in_progress"]["status"] == "queued"

            # a failing stage stores a fixed message: raw exception text (SQL, paths) never reaches the API
            leak = 'relation "process_events" does not exist; SELECT secret FROM pg_shadow'

            def boom(*_a):
                raise RuntimeError(leak)

            monkeypatch.setattr(rpd, "collect", boom)

            sess = tenant_session(owner, tid)
            assert rpd.discover(sess, tid, sid, [started_ids[0]], vid, frames_for=_frames,
                                today=date(2026, 10, 11)) == {started_ids[0]: "failed"}
            sess.close()
            bodies = [(await c.get(f"{BASE}/runs/{started_ids[0]}", headers=viewer)).text,
                      (await c.get(f"{BASE}/systems/{sid}/runs", headers=viewer)).text,
                      (await c.get(f"{BASE}/systems/{sid}/catalogue", headers=viewer)).text]
            for body in bodies:
                assert "SELECT" not in body and "pg_shadow" not in body and "process_events" not in body
            assert (await c.get(f"{BASE}/runs/{started_ids[0]}", headers=viewer)).json()["error"] == rpd.BUILD_ERROR
            ptp = {r["l1"]: r for r in (await c.get(f"{BASE}/systems/{sid}/catalogue", headers=viewer)).json()}["PTP"]
            assert ptp["in_progress"] is None and ptp["failed"]["error"] == rpd.BUILD_ERROR
            assert ptp["last_run"]["id"] == rid  # a failed newer run does not replace the completed one

            r = await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["SFX"]})
            assert r.json()["job_id"] is None and rpd.lock_key(tid, sid) not in redis.data
            assert len(FakeChain.calls) == 1

            # a tenant licensed for a module the PTP event log reads (EKKO is mm_purchasing's) gets past the check
            r = await c.post(f"{BASE}/systems/{sid}/runs", json={"l1s": ["PTP"]},
                             headers={**h, "X-Test-Licensed": "mm_purchasing,business_partner"})
            assert r.status_code == 200, r.text
            assert len(FakeChain.calls) == 2
            redis.delete(rpd.lock_key(tid, sid))
            FakeChain.calls.pop()

            # stored views
            model = (await c.get(f"{BASE}/runs/{rid}/model", headers=viewer)).json()
            assert model["source"] == "discovered" and [x["id"] for x in model["l1"]] == ["PTP"]
            assert (await c.get(f"{BASE}/runs/{rid}", headers=viewer)).json()["coverage"] == "partial"
            assert (await c.get(f"{BASE}/runs/{uuid.uuid4()}", headers=viewer)).status_code == 404
            assert (await c.get(f"{BASE}/runs/not-a-uuid", headers=viewer)).status_code == 422

            g = (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer)).json()
            assert g["level"] == 2 and g["node"]["id"] == "PTP" and g["cached"] is False
            assert g["edges"] and {e["source"] for e in g["edges"]} >= {"START"}
            assert all("median_seconds" in e for e in g["edges"])
            every = (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params={"all_edges": "true"})).json()
            assert {(e["source"], e["target"]) for e in g["edges"]} <= {(e["source"], e["target"]) for e in every["edges"]}
            f = {"doc_type": "NB"}
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()["cached"] is False
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()["cached"] is True
            wrong = {**f, "level": 3}  # the cached node is the L1, so its children are level 2
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=wrong)).status_code == 422
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params={**f, "level": 2})).json()["cached"] is True
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params={"node_id": "NOPE"})).status_code == 404

            # dq_defects: None without a finished analysis of the system; fresh on every request, cache hit included
            assert (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()["node"]["dq_defects"] is None
            assert {r["l1"]: r for r in (await c.get(f"{BASE}/systems/{sid}/catalogue", headers=viewer)).json()
                    }["PTP"]["dq_defects"] is None
            # no DQ run: the version id is null too (not "None" or an empty string) on the catalogue and the flow
            assert all(r["dq_version_id"] is None for r in (await c.get(f"{BASE}/systems/{sid}/catalogue", headers=viewer)).json())
            nodata = (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()
            assert nodata["node"]["dq_version_id"] is None and all(n["dq_version_id"] is None for n in nodata["nodes"])
            dq_v = str(uuid.uuid4())

            def seed(check_id: str, affected: int) -> None:
                with owner.begin() as conn:
                    if check_id == "DQ1":
                        conn.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) VALUES "
                                          "(:v, :t, 'complete', CAST(:m AS jsonb))"),
                                     {"v": dq_v, "t": tid, "m": json.dumps({"system_id": sid})})
                    conn.execute(text("INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, "
                                      "dimension, affected_count, total_count) VALUES (gen_random_uuid(), :v, :t, "
                                      "'mm_purchasing', :c, 'low', 'validity', :a, 10)"),
                                 {"v": dq_v, "t": tid, "c": check_id, "a": affected})
            seed("DQ1", 5)
            hit = (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()
            assert hit["cached"] is True and hit["node"]["dq_defects"] == 1
            assert hit["node"]["dq_version_id"] == dq_v and hit["nodes"][0]["dq_version_id"] == dq_v
            seed("DQ2", 2)
            hit = (await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)).json()
            assert hit["cached"] is True and hit["node"]["dq_defects"] == 2  # fresh, not the cached 1
            assert {r["l1"]: r for r in (await c.get(f"{BASE}/systems/{sid}/catalogue", headers=viewer)).json()
                    }["PTP"]["dq_defects"] == 2
            assert {r["l1"]: r for r in (await c.get(f"{BASE}/systems/{sid}/catalogue", headers=viewer)).json()
                    }["PTP"]["dq_version_id"] == dq_v

            # legacy cache entry (a bare DfgResponse, no dfg/modules keys): a miss, rewritten in the new format
            ckey = next(k for k, val in redis.data.items() if '"modules"' in val and '"dfg"' in val)
            legacy = json.dumps(json.loads(redis.data[ckey])["dfg"])
            redis.data[ckey] = legacy
            r = await c.get(f"{BASE}/runs/{rid}/dfg", headers=viewer, params=f)
            assert r.status_code == 200 and r.json()["cached"] is False
            rewritten = json.loads(redis.data[ckey])
            assert set(rewritten) == {"dfg", "modules"} and rewritten["dfg"]["node"]["id"] == "PTP"

            v = (await c.get(f"{BASE}/runs/{rid}/variants", headers=viewer)).json()
            assert v["case_type"] == "po_item" and v["total"] == len(v["items"]) > 0
            vf = (await c.get(f"{BASE}/runs/{rid}/variants", headers=viewer, params=f)).json()
            assert [x["hash"] for x in vf["items"]] == [x["hash"] for x in v["items"]]
            # sample case ids are SAP document keys: only a caller who may export sees them
            assert not any(x["sample_case_ids"] for x in v["items"])
            vh = (await c.get(f"{BASE}/runs/{rid}/variants", headers=h)).json()
            assert any(x["sample_case_ids"] for x in vh["items"])
            conf = (await c.get(f"{BASE}/runs/{rid}/conformance", headers=viewer)).json()
            assert conf["case_type"] == "po_item" and conf["steps"]

            # the Other bucket sorts last whatever its count
            with owner.begin() as oc:
                oc.execute(text("""INSERT INTO process_discovery_variants
                    (run_id, tenant_id, case_type, variant_hash, activities, case_count, share, sample_case_ids)
                    VALUES (:r, :t, 'po_item', :h, ARRAY['__OTHER__'], 999, 0.5, ARRAY[]::text[])"""),
                           {"r": rid, "t": str(tid), "h": "0" * 32})
            tail = (await c.get(f"{BASE}/runs/{rid}/variants", headers=viewer, params={"limit": 500})).json()["items"][-1]
            assert tail["hash"] == "0" * 32 and tail["activities"] == ["__OTHER__"]

            # the case explorer is viewing (every role that runs discovery opens Cases); export needs export_process (below)
            assert (await c.get(f"{BASE}/runs/{rid}/cases", headers=viewer)).status_code == 200
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

            # broker down: the lock is released, the queued runs fail, and the caller gets a 503
            class DownChain(FakeChain):
                def apply_async(self, link_error=None):
                    raise ConnectionError("amqp://user:secret@broker refused")

            monkeypatch.setattr(route, "chain", DownChain)
            r = await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["PTP"]})
            assert r.status_code == 503 and "secret" not in r.text
            assert rpd.lock_key(tid, sid) not in redis.data
            latest = (await c.get(f"{BASE}/systems/{sid}/runs", headers=viewer, params={"l1": "PTP"})).json()[0]
            assert latest["status"] == "failed" and latest["error"] == route.DISPATCH_ERROR
            monkeypatch.setattr(route, "chain", FakeChain)

            # Redis down: no lock, no run
            monkeypatch.setattr(route, "_redis_client", lambda: None)
            assert (await c.post(f"{BASE}/systems/{sid}/runs", headers=h, json={"l1s": ["PTP"]})).status_code == 503

    asyncio.run(scenario())
    asyncio.run(aeng.dispose())


@pg
def test_discovery_extraction_is_not_a_data_quality_version(app_engine, monkeypatch):  # noqa: F811
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import versions

    owner, app_eng = app_engine
    tid, mine, normal = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDV-{tid[:8]}"})
        for v, meta in ((mine, {"dataset_path": "mem", "purpose": "process_discovery"}), (normal, {"dataset_path": "mem"})):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                           "VALUES (:v, :t, 'extracted', CAST(:m AS jsonb))"), {"v": v, "t": tid, "m": json.dumps(meta)})
    factory = async_sessionmaker(create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg")),
                                 expire_on_commit=False)

    async def _db():
        async with factory() as sess:
            yield sess

    api = FastAPI()
    api.include_router(versions.router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "D", [])

    async def scenario():
        h = {"X-User-Role": "admin"}
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            ids = {x["id"] for x in (await c.get("/api/v1/versions", headers=h)).json()["versions"]}
            assert ids == {normal}
            assert (await c.post(f"/api/v1/versions/{mine}/analyse", headers=h)).status_code == 409

    asyncio.run(scenario())


@pg
def test_system_scoped_process_analyst_grant(app_engine, monkeypatch):  # noqa: F811
    """A process_analyst grant on one system opens that system's and its runs' routes, and no other system's."""
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.config import settings
    from api.deps import Tenant, get_db, get_tenant
    from api.routes import process_discovery as route

    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)
    monkeypatch.setattr(settings, "auth_mode", "local")
    redis = FakeRedis()
    monkeypatch.setattr(route, "_redis_client", lambda: redis)
    monkeypatch.setattr(route, "_insert_audit_row", lambda row: None)
    monkeypatch.setattr(route, "chain", FakeChain)
    monkeypatch.setattr(route.jobs, "start_job", lambda *a, **k: None)
    monkeypatch.setattr(route.jobs, "update_job", lambda *a, **k: None)
    FakeChain.calls = []

    owner, app_eng = app_engine
    tid, mine, other, uid = (str(uuid.uuid4()) for _ in range(4))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDS-{tid[:8]}"})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active) "
                       "VALUES (:u, :t, :e, 'u', 'viewer', true)"), {"u": uid, "t": tid, "e": f"{uid[:8]}@example.test"})
        runs = {}
        for sid in (mine, other):
            c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'S', 'ecc')"),
                      {"s": sid, "t": tid})
            runs[sid] = str(c.execute(text(
                "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status) "
                "VALUES (:t, :s, 'PTP', 'full', 'completed') RETURNING id"), {"t": tid, "s": sid}).scalar())
        c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key, system_id) "
                       "VALUES (:t, :u, 'process_analyst', :s)"), {"t": tid, "u": uid, "s": mine})
    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as sess:
            yield sess

    api = FastAPI()
    api.include_router(route.router)

    @api.middleware("http")
    async def _user(request, call_next):  # what the auth middleware sets
        request.state.local_user_id = uid
        return await call_next(request)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "D", [])

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            start = {"json": {"l1s": ["SFX"]}}  # reference-only: no lock, no chain
            assert (await c.get(f"{BASE}/systems/{mine}/catalogue")).status_code == 200
            assert (await c.post(f"{BASE}/systems/{mine}/runs", **start)).status_code == 200
            assert (await c.get(f"{BASE}/runs/{runs[mine]}")).status_code == 200
            assert (await c.get(f"{BASE}/runs/{runs[mine]}/cases")).status_code == 200  # view
            assert (await c.get(f"{BASE}/systems/{other}/catalogue")).status_code == 200  # users.role viewer sees all
            assert (await c.post(f"{BASE}/systems/{other}/runs", **start)).status_code == 403
            assert (await c.get(f"{BASE}/runs/{runs[other]}/cases")).status_code == 200  # users.role viewer: view
            assert (await c.get(f"{BASE}/runs/{runs[other]}/export/signavio")).status_code == 403

    asyncio.run(scenario())
    asyncio.run(aeng.dispose())
