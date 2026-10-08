"""tests/workers/test_run_sync_steps.py"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


def test_run_sync_failure_is_recorded_as_a_step(monkeypatch):
    """_fail_sync_run must also leave a failed row in analysis_run_steps, keyed by
    the sync_run_id (sync runs have no analysis_versions row, so version_id here
    is the sync_run_id — read run_sync.py's _fail_sync_run signature to confirm
    which id is available at the call site before wiring this up)."""
    from workers.tasks.run_sync import _fail_sync_run

    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tenant_id = str(uuid.uuid4())
    sync_run_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, 'run-sync-steps-test')"), {"id": tenant_id})
        conn.execute(text(
            "INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'processing')"
        ), {"v": sync_run_id, "t": tenant_id})

    _fail_sync_run(engine, tenant_id, sync_run_id, "SAP connection refused: RFC_COMMUNICATION_FAILURE",
                   version_id=sync_run_id)

    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT status, error_detail FROM analysis_run_steps WHERE version_id = :v ORDER BY step_number DESC LIMIT 1"
        ), {"v": sync_run_id}).fetchone()
    assert row is not None
    assert row.status == "failed"
    assert "RFC_COMMUNICATION_FAILURE" in row.error_detail

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM analysis_versions WHERE id = :v"), {"v": sync_run_id})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
