"""Learned minimum effects on real Postgres: the events query through the worker's sync session and the route's
asyncpg session, as a role under row level security, with two tenants deciding on the same monitor.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_migration_waves_pg.py); skipped otherwise.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import urlparse, urlunparse

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import Session

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_monitor_app"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_MODULE = "material_master"
_NOW = datetime.now(timezone.utc)


@pytest.fixture(scope="module")
def engines():
    url = os.environ["MERIDIAN_TEST_DB_URL"]
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text(f"SELECT 1 FROM pg_roles WHERE rolname = '{_ROLE}'")).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    role_url = urlunparse(("postgresql", f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}", u.path, u.params, u.query, u.fragment))
    app = create_engine(role_url)
    yield owner, app, role_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _tenant_with_decisions(owner, decisions: list[tuple[str, float, float, datetime]]) -> str:
    """A tenant with one run and a decided fail-rate break on rule R1 per (status, observed, median, decided_at)."""
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"M-{tid[:8]}"})
        vid = c.execute(text("INSERT INTO analysis_versions (tenant_id, run_number) VALUES (:t, 1) RETURNING id"),
                        {"t": tid}).scalar()
        for n, (status, observed, median, at) in enumerate(decisions):
            # The unique key is (version, module, kind, subject), so each decision after the first gets its own run.
            v = vid if n == 0 else c.execute(text(
                "INSERT INTO analysis_versions (tenant_id, run_number) VALUES (:t, :r) RETURNING id"),
                {"t": tid, "r": n + 1}).scalar()
            c.execute(text("""
                INSERT INTO learned_monitor_breaks (tenant_id, version_id, module, kind, metric, subject_code, severity,
                                                    median, observed, baseline_runs, method, status, decided_by, decided_at)
                VALUES (:t, :v, :m, 'fail_rate_jump', 'fail_rate', 'R1', 'high', :med, :obs, 6, 'median_mad', :s,
                        'steward', :at)"""), {"t": tid, "v": v, "m": _MODULE, "med": median, "obs": observed, "s": status, "at": at})
    return tid


def test_minimums_are_learned_per_tenant_through_the_worker_and_the_route(engines):
    from api.routes.learned_monitors import _thresholds
    from api.services import learned_monitors as lm

    owner, app, async_url = engines
    day = timedelta(days=1)
    t1 = _tenant_with_decisions(owner, [("expected", 7.0, 2.0, _NOW - day),         # effect 5, minimum 5.25
                                        ("expected", 30.0, 2.0, _NOW - 91 * day)])  # older than the window
    t2 = _tenant_with_decisions(owner, [("expected", 4.0, 1.0, _NOW - day)])        # effect 3, minimum 3.15

    def worker(tid: str) -> dict:
        with Session(app) as s, s.begin():
            s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
            return lm.learned_minimums(s, tid, _MODULE, _NOW)

    assert worker(t1) == {("fail_rate", "R1"): 5.0 * lm.LEARN_MARGIN}
    assert worker(t2) == {("fail_rate", "R1"): 3.0 * lm.LEARN_MARGIN}

    async def route(tid: str) -> list:
        eng = create_async_engine(async_url)
        try:
            async with AsyncSession(eng) as db, db.begin():
                await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
                return await _thresholds(db, SimpleNamespace(id=uuid.UUID(tid)), [_MODULE])
        finally:
            await eng.dispose()

    got = asyncio.run(route(t1))
    assert [(x.module, x.metric, x.subject_code, x.min_effect) for x in got] == [
        (_MODULE, "fail_rate", "R1", 5.0 * lm.LEARN_MARGIN)]
    assert len(got[0].moves) == 1


def test_another_tenants_id_reads_nothing_under_row_level_security(engines):
    from api.services import learned_monitors as lm

    owner, app, _ = engines
    t1 = _tenant_with_decisions(owner, [("expected", 7.0, 2.0, _NOW - timedelta(days=1))])
    t2 = _tenant_with_decisions(owner, [])
    with Session(app) as s, s.begin():
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": t2})
        assert lm.learned_minimums(s, t1, _MODULE, _NOW) == {}
