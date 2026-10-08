"""tests/db/test_analysis_run_steps_migration.py"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


def test_analysis_run_steps_table_shape():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.connect() as conn:
        cols = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'analysis_run_steps'"
        )).scalars().all()
    expected = {
        "id", "tenant_id", "version_id", "step_number", "step_name",
        "status", "started_at", "finished_at", "duration_ms", "error_detail",
    }
    assert expected <= set(cols)


@pytest.fixture
def tenant_and_version():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tenant_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, 'wave1b-test')"), {"id": tenant_id})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"
        ), {"v": version_id, "t": tenant_id})
    yield engine, tenant_id, version_id
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": version_id})
        conn.execute(text("DELETE FROM tenants WHERE id = :id"), {"id": tenant_id})


def test_analysis_run_steps_cascades_on_version_delete(tenant_and_version):
    engine, tenant_id, version_id = tenant_and_version
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name) "
            "VALUES (:t, :v, 1, 'Uploading and validating file')"
        ), {"t": tenant_id, "v": version_id})
        conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": version_id})
        remaining = conn.execute(text(
            "SELECT count(*) FROM analysis_run_steps WHERE version_id = :v"
        ), {"v": version_id}).scalar()
    assert remaining == 0
