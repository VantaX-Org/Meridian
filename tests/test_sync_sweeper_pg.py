"""sync_profile_scheduler's stale-run sweep against a real Postgres.

Runs with MERIDIAN_TEST_DB_URL; skipped otherwise. A run that started two hours ago is
still inside run_sync's time limit (EXTRACT_TIME_LIMIT, 6h by default) and must stay
'running'; one that started past the limit is swept to 'failed'.
"""

from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def engine():
    import subprocess

    from sqlalchemy import create_engine

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    e = create_engine(url)
    yield e
    e.dispose()


def test_sweep_only_marks_runs_past_the_extraction_time_limit(engine, monkeypatch):
    from sqlalchemy import text

    from workers import scheduler
    from workers.tasks.run_extraction import EXTRACT_TIME_LIMIT

    tid, sid, pid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    live, dead = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'sweep')"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'sys')"),
                  {"s": sid, "t": tid})
        c.execute(text("INSERT INTO sync_profiles (id, tenant_id, system_id, domain) "
                       "VALUES (:p, :t, :s, 'material_master')"), {"p": pid, "t": tid, "s": sid})
        c.execute(text("""
            INSERT INTO sync_runs (id, tenant_id, profile_id, status, started_at) VALUES
              (:live, :t, :p, 'running', now() - interval '2 hours'),
              (:dead, :t, :p, 'running', now() - make_interval(secs => :past))
        """), {"live": live, "dead": dead, "t": tid, "p": pid, "past": EXTRACT_TIME_LIMIT + 601})

    monkeypatch.setattr(scheduler, "get_sync_engine", lambda: engine)
    monkeypatch.setattr(scheduler, "_get_tenants", lambda s: [{"id": tid}])
    scheduler.sync_profile_scheduler()

    with engine.begin() as c:
        rows = dict(c.execute(text("SELECT id::text, status FROM sync_runs WHERE tenant_id = :t"),
                              {"t": tid}).fetchall())
        for table in ("sync_runs", "sync_profiles", "sap_systems", "tenants"):
            c.execute(text(f"DELETE FROM {table} WHERE {'id' if table == 'tenants' else 'tenant_id'} = :t"),
                      {"t": tid})
    assert rows[live] == "running"
    assert rows[dead] == "failed"
