"""POST /writeback and /writeback/approve with the BAPI mappings, over Postgres and a fake RFC connector.

The dry run says per field whether a BAPI carries it (and why not); the approval simulates, then commits only
on a clean RETURN, and stores SAP's RETURN messages per record in write_back_log.
"""
import json
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
KEY = "MATNR=000000000000000042|WERKS=1000"
FIXES = [{"auto_fix": True, "record_key": KEY, "field": "MARC.PLIFZ", "proposed_value": "12"},
         {"auto_fix": True, "record_key": KEY, "field": "MARC.NFMAT", "proposed_value": "X1"}]
CONN = {"host": "sap-host", "client": "100", "user": "u", "password": "p", "sysnr": "00"}


@pytest.fixture
def finding():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, vid, fid, sid = (str(uuid.uuid4()) for _ in range(4))
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                  {"v": vid, "t": tid})
        c.execute(text("""
            INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, affected_count,
                                  total_count, pass_rate, record_fixes)
            VALUES (:f, :v, :t, 'material_master', 'MM_TEST', 'high', 'completeness', 1, 10, 90, CAST(:r AS jsonb))"""),
                  {"f": fid, "v": vid, "t": tid, "r": json.dumps(FIXES)})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, host, client, sysnr) "
                       "VALUES (:s, :t, 'ECC', 'ecc', 'sap-host', '100', '00')"), {"s": sid, "t": tid})
        c.execute(text("INSERT INTO system_credentials (id, system_id, encrypted_password) "
                       "VALUES (gen_random_uuid(), :s, 'enc')"), {"s": sid})
    yield tid, fid
    with engine.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("DELETE FROM system_credentials WHERE system_id = :s"), {"s": sid})
        for t in ("write_back_log", "findings", "sap_systems", "analysis_versions"):
            c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    engine.dispose()


async def _post(path: str, body=None):
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(path, json=body, headers=HEADERS)


@pytest.mark.anyio
async def test_dry_run_says_per_field_what_a_bapi_carries(finding, monkeypatch):
    tid, fid = finding
    patch_tenant(monkeypatch, tid)
    r = await _post("/api/v1/writeback", {"finding_id": fid, "record_fixes": FIXES, "sap_connection": CONN,
                                          "dry_run": True})
    assert r.status_code == 200, r.text
    fields = {f["field"]: f for f in r.json()["fields"]}
    assert fields["MARC.PLIFZ"]["supported"] and fields["MARC.PLIFZ"]["bapi"] == "BAPI_MATERIAL_SAVEDATA"
    assert fields["MARC.PLIFZ"]["delivery"] == "bapi"
    assert not fields["MARC.NFMAT"]["supported"] and fields["MARC.NFMAT"]["delivery"] == "export"
    assert fields["MARC.NFMAT"]["reason"].startswith("No BAPI mapping for MARC.NFMAT")


@pytest.mark.anyio
async def test_approval_simulates_commits_and_records_return_per_record(finding, monkeypatch):
    from api.config import settings

    tid, fid = finding
    patch_tenant(monkeypatch, tid)
    monkeypatch.setattr(settings, "live_writeback_enabled", True)
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    aid = str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("INSERT INTO write_back_log (id, tenant_id, finding_id, requested_by, records_updated, dry_run, "
                       "sap_host) VALUES (:a, :t, :f, 'another-user', 2, false, 'sap-host')"),
                  {"a": aid, "t": tid, "f": fid})

    fake = FakeRFC(testrun=True)

    class _Conn(FakeRFC):
        def __enter__(self):
            return fake

        def __exit__(self, *a):
            return False

    fake.connect = lambda params: None
    monkeypatch.setattr("sap.get_connector", lambda *a, **kw: _Conn())
    monkeypatch.setattr("api.services.credential_store.decrypt_password", lambda t, e: "pw")

    r = await _post(f"/api/v1/writeback/approve/{aid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applied"] == 1 and body["records"][0]["committed"] is True
    assert body["records"][0]["fields"] == ["MARC.PLIFZ"]  # the unmapped field is never sent
    assert [f["field"] for f in body["fields"] if not f["supported"]] == ["MARC.NFMAT"]
    assert fake.names() == ["BAPI_MATERIAL_SAVEDATA", "BAPI_MATERIAL_SAVEDATA", "BAPI_TRANSACTION_COMMIT"]
    with engine.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        stored = c.execute(text("SELECT errors, records_updated FROM write_back_log WHERE id = :a"), {"a": aid}).one()
    assert stored[1] == 1 and stored[0]["records"][0]["messages"][0]["message"] == "saved"
    engine.dispose()
