"""tests/services/test_run_steps.py"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from api.services.run_steps import record_step

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture(scope="module", autouse=True)
def _migrated_schema():
    """Run migrations before this module's tests insert into `tenants` etc.

    Without this, alphabetical collection can run this file before any
    tests/test_*_pg.py module has migrated the test database, and every
    insert fails with `UndefinedTable`. Same approach as
    tests/test_exception_rules_pg.py's `engines` fixture.
    """
    import subprocess

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    r = subprocess.run(
        ["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
        env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root},
    )
    assert r.returncode == 0, r.stderr


@pytest.fixture
def tenant_and_version():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tenant_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, 'run-steps-test')"), {"id": tenant_id})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'processing')"
        ), {"v": version_id, "t": tenant_id})
    yield engine, tenant_id, version_id
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": version_id})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})


def test_record_step_inserts_running_then_completes(tenant_and_version):
    engine, tenant_id, version_id = tenant_and_version
    record_step(engine, tenant_id, version_id, 3, "Running data quality checks", status="running")
    record_step(engine, tenant_id, version_id, 3, "Running data quality checks", status="complete")
    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT status, duration_ms, finished_at FROM analysis_run_steps "
            "WHERE version_id = :v AND step_number = 3"
        ), {"v": version_id}).fetchone()
    assert row.status == "complete"
    assert row.duration_ms is not None
    assert row.finished_at is not None


def test_record_step_failed_stores_error_detail(tenant_and_version):
    engine, tenant_id, version_id = tenant_and_version
    record_step(engine, tenant_id, version_id, 4, "Generating AI insights", status="running")
    record_step(engine, tenant_id, version_id, 4, "Generating AI insights", status="failed",
                error_detail="LLM provider timed out after 120s")
    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT status, error_detail FROM analysis_run_steps WHERE version_id = :v AND step_number = 4"
        ), {"v": version_id}).fetchone()
    assert row.status == "failed"
    assert row.error_detail == "LLM provider timed out after 120s"


def test_record_step_running_is_idempotent_and_closes_earlier_steps(tenant_and_version):
    engine, tenant_id, version_id = tenant_and_version
    record_step(engine, tenant_id, version_id, 3, "Running data quality checks", status="running")
    record_step(engine, tenant_id, version_id, 3, "Running data quality checks", status="running")
    record_step(engine, tenant_id, version_id, 4, "Generating AI insights", status="running")
    record_step(engine, tenant_id, version_id, 4, "Generating AI insights", status="complete")
    with engine.connect() as conn:
        step3_rows = conn.execute(text(
            "SELECT status, finished_at FROM analysis_run_steps WHERE version_id = :v AND step_number = 3"
        ), {"v": version_id}).fetchall()
        step4_row = conn.execute(text(
            "SELECT status FROM analysis_run_steps WHERE version_id = :v AND step_number = 4"
        ), {"v": version_id}).fetchone()
    assert len(step3_rows) == 1
    assert step3_rows[0].status == "complete"
    assert step3_rows[0].finished_at is not None
    assert step4_row.status == "complete"


def test_record_step_failed_matches_the_open_row_not_the_given_step_number(tenant_and_version):
    engine, tenant_id, version_id = tenant_and_version
    record_step(engine, tenant_id, version_id, 3, "Running data quality checks", status="running")
    record_step(engine, tenant_id, version_id, 6, "Finalising", status="running")
    record_step(engine, tenant_id, version_id, 3, "Running data quality checks", status="failed",
                error_detail="boom")
    with engine.connect() as conn:
        step3_row = conn.execute(text(
            "SELECT status FROM analysis_run_steps WHERE version_id = :v AND step_number = 3"
        ), {"v": version_id}).fetchone()
        step6_row = conn.execute(text(
            "SELECT status, error_detail FROM analysis_run_steps WHERE version_id = :v AND step_number = 6"
        ), {"v": version_id}).fetchone()
    assert step3_row.status == "complete"
    assert step6_row.status == "failed"
    assert step6_row.error_detail == "boom"
