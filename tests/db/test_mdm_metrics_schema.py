"""MDM metrics writers match the real schema.

weekly_cleaning_batch wrote steward_metrics.period_type, a column the table never had,
and snapshot_mdm_metrics used ON CONFLICT (tenant_id, snapshot_date, domain) with no
unique index behind it. Migration 080 removes duplicate snapshots and adds the index.
The Postgres part runs with MERIDIAN_TEST_DB_URL (see tests/test_alert_digest_pg.py).
"""

from __future__ import annotations

import importlib.util
import inspect
import os
import re
import subprocess
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


def test_steward_rollup_writes_only_real_columns():
    from db.schema import StewardMetric
    from workers import scheduler

    src = inspect.getsource(scheduler.weekly_cleaning_batch)
    cols = re.search(r"INSERT INTO steward_metrics \(([^)]*)\)", src).group(1)
    written = {c.strip() for c in cols.split(",")}
    assert written <= set(StewardMetric.__table__.columns.keys())


def test_080_follows_079():
    spec = importlib.util.spec_from_file_location("m080", ROOT / "db/migrations/versions/080_mdm_metrics_unique_snapshot.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert (mod.revision, mod.down_revision) == ("080", "079")


def _alembic(url: str, *args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": str(ROOT)})
    assert r.returncode == 0, r.stderr


_INSERT = """
    INSERT INTO mdm_metrics (id, tenant_id, snapshot_date, domain, mdm_health_score)
    VALUES (gen_random_uuid(), :t, '2026-10-01', :d, :s)
"""


@pg
def test_080_dedups_then_on_conflict_holds():
    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic(url, "upgrade", "head")
    _alembic(url, "downgrade", "079")
    eng = create_engine(url)
    t = str(uuid.uuid4())
    try:
        with eng.begin() as c:
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": t})
            for d, s in ((None, 1), (None, 2), ("material", 3), ("material", 4), ("customer", 5)):
                c.execute(text(_INSERT), {"t": t, "d": d, "s": s})
        _alembic(url, "upgrade", "head")
        with eng.begin() as c:
            rows = c.execute(text("SELECT domain, mdm_health_score FROM mdm_metrics WHERE tenant_id = :t"
                                  " ORDER BY domain NULLS FIRST"), {"t": t}).fetchall()
            assert [tuple(r) for r in rows] == [(None, 1.0), ("customer", 5.0), ("material", 3.0)]
            for d in (None, "material"):
                c.execute(text(_INSERT + " ON CONFLICT (tenant_id, snapshot_date, domain) DO NOTHING"),
                          {"t": t, "d": d, "s": 9})
            n = c.execute(text("SELECT count(*) FROM mdm_metrics WHERE tenant_id = :t"), {"t": t}).scalar()
            assert n == 3
    finally:
        with eng.begin() as c:
            c.execute(text("DELETE FROM mdm_metrics WHERE tenant_id = :t"), {"t": t})
            c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": t})
        eng.dispose()


@pg
def test_steward_rollup_runs_on_postgres():
    from sqlalchemy import create_engine, text

    from workers import scheduler

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic(url, "upgrade", "head")
    src = inspect.getsource(scheduler.weekly_cleaning_batch)
    sql = re.search(r'(INSERT INTO steward_metrics.*?ON CONFLICT DO NOTHING)', src, re.S).group(1)
    eng = create_engine(url)
    t = str(uuid.uuid4())
    try:
        with eng.begin() as c:
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": t})
            c.execute(text(sql), {"tid": t, "period": "2026-10-12"})
    finally:
        with eng.begin() as c:
            c.execute(text("DELETE FROM steward_metrics WHERE tenant_id = :t"), {"t": t})
            c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": t})
        eng.dispose()
