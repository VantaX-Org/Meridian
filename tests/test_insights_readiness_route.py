import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api.deps import Tenant, get_tenant
from api.main import app
from api import deps as api_deps

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def two_tenants():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        for t in (t1, t2):
            conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
    yield t1, t2
    with engine.begin() as conn:
        # Order matters: migration_runs references both migration_waves (wave_id) and
        # analysis_versions (source_version_id); migration_waves and analysis_versions
        # each reference tenants. Delete children before parents.
        conn.execute(text("DELETE FROM migration_runs WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM migration_waves WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM analysis_versions WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM tenants WHERE id IN (:t1, :t2)"), {"t1": t1, "t2": t2})


def _patch_tenant(monkeypatch, tenant_id: str):
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr(
        "api.middleware.local_auth.decode_access_token",
        lambda token, secret: {
            "sub": "00000000-0000-0000-0000-000000000002",
            "email": "dev@example.com",
            "role": "admin",
        },
    )
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(
        app.dependency_overrides, get_tenant,
        lambda: Tenant(uuid.UUID(tenant_id), "T", []),
    )


@pytest.mark.anyio
async def test_readiness_without_waves_is_an_empty_grid(two_tenants, monkeypatch):
    t1, _t2 = two_tenants
    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r.status_code == 200
    assert r.json()["cells"] == []


@pytest.mark.anyio
async def test_readiness_reads_wave_rows_and_is_tenant_isolated(two_tenants, monkeypatch):
    t1, t2 = two_tenants
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO migration_waves (tenant_id, name, modules) VALUES (:t, 'Wave 1', '{material_master}')"),
                     {"t": t1})
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}

    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r.status_code == 200
    assert r.json()["cells"] == [{"module": "material_master", "wave": "Wave 1", "verdict": "no_go",
                                  "blocker_count": 0, "dqs": None, "score": None, "records_blocked": 0}]

    _patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r2 = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r2.json()["cells"] == []


@pytest.mark.anyio
async def test_readiness_wave_uses_its_own_run_not_another_waves(two_tenants, monkeypatch):
    """Two waves, each with a wave_id-matched run on the same module: each wave's cell
    must reflect its own run's gap_summary, not the other wave's."""
    t1, _t2 = two_tenants
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    wave_a, wave_b = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO migration_waves (id, tenant_id, name, modules) "
            "VALUES (:id, :t, 'Wave A', '{material_master}')"), {"id": wave_a, "t": t1})
        conn.execute(text(
            "INSERT INTO migration_waves (id, tenant_id, name, modules) "
            "VALUES (:id, :t, 'Wave B', '{material_master}')"), {"id": wave_b, "t": t1})
        conn.execute(text(
            "INSERT INTO migration_runs (tenant_id, mode, wave_id, status, completed_at, gap_summary) "
            "VALUES (:t, 'source_to_destination', :w, 'analysed', now(), "
            "CAST(:g AS jsonb))"), {
            "t": t1, "w": wave_a,
            "g": '{"material_master": {"verdict": "go", "score": 100.0, "blocked_records": 0, "gaps": {}}}',
        })
        conn.execute(text(
            "INSERT INTO migration_runs (tenant_id, mode, wave_id, status, completed_at, gap_summary) "
            "VALUES (:t, 'source_to_destination', :w, 'analysed', now(), "
            "CAST(:g AS jsonb))"), {
            "t": t1, "w": wave_b,
            "g": '{"material_master": {"verdict": "no-go", "score": 50.0, "blocked_records": 50, "gaps": {}}}',
        })

    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r.status_code == 200
    cells = {c["wave"]: c for c in r.json()["cells"]}
    assert cells["Wave A"]["verdict"] == "go"
    assert cells["Wave A"]["score"] == 100.0
    assert cells["Wave A"]["records_blocked"] == 0
    assert cells["Wave B"]["verdict"] == "no_go"
    assert cells["Wave B"]["score"] == 50.0
    assert cells["Wave B"]["records_blocked"] == 50


@pytest.mark.anyio
async def test_readiness_wave_without_own_run_falls_back_to_tenant_latest(two_tenants, monkeypatch):
    """A wave with no wave_id-matched run falls back to the tenant-wide latest analysed
    run, per the documented fallback in get_readiness."""
    t1, _t2 = two_tenants
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    wave_c = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO migration_waves (id, tenant_id, name, modules) "
            "VALUES (:id, :t, 'Wave C', '{material_master}')"), {"id": wave_c, "t": t1})
        conn.execute(text(
            "INSERT INTO migration_runs (tenant_id, mode, wave_id, status, completed_at, gap_summary) "
            "VALUES (:t, 'source_to_destination', NULL, 'analysed', now(), CAST(:g AS jsonb))"), {
            "t": t1,
            "g": '{"material_master": {"verdict": "go", "score": 97.0, "blocked_records": 0, "gaps": {}}}',
        })

    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r.status_code == 200
    cells = {c["wave"]: c for c in r.json()["cells"]}
    assert cells["Wave C"]["verdict"] == "go"
    assert cells["Wave C"]["score"] == 97.0


@pytest.mark.anyio
async def test_readiness_wave_min_dqs_override_changes_verdict(two_tenants, monkeypatch):
    """A wave's min_dqs override produces a different verdict than the tenant default
    threshold would, proving the override is actually applied."""
    t1, _t2 = two_tenants
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    version_id = str(uuid.uuid4())
    wave_override, wave_default = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, dqs_summary) "
            "VALUES (:id, :t, CAST(:d AS jsonb))"), {
            "id": version_id, "t": t1,
            "d": '{"material_master": {"composite_score": 65.0}}',
        })
        # Tenant-wide default threshold is 70 (no alert_thresholds override set).
        conn.execute(text(
            "INSERT INTO migration_waves (id, tenant_id, name, modules, min_dqs) "
            "VALUES (:id, :t, 'Wave Override', '{material_master}', 60)"), {"id": wave_override, "t": t1})
        conn.execute(text(
            "INSERT INTO migration_waves (id, tenant_id, name, modules) "
            "VALUES (:id, :t, 'Wave Default', '{material_master}')"), {"id": wave_default, "t": t1})
        for wave_id in (wave_override, wave_default):
            conn.execute(text(
                "INSERT INTO migration_runs (tenant_id, mode, wave_id, status, completed_at, "
                "source_version_id, gap_summary) "
                "VALUES (:t, 'source_to_destination', :w, 'analysed', now(), :v, CAST(:g AS jsonb))"), {
                "t": t1, "w": wave_id, "v": version_id,
                "g": '{"material_master": {"verdict": "go", "score": 100.0, "blocked_records": 0, "gaps": {}}}',
            })

    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/readiness", headers=headers)
    assert r.status_code == 200
    cells = {c["wave"]: c for c in r.json()["cells"]}
    # DQS 65 clears the wave's own min_dqs override (60) -> go.
    assert cells["Wave Override"]["verdict"] == "go"
    # DQS 65 misses the tenant default threshold (70) -> at_risk.
    assert cells["Wave Default"]["verdict"] == "at_risk"
