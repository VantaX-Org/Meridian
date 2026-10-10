"""When a delta may build on the previous version, and from which date."""

import json
import os
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, text

from workers.tasks.run_extraction import delta_baseline, delta_plan

NOW = datetime(2026, 10, 10, 1, 0, tzinfo=timezone.utc)


def test_no_baseline_means_a_full_read():
    assert delta_plan(None, NOW, 7) is None
    assert delta_plan({"id": "v0"}, NOW, 7) is None  # no started_at


def test_recent_full_baseline_gives_since_and_full_at():
    b = {"id": "v1", "started_at": "2026-10-09T01:00:00+00:00", "delta": {"full_at": "2026-10-09T01:00:00+00:00"}}
    assert delta_plan(b, NOW, 7) == ("20261008", "2026-10-09T01:00:00+00:00")


def test_delta_baseline_carries_the_last_full_read():
    b = {"id": "v2", "started_at": "2026-10-09T01:00:00+00:00", "delta": {"full_at": "2026-10-05T01:00:00+00:00"}}
    assert delta_plan(b, NOW, 7) == ("20261008", "2026-10-05T01:00:00+00:00")


def test_full_read_older_than_the_limit_forces_a_full_read():
    b = {"id": "v3", "started_at": "2026-10-09T01:00:00+00:00", "delta": {"full_at": "2026-10-01T01:00:00+00:00"}}
    assert delta_plan(b, NOW, 7) is None


def test_versions_before_delta_count_their_start_as_the_full_read():
    assert delta_plan({"id": "v4", "started_at": "2026-10-09T01:00:00+00:00"}, NOW, 7) == \
        ("20261008", "2026-10-09T01:00:00+00:00")


pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def tenant_and_system():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tenant_id = str(uuid.uuid4())
    system_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, 'delta-baseline-test')"), {"id": tenant_id})
    yield engine, tenant_id, system_id
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": tenant_id})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})


def _insert_version(engine, tenant_id: str, system_id: str, scope: object, status: str = "success") -> str:
    version_id = str(uuid.uuid4())
    meta = {"system_id": system_id, "modules": ["material_master"], "scope": scope,
            "dataset_path": f"staging/{tenant_id}/{version_id}/", "started_at": "2026-10-09T01:00:00+00:00"}
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO analysis_versions (id, tenant_id, status, metadata)
            VALUES (:v, :t, :st, CAST(:meta AS jsonb))
        """), {"v": version_id, "t": tenant_id, "st": status, "meta": json.dumps(meta)})
    return version_id


def test_delta_baseline_ignores_a_differently_scoped_version(tenant_and_system):
    """A scoped manual baseline must not be picked as the baseline for an unscoped (sync) delta."""
    engine, tenant_id, system_id = tenant_and_system
    scoped = _insert_version(engine, tenant_id, system_id, {"plant": "1000"})

    with engine.connect() as session:
        assert delta_baseline(session, tenant_id, system_id, ["material_master"], None) is None
        assert delta_baseline(session, tenant_id, system_id, ["material_master"], {"plant": "1000"})["id"] == scoped


def test_delta_baseline_matches_the_same_scope(tenant_and_system):
    engine, tenant_id, system_id = tenant_and_system
    unscoped = _insert_version(engine, tenant_id, system_id, {})

    with engine.connect() as session:
        found = delta_baseline(session, tenant_id, system_id, ["material_master"], None)
        assert found is not None and found["id"] == unscoped
        assert delta_baseline(session, tenant_id, system_id, ["material_master"], {"plant": "1000"}) is None
