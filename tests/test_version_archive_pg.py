"""Clearing old runs hides finished versions, keeps the newest and live runs, clears stuck runs, and restores."""

from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")


def test_archive_keeps_latest_and_running_then_restores():
    import subprocess

    from sqlalchemy import create_engine, text

    from api.routes.versions import _DONE, ARCHIVE_SQL, RESTORE_SQL

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    eng = create_engine(url)
    tid, other = str(uuid.uuid4()), str(uuid.uuid4())
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'A1'), (:b, 'A2')"), {"a": tid, "b": other})
        ids = {}
        for name, t, status, days in (("old", tid, "complete", 3), ("mid", tid, "agents_complete", 2),
                                      ("new", tid, "complete", 1), ("stuck", tid, "running", 5), ("live", tid, "running", 0),
                                      ("foreign", other, "complete", 9)):
            ids[name] = str(uuid.uuid4())
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at) "
                           "VALUES (:v, :t, :s, now() - make_interval(days => :d))"),
                      {"v": ids[name], "t": t, "s": status, "d": days})

        def archived():
            return {n for n, v in ids.items() if c.execute(text(
                "SELECT metadata->>'archived' FROM analysis_versions WHERE id = :v"), {"v": v}).scalar() == "true"}

        p = {"tid": tid, "done": list(_DONE), "keep": 1}
        assert c.execute(text(ARCHIVE_SQL), p).rowcount == 3
        assert archived() == {"old", "mid", "stuck"}
        assert c.execute(text(ARCHIVE_SQL), p).rowcount == 0
        assert c.execute(text(RESTORE_SQL), {"tid": tid}).rowcount == 3
        assert archived() == set()
        c.execute(text("DELETE FROM analysis_versions WHERE tenant_id IN (:a, :b)"), {"a": tid, "b": other})
        c.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": tid, "b": other})
    eng.dispose()
