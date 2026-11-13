"""Batch write-back in the background: POST /writeback/batches/{id}/send creates a run, the worker
(workers/tasks/run_batch_writeback.py) sends it in chunks against a fake connector, and the run survives a crash,
a lost connection, a cancel and a retry. Also row level security and the one open run per batch."""
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.config import settings
from api.main import app
from sap.base import SAPConnectorError
from tests.route_auth import patch_tenant
from tests.test_writeback_safety import ReadRFC
from tests.test_writeback_batch_route_pg import HEADERS, ME, drive
from workers.db import tenant_session
from workers.tasks import run_batch_writeback as worker

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")
URL = os.environ.get("MERIDIAN_TEST_DB_URL", "")
N = 5


def _key(i: int) -> str:
    return f"MATNR=00000000000000{i:04d}|WERKS=1000"


@pytest.fixture
def env(monkeypatch):
    """An approved batch of N records (one BAPI field each) on one system, live write-back on, chunks of 2."""
    engine = create_engine(URL)
    tid, bid, sid = (str(uuid.uuid4()) for _ in range(3))
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, host, client, sysnr) "
                       "VALUES (:s, :t, 'ECC', 'ecc', 'sap-host', '100', '00')"), {"s": sid, "t": tid})
        c.execute(text("INSERT INTO system_credentials (id, system_id, encrypted_password) "
                       "VALUES (gen_random_uuid(), :s, 'enc')"), {"s": sid})
        c.execute(text("INSERT INTO remediation_batches (id, tenant_id, name, status, created_by, approved_by) "
                       "VALUES (:b, :t, 'Lead times', 'approved', gen_random_uuid(), gen_random_uuid())"),
                  {"b": bid, "t": tid})
        for i in range(N):
            c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, "
                           "field, current_value, proposed_value) VALUES (:t, :b, :s, 'material_master', 'MM_PLIFZ', "
                           ":k, 'MARC.PLIFZ', '', '12')"), {"t": tid, "b": bid, "s": sid, "k": _key(i)})
    patch_tenant(monkeypatch, tid)
    monkeypatch.setattr(settings, "live_writeback_enabled", True)
    monkeypatch.setattr(settings, "writeback_chunk_size", 2)
    monkeypatch.setattr(settings, "writeback_chunk_pause_seconds", 0.0)
    monkeypatch.setattr(settings, "writeback_connect_retry_seconds", 0.0)
    queued: list = []
    monkeypatch.setattr("api.routes.writeback._enqueue", lambda run_id, t: queued.append(run_id))
    monkeypatch.setattr("api.services.credential_store.decrypt_password", lambda t, e: "pw")
    yield engine, tid, bid, sid, queued
    with engine.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("DELETE FROM system_credentials WHERE system_id = :s"), {"s": sid})
        for t in ("audit_log", "writeback_runs", "remediation_events", "remediation_items", "remediation_batches", "sap_systems"):
            c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    engine.dispose()


def _sap(monkeypatch, fake=None, fail_connect=False):
    """A fake connector; ``opened`` counts connections (one per chunk)."""
    fake = fake or ReadRFC({})  # SAP still holds the blank each item was based on
    opened: list = []

    class _Conn:
        def __enter__(self):
            return fake

        def __exit__(self, *a):
            return False

    def _connect(params):
        opened.append(1)
        if fail_connect:
            raise SAPConnectorError("no route to host")

    fake.connect = _connect
    monkeypatch.setattr("sap.get_connector", lambda *a, **kw: _Conn())
    return fake, opened


async def _call(method, path, body=None):
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.request(method, path, headers=HEADERS, json=body)


def q(env, sql, **p):
    engine, tid = env[0], env[1]
    with engine.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        r = c.execute(text(sql), p)
        return r.fetchall() if r.returns_rows else []


async def _send(env):
    r = await _call("POST", f"/api/v1/writeback/batches/{env[2]}/send")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.anyio
async def test_send_returns_at_once_and_the_worker_commits_in_chunks(env, monkeypatch):
    engine, tid, bid, sid, queued = env
    fake, opened = _sap(monkeypatch)
    run = await _send(env)
    assert run["status"] == "queued" and run["records"] == N and run["counts"]["pending"] == N
    assert queued == [run["id"]] and fake.calls == []
    # a second send while the run is open returns the same run and creates nothing
    assert (await _send(env))["id"] == run["id"] and queued == [run["id"]]
    drive(tid, run["id"])
    done = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()
    assert done["status"] == "completed" and done["counts"]["committed"] == N
    assert len(opened) == 3  # chunks of 2, 2 and 1: one RFC connection each
    assert q(env, "SELECT status FROM remediation_batches WHERE id = :b", b=bid)[0][0] == "exported"
    assert q(env, "SELECT count(DISTINCT action) , count(*) FROM remediation_events WHERE batch_id = :b", b=bid)[0] == (1, N)
    assert q(env, "SELECT count(*) FROM audit_log WHERE action = 'writeback_run.completed' AND entity_id = :r", r=run["id"])[0][0] == 1
    assert fake.names().count("BAPI_TRANSACTION_COMMIT") == N
    # a finished batch is not sent twice: nothing is left for a new run
    assert (await _call("POST", f"/api/v1/writeback/batches/{bid}/send")).status_code == 409


@pytest.mark.anyio
async def test_crash_mid_chunk_leaves_the_record_in_doubt_and_resume_does_not_resend_it(env, monkeypatch):
    engine, tid, bid, sid, queued = env
    fake, _ = _sap(monkeypatch)
    import sap.bapi_writeback as bw

    orig, calls = bw.write_record, []

    def flaky(conn, module, key, changes, apply, cache):
        calls.append(key)
        if len(calls) == 2:
            raise RuntimeError("worker killed")
        return orig(conn, module, key, changes, apply=apply, cache=cache)

    monkeypatch.setattr(bw, "write_record", flaky)
    run = await _send(env)
    drive(tid, run["id"])
    paused = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()
    assert paused["status"] == "paused" and "worker error" in paused["pause_reason"]
    assert paused["counts"]["committed"] == 1 and paused["counts"]["needs_check"] == 1 and paused["counts"]["pending"] == 3
    monkeypatch.setattr(bw, "write_record", orig)
    r = await _call("POST", f"/api/v1/writeback/batches/{bid}/run/resume")
    assert r.status_code == 200 and r.json()["status"] == "queued"
    drive(tid, run["id"])
    done = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()
    assert done["status"] == "completed_with_errors"
    assert done["counts"]["committed"] == N - 1 and done["counts"]["needs_check"] == 1
    page = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run/records")).json()
    assert [x["state"] for x in page["items"]] == ["needs_check"] and page["items"][0]["record_key"] == calls[1]
    assert "check this record in SAP" in page["items"][0]["error"]
    assert fake.names().count("BAPI_TRANSACTION_COMMIT") == N - 1  # the doubtful record was never sent again


@pytest.mark.anyio
async def test_a_stalled_run_is_taken_over_by_resume(env, monkeypatch):
    engine, tid, bid, sid, queued = env
    _sap(monkeypatch)
    run = await _send(env)
    q(env, "UPDATE writeback_runs SET status = 'running', heartbeat_at = now() - interval '1 hour' WHERE id = :r", r=run["id"])
    q(env, "UPDATE writeback_run_records SET state = 'sending' WHERE seq = 0")
    assert (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()["stale"] is True
    assert (await _call("POST", f"/api/v1/writeback/batches/{bid}/run/resume")).status_code == 200
    got = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()
    assert got["counts"]["needs_check"] == 1 and got["counts"]["sending"] == 0 and got["status"] == "queued"
    # a healthy run cannot be resumed
    q(env, "UPDATE writeback_runs SET status = 'running', heartbeat_at = now() WHERE id = :r", r=run["id"])
    assert (await _call("POST", f"/api/v1/writeback/batches/{bid}/run/resume")).status_code == 409


@pytest.mark.anyio
async def test_repeated_connection_failures_pause_and_leave_the_rest_unsent(env, monkeypatch):
    engine, tid, bid, sid, queued = env
    _, opened = _sap(monkeypatch, fail_connect=True)
    run = await _send(env)
    drive(tid, run["id"])
    got = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()
    assert got["status"] == "paused" and "3 connection failures" in got["pause_reason"]
    assert got["counts"] == {"pending": N, "sending": 0, "committed": 0, "failed": 0, "needs_check": 0, "export_only": 0, "stale": 0}
    assert len(opened) == 3
    assert q(env, "SELECT status FROM remediation_batches WHERE id = :b", b=bid)[0][0] == "approved"


@pytest.mark.anyio
async def test_cancel_stops_after_the_chunk_in_progress(env, monkeypatch):
    engine, tid, bid, sid, queued = env
    fake, _ = _sap(monkeypatch)
    run = await _send(env)
    orig, seen = fake.execute_bapi, []

    def cancel_after_first_commit(call):
        out = orig(call)
        if call.bapi_name == "BAPI_TRANSACTION_COMMIT" and not seen:
            seen.append(1)
            q(env, "UPDATE writeback_runs SET status = 'cancelling' WHERE id = :r", r=run["id"])
        return out

    fake.execute_bapi = cancel_after_first_commit
    drive(tid, run["id"])
    got = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()
    assert got["status"] == "cancelled" and got["counts"]["committed"] == 2 and got["counts"]["pending"] == N - 2
    # a queued run cancels at once
    q(env, "UPDATE writeback_runs SET status = 'queued', finished_at = NULL WHERE id = :r", r=run["id"])
    r = await _call("POST", f"/api/v1/writeback/batches/{bid}/run/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert (await _call("POST", f"/api/v1/writeback/batches/{bid}/run/cancel")).status_code == 409


@pytest.mark.anyio
async def test_a_second_cancel_leaves_a_live_worker_to_finish_the_stop(env, monkeypatch):
    engine, tid, bid, sid, queued = env
    _sap(monkeypatch)
    run = await _send(env)
    q(env, "UPDATE writeback_runs SET status = 'running', heartbeat_at = now() WHERE id = :r", r=run["id"])
    q(env, "UPDATE writeback_run_records SET state = 'sending' WHERE seq = 0")
    for _ in range(2):
        r = await _call("POST", f"/api/v1/writeback/batches/{bid}/run/cancel")
        assert r.status_code == 200 and r.json()["status"] == "cancelling"
    assert r.json()["counts"]["sending"] == 1 and r.json()["counts"]["needs_check"] == 0


@pytest.mark.anyio
async def test_a_worker_stops_sending_once_the_run_is_no_longer_its_own(env, monkeypatch):
    engine, tid, bid, sid, queued = env
    fake, _ = _sap(monkeypatch)
    run = await _send(env)
    orig, seen = fake.execute_bapi, []

    def cancel_outright_after_first_commit(call):
        out = orig(call)
        if call.bapi_name == "BAPI_TRANSACTION_COMMIT" and not seen:
            seen.append(1)
            q(env, "UPDATE writeback_runs SET status = 'cancelled' WHERE id = :r", r=run["id"])
        return out

    fake.execute_bapi = cancel_outright_after_first_commit
    drive(tid, run["id"])
    got = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()
    assert got["status"] == "cancelled" and got["counts"]["committed"] == 2 and got["counts"]["pending"] == N - 2


@pytest.mark.anyio
async def test_the_batch_creator_cannot_resume_or_retry(env, monkeypatch):
    engine, tid, bid, sid, queued = env
    _sap(monkeypatch)
    run = await _send(env)
    q(env, "UPDATE writeback_runs SET status = 'paused' WHERE id = :r", r=run["id"])
    q(env, "UPDATE remediation_batches SET created_by = :u WHERE id = :b", u=ME, b=bid)
    for action in ("resume", "retry-failed"):
        assert (await _call("POST", f"/api/v1/writeback/batches/{bid}/run/{action}")).status_code == 403


@pytest.mark.anyio
async def test_retry_failed_requeues_only_failed_records(env, monkeypatch):
    engine, tid, bid, sid, queued = env
    bad = {"TYPE": "E", "ID": "M3", "NUMBER": "100", "MESSAGE": "plant not maintained"}
    fake, _ = _sap(monkeypatch, ReadRFC({}, sim_return=bad))
    run = await _send(env)
    drive(tid, run["id"])
    got = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()
    assert got["status"] == "completed_with_errors" and got["counts"]["failed"] == N and got["counts"]["committed"] == 0
    page = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run/records?limit=2")).json()
    assert page["total"] == N and len(page["items"]) == 2
    assert page["items"][0]["messages"][0]["message"] == "plant not maintained"
    q(env, "UPDATE writeback_run_records SET state = 'needs_check' WHERE seq = 0")
    fake.sim_return = {"TYPE": "S", "ID": "M3", "NUMBER": "801", "MESSAGE": "ok"}
    r = await _call("POST", f"/api/v1/writeback/batches/{bid}/run/retry-failed", {})
    assert r.status_code == 200 and r.json()["counts"]["pending"] == N - 1
    drive(tid, run["id"])
    done = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()
    assert done["counts"]["committed"] == N - 1 and done["counts"]["needs_check"] == 1
    assert (await _call("POST", f"/api/v1/writeback/batches/{bid}/run/retry-failed", {})).status_code == 409


@pytest.mark.anyio
async def test_live_off_pauses_the_worker_and_sandbox_holds_it(env, monkeypatch):
    engine, tid, bid, sid, queued = env
    fake, _ = _sap(monkeypatch)
    run = await _send(env)
    monkeypatch.setattr(settings, "live_writeback_enabled", False)
    drive(tid, run["id"])
    got = (await _call("GET", f"/api/v1/writeback/batches/{bid}/run")).json()
    assert got["status"] == "paused" and "off on this deployment" in got["pause_reason"] and fake.calls == []


def test_one_open_run_per_batch_and_row_level_security(env):
    engine, tid, bid, sid, _ = env
    other = str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": other})
    try:
        with engine.begin() as c:
            c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
            for st in ("completed", "paused"):  # closed runs pile up; one open run at most
                c.execute(text("INSERT INTO writeback_runs (tenant_id, batch_id, status, requested_by) "
                               "VALUES (:t, :b, :s, 'u')"), {"t": tid, "b": bid, "s": st})
        with pytest.raises(Exception, match="uq_writeback_runs_open"):
            with engine.begin() as c:
                c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
                c.execute(text("INSERT INTO writeback_runs (tenant_id, batch_id, status, requested_by) "
                               "VALUES (:t, :b, 'queued', 'u')"), {"t": tid, "b": bid})
        with engine.begin() as c:
            c.execute(text("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wv_rls_app') THEN "
                           "CREATE ROLE wv_rls_app NOSUPERUSER NOBYPASSRLS; END IF; END $$"))
            for t in ("writeback_runs", "writeback_run_records"):
                c.execute(text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {t} TO wv_rls_app"))
        with engine.connect() as conn:  # a role that cannot bypass row level security
            tx = conn.begin()
            conn.execute(text("SET LOCAL ROLE wv_rls_app"))
            conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": other})
            assert conn.execute(text("SELECT count(*) FROM writeback_runs")).scalar() == 0
            assert conn.execute(text("UPDATE writeback_runs SET status = 'completed'")).rowcount == 0
            with pytest.raises(Exception, match="row-level security"):
                conn.execute(text("INSERT INTO writeback_runs (tenant_id, batch_id, status, requested_by) "
                                  "VALUES (:t, :b, 'completed', 'u')"), {"t": tid, "b": bid})
            tx.rollback()
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": other})
