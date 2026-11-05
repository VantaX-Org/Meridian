"""Data-subject access and erasure (D-27): the destructive path against a real Postgres.

Skipped without MERIDIAN_TEST_DB_URL. Keys and values are synthetic. Extracts are an in-memory dict standing in for
the object store.
"""
from __future__ import annotations

import io
import json
import os
import uuid
import zipfile

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api.services import subject_requests as svc
from api.services.purge import Actor

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
KEY = "PERNR=00000001|SUBTY=0001"
OTHER = "PERNR=00000002|SUBTY=0001"
ACTOR = Actor(user_id=None, email="admin@example.test", method="POST", path="/x")

TABLES_BY_KEY = ("finding_records", "record_issues", "work_records", "record_hashes", "cleaning_queue",
                 "cleaning_audit")


def _count(c, table, tid, key):
    col = "record_key"
    return c.execute(text(f"SELECT count(*) FROM {table} WHERE tenant_id = :t AND {col} = :k"),
                     {"t": tid, "k": key}).scalar()


def _seed(c, t, key):
    v = str(uuid.uuid4())
    c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, metadata, dqs_summary) VALUES "
                   "(:v, :t, 'x', 'complete', '{}'::jsonb, '{}'::jsonb)"), {"v": v, "t": t})
    p = {"t": t, "v": v, "k": key}
    c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, record_key) "
                   "VALUES (:t, :v, 'C1', 'hcm', :k)"), p)
    c.execute(text("INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, "
                   "first_seen_version, last_seen_version) VALUES (:t, 's', 'hcm', 'C1', :k, 'high', :v, :v)"), p)
    c.execute(text("INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, issues, sev_rank, "
                   "checks) VALUES (:t, :v, 's', 'hcm', :k, 1, 1, ARRAY['C1'])"), p)
    c.execute(text("INSERT INTO record_hashes (tenant_id, module, record_key, row_hash, version_id) "
                   "VALUES (:t, 'hcm', :k, 'h', :v)"), p)
    qid = c.execute(text("INSERT INTO cleaning_queue (tenant_id, object_type, record_key, record_data_before) "
                         "VALUES (:t, 'x', :k, CAST('{\"NAME\": \"synthetic-person\"}' AS jsonb)) RETURNING id"),
                    p).scalar()
    c.execute(text("INSERT INTO cleaning_audit (tenant_id, queue_id, action, record_key, object_type, data_before) "
                   "VALUES (:t, :q, 'fix', :k, 'x', CAST('{\"NAME\": \"synthetic-person\"}' AS jsonb))"),
              {**p, "q": qid})


@pytest.fixture
def world(monkeypatch):
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as c:
        for t in (a, b):
            c.execute(text("INSERT INTO tenants (id, name, jwt_secret) VALUES (:id, :id, 'synthetic-secret')"),
                      {"id": t})
            _seed(c, t, KEY)
            _seed(c, t, OTHER)
    store: dict[str, bytes] = {}
    for t in (a, b):
        buf = io.BytesIO()
        pq.write_table(pa.table({"PA0001.PERNR": ["00000001", "00000002"], "PA0001.SUBTY": ["0001", "0001"],
                                 "PA0001.ENAME": ["synthetic one", "synthetic two"]}), buf)
        store[f"staging/{t}/v1/PA0001.parquet"] = buf.getvalue()
    monkeypatch.setattr(svc.storage, "list_prefix",
                        lambda bucket, prefix: [(n, len(d)) for n, d in store.items() if n.startswith(prefix)])
    monkeypatch.setattr(svc.storage, "download_file", lambda bucket, name: store[name])
    monkeypatch.setattr(svc.storage, "upload_file", lambda bucket, name, data, *a, **k: store.__setitem__(name, data))
    from workers.db import tenant_session
    yield engine, a, b, store, lambda t: tenant_session(engine, t)
    with engine.begin() as c:
        for table in ("subject_requests", "audit_log", "cleaning_audit", "cleaning_queue", "record_hashes",
                      "work_records", "record_issues", "finding_records", "analysis_versions"):
            c.execute(text(f"DELETE FROM {table} WHERE tenant_id IN (:a, :b)"), {"a": a, "b": b})
        c.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": a, "b": b})
    engine.dispose()


def _pernrs(store, name):
    return pq.read_table(io.BytesIO(store[name])).column("PA0001.PERNR").to_pylist()


@pg
def test_search_counts_each_table_and_the_extract(world):
    engine, a, b, store, sess = world
    with sess(a) as s:
        r = svc.search(s, a, KEY, ACTOR)
    assert r["rows_by_table"]["finding_records"] == 1 and r["rows_by_table"]["cleaning_audit"] == 1
    assert r["extracts"]["rows"] == 1
    # a bare key value finds the same record
    with sess(a) as s:
        assert svc.search(s, a, "00000001", ACTOR)["keys"] == [KEY]


@pg
def test_dry_run_deletes_nothing(world):
    engine, a, b, store, sess = world
    before = dict(store)
    with sess(a) as s:
        r = svc.erase(s, a, KEY, ACTOR, dry_run=True)
    assert r["dry_run"] and r["total_rows"] > 0
    with engine.connect() as c:
        for t in TABLES_BY_KEY:
            assert _count(c, t, a, KEY) == 1, t
    assert store == before


@pg
def test_execute_needs_confirm_reason_and_a_matching_dry_run(world):
    engine, a, b, store, sess = world
    with sess(a) as s:
        dry = svc.erase(s, a, KEY, ACTOR, dry_run=True)["request_id"]
    cases = [
        dict(confirm=None, reason="a long enough reason", dry_run_id=dry, code="confirm_required"),
        dict(confirm="erase", reason="a long enough reason", dry_run_id=dry, code="confirm_required"),
        dict(confirm="ERASE", reason="short", dry_run_id=dry, code="reason_required"),
        dict(confirm="ERASE", reason="a long enough reason", dry_run_id=None, code="dry_run_required"),
        dict(confirm="ERASE", reason="a long enough reason", dry_run_id=str(uuid.uuid4()), code="dry_run_unknown"),
    ]
    for case in cases:
        code = case.pop("code")
        with sess(a) as s, pytest.raises(svc.SubjectError) as e:
            svc.erase(s, a, KEY, ACTOR, dry_run=False, **case)
        assert e.value.code == code
    # a dry run for another subject does not unlock this one
    with sess(a) as s, pytest.raises(svc.SubjectError) as e:
        svc.erase(s, a, OTHER, ACTOR, dry_run=False, confirm="ERASE", reason="a long enough reason", dry_run_id=dry)
    assert e.value.code == "dry_run_unknown"
    with engine.connect() as c:
        for t in TABLES_BY_KEY:
            assert _count(c, t, a, KEY) == 1, t
    assert len(_pernrs(store, f"staging/{a}/v1/PA0001.parquet")) == 2


@pg
def test_execute_erases_one_tenant_and_leaves_the_rest(world):
    engine, a, b, store, sess = world
    with sess(a) as s:
        dry = svc.erase(s, a, KEY, ACTOR, dry_run=True)["request_id"]
    with sess(a) as s:
        r = svc.erase(s, a, KEY, ACTOR, dry_run=False, confirm="ERASE", reason="subject asked for erasure",
                      dry_run_id=dry)
    assert r["complete"] and r["extracts"]["rows"] == 1
    with engine.connect() as c:
        for t in TABLES_BY_KEY:
            assert _count(c, t, a, KEY) == 0, t
            assert _count(c, t, a, OTHER) == 1, t       # another subject, same tenant
            assert _count(c, t, b, KEY) == 1, t         # same subject, another tenant
        # scrubbed rows lose their values
        assert c.execute(text("SELECT count(*) FROM cleaning_audit WHERE tenant_id = :t AND data_before IS NOT NULL "
                              "AND record_key LIKE 'erased:%'"), {"t": a}).scalar() == 0
    assert _pernrs(store, f"staging/{a}/v1/PA0001.parquet") == ["00000002"]
    assert _pernrs(store, f"staging/{b}/v1/PA0001.parquet") == ["00000001", "00000002"]
    # the dry run cannot be used twice
    with sess(a) as s, pytest.raises(svc.SubjectError) as e:
        svc.erase(s, a, KEY, ACTOR, dry_run=False, confirm="ERASE", reason="subject asked for erasure",
                  dry_run_id=dry)
    assert e.value.code == "already_executed"


@pg
def test_ledger_and_audit_rows_hold_no_key_or_value(world):
    engine, a, b, store, sess = world
    with sess(a) as s:
        dry = svc.erase(s, a, KEY, ACTOR, dry_run=True)["request_id"]
    with sess(a) as s:
        svc.erase(s, a, KEY, ACTOR, dry_run=False, confirm="ERASE", reason="subject asked for erasure",
                  dry_run_id=dry)
    with sess(a) as s:
        svc.search(s, a, "00000001", ACTOR)
        data, _ = svc.export(s, a, KEY, ACTOR)
    assert zipfile.ZipFile(io.BytesIO(data)).namelist() == ["manifest.json"]
    with engine.connect() as c:
        ledger = json.dumps([list(r) for r in c.execute(text(
            "SELECT * FROM subject_requests WHERE tenant_id = :t"), {"t": a}).fetchall()], default=str)
        audit = json.dumps([list(r) for r in c.execute(text(
            "SELECT * FROM audit_log WHERE tenant_id = :t AND entity_type = 'subject_request'"),
            {"t": a}).fetchall()], default=str)
        n_audit = c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t AND entity_type = "
                                 "'subject_request'"), {"t": a}).scalar()
    assert n_audit >= 4
    for blob in (ledger, audit):
        assert "00000001" not in blob and "synthetic-person" not in blob and "PERNR" not in blob


@pg
def test_export_holds_the_subjects_rows_only(world):
    engine, a, b, store, sess = world
    with sess(a) as s:
        data, rid = svc.export(s, a, KEY, ACTOR)
    z = zipfile.ZipFile(io.BytesIO(data))
    assert "finding_records.json" in z.namelist() and "extracts.json" in z.namelist()
    body = " ".join(z.read(n).decode() for n in z.namelist())
    assert OTHER not in body and "00000002" not in z.read("extracts.json").decode()
    assert json.loads(z.read("manifest.json"))["request_id"] == rid


@pg
def test_bare_value_over_the_cap_is_refused(world):
    engine, a, b, store, sess = world
    with engine.begin() as c:
        v = c.execute(text("SELECT id FROM analysis_versions WHERE tenant_id = :t LIMIT 1"), {"t": a}).scalar()
        c.execute(text("INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, "
                       "first_seen_version, last_seen_version) SELECT :t, 's', 'hcm', 'C2', 'PERNR=7|N=' || g, "
                       "'high', :v, :v FROM generate_series(1, :n) g"), {"t": a, "v": v, "n": svc.MAX_KEYS + 5})
    with sess(a) as s, pytest.raises(svc.SubjectError) as e:
        svc.search(s, a, "7", ACTOR)
    assert e.value.code == "too_many_keys"


@pg
@pytest.mark.anyio
async def test_routes_are_admin_only_and_refuse_a_bare_execute(world, monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    engine, a, b, store, sess = world
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token", lambda token, secret: {
        "sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "viewer"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(a), "T", []))
    await api_deps.engine.dispose()
    base = "/api/v1/admin/subject-requests"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        v = await client.post(f"{base}/search", json={"subject": KEY},
                              headers={**HEADERS, "X-User-Role": "viewer"})
        assert v.status_code == 403
        r = await client.post(f"{base}/erase", json={"subject": KEY, "dry_run": False}, headers=HEADERS)
        assert r.status_code == 400 and r.json()["detail"]["error"] == "confirm_required"
    with engine.connect() as c:
        assert _count(c, "finding_records", a, KEY) == 1
