"""POST /writeback/batches/{id}/check and /send: an approved fix batch written back to SAP from the batch inspector.

The check says per field whether a BAPI carries it and sends nothing; the send (approve permission, never by the
batch creator, only with live write-back on) simulates, commits on a clean RETURN, returns SAP's RETURN messages per
record and moves the batch to Sent to SAP. GET /settings says whether live write-back is on.
"""
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.main import app
from tests.route_auth import patch_tenant
from tests.test_bapi_writeback import FakeRFC

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
ME = "00000000-0000-0000-0000-000000000002"  # the signed-in user of tests/route_auth.py
KEY = "MATNR=000000000000000042|WERKS=1000"


def _batch(created_by: str, status: str = "approved"):
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, bid, sid = (str(uuid.uuid4()) for _ in range(3))
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, host, client, sysnr) "
                       "VALUES (:s, :t, 'ECC', 'ecc', 'sap-host', '100', '00')"), {"s": sid, "t": tid})
        c.execute(text("INSERT INTO system_credentials (id, system_id, encrypted_password) "
                       "VALUES (gen_random_uuid(), :s, 'enc')"), {"s": sid})
        c.execute(text("INSERT INTO remediation_batches (id, tenant_id, name, status, created_by, approved_by) "
                       "VALUES (:b, :t, 'Lead times', :st, CAST(:u AS uuid), gen_random_uuid())"),
                  {"b": bid, "t": tid, "st": status, "u": created_by})
        for check, fld, value in (("MM_PLIFZ", "MARC.PLIFZ", "12"), ("MM_NFMAT", "MARC.NFMAT", "X1")):
            c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, "
                           "field, current_value, proposed_value) VALUES (:t, :b, :s, 'material_master', :c, :k, "
                           ":f, '', :v)"), {"t": tid, "b": bid, "s": sid, "c": check, "k": KEY, "f": fld, "v": value})
    return engine, tid, bid, sid


def _drop(engine, tid, sid):
    with engine.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("DELETE FROM system_credentials WHERE system_id = :s"), {"s": sid})
        for t in ("remediation_events", "remediation_items", "remediation_batches", "sap_systems"):
            c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    engine.dispose()


@pytest.fixture
def batch():
    engine, tid, bid, sid = _batch(created_by=str(uuid.uuid4()))
    yield tid, bid
    _drop(engine, tid, sid)


@pytest.fixture
def my_batch():
    engine, tid, bid, sid = _batch(created_by=ME)
    yield tid, bid
    _drop(engine, tid, sid)


async def _call(method: str, path: str):
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.request(method, path, headers=HEADERS)


def _fake_sap(monkeypatch) -> FakeRFC:
    fake = FakeRFC(testrun=True)

    class _Conn(FakeRFC):
        def __enter__(self):
            return fake

        def __exit__(self, *a):
            return False

    fake.connect = lambda params: None
    monkeypatch.setattr("sap.get_connector", lambda *a, **kw: _Conn())
    monkeypatch.setattr("api.services.credential_store.decrypt_password", lambda t, e: "pw")
    return fake


@pytest.mark.anyio
async def test_settings_say_whether_live_writeback_is_on(batch, monkeypatch):
    from api.config import settings

    tid, _ = batch
    patch_tenant(monkeypatch, tid)
    r = await _call("GET", "/api/v1/settings")
    assert r.status_code == 200, r.text
    assert r.json()["live_writeback"] is False
    monkeypatch.setattr(settings, "live_writeback_enabled", True)
    assert (await _call("GET", "/api/v1/settings")).json()["live_writeback"] is True


@pytest.mark.anyio
async def test_check_says_per_field_what_a_bapi_carries_and_sends_nothing(batch, monkeypatch):
    tid, bid = batch
    patch_tenant(monkeypatch, tid)
    fake = _fake_sap(monkeypatch)
    r = await _call("POST", f"/api/v1/writeback/batches/{bid}/check")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["records"] == 1 and body["bapi"] == 1 and body["export_only"] == 1
    fields = {f["field"]: f for f in body["fields"]}
    assert fields["MARC.PLIFZ"]["delivery"] == "bapi" and fields["MARC.PLIFZ"]["bapi"] == "BAPI_MATERIAL_SAVEDATA"
    assert fields["MARC.NFMAT"]["delivery"] == "export" and fields["MARC.NFMAT"]["reason"]
    assert fake.calls == []


@pytest.mark.anyio
async def test_send_is_refused_while_live_writeback_is_off(batch, monkeypatch):
    tid, bid = batch
    patch_tenant(monkeypatch, tid)
    r = await _call("POST", f"/api/v1/writeback/batches/{bid}/send")
    assert r.status_code == 409 and "MERIDIAN_LIVE_WRITEBACK_ENABLED" in r.json()["detail"]


@pytest.mark.anyio
async def test_the_batch_creator_cannot_send_it(my_batch, monkeypatch):
    from api.config import settings

    tid, bid = my_batch
    patch_tenant(monkeypatch, tid)
    monkeypatch.setattr(settings, "live_writeback_enabled", True)
    r = await _call("POST", f"/api/v1/writeback/batches/{bid}/send")
    assert r.status_code == 403


@pytest.mark.anyio
async def test_send_simulates_commits_returns_sap_messages_and_marks_the_batch_sent(batch, monkeypatch):
    from api.config import settings

    tid, bid = batch
    patch_tenant(monkeypatch, tid)
    monkeypatch.setattr(settings, "live_writeback_enabled", True)
    fake = _fake_sap(monkeypatch)
    r = await _call("POST", f"/api/v1/writeback/batches/{bid}/send")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["sent"], body["failed"], body["export_only"]) == (1, 0, 1)
    rec = body["records"][0]
    assert rec["record_key"] == KEY and rec["committed"] and rec["fields"] == ["MARC.PLIFZ"]
    assert rec["messages"][0] == {"type": "S", "id": "M3", "number": "801", "message": "saved"}
    assert rec["simulated"] and rec["simulate_messages"][0]["message"] == "ok"
    assert fake.names() == ["BAPI_MATERIAL_SAVEDATA", "BAPI_MATERIAL_SAVEDATA", "BAPI_TRANSACTION_COMMIT"]
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        assert c.execute(text("SELECT status FROM remediation_batches WHERE id = :b"), {"b": bid}).scalar() == "exported"
    engine.dispose()


@pytest.mark.anyio
async def test_a_draft_batch_is_not_sent(monkeypatch):
    engine, tid, bid, sid = _batch(created_by=str(uuid.uuid4()), status="draft")
    try:
        patch_tenant(monkeypatch, tid)
        r = await _call("POST", f"/api/v1/writeback/batches/{bid}/check")
        assert r.status_code == 409
    finally:
        _drop(engine, tid, sid)
