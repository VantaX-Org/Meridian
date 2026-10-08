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
