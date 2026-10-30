"""POST /writeback/batches/{id}/check and /send for an approved accounts payable batch: vendor fields go through the
vendor's business partner where the connected system links one (CVI), company code and purchasing data go with the
export, and a classic release without CVI sends nothing for the vendor, with the reason. Fake RFC connector."""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from api.config import settings
from tests.route_auth import patch_tenant
from tests.test_vendor_writeback import BPC, CVI_TABLES, LIFNR, VendorRFC
from tests.test_writeback_batch_route_pg import _call, _drop

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

KEY = f"LIFNR={LIFNR}|BUKRS=1000"


@pytest.fixture
def ap_batch():
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
                       "VALUES (:b, :t, 'Vendor names', 'approved', gen_random_uuid(), gen_random_uuid())"),
                  {"b": bid, "t": tid})
        for check, fld, value in (("AP003", "LFA1.NAME1", "Acme GmbH"), ("AP_ZTERM", "LFB1.ZTERM", "0001")):
            c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, "
                           "field, current_value, proposed_value) VALUES (:t, :b, :s, 'accounts_payable', :c, :k, "
                           ":f, '', :v)"), {"t": tid, "b": bid, "s": sid, "c": check, "k": KEY, "f": fld, "v": value})
    yield tid, bid
    _drop(engine, tid, sid)


def _fake(monkeypatch, **kw) -> VendorRFC:
    fake = VendorRFC(**kw)

    class _Conn:
        def __enter__(self):
            return fake

        def __exit__(self, *a):
            return False

    fake.connect = lambda params: None
    monkeypatch.setattr("sap.get_connector", lambda *a, **k: _Conn())
    monkeypatch.setattr("api.services.credential_store.decrypt_password", lambda t, e: "pw")
    return fake


@pytest.mark.anyio
async def test_check_without_live_writeback_plans_without_contacting_sap(ap_batch, monkeypatch):
    tid, bid = ap_batch
    patch_tenant(monkeypatch, tid)
    fake = _fake(monkeypatch)
    body = (await _call("POST", f"/api/v1/writeback/batches/{bid}/check")).json()
    fields = {f["field"]: f for f in body["fields"]}
    assert fields["LFA1.NAME1"]["delivery"] == "bapi" and fields["LFA1.NAME1"]["bapi"] == BPC
    assert "business partner" in fields["LFA1.NAME1"]["reason"]
    assert fields["LFB1.ZTERM"]["delivery"] == "export" and "VMD_EI_API" in fields["LFB1.ZTERM"]["reason"]
    assert fake.calls == [] and fake.reads == [] and fake.searched == []


@pytest.mark.anyio
async def test_check_asks_sap_which_vendors_are_business_partners(ap_batch, monkeypatch):
    tid, bid = ap_batch
    patch_tenant(monkeypatch, tid)
    monkeypatch.setattr(settings, "live_writeback_enabled", True)
    fake = _fake(monkeypatch)
    r = await _call("POST", f"/api/v1/writeback/batches/{bid}/check")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["records"], body["bapi"], body["export_only"]) == (1, 1, 1)
    assert {f["field"]: f["delivery"] for f in body["fields"]} == {"LFA1.NAME1": "bapi", "LFB1.ZTERM": "export"}
    assert fake.names() == []  # read only: function search and table reads, no BAPI


@pytest.mark.anyio
async def test_check_on_a_classic_release_moves_the_vendor_to_the_export(ap_batch, monkeypatch):
    tid, bid = ap_batch
    patch_tenant(monkeypatch, tid)
    monkeypatch.setattr(settings, "live_writeback_enabled", True)
    _fake(monkeypatch, tables={**CVI_TABLES, "CVI_VEND_LINK": CVI_TABLES["CVI_VEND_LINK"].iloc[0:0]})
    body = (await _call("POST", f"/api/v1/writeback/batches/{bid}/check")).json()
    assert (body["bapi"], body["export_only"]) == (0, 2)
    name = {f["field"]: f for f in body["fields"]}["LFA1.NAME1"]
    assert name["delivery"] == "export" and name["reason"].startswith(
        "Vendor master on this release changes through the vendor maintenance transaction; Meridian exports a load file")


@pytest.mark.anyio
async def test_send_writes_the_vendor_name_through_the_business_partner(ap_batch, monkeypatch):
    tid, bid = ap_batch
    patch_tenant(monkeypatch, tid)
    monkeypatch.setattr(settings, "live_writeback_enabled", True)
    fake = _fake(monkeypatch)
    r = await _call("POST", f"/api/v1/writeback/batches/{bid}/send")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["sent"], body["failed"], body["export_only"]) == (1, 0, 1)
    rec = body["records"][0]
    assert rec["committed"] and rec["bapis"] == [BPC] and rec["fields"] == ["LFA1.NAME1"] and rec["export"] == []
    assert fake.names() == [BPC, "BAPI_TRANSACTION_ROLLBACK", BPC, "BAPI_TRANSACTION_COMMIT"]
    assert fake.params(BPC)[-1]["BUSINESSPARTNER"] == "0000900001"


@pytest.mark.anyio
async def test_send_on_a_classic_release_sends_nothing_and_says_why(ap_batch, monkeypatch):
    tid, bid = ap_batch
    patch_tenant(monkeypatch, tid)
    monkeypatch.setattr(settings, "live_writeback_enabled", True)
    fake = _fake(monkeypatch, functions=())
    body = (await _call("POST", f"/api/v1/writeback/batches/{bid}/send")).json()
    assert (body["sent"], body["failed"], body["export_only"]) == (0, 0, 2)
    assert body["status"] == "completed_with_errors" and fake.names() == []
    rec = body["records"][0]
    assert rec["export"][0]["field"] == "LFA1.NAME1" and "vendor maintenance transaction" in rec["export"][0]["reason"]
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        assert c.execute(text("SELECT status FROM remediation_batches WHERE id = :b"), {"b": bid}).scalar() == "approved"
    engine.dispose()
