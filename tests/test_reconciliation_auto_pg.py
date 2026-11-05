"""A finished target analysis starts a reconciliation for each run whose latest one is now stale (Postgres)."""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from unittest import mock

import pytest

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="module")
def engine():
    from sqlalchemy import create_engine

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr
    e = create_engine(url)
    yield e
    e.dispose()


def _seed(engine, recon_age: str = "2 days") -> tuple[str, str, str]:
    """A tenant with a target system analysed 1 hour ago and a run reconciled against an older extraction."""
    from sqlalchemy import text

    tid, sid, run = (str(uuid.uuid4()) for _ in range(3))
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"A-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'TGT')"), {"s": sid, "t": tid})
        c.execute(text("INSERT INTO migration_runs (id, tenant_id, mode, modules, status, dest_system_id) "
                       "VALUES (:r, :t, 'source_to_destination', '{material_master}', 'analysed', :s)"),
                  {"r": run, "t": tid, "s": sid})
        meta = json.dumps({"system_id": sid, "dataset_path": "x"})
        c.execute(text("INSERT INTO analysis_versions (tenant_id, status, run_at, metadata) VALUES "
                       "(:t, 'complete', now() - CAST(:a AS interval), CAST(:m AS jsonb)), "
                       "(:t, 'complete', now() - interval '1 hour', CAST(:m AS jsonb))"),
                  {"t": tid, "a": recon_age, "m": meta})
        c.execute(text("INSERT INTO migration_reconciliations (tenant_id, run_id, status, target_system_id, "
                       "target_synced_at) VALUES (:t, :r, 'done', :s, now() - CAST(:a AS interval))"),
                  {"t": tid, "r": run, "s": sid, "a": recon_age})
    return tid, sid, run


@pg
def test_stale_run_is_reconciled_once_and_marked_automatic(engine):
    from sqlalchemy import text

    from workers.db import tenant_session
    from workers.tasks.run_reconciliation import run_reconciliation, start_stale_reconciliations

    tid, sid, run = _seed(engine)
    with mock.patch.object(run_reconciliation, "delay", return_value=mock.Mock(id="task-1")) as delay:
        with tenant_session(engine, tid) as s:
            first = start_stale_reconciliations(s, tid, sid)
            again = start_stale_reconciliations(s, tid, sid)  # one is queued now: nothing more
    assert len(first) == 1 and again == []
    assert delay.call_count == 1
    with engine.begin() as c:
        row = c.execute(text("SELECT status, auto_started, task_id FROM migration_reconciliations "
                             "WHERE id = :i"), {"i": first[0]}).one()
    assert tuple(row) == ("queued", True, "task-1")


@pg
def test_current_run_is_left_alone(engine):
    from workers.db import tenant_session
    from workers.tasks.run_reconciliation import run_reconciliation, start_stale_reconciliations

    tid, sid, _ = _seed(engine, recon_age="10 minutes")  # compared after the newest extraction
    with mock.patch.object(run_reconciliation, "delay") as delay:
        with tenant_session(engine, tid) as s:
            assert start_stale_reconciliations(s, tid, sid) == []
    delay.assert_not_called()


@pg
def test_failures_never_propagate(engine):
    from sqlalchemy import text

    from workers.db import tenant_session
    from workers.tasks.run_reconciliation import run_reconciliation, start_stale_reconciliations

    tid, sid, _ = _seed(engine)
    with mock.patch.object(run_reconciliation, "delay", side_effect=RuntimeError("queue down")):
        with tenant_session(engine, tid) as s:
            start_stale_reconciliations(s, tid, sid)  # queue unreachable: recorded as failed, no raise
    with engine.begin() as c:
        assert c.execute(text("SELECT status FROM migration_reconciliations WHERE tenant_id = :t "
                              "AND auto_started"), {"t": tid}).scalar() == "failed"
    broken = mock.Mock()
    broken.execute.side_effect = RuntimeError("db down")
    assert start_stale_reconciliations(broken, tid, sid) == []  # a broken session does not raise either
