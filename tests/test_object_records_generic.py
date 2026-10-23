"""The record sheet for every object, not only material master and business partner.

Before, GET /objects/{object}/records/{key} answered 501 for 43 of 45 objects, so opening a
failing accounts payable or SuccessFactors record showed "Not yet available".
"""
import os
import uuid

import pandas as pd
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app
from api.routes.object_records import _generic_record, find_record, key_fields


def test_key_fields_reads_composite_keys():
    assert key_fields("LIFNR=V9|BUKRS=2000") == {"LIFNR": "V9", "BUKRS": "2000"}
    assert key_fields("LFB1.LIFNR=V9") == {"LIFNR": "V9"}
    assert key_fields("100001") == {}


def test_find_record_picks_the_table_holding_every_key_field():
    tables = {
        "LFA1": pd.DataFrame({"LIFNR": ["V9"], "NAME1": ["Acme"]}),
        "LFB1": pd.DataFrame({"LIFNR": ["0000000V9", "V8"], "BUKRS": ["2000", "2000"], "AKONT": [None, "160000"]}),
    }
    table, row = find_record(tables, {"LIFNR": "V9", "BUKRS": "2000"})
    assert table == "LFB1"
    assert row == {"LIFNR": "0000000V9", "BUKRS": "2000", "AKONT": None}  # leading zeros match
    assert find_record(tables, {"LIFNR": "V7", "BUKRS": "2000"}) is None


def test_generic_record_names_the_record_and_keeps_its_fields():
    out = _generic_record("LFA1", {"LIFNR": "V9", "NAME1": "Acme"}, "LIFNR=V9", {"LIFNR": "V9"})
    assert out["description"] == "Acme"
    assert out["labels"] == {"Table": "LFA1", "LIFNR": "V9"}
    assert out["mara"] == {"LIFNR": "V9", "NAME1": "Acme"} and out["views"] == []


HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


@pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")
@pytest.mark.anyio
async def test_record_findings_list_the_rules_it_fails_in_the_run(monkeypatch):
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, vid, old = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    key = "LIFNR=V9|BUKRS=2000"
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        for v in (old, vid):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"), {"v": v, "t": tid})
        c.execute(text("""INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, details)
                          VALUES (gen_random_uuid(), :v, :t, 'accounts_payable', 'AP012', 'critical', 'completeness',
                                  CAST('{"message": "Reconciliation account is missing", "field_checked": "LFB1.AKONT"}' AS jsonb))"""),
                  {"v": vid, "t": tid})
        for check, last, status in (("AP012", vid, "open"), ("AP020", old, "open"), ("AP030", vid, "resolved")):
            c.execute(text("""INSERT INTO record_issues (id, tenant_id, scope, module, check_id, record_key, severity, status,
                                                         first_seen_version, last_seen_version)
                              VALUES (gen_random_uuid(), :t, 'upload', 'accounts_payable', :c, :k, 'critical', :s, :v, :v)"""),
                      {"t": tid, "c": check, "k": key, "s": status, "v": last})
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
    try:
        await api_deps.engine.dispose()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/api/v1/objects/accounts_payable/records/{key}/findings", params={"version_id": vid}, headers=HEADERS)
        assert r.status_code == 200, r.text
        # Only the open issue last seen in this run; the older run's and the resolved one are not failing here.
        assert r.json()["failing"] == [{"check_id": "AP012", "severity": "critical",
                                        "message": "Reconciliation account is missing", "field": "LFB1.AKONT"}]
    finally:
        with engine.begin() as c:
            for t in ("record_issues", "findings", "analysis_versions"):
                c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": tid})
            c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
