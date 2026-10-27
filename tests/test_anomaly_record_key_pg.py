"""Insights > Duplicates > Anomalies named no record: eleven PA0007.EMPCT rows read the same, with nothing to open.

- The anomaly miner keys each outlier's record as the check engine keys it (the DDIC key fields of the column's
  table), so the list can name the record and open it.
- GET /mining/anomalies returns that key and the usual range the value falls outside of, per tenant only.

The API tests are skipped without MERIDIAN_TEST_DB_URL; the miner's keying runs everywhere.
"""
from __future__ import annotations

import json
import os
import uuid

import pandas as pd
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

import workers.celery_app  # noqa: F401 -- registers the mining tasks before the module is imported
from workers.tasks.mining.anomaly import _find_anomalies, _with_record_keys

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


def test_miner_keys_each_outlier_by_its_tables_ddic_key():
    df = pd.DataFrame({
        "PA0007.PERNR": [f"{i:08d}" for i in range(12)],
        "PA0007.SUBTY": ["0001"] * 12,
        "PA0007.WEEKLY_QTY": [40] * 11 + [400],
    })
    found = _with_record_keys(df, _find_anomalies(df, "hcm", "iqr"))
    assert [(a["field"], a["record_key"]) for a in found] == [("PA0007.WEEKLY_QTY", "PERNR=00000011|SUBTY=0001")]


def test_miner_leaves_the_key_empty_when_the_record_cannot_be_keyed():
    df = pd.DataFrame({"WEEKLY_QTY": [40] * 11 + [400], "PA0007.EMPCT_QTY": [1] * 12})
    found = _with_record_keys(df, _find_anomalies(df, "hcm", "iqr"))
    assert [(a["field"], a["record_key"]) for a in found] == [("WEEKLY_QTY", None)]


pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture
def tenants():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    runs = {a: str(uuid.uuid4()), b: str(uuid.uuid4())}
    with engine.begin() as c:
        for t, key in ((a, "PERNR=00001001|SUBTY=0001"), (b, "PERNR=00009999|SUBTY=0001")):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, metadata, dqs_summary) "
                           "VALUES (:id, :t, 'hcm', 'complete', CAST(:m AS jsonb), '{}'::jsonb)"),
                      {"id": runs[t], "t": t, "m": json.dumps({"modules": ["hcm"]})})
            c.execute(text("INSERT INTO data_anomalies (tenant_id, version_id, module_id, field_name, field_value, "
                           "record_index, record_key, detection_method, severity, bounds_json) "
                           "VALUES (:t, :v, 'hcm', 'PA0007.EMPCT', 400, 11, :k, 'iqr', 'high', "
                           "CAST(:b AS jsonb))"),
                      {"t": t, "v": runs[t], "k": key, "b": json.dumps({"lower": 40.0, "upper": 100.0})})
            # mined before 095: no key, read by its row number
            c.execute(text("INSERT INTO data_anomalies (tenant_id, version_id, module_id, field_name, field_value, "
                           "record_index, detection_method, z_score, severity) "
                           "VALUES (:t, :v, 'hcm', 'PA0007.EMPCT', 380, 4, 'zscore', 4.2, 'medium')"),
                      {"t": t, "v": runs[t]})
    yield a, b, runs
    with engine.begin() as c:
        c.execute(text("DELETE FROM data_anomalies WHERE tenant_id IN (:a, :b)"), {"a": a, "b": b})
        c.execute(text("DELETE FROM analysis_versions WHERE tenant_id IN (:a, :b)"), {"a": a, "b": b})
        c.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": a, "b": b})
    engine.dispose()


@pytest.fixture
def get(monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    async def go(tid: str, path: str, **params) -> list:
        monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
        monkeypatch.setattr("api.middleware.local_auth.decode_access_token", lambda token, secret: {
            "sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"})
        monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
        monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
        await api_deps.engine.dispose()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(path, params=params, headers=HEADERS)
        assert r.status_code == 200, (path, r.text)
        return r.json()
    return go


@pg
@pytest.mark.anyio
async def test_anomalies_carry_the_record_key_and_usual_range_per_tenant(tenants, get):
    a, b, runs = tenants
    rows = await get(a, "/api/v1/mining/anomalies", version_id=runs[a])
    by_index = {r["record_index"]: r for r in rows}
    assert by_index[11]["record_key"] == "PERNR=00001001|SUBTY=0001"
    assert (by_index[11]["lower_bound"], by_index[11]["upper_bound"]) == (40.0, 100.0)
    assert by_index[4]["record_key"] is None and by_index[4]["z_score"] == pytest.approx(4.2)
    assert by_index[4]["lower_bound"] is None
    # Tenant isolation: neither tenant reads the other's records, by run or across runs.
    assert await get(b, "/api/v1/mining/anomalies", version_id=runs[a]) == []
    keys_b = {r["record_key"] for r in await get(b, "/api/v1/mining/anomalies")}
    assert keys_b == {"PERNR=00009999|SUBTY=0001", None}
