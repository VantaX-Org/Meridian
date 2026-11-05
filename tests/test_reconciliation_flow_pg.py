"""Post-load reconciliation end to end: the Celery task under row-level security, then the routes over its result.

Runs with MERIDIAN_TEST_DB_URL. The task runs as a NOBYPASSRLS role, so a transaction that lost its tenant finds no
rows. Object storage is the only stub: real parquet bytes go through load_dataset, build_load_tables and reconcile.
"""

from __future__ import annotations

import io
import json
import os
import uuid
from types import SimpleNamespace
from urllib.parse import quote, urlparse, urlunparse

import pandas as pd
import pytest
from httpx import ASGITransport, AsyncClient
from openpyxl import load_workbook
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_recon_flow"
_USER = "00000000-0000-0000-0000-000000000002"
H = {"Authorization": "Bearer test-token"}


@pytest.fixture(scope="module")
def engines():
    url = os.environ["MERIDIAN_TEST_DB_URL"]
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    worker = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                       u.path, u.params, u.query, u.fragment)))
    yield owner, worker
    worker.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _parquet(rows: list[dict]) -> bytes:
    buf = io.BytesIO()
    pd.DataFrame(rows).to_parquet(buf)
    return buf.getvalue()


@pytest.fixture
def store(monkeypatch):
    """Object storage holding one source and one target bundle. M1 agrees, M2 differs, M3 is missing, M4 was held back
    by a blocking gap yet is in the target, M5 is in the target but was never part of the load."""
    objects = {
        f"src/{quote('MARA')}.parquet": _parquet([{"MARA.MATNR": "M1", "MARA.MTART": "FERT"},
                                                  {"MARA.MATNR": "M2", "MARA.MTART": "ROH"},
                                                  {"MARA.MATNR": "M3", "MARA.MTART": "FERT"},
                                                  {"MARA.MATNR": "M4", "MARA.MTART": "FERT"}]),
        f"tgt/{quote('MARA')}.parquet": _parquet([{"MARA.MATNR": "M1", "MARA.MTART": "FERT"},
                                                  {"MARA.MATNR": "M2", "MARA.MTART": "HALB"},
                                                  {"MARA.MATNR": "M4", "MARA.MTART": "FERT"},
                                                  {"MARA.MATNR": "M5", "MARA.MTART": "FERT"}]),
    }
    client = SimpleNamespace(list_objects=lambda bucket, prefix: [SimpleNamespace(object_name=k) for k in objects
                                                                  if k.startswith(prefix)])
    monkeypatch.setattr("workers.dataset._client", lambda: client)
    monkeypatch.setattr("workers.dataset._read", lambda _c, _b, name: objects[name])
    return objects


@pytest.fixture
def seeded(engines):
    owner, _ = engines
    tid, src, dst, sv, tv, run = (str(uuid.uuid4()) for _ in range(6))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"F-{tid[:8]}"})
        c.execute(text("INSERT INTO users (id, tenant_id, name, email, role) VALUES (:u, :t, 'Dev', 'dev@example.com', 'admin') "
                       "ON CONFLICT (id) DO UPDATE SET tenant_id = :t"), {"u": _USER, "t": tid})
        for sid, kind in ((src, "ecc6"), (dst, "s4hana")):
            c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:i, :t, :k, :k)"),
                      {"i": sid, "t": tid, "k": kind})
        for vid, sid, path in ((sv, src, "src/"), (tv, dst, "tgt/")):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) "
                           "VALUES (:v, :t, 'complete', now(), CAST(:m AS jsonb), '{}')"),
                      {"v": vid, "t": tid, "m": json.dumps({"dataset_path": path, "system_id": sid})})
        c.execute(text("INSERT INTO migration_runs (id, tenant_id, mode, modules, status, source_system_id, "
                       "dest_system_id, source_version_id, gap_summary) VALUES (:r, :t, 'source_to_destination', "
                       "'{material_master}', 'analysed', :s, :d, :v, '{}')"),
                  {"r": run, "t": tid, "s": src, "d": dst, "v": sv})
        for field in ("MATNR", "MTART"):
            c.execute(text("INSERT INTO transfer_field_mappings (id, tenant_id, module, source_field, "
                           "dest_system_type, dest_table, dest_field) VALUES (:i, :t, 'material_master', :s, "
                           "'s4hana', 'MARA', :f)"),
                      {"i": str(uuid.uuid4()), "t": tid, "s": f"MARA.{field}", "f": field})
        c.execute(text("INSERT INTO migration_gap_findings (id, tenant_id, run_id, module, record_key, gap_type, "
                       "severity) VALUES (:i, :t, :r, 'material_master', 'MATNR=M4', 'target_mandatory', 'critical')"),
                  {"i": str(uuid.uuid4()), "t": tid, "r": run})
    yield SimpleNamespace(tid=tid, run=run, dst=dst, tv=tv)
    with owner.begin() as c:
        for table in ("audit_log", "migration_reconciliations", "migration_export_files", "transfer_field_mappings", "migration_runs",
                      "analysis_versions", "users", "sap_systems", "tenants"):
            col = "id" if table == "tenants" else "tenant_id"
            c.execute(text(f"DELETE FROM {table} WHERE {col} = :t"), {"t": tid})


def _queued(owner, s) -> str:
    rid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO migration_reconciliations (id, tenant_id, run_id) VALUES (:i, :t, :r)"),
                  {"i": rid, "t": s.tid, "r": s.run})
    return rid


def _row(owner, rid: str):
    with owner.connect() as c:
        return c.execute(text("SELECT * FROM migration_reconciliations WHERE id = :i"), {"i": rid}).mappings().one()


def _execute(monkeypatch, worker, s, rid: str) -> dict:
    from workers.tasks import run_reconciliation as task

    monkeypatch.setattr(task, "get_sync_engine", lambda: worker)
    return task.run_reconciliation.run(s.tid, rid)


async def _client(monkeypatch, tenant_id: str) -> AsyncClient:
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": _USER, "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tenant_id), "T", []))
    await api_deps.engine.dispose()
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def test_task_compares_the_load_with_the_target_under_rls(engines, seeded, store, monkeypatch):
    owner, worker = engines
    rid = _queued(owner, seeded)

    out = _execute(monkeypatch, worker, seeded, rid)

    row = _row(owner, rid)
    assert out["status"] == "done", row["error_detail"]
    assert row["status"] == "done" and row["completed_at"] is not None
    assert str(row["target_version_id"]) == seeded.tv and str(row["target_system_id"]) == seeded.dst
    totals = row["summary"]
    assert (totals["expected"], totals["found"], totals["missing"], totals["unexpected"]) == (3, 2, 1, 1)
    assert totals["differing_fields"] == 1
    kinds = {r["kind"]: r for r in row["records"]["MARA"]}
    assert set(kinds) == {"missing", "unexpected", "differing"}
    assert (kinds["differing"]["expected"], kinds["differing"]["found"]) == ("ROH", "HALB")
    assert "M4" in kinds["unexpected"]["key"]
    assert not any("M5" in r["key"] for r in row["records"]["MARA"])


def test_task_fails_with_a_reason_when_the_target_was_never_extracted(engines, seeded, store, monkeypatch):
    owner, worker = engines
    with owner.begin() as c:
        c.execute(text("UPDATE analysis_versions SET status = 'failed' WHERE id = :v"), {"v": seeded.tv})
    rid = _queued(owner, seeded)

    assert _execute(monkeypatch, worker, seeded, rid)["status"] == "failed"
    assert _row(owner, rid)["error_detail"] == "The target system has no completed analysis. Extract the target first."


@pytest.mark.anyio
async def test_routes_start_read_and_export_a_reconciliation(engines, seeded, store, monkeypatch):
    owner, worker = engines
    started: list = []
    monkeypatch.setattr("workers.tasks.run_reconciliation.run_reconciliation.delay",
                        lambda *a: started.append(a) or SimpleNamespace(id="task-1"))
    base = f"/api/v1/migration/runs/{seeded.run}"
    async with await _client(monkeypatch, seeded.tid) as client:
        assert (await client.get(f"{base}/reconciliation", headers=H)).status_code == 404

        r = await client.post(f"{base}/reconcile", headers=H)
        assert r.status_code == 200, r.text
        rid = r.json()["reconciliation_id"]
        assert started == [(seeded.tid, rid)]
        assert (await client.post(f"{base}/reconcile", headers=H)).status_code == 409

        assert (await client.get(f"{base}/reconciliation/export", headers=H)).status_code == 409
        _execute(monkeypatch, worker, seeded, rid)

        r = await client.get(f"{base}/reconciliation", headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "done" and r.json()["summary"]["missing"] == 1

        r = await client.get(f"{base}/reconciliation/records", headers=H, params={"table": "MARA"})
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 3 and len(r.json()["rows"]) == 3

        r = await client.get(f"{base}/reconciliation/export", headers=H)
        assert r.status_code == 200, r.text
        assert {"Tables", "Fields", "Records"} <= set(load_workbook(io.BytesIO(r.content)).sheetnames)


@pytest.mark.anyio
async def test_unreachable_queue_answers_503_and_leaves_no_busy_row(engines, seeded, store, monkeypatch):
    owner, _ = engines

    def down(*_a):
        raise ConnectionError("broker down")

    monkeypatch.setattr("workers.tasks.run_reconciliation.run_reconciliation.delay", down)
    base = f"/api/v1/migration/runs/{seeded.run}"
    async with await _client(monkeypatch, seeded.tid) as client:
        assert (await client.post(f"{base}/reconcile", headers=H)).status_code == 503
        with owner.connect() as c:
            assert c.execute(text("SELECT status, error_detail FROM migration_reconciliations WHERE run_id = :r"),
                             {"r": seeded.run}).one() == ("failed", "The task queue could not be reached.")
        monkeypatch.setattr("workers.tasks.run_reconciliation.run_reconciliation.delay",
                            lambda *a: SimpleNamespace(id="task-2"))
        assert (await client.post(f"{base}/reconcile", headers=H)).status_code == 200


@pytest.mark.anyio
async def test_a_viewer_cannot_start_a_reconciliation(seeded, monkeypatch):
    async with await _client(monkeypatch, seeded.tid) as client:
        r = await client.post(f"/api/v1/migration/runs/{seeded.run}/reconcile",
                              headers={**H, "X-User-Role": "viewer"})
    assert r.status_code == 403


# ---- export snapshots -----------------------------------------------------------------------------------------

@pytest.fixture
def blobs(monkeypatch):
    """In-memory stand-in for the snapshot bucket."""
    b: dict[str, bytes] = {}
    from api.services import storage

    monkeypatch.setattr(storage, "upload_file", lambda bucket, name, data, content_type="", suppress=True: b.__setitem__(name, data))
    monkeypatch.setattr(storage, "download_file", lambda bucket, name: b[name])
    monkeypatch.setattr(storage, "list_prefix", lambda bucket, pre: [(k, len(v)) for k, v in b.items() if k.startswith(pre)])

    def drop(bucket, pre):
        gone = [k for k in b if k.startswith(pre)]
        for k in gone:
            del b[k]
        return len(gone), 0

    monkeypatch.setattr(storage, "delete_prefix", drop)
    return b


def _export(engines, s, monkeypatch) -> str:
    """What the export route does: build the load from the mappings as they stand, snapshot it, record the pointer."""
    from api.services.migration import snapshot
    from api.services.migration.export import load_run_tables
    from workers.db import tenant_session

    owner, worker = engines
    eid = str(uuid.uuid4())
    with tenant_session(worker, s.tid) as session:
        run = session.execute(text("SELECT * FROM migration_runs WHERE id = :r"), {"r": s.run}).fetchone()
        held: dict = {}
        load, _ = load_run_tables(session, run, held)
    pre, dig = snapshot.write(s.tid, s.run, eid, load, held)
    with owner.begin() as c:
        c.execute(text("INSERT INTO migration_export_files (id, tenant_id, run_id, export_format, filename, "
                       "snapshot_prefix, snapshot_sha256, snapshot_at) VALUES (:i, :t, :r, 'csv', 'x.csv', :p, :d, now())"),
                  {"i": eid, "t": s.tid, "r": s.run, "p": pre, "d": dig})
    return eid


def _summary(owner, rid):
    return _row(owner, rid)["summary"]


def test_mapping_changed_after_export_still_compares_against_the_snapshot(engines, seeded, store, blobs, monkeypatch):
    owner, worker = engines
    eid = _export(engines, seeded, monkeypatch)
    with owner.begin() as c:  # the rebuilt side would no longer have MTART
        c.execute(text("DELETE FROM transfer_field_mappings WHERE tenant_id = :t AND source_field = 'MARA.MTART'"),
                  {"t": seeded.tid})
    rid = _queued(owner, seeded)
    assert _execute(monkeypatch, worker, seeded, rid)["status"] == "done"
    sm = _summary(owner, rid)
    assert sm["basis"] == "snapshot" and sm["snapshot_export_id"] == eid and sm["snapshot_exported_at"]
    assert sm["differing_fields"] == 1


def test_no_snapshot_rebuilds_and_says_so(engines, seeded, store, blobs, monkeypatch):
    owner, worker = engines
    rid = _queued(owner, seeded)
    assert _execute(monkeypatch, worker, seeded, rid)["status"] == "done"
    sm = _summary(owner, rid)
    assert sm["basis"] == "rebuilt" and "snapshot_export_id" not in sm and "snapshot_skipped" not in sm


def test_altered_snapshot_is_refused_and_rebuilt(engines, seeded, store, blobs, monkeypatch):
    owner, worker = engines
    _export(engines, seeded, monkeypatch)
    name = next(iter(blobs))
    blobs[name] = blobs[name] + b"x"
    rid = _queued(owner, seeded)
    assert _execute(monkeypatch, worker, seeded, rid)["status"] == "done"
    sm = _summary(owner, rid)
    assert sm["basis"] == "rebuilt" and "digest" in sm["snapshot_skipped"]


def test_erasure_removes_the_person_from_snapshots(engines, seeded, store, blobs, monkeypatch):
    from api.services import subject_requests
    from api.services.migration import snapshot
    from workers.db import tenant_session

    owner, worker = engines
    eid = _export(engines, seeded, monkeypatch)
    with tenant_session(worker, seeded.tid) as session:
        found = subject_requests.scan_snapshots(session, seeded.tid, ["MATNR=M2"], rewrite=False)
        assert found["rows"] >= 1
        done = subject_requests.scan_snapshots(session, seeded.tid, ["MATNR=M2"], rewrite=True)
        assert done["complete"] and done["rows"] >= 1
        row = session.execute(text("SELECT snapshot_prefix, snapshot_sha256 FROM migration_export_files WHERE id = :i"),
                              {"i": eid}).one()
    load, held = snapshot.read(seeded.tid, row[0], row[1])  # digest was recomputed, so it still verifies
    assert "M2" not in {v for df in (*load.values(), *held.values()) for v in df["MATNR"]}
    assert "M1" in set(load["MARA"]["MATNR"])
    with tenant_session(worker, seeded.tid) as session:
        assert subject_requests.scan_snapshots(session, seeded.tid, ["MATNR=M2"], rewrite=False)["rows"] == 0


def test_erasure_deletes_a_snapshot_it_cannot_verify(engines, seeded, store, blobs, monkeypatch):
    from api.services import subject_requests
    from workers.db import tenant_session

    owner, worker = engines
    eid = _export(engines, seeded, monkeypatch)
    name = next(iter(blobs))
    blobs[name] = blobs[name] + b"x"
    with tenant_session(worker, seeded.tid) as session:
        out = subject_requests.scan_snapshots(session, seeded.tid, ["MATNR=M2"], rewrite=True)
    assert out["complete"] and not blobs
    with owner.connect() as c:
        assert c.execute(text("SELECT snapshot_prefix FROM migration_export_files WHERE id = :i"), {"i": eid}).scalar() is None


def test_run_delete_removes_its_snapshots(engines, seeded, store, blobs, monkeypatch):
    from api.services.migration import snapshot

    _export(engines, seeded, monkeypatch)
    _export(engines, seeded, monkeypatch)
    assert blobs
    assert snapshot.delete_run(seeded.tid, seeded.run) > 0 and not blobs


def _ready_to_export(owner, s) -> None:
    with owner.begin() as c:
        c.execute(text("UPDATE migration_runs SET status = 'analysed' WHERE id = :r"), {"r": s.run})


def _exports(owner, s) -> list:
    with owner.connect() as c:
        return c.execute(text("SELECT snapshot_prefix, snapshot_sha256, snapshot_at, snapshot_error "
                              "FROM migration_export_files WHERE run_id = :r"), {"r": s.run}).fetchall()


@pytest.mark.anyio
async def test_export_route_records_the_snapshot_it_wrote(engines, seeded, store, blobs, monkeypatch):
    from api.services.migration import snapshot

    owner, worker = engines
    _ready_to_export(owner, seeded)
    monkeypatch.setattr("workers.db.get_sync_engine", lambda: worker)
    async with await _client(monkeypatch, seeded.tid) as c:
        r = await c.get(f"/api/v1/migration/export/{seeded.run}/csv", headers=H)
    assert r.status_code == 200, r.text
    (row,) = _exports(owner, seeded)
    assert row.snapshot_error is None and row.snapshot_at is not None
    assert any(k.startswith(row.snapshot_prefix) for k in blobs)
    load, _held = snapshot.read(seeded.tid, row.snapshot_prefix, row.snapshot_sha256)
    assert load


@pytest.mark.anyio
async def test_export_route_survives_a_storage_failure_and_records_it(engines, seeded, store, blobs, monkeypatch):
    from api.services import storage

    def fail(*_a, **_k):
        raise OSError("bucket down")

    owner, worker = engines
    _ready_to_export(owner, seeded)
    monkeypatch.setattr("workers.db.get_sync_engine", lambda: worker)
    monkeypatch.setattr(storage, "upload_file", fail)
    async with await _client(monkeypatch, seeded.tid) as c:
        r = await c.get(f"/api/v1/migration/export/{seeded.run}/csv", headers=H)
    assert r.status_code == 200, r.text
    (row,) = _exports(owner, seeded)
    assert row.snapshot_prefix is None and row.snapshot_sha256 is None and row.snapshot_at is None
    assert "bucket down" in row.snapshot_error
