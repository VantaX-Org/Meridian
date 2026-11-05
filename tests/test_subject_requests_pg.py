"""Data-subject access and erasure (D-27): the destructive path against a real Postgres.

Skipped without MERIDIAN_TEST_DB_URL. Keys and values are synthetic. Extracts are an in-memory dict standing in for
the object store.
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import time
import uuid
import zipfile

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from api.services import subject_requests as svc
from api.services.purge import Actor

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
KEY = "PERNR=00000001|SUBTY=0001"
OTHER = "PERNR=00000002|SUBTY=0001"
ACTOR = Actor(user_id=None, email="admin@example.test", method="POST", path="/x")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REASON = "subject asked for erasure"

TABLES_BY_KEY = ("finding_records", "record_issues", "work_records", "record_hashes", "cleaning_queue",
                 "cleaning_audit")


@pytest.fixture(scope="module", autouse=True)
def _schema():
    if not os.environ.get("MERIDIAN_TEST_DB_URL"):
        return
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": ROOT})
    assert r.returncode == 0, r.stderr


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


def _seed_golden(c, t, key):
    """A golden record with its history, write-back, merge event and pair rule. Returns the golden id."""
    g = c.execute(text("INSERT INTO master_records (id, tenant_id, domain, sap_object_key, golden_fields) VALUES "
                       "(gen_random_uuid(), :t, 'hcm', :k, CAST('{\"NAME\": \"synthetic-person\"}' AS jsonb)) "
                       "RETURNING id"), {"t": t, "k": key}).scalar()
    p = {"t": t, "g": g, "k": key, "o": OTHER}
    c.execute(text("INSERT INTO master_record_history (id, tenant_id, master_record_id, change_type, new_fields) "
                   "VALUES (gen_random_uuid(), :t, :g, 'create', CAST('{\"NAME\": \"synthetic-person\"}' AS jsonb))"),
              p)
    c.execute(text("INSERT INTO golden_writeback_requests (tenant_id, master_record_id, requested_by) "
                   "VALUES (:t, :g, 'steward')"), p)
    c.execute(text("INSERT INTO mdm_merge_events (id, tenant_id, domain, event_type, golden_record_id, member_keys, "
                   "before, after) VALUES (gen_random_uuid(), :t, 'hcm', 'merge', :g, ARRAY[:k, :o], "
                   "CAST('{\"NAME\": \"synthetic-person\"}' AS jsonb), CAST('{\"NAME\": \"synthetic-person\"}' AS jsonb))"),
              p)
    c.execute(text("INSERT INTO mdm_pair_constraints (id, tenant_id, domain, key_lo, key_hi, kind) VALUES "
                   "(gen_random_uuid(), :t, 'hcm', :k, :o, 'do_not_match')"), p)
    return g


def _seed_change(c, t, key, status, kind="change"):
    r = c.execute(text("INSERT INTO change_requests (tenant_id, kind, object, object_key, title, payload, status, "
                       "record_keys) VALUES (:t, :kind, 'material', :ok, 'synthetic-person', "
                       "CAST('{\"NAME\": \"synthetic-person\"}' AS jsonb), :st, CAST(:rk AS jsonb)) RETURNING id"),
                  {"t": t, "kind": kind, "st": status, "ok": None if kind == "mass_change" else key,
                   "rk": json.dumps([key, OTHER] if kind == "mass_change" else [])}).scalar()
    c.execute(text("INSERT INTO change_request_field_changes (tenant_id, request_id, record_key, field, action, "
                   "old_value, new_value) VALUES (:t, :r, :k, 'NAME', 'set', 'synthetic-person', 'x')"),
              {"t": t, "r": r, "k": key if kind == "mass_change" else None})
    return r


def _erase(sess, t, key=KEY):
    with sess(t) as s:
        dry = svc.erase(s, t, key, ACTOR, dry_run=True)["request_id"]
    with sess(t) as s:
        return svc.erase(s, t, key, ACTOR, dry_run=False, confirm="ERASE", reason=REASON, dry_run_id=dry)


def _refused(sess, t, code, key=KEY):
    with sess(t) as s:
        dry = svc.erase(s, t, key, ACTOR, dry_run=True)["request_id"]
    with sess(t) as s, pytest.raises(svc.SubjectError) as e:
        svc.erase(s, t, key, ACTOR, dry_run=False, confirm="ERASE", reason=REASON, dry_run_id=dry)
    assert e.value.code == code


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
    monkeypatch.setattr(svc.jobs, "list_jobs", lambda *a, **k: [])
    from api.services import suppression
    from workers.db import tenant_session
    monkeypatch.setattr(suppression, "_db", lambda t: tenant_session(engine, t))
    suppression._cache.clear()
    yield engine, a, b, store, lambda t: tenant_session(engine, t)
    with engine.begin() as c:
        c.execute(text("SET LOCAL app.subject_erasure = 'on'"))
        for table in ("mdm_pair_constraints", "mdm_merge_events", "golden_writeback_requests",
                      "master_record_history", "master_records", "change_request_field_changes", "change_requests",
                      "subject_suppressions", "subject_requests", "audit_log", "cleaning_audit", "cleaning_queue", "record_hashes",
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
        dict(confirm="ERASE", reason="a long enough reason", dry_run_id="not-a-uuid", code="dry_run_unknown"),
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
def test_golden_record_and_its_append_only_trail_are_erased(world):
    engine, a, b, store, sess = world
    with engine.begin() as c:
        for t in (a, b):
            _seed_golden(c, t, KEY)
    r = _erase(sess, a)
    assert r["complete"]
    assert r["rows_by_table"]["master_records"] == 1 and r["rows_by_table"]["master_record_history"] == 1
    with engine.connect() as c:
        for table in ("master_records", "master_record_history", "golden_writeback_requests",
                      "mdm_pair_constraints"):
            n = lambda t: c.execute(text(f"SELECT count(*) FROM {table} WHERE tenant_id = :t"), {"t": t}).scalar()
            assert (n(a), n(b)) == (0, 1), table
        ev = c.execute(text("SELECT golden_record_id, member_keys, before, after FROM mdm_merge_events "
                            "WHERE tenant_id = :t"), {"t": a}).fetchone()
        assert ev == (None, [OTHER], None, None)
        kept = c.execute(text("SELECT golden_record_id, member_keys FROM mdm_merge_events WHERE tenant_id = :t"),
                         {"t": b}).fetchone()
        assert kept[0] is not None and KEY in kept[1]


@pg
def test_append_only_triggers_hold_without_the_erasure_setting(world):
    engine, a, b, store, sess = world
    with engine.begin() as c:
        _seed_golden(c, a, KEY)
    for table in ("master_record_history", "mdm_merge_events"):
        with pytest.raises(DBAPIError, match="append-only"), engine.begin() as c:
            c.execute(text(f"DELETE FROM {table} WHERE tenant_id = :t"), {"t": a})


@pg
@pytest.mark.parametrize("kind", ["change", "mass_change"])
def test_open_change_request_refuses_the_erasure(world, kind):
    engine, a, b, store, sess = world
    with engine.begin() as c:
        _seed_change(c, a, KEY, "in_approval", kind)
    _refused(sess, a, "change_request_open")
    with engine.connect() as c:
        assert _count(c, "finding_records", a, KEY) == 1


@pg
def test_closed_change_requests_are_scrubbed(world):
    engine, a, b, store, sess = world
    with engine.begin() as c:
        single = _seed_change(c, a, KEY, "created")
        mass = _seed_change(c, a, KEY, "cancelled", "mass_change")
        kept = _seed_change(c, b, KEY, "created")
    assert _erase(sess, a)["complete"]
    with engine.connect() as c:
        q = text("SELECT object_key, title, payload, record_keys FROM change_requests WHERE id = :i")
        ok, title, payload, _ = c.execute(q, {"i": single}).fetchone()
        assert ok.startswith("erased:") and title is None and payload == {}
        ok, title, payload, keys = c.execute(q, {"i": mass}).fetchone()
        assert ok is None and title == "synthetic-person" and keys == [OTHER]
        f = text("SELECT record_key, old_value, new_value FROM change_request_field_changes WHERE request_id = :i")
        assert c.execute(f, {"i": single}).fetchone() == (None, None, None)
        rk, old, new = c.execute(f, {"i": mass}).fetchone()
        assert rk.startswith("erased:") and old is None and new is None
        assert c.execute(q, {"i": kept}).fetchone()[0] == KEY
        assert c.execute(f, {"i": kept}).fetchone()[1] == "synthetic-person"


@pg
def test_running_analysis_refuses_the_erasure(world):
    engine, a, b, store, sess = world
    with sess(a) as s:
        dry = svc.erase(s, a, KEY, ACTOR, dry_run=True)["request_id"]
    with engine.begin() as c:
        c.execute(text("UPDATE analysis_versions SET status = 'running', run_at = now() WHERE tenant_id = :t"),
                  {"t": a})
    with sess(a) as s, pytest.raises(svc.SubjectError) as e:
        svc.erase(s, a, KEY, ACTOR, dry_run=False, confirm="ERASE", reason=REASON, dry_run_id=dry)
    assert e.value.code == "run_in_progress" and e.value.status == 409


@pg
def test_active_job_refuses_and_an_unrelated_job_does_not(world, monkeypatch):
    engine, a, b, store, sess = world
    job = {"kind": "extraction", "updated_at": time.time()}
    monkeypatch.setattr(svc.jobs, "list_jobs", lambda *x, **k: [job])
    _refused(sess, a, "run_in_progress")
    job["kind"] = "simulation"
    assert _erase(sess, a)["complete"]


@pg
def test_unreadable_job_registry_refuses(world, monkeypatch):
    engine, a, b, store, sess = world

    def boom(*x, **k):
        raise RuntimeError("redis down")

    monkeypatch.setattr(svc.jobs, "list_jobs", boom)
    _refused(sess, a, "jobs_unreadable")


@pg
def test_run_starting_after_the_database_half_leaves_extracts_and_says_so(world, monkeypatch):
    engine, a, b, store, sess = world
    calls = iter(([], [], [{"kind": "analysis", "updated_at": time.time()}]))
    with sess(a) as s:
        dry = svc.erase(s, a, KEY, ACTOR, dry_run=True)["request_id"]
    monkeypatch.setattr(svc.jobs, "list_jobs", lambda *x, **k: next(calls))
    next(calls)  # the dry run does not read the registry; only the two checks of the execute do
    with sess(a) as s:
        r = svc.erase(s, a, KEY, ACTOR, dry_run=False, confirm="ERASE", reason=REASON, dry_run_id=dry)
    assert not r["complete"] and r["extracts"]["errors"] == ["run_in_progress"]
    assert _pernrs(store, f"staging/{a}/v1/PA0001.parquet") == ["00000001", "00000002"]
    with engine.connect() as c:
        assert _count(c, "finding_records", a, KEY) == 0
        assert c.execute(text("SELECT status FROM subject_requests WHERE tenant_id = :t AND dry_run = false"),
                         {"t": a}).scalar() == "incomplete"


@pg
def test_a_dry_run_can_only_be_executed_once_by_the_database(world):
    engine, a, b, store, sess = world
    d = str(uuid.uuid4())
    row = text("INSERT INTO subject_requests (tenant_id, kind, dry_run, subject_hmac, key_set_hmac, dry_run_id) "
               "VALUES (:t, 'erasure', false, 'h', 'k', :d)")
    with engine.begin() as c:
        c.execute(row, {"t": a, "d": d})
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(row, {"t": a, "d": d})


@pg
def test_no_foreign_key_blocks_a_delete_target(world):
    """Every table erasure deletes from must be free to go: a new NO ACTION foreign key would fail in production."""
    engine, *_ = world
    deleted = [t.table for t in svc.TARGETS if t.action == "delete"]
    with engine.connect() as c:
        rows = c.execute(text(
            "SELECT conrelid::regclass::text, conname, confrelid::regclass::text FROM pg_constraint "
            "WHERE contype = 'f' AND confrelid::regclass::text = ANY(:t) AND confdeltype NOT IN ('c', 'n') "
            "AND conrelid <> confrelid"), {"t": deleted}).fetchall()
    # rows of these tables are deleted first, so their keys never block what follows
    assert [r for r in rows if r[0] not in deleted] == []


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
