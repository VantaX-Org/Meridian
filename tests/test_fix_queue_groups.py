"""The Fix screen's cleaning queue, end to end against Postgres.

Regression: cleaning items carry the run that found them (version_id) but run_cleaning never
sets batch_id, and the Fix screen grouped by batch_id, so a queue of tens of thousands of
proposals rendered as "No cleaning proposals". The queue is now grouped by run and rule on
the server, a review page works on one run and rule, and its approved items become a fix batch.
"""
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


@pytest.fixture
def seeded():
    """One tenant, one run, as run_cleaning writes it (no rule, no batch, confidence 0..100):
    5 open MARA.MEINS fixes (3 at >= 85%), 1 open MARA.MATKL fix, 1 approved MARA.MEINS fix and
    1 open duplicate merge; plus 3 duplicate pairs."""
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, vid = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status) VALUES (:v, :t, 'mm_run', 'complete')"),
                  {"v": vid, "t": tid})
        rows = ([("MARA.MEINS", "detected", c_) for c_ in (95, 90, 85, 60, 50)]
                + [("MARA.MATKL", "detected", 99), ("MARA.MEINS", "approved", 90)])
        for i, (field, status, conf) in enumerate(rows):
            c.execute(text("""
                INSERT INTO cleaning_queue (id, tenant_id, object_type, status, confidence, record_key, version_id,
                                            record_data_before, record_data_after)
                VALUES (gen_random_uuid(), :t, 'material_master', :st, :conf, :rk, :v,
                        CAST(:before AS jsonb), CAST(:after AS jsonb))"""),
                      {"t": tid, "st": status, "conf": conf, "rk": f"MAT{i:05d}", "v": vid,
                       "before": f'{{"{field}": ""}}', "after": f'{{"{field}": "EA"}}'})
        c.execute(text("""
            INSERT INTO cleaning_queue (id, tenant_id, object_type, status, confidence, record_key, version_id, merge_preview)
            VALUES (gen_random_uuid(), :t, 'material_master', 'detected', 98, 'MAT1|MAT1_dup', :v,
                    CAST('{"MARA.MAKTX": {"a": "Bolt", "b": "Bolt", "survivor": "Bolt"}}' AS jsonb))"""), {"t": tid, "v": vid})
        for i in range(3):
            c.execute(text("""INSERT INTO dedup_candidates (id, tenant_id, object_type, record_key_a, record_key_b, match_score,
                                                            match_method, status)
                              VALUES (gen_random_uuid(), :t, 'business_partner', :a, :b, :s, 'fuzzy', 'pending')"""),
                      {"t": tid, "a": f"A{i}", "b": f"B{i}", "s": 90 - i})
    yield tid, vid
    with engine.begin() as c:
        for t in ("remediation_events", "remediation_items"):
            c.execute(text(f"DELETE FROM {t} WHERE batch_id IN (SELECT id FROM remediation_batches WHERE tenant_id = :t)"), {"t": tid})
        for t in ("remediation_batches", "cleaning_audit", "cleaning_queue", "dedup_candidates", "analysis_versions"):
            c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})


def _as(monkeypatch, tid: str) -> None:
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))


async def _client() -> AsyncClient:
    await api_deps.engine.dispose()
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.anyio
async def test_groups_cover_proposals_without_a_batch(seeded, monkeypatch):
    tid, vid = seeded
    _as(monkeypatch, tid)
    from api.routes import cleaning
    cleaning._groups_cache.clear()
    async with await _client() as client:
        r = await client.get("/api/v1/cleaning/queue/groups", headers=HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["records"] == 7 and body["runs"] == 1  # the approved item is not open work
    by_kind = {g["kind"]: g for g in body["groups"]}
    assert set(by_kind) == {"MARA.MEINS", "MARA.MATKL", "duplicate"}
    meins = by_kind["MARA.MEINS"]
    assert (meins["version_id"], meins["records"], meins["confident"], meins["run_label"]) == (vid, 5, 3, "mm_run")
    assert meins["avg_confidence"] == pytest.approx(0.76)  # read as 0..1 though stored 0..100
    assert body["groups"][0]["kind"] == "MARA.MEINS"  # ranked by records


@pytest.mark.anyio
async def test_queue_filters_by_run_and_rule(seeded, monkeypatch):
    tid, vid = seeded
    _as(monkeypatch, tid)
    async with await _client() as client:
        r = await client.get("/api/v1/cleaning/queue", params={"version_id": vid, "kind": "MARA.MATKL"}, headers=HEADERS)
        dup = await client.get("/api/v1/cleaning/queue", params={"version_id": vid, "kind": "duplicate"}, headers=HEADERS)
    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["record_key"] for i in items] == ["MAT00005"] and items[0]["confidence"] == pytest.approx(0.99)
    assert [i["record_key"] for i in dup.json()["items"]] == ["MAT1|MAT1_dup"]


@pytest.mark.anyio
async def test_bulk_approve_a_run_and_rule_above_a_confidence(seeded, monkeypatch):
    tid, vid = seeded
    _as(monkeypatch, tid)
    async with await _client() as client:
        r = await client.post("/api/v1/cleaning/bulk-approve", headers=HEADERS,
                              json={"version_id": vid, "kind": "MARA.MEINS", "min_confidence": 0.85, "max_count": 5000})
    assert r.status_code == 200, r.text
    assert r.json()["approved_count"] == 3
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.connect() as c:
        n = c.execute(text("SELECT COUNT(*) FROM cleaning_queue WHERE tenant_id = :t AND status = 'approved' AND record_data_after ? 'MARA.MATKL'"),
                      {"t": tid}).scalar()
    assert n == 0  # the other kind is untouched


@pytest.mark.anyio
async def test_approved_proposals_of_a_run_become_a_fix_batch(seeded, monkeypatch):
    tid, vid = seeded
    _as(monkeypatch, tid)
    async with await _client() as client:
        r = await client.post("/api/v1/remediation/batches/from-cleaning", headers=HEADERS,
                              json={"name": "MARA.MEINS from mm_run", "version_id": vid, "kind": "MARA.MEINS"})
        assert r.status_code == 200, r.text
        assert r.json()["items"] == 1  # the one approved MARA.MEINS item
        empty = await client.post("/api/v1/remediation/batches/from-cleaning", headers=HEADERS,
                                  json={"name": "x", "version_id": vid, "kind": "MARA.MATKL"})
        assert empty.status_code == 400
        neither = await client.post("/api/v1/remediation/batches/from-cleaning", headers=HEADERS, json={"name": "x"})
        assert neither.status_code == 422


@pytest.mark.anyio
async def test_dedup_candidates_come_a_page_at_a_time(seeded, monkeypatch):
    tid, _ = seeded
    _as(monkeypatch, tid)
    async with await _client() as client:
        r = await client.get("/api/v1/dedup/candidates", params={"per_page": 2, "page": 2}, headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3
    assert [i["record_key_a"] for i in body["items"]] == ["A2"]
