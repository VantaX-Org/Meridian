"""Golden-record write-back end to end against a real Postgres (RLS enforced), with a fake connector.

preview -> request (simulate in the worker) -> submit (inbox task) -> four-eyes approve -> apply in
the worker -> per-field results, history and audit rows; idempotent re-runs; tenant isolation.
Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid

import pytest

from tests.test_record_issues_pg import app_engine  # noqa: F401  (module fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

GOLDEN = {"BUT000.PARTNER": "1000", "BUT000.NAME_ORG1": "Acme Ltd", "BUT000.BU_SORT1": "ACME",
          "BUT000.BU_GROUP": "BP01"}


class FakeOData:
    def __init__(self) -> None:
        self.row = {"OrganizationBPName1": "ACME LTD.", "SearchTerm1": "ACME"}
        self.patches: list[dict] = []

    def read_entity(self, entity_set, key, select):
        return {k: self.row.get(k) for k in select}, {"If-Match": "*"}

    def update_entity(self, entity_set, key, changes):
        self.patches.append(changes)
        self.row.update(changes)

    def close(self):
        pass


def _seed(owner, tid: str, stype: str, key: str, golden: dict, with_system: bool = True) -> str:
    from sqlalchemy import text

    vid = str(uuid.uuid4())
    with owner.begin() as c:
        meta = {}
        if with_system:
            sid = c.execute(text("INSERT INTO sap_systems (tenant_id, name, system_type, base_url) "
                                 "VALUES (:t, :n, :s, 'https://x.test') RETURNING id"),
                            {"t": tid, "n": f"{stype}-{key}", "s": stype}).scalar()
            meta = {"system_id": str(sid), "source": "extraction"}
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"), {"v": vid, "t": tid, "m": json.dumps(meta)})
        contrib = {f: {"value": v, "source_system": f"upload:{vid[:8]}", "extracted_at": "2026-10-01T00:00:00Z",
                       "confidence": 1.0} for f, v in golden.items()}
        return str(c.execute(text(
            "INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, source_contributions, status) "
            "VALUES (:t, 'business_partner', :k, CAST(:g AS jsonb), CAST(:s AS jsonb), 'golden') RETURNING id"),
            {"t": tid, "k": key, "g": json.dumps(golden), "s": json.dumps(contrib)}).scalar())


def test_golden_writeback_round_trip(app_engine, monkeypatch):  # noqa: F811
    from fastapi import FastAPI, Request
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.config import settings
    from api.deps import Tenant, get_db, get_tenant
    from api.routes import golden_writeback as routes
    from api.routes import master_records, stewardship
    from api.services import golden_writeback as gw
    from workers.db import tenant_session
    from workers.tasks import run_golden_writeback as worker

    owner, app_eng = app_engine
    tid, other = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'G1'), (:b, 'G2')"), {"a": tid, "b": other})
    rec = _seed(owner, tid, "s4hana_cloud", "1000", GOLDEN)
    ecc_rec = _seed(owner, tid, "ecc", "2000", GOLDEN)
    file_rec = _seed(owner, tid, "ecc", "3000", GOLDEN, with_system=False)

    sap = FakeOData()
    monkeypatch.setattr(gw, "connect_system", lambda session, t, sid: sap)
    queued: list[tuple[str, str, str]] = []
    monkeypatch.setattr(gw, "enqueue", lambda rid, t, mode: queued.append((rid, t, mode)))
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(settings, "live_writeback_enabled", False)

    def work() -> list[dict]:
        out = []
        while queued:
            rid, t, mode = queued.pop(0)
            s = tenant_session(app_eng, t)
            try:
                out.append(worker.run(s, t, rid, mode))
            finally:
                s.close()
        return out

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    current = {"tenant": tid}
    api = FastAPI()
    for r in (routes.router, master_records.router, stewardship.router):
        api.include_router(r)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(current["tenant"]), "G", [])

    @api.middleware("http")
    async def _as_user(request: Request, call_next):
        request.state.local_user_id = request.headers.get("x-test-uid")
        return await call_next(request)

    alice = {"X-User-Role": "admin", "x-test-uid": "alice"}
    bob = {"X-User-Role": "admin", "x-test-uid": "bob"}
    base = f"/api/v1/master-records/{rec}/writeback"

    def owner_rows(sql: str, **p):
        with owner.begin() as c:
            return c.execute(text(sql), {"t": tid, **p}).fetchall()

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            # Preview: the S/4HANA Cloud source system takes two BP fields, never the key
            p = (await c.get(f"{base}/preview", headers=alice)).json()
            assert p["writeback_supported"] is True and p["live_enabled"] is False
            [t] = p["targets"]
            assert t["system_type"] == "s4hana_cloud" and t["method"] == "odata_patch"
            assert {x["field"]: x["supported"] for x in t["fields"]} == {
                "BUT000.NAME_ORG1": True, "BUT000.BU_SORT1": True, "BUT000.BU_GROUP": False}
            # The legacy POST says the same, truthfully
            legacy = (await c.post(base, headers=alice)).json()
            assert legacy["writeback_supported"] is True and legacy["targets"][0]["system_id"] == t["system_id"]

            # ECC: BAPI_BUPA_CENTRAL_CHANGE carries the name and search term, not the grouping; a file upload has no system
            e = (await c.get(f"/api/v1/master-records/{ecc_rec}/writeback/preview", headers=alice)).json()
            assert e["writeback_supported"] is True
            ecc_fields = {x["field"]: x for x in e["targets"][0]["fields"]}
            assert ecc_fields["BUT000.NAME_ORG1"]["target"] == "BAPI_BUPA_CENTRAL_CHANGE"
            assert ecc_fields["BUT000.BU_GROUP"]["supported"] is False and ecc_fields["BUT000.BU_GROUP"]["reason"]
            f = (await c.get(f"/api/v1/master-records/{file_rec}/writeback/preview", headers=alice)).json()
            assert f["writeback_supported"] is False and f["targets"] == [] and "file upload" in f["message"]
            assert f["unresolved_sources"]

            # Request: simulate first, in the worker
            r = await c.post(f"{base}/requests", headers=alice)
            assert r.status_code == 202, r.text
            req = r.json()
            assert req["status"] == "simulating" and queued == [(req["id"], tid, "simulate")]
            assert work() == [{"status": "simulated", "counts": {"would_change": 1, "unchanged": 1, "unsupported": 1}}]
            assert sap.patches == []
            assert work() == []  # nothing queued; a redelivered simulate claims nothing:
            s = tenant_session(app_eng, tid)
            assert worker.run(s, tid, req["id"], "simulate")["skipped"] is True
            s.close()
            [got] = (await c.get(f"{base}/requests", headers=alice)).json()["requests"]
            name = {x["field"]: x for x in got["targets"][0]["fields"]}["BUT000.NAME_ORG1"]
            assert name["result"] == "would_change" and name["current_value"] == "ACME LTD."

            # Submit: only the requester; then an inbox task for a second person
            assert (await c.post(f"{base}/requests/{req['id']}/submit", headers=bob)).status_code == 403
            r = await c.post(f"{base}/requests/{req['id']}/submit", headers=alice)
            assert r.status_code == 200 and r.json()["status"] == "pending_approval", r.text
            [task] = owner_rows("SELECT id, status FROM stewardship_queue WHERE tenant_id = :t "
                                "AND item_type = 'golden_writeback' AND source_id = :r", r=rec)
            assert task[1] == "open"
            # A second request cannot start while one waits
            assert (await c.post(f"{base}/requests", headers=alice)).status_code == 409

            # Four-eyes: the requester cannot approve, here or in the inbox
            r = await c.post(f"{base}/approve", headers=alice)
            assert r.status_code == 403 and "4-eyes" in r.json()["detail"]
            r = await c.put(f"/api/v1/stewardship/{task[0]}/resolve", json={"action": "approve"}, headers=alice)
            assert r.status_code == 403
            # Live write-back off: refused, nothing queued or written
            r = await c.post(f"{base}/approve", headers=bob)
            assert r.status_code == 409 and "disabled" in r.json()["detail"] and queued == []
            # Bulk approve never approves an SAP write
            r = await c.post("/api/v1/stewardship/bulk-approve", json={"item_ids": [str(task[0])], "min_confidence": 0},
                             headers=bob)
            assert r.status_code == 200 and r.json()["approved"] == 0

            monkeypatch.setattr(settings, "live_writeback_enabled", True)
            r = await c.put(f"/api/v1/stewardship/{task[0]}/resolve", json={"action": "approve"}, headers=bob)
            assert r.status_code == 200, r.text
            assert queued == [(req["id"], tid, "apply")]
            assert owner_rows("SELECT status FROM stewardship_queue WHERE id = :i", i=task[0])[0][0] == "resolved"
            # Approving again: nothing is waiting
            assert (await c.post(f"{base}/approve", headers=bob)).status_code == 409

            # Apply: writes only the approved change; per-field results
            assert work() == [{"status": "applied", "counts": {"written": 1, "unchanged": 1, "unsupported": 1}}]
            assert sap.patches == [{"OrganizationBPName1": "Acme Ltd"}]
            [done] = (await c.get(f"{base}/requests", headers=alice)).json()["requests"]
            assert done["status"] == "applied" and done["approved_by"] == "bob" and done["requested_by"] == "alice"
            fields = {x["field"]: x["result"] for x in done["targets"][0]["fields"]}
            assert fields == {"BUT000.NAME_ORG1": "written", "BUT000.BU_SORT1": "unchanged",
                              "BUT000.BU_GROUP": "unsupported"}

            # Idempotent: a redelivered apply finds nothing approved and writes nothing
            s = tenant_session(app_eng, tid)
            assert worker.run(s, tid, req["id"], "apply")["skipped"] is True
            s.close()
            assert sap.patches == [{"OrganizationBPName1": "Acme Ltd"}]

            hist = owner_rows("SELECT change_type, new_fields FROM master_record_history WHERE master_record_id = :r",
                              r=rec)
            assert [(h[0], h[1]) for h in hist] == [("written_back", {"BUT000.NAME_ORG1": "Acme Ltd"})]
            actions = {(a[0], a[1]) for a in owner_rows(
                "SELECT action, actor_email FROM audit_log WHERE tenant_id = :t "
                "AND entity_type = 'golden_writeback_request'")}
            assert actions == {("golden_writeback.requested", "alice"), ("golden_writeback.simulated", "alice"),
                               ("golden_writeback.submitted", "alice"), ("golden_writeback.approved", "bob"),
                               ("golden_writeback.applied", "bob")}

            # Reject path: a new request, rejected by the second person, never applied
            sap.row["OrganizationBPName1"] = "Drifted"
            req2 = (await c.post(f"{base}/requests", headers=alice)).json()
            work()
            assert (await c.post(f"{base}/requests/{req2['id']}/submit", headers=alice)).status_code == 200
            r = await c.post(f"{base}/reject", headers=bob)
            assert r.status_code == 200 and r.json()["status"] == "rejected" and queued == []
            s = tenant_session(app_eng, tid)
            assert worker.run(s, tid, req2["id"], "apply")["skipped"] is True
            s.close()

            # Tenant isolation: another tenant sees neither the record nor its requests
            current["tenant"] = other
            assert (await c.get(f"{base}/requests", headers=alice)).status_code == 404
            assert (await c.post(f"{base}/approve", headers=bob)).status_code == 404
            current["tenant"] = tid

    async def main():
        try:
            await scenario()
        finally:
            await aeng.dispose()

    asyncio.run(main())


def test_golden_writeback_races_and_malformed_ids(app_engine, monkeypatch):  # noqa: F811
    """A simulation cancelled while the worker runs stays cancelled; submitting while another request holds
    the record's one open slot is a 409, not a unique-index 500; malformed ids are 404s."""
    from fastapi import FastAPI, Request
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import golden_writeback as routes
    from api.services import golden_writeback as gw
    from workers.db import tenant_session
    from workers.tasks import run_golden_writeback as worker

    owner, app_eng = app_engine
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'G3')"), {"a": tid})
    rec = _seed(owner, tid, "s4hana_cloud", "1000", GOLDEN)
    sap = FakeOData()
    monkeypatch.setattr(gw, "connect_system", lambda session, t, sid: sap)
    queued: list[tuple[str, str, str]] = []
    monkeypatch.setattr(gw, "enqueue", lambda rid, t, mode: queued.append((rid, t, mode)))
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")

    def status(rid: str) -> str:
        with owner.begin() as c:
            return c.execute(text("SELECT status FROM golden_writeback_requests WHERE id = :i"), {"i": rid}).scalar()

    def run(rid: str, mode: str) -> dict:
        s = tenant_session(app_eng, tid)
        try:
            return worker.run(s, tid, rid, mode)
        finally:
            s.close()

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(routes.router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "G", [])

    @api.middleware("http")
    async def _as_user(request: Request, call_next):
        request.state.local_user_id = "alice"
        return await call_next(request)

    h = {"X-User-Role": "admin"}
    base = f"/api/v1/master-records/{rec}/writeback"

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            assert (await c.get("/api/v1/master-records/not-a-uuid/writeback/preview", headers=h)).status_code == 404
            assert (await c.get("/api/v1/master-records/not-a-uuid/writeback/requests", headers=h)).status_code == 404
            assert (await c.post(f"{base}/requests/not-a-uuid/submit", headers=h)).status_code == 404

            # cancelled (superseded) while the worker simulates: the result is dropped
            first = (await c.post(f"{base}/requests", headers=h)).json()["id"]
            real = gw.execute_targets

            def cancel_midway(*a, **k):
                with owner.begin() as conn:
                    conn.execute(text("UPDATE golden_writeback_requests SET status = 'cancelled' WHERE id = :i"),
                                 {"i": first})
                return real(*a, **k)

            monkeypatch.setattr(gw, "execute_targets", cancel_midway)
            assert run(first, "simulate")["skipped"] is True
            assert status(first) == "cancelled"
            monkeypatch.setattr(gw, "execute_targets", real)

            # a simulated request cannot be submitted while another holds the open slot
            second = (await c.post(f"{base}/requests", headers=h)).json()["id"]
            assert run(second, "simulate")["status"] == "simulated"
            with owner.begin() as conn:
                conn.execute(text("INSERT INTO golden_writeback_requests (tenant_id, master_record_id, status, "
                                  "requested_by) VALUES (:t, :r, 'pending_approval', 'carol')"), {"t": tid, "r": rec})
            r = await c.post(f"{base}/requests/{second}/submit", headers=h)
            assert r.status_code == 409 and "pending approval" in r.json()["detail"], r.text
            assert status(second) == "simulated"

    async def main():
        try:
            await scenario()
        finally:
            await aeng.dispose()

    asyncio.run(main())


@pytest.mark.parametrize("mode", ["apply", "simulate"])
def test_worker_error_releases_the_claim(app_engine, monkeypatch, mode):  # noqa: F811
    """Any error (not only a connector error), e.g. a credential that fails to decrypt, fails the request
    instead of leaving it applying/simulating and holding the record's one open slot."""
    from sqlalchemy import text

    from api.services import golden_writeback as gw
    from workers.db import tenant_session
    from workers.tasks import run_golden_writeback as worker

    owner, app_eng = app_engine
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'GE')"), {"a": tid})
    rec = _seed(owner, tid, "s4hana_cloud", "1000", GOLDEN)
    targets = [{"system_id": str(uuid.uuid4()), "system_name": "x", "system_type": "s4hana_cloud", "supported": True,
                "fields": [{"field": "BUT000.NAME_ORG1", "supported": True, "result": "would_change",
                            "golden_value": "A", "target": "OrganizationBPName1"}]}]
    with owner.begin() as c:
        req = str(c.execute(text(
            "INSERT INTO golden_writeback_requests (tenant_id, master_record_id, status, requested_by, targets) "
            "VALUES (:t, :r, :s, 'u1', CAST(:tg AS jsonb)) RETURNING id"),
            {"t": tid, "r": rec, "s": "approved" if mode == "apply" else "simulating",
             "tg": json.dumps(targets)}).scalar())

    class InvalidTag(Exception):
        pass

    def boom(session, t, sid):
        raise InvalidTag()

    monkeypatch.setattr(gw, "connect_system", boom)
    s = tenant_session(app_eng, tid)
    try:
        with pytest.raises(InvalidTag):
            worker.run(s, tid, req, mode)
    finally:
        s.close()
    with owner.begin() as c:
        st, err = c.execute(text("SELECT status, error FROM golden_writeback_requests WHERE id = :i"),
                            {"i": req}).one()
    assert st == ("failed" if mode == "apply" else "simulation_failed")
    assert err == "Write-back failed (InvalidTag)"
