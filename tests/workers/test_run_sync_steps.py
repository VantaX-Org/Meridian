"""tests/workers/test_run_sync_steps.py"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def tenant_and_version():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tenant_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, 'run-sync-steps-test')"), {"id": tenant_id})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'processing')"
        ), {"v": version_id, "t": tenant_id})
    yield engine, tenant_id, version_id
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": version_id})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})


def test_run_sync_failure_is_recorded_as_a_step(tenant_and_version):
    """_fail_sync_run(..., version_id=) must also leave a failed step-0 row in
    analysis_run_steps for the analysis_versions row the sync was downloading into
    (run_sync.py creates that row before any failure exit that passes version_id)."""
    from workers.tasks.run_sync import _fail_sync_run

    engine, tenant_id, version_id = tenant_and_version
    sync_run_id = str(uuid.uuid4())
    _fail_sync_run(engine, tenant_id, sync_run_id, "SAP connection refused: RFC_COMMUNICATION_FAILURE",
                   version_id=version_id)

    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT status, error_detail FROM analysis_run_steps WHERE version_id = :v ORDER BY step_number DESC LIMIT 1"
        ), {"v": version_id}).fetchone()
    assert row is not None
    assert row.status == "failed"
    assert "RFC_COMMUNICATION_FAILURE" in row.error_detail


def test_sync_quality_warning_writes_pass_rate_on_the_0_to_100_scale(tenant_and_version):
    """findings.pass_rate is a percentage everywhere (checks/base.py pass_rate_of); the UI no
    longer guesses a 0..1 share, so the sync warning must not write the raw 0..1 score."""
    from workers.tasks.run_sync import _write_quality_warning

    engine, tenant_id, version_id = tenant_and_version
    _write_quality_warning(engine, tenant_id, version_id, "material_master", 40, 0.45, [])
    with engine.begin() as conn:
        rate = conn.execute(text(
            "SELECT pass_rate FROM findings WHERE version_id = :v AND check_id = 'SYNC_QUALITY_WARNING'"
        ), {"v": version_id}).scalar()
        conn.execute(text("DELETE FROM findings WHERE version_id = :v"), {"v": version_id})
    assert float(rate) == 45.0


def test_migration_094_rescales_legacy_sync_warning_rows(tenant_and_version):
    """Rows the old writer stored as a 0..1 share become 0..100; other findings are untouched."""
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "db" / "migrations" / "versions" / "094_sync_warning_pass_rate_pct.py"
    spec = importlib.util.spec_from_file_location("m094", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    engine, tenant_id, version_id = tenant_and_version
    with engine.begin() as conn:
        for cid, rate in (("SYNC_QUALITY_WARNING", 0.45), ("MM001", 0.5)):
            conn.execute(text("""
                INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension,
                                      affected_count, total_count, pass_rate, details)
                VALUES (gen_random_uuid(), :v, :t, 'material_master', :c, 'high', 'completeness', 1, 2, :r, '{}'::jsonb)
            """), {"v": version_id, "t": tenant_id, "c": cid, "r": rate})
        conn.execute(text(mod.BACKFILL_SQL))
        rates = dict(conn.execute(text("SELECT check_id, pass_rate FROM findings WHERE version_id = :v"),
                                  {"v": version_id}).all())
        conn.execute(text("DELETE FROM findings WHERE version_id = :v"), {"v": version_id})
    assert float(rates["SYNC_QUALITY_WARNING"]) == 45.0
    assert float(rates["MM001"]) == 0.5
