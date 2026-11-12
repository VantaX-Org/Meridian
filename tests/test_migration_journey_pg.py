"""Migration journey routes: the picked source run, the load history, and the four-eyes reconciliation sign-off.

Runs with MERIDIAN_TEST_DB_URL, on the same client and seed pattern as test_reconciliation_flow_pg.
"""

from __future__ import annotations

import json
import os
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text

from tests.test_reconciliation_flow_pg import H, _USER, _client

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

_OTHER = "00000000-0000-0000-0000-000000000003"


@pytest.fixture
def seeded():
    owner = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, other_tid, src, dst, sv, failed_v, foreign_v, run, wave = (str(uuid.uuid4()) for _ in range(9))
    with owner.begin() as c:
        for t in (tid, other_tid):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": t, "n": f"J-{t[:8]}"})
        for uid, name in ((_USER, "Dev"), (_OTHER, "Other")):
            c.execute(text("INSERT INTO users (id, tenant_id, name, email, role) VALUES (:u, :t, :n, :e, 'admin') "
                           "ON CONFLICT (id) DO UPDATE SET tenant_id = :t"),
                      {"u": uid, "t": tid, "n": name, "e": f"{name.lower()}@example.com"})
        for sid, kind in ((src, "ecc6"), (dst, "s4hana")):
            c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:i, :t, :k, :k)"),
                      {"i": sid, "t": tid, "k": kind})
        for vid, t, status in ((sv, tid, "complete"), (failed_v, tid, "failed"), (foreign_v, other_tid, "complete")):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) "
                           "VALUES (:v, :t, :s, now(), CAST(:m AS jsonb), '{}')"),
                      {"v": vid, "t": t, "s": status, "m": json.dumps({"dataset_path": "src/", "system_id": src})})
        c.execute(text("INSERT INTO migration_waves (id, tenant_id, name, stage, source_system_id) "
                       "VALUES (:w, :t, 'Wave 1', 'mock_load', :s)"), {"w": wave, "t": tid, "s": src})
        c.execute(text("INSERT INTO migration_runs (id, tenant_id, mode, modules, status, source_system_id, "
                       "dest_system_id, source_version_id, gap_summary, requested_by, wave_id) VALUES (:r, :t, "
                       "'source_to_destination', '{material_master}', 'analysed', :s, :d, :v, '{}', :u, :w)"),
                  {"r": run, "t": tid, "s": src, "d": dst, "v": sv, "u": _USER, "w": wave})
        c.execute(text("INSERT INTO migration_export_files (id, tenant_id, run_id, export_format, filename, "
                       "record_count, exported_by) VALUES (:i, :t, :r, 's4_migration_cockpit', 'mm.xlsx', 12, :u)"),
                  {"i": str(uuid.uuid4()), "t": tid, "r": run, "u": _USER})
    yield SimpleNamespace(owner=owner, tid=tid, src=src, sv=sv, failed_v=failed_v, foreign_v=foreign_v, run=run)
    with owner.begin() as c:
        for t in (tid, other_tid):
            for table in ("audit_log", "migration_reconciliations", "migration_export_files", "migration_runs",
                          "migration_waves", "analysis_versions", "users", "sap_systems", "tenants"):
                col = "id" if table == "tenants" else "tenant_id"
                c.execute(text(f"DELETE FROM {table} WHERE {col} = :t"), {"t": t})
    owner.dispose()


def _recon(s, status: str, requested_by: str | None) -> None:
    with s.owner.begin() as c:
        c.execute(text("INSERT INTO migration_reconciliations (id, tenant_id, run_id, status, requested_by) "
                       "VALUES (:i, :t, :r, :s, :u)"),
                  {"i": str(uuid.uuid4()), "t": s.tid, "r": s.run, "s": status, "u": requested_by})


@pytest.mark.anyio
async def test_start_passes_the_picked_source_run_and_refuses_a_foreign_or_unfinished_one(seeded, monkeypatch):
    sent: list = []
    monkeypatch.setattr("workers.tasks.run_migration.run_migration.delay",
                        lambda *a: sent.append(a) or SimpleNamespace(id="task-1"))
    body = {"mode": "source_only", "source_system_id": seeded.src, "modules": ["material_master"]}
    async with await _client(monkeypatch, seeded.tid) as client:
        r = await client.post("/api/v1/migration/analyze", headers=H, json={**body, "source_version_id": seeded.sv})
        assert r.status_code == 200, r.text
        assert sent[0][6] == seeded.sv
        for bad in (seeded.failed_v, seeded.foreign_v, str(uuid.uuid4())):
            r = await client.post("/api/v1/migration/analyze", headers=H, json={**body, "source_version_id": bad})
            assert r.status_code == 404, r.text
        assert len(sent) == 1


@pytest.mark.anyio
async def test_load_events_list_each_download_with_its_wave_and_objects(seeded, monkeypatch):
    async with await _client(monkeypatch, seeded.tid) as client:
        r = await client.get("/api/v1/migration/load-events", headers=H)
    assert r.status_code == 200, r.text
    (e,) = r.json()["events"]
    assert (e["run_id"], e["filename"], e["record_count"]) == (seeded.run, "mm.xlsx", 12)
    assert (e["wave_name"], e["wave_stage"], e["modules"], e["exported_by_label"]) == \
        ("Wave 1", "mock_load", ["material_master"], "Dev")


@pytest.mark.anyio
async def test_accept_needs_a_finished_reconciliation(seeded, monkeypatch):
    _recon(seeded, "running", _OTHER)
    async with await _client(monkeypatch, seeded.tid) as client:
        r = await client.post(f"/api/v1/migration/runs/{seeded.run}/reconciliation/accept", headers=H)
    assert r.status_code == 409, r.text


@pytest.mark.anyio
async def test_the_user_who_ran_the_reconciliation_cannot_accept_it(seeded, monkeypatch):
    _recon(seeded, "done", _USER)
    async with await _client(monkeypatch, seeded.tid) as client:
        r = await client.post(f"/api/v1/migration/runs/{seeded.run}/reconciliation/accept", headers=H)
    assert r.status_code == 403, r.text


@pytest.mark.anyio
async def test_a_second_user_accepts_once_and_it_is_audited(seeded, monkeypatch):
    _recon(seeded, "done", _OTHER)
    url = f"/api/v1/migration/runs/{seeded.run}/reconciliation/accept"
    async with await _client(monkeypatch, seeded.tid) as client:
        r = await client.post(url, headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["accepted_by"] == _USER and r.json()["accepted_at"] and r.json()["accepted_by_label"] == "Dev"
        assert (await client.post(url, headers=H)).status_code == 409
    with seeded.owner.connect() as c:
        n = c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t AND action = 'accept_reconciliation'"),
                      {"t": seeded.tid}).scalar()
    assert n == 1
