"""Learned monitors between full runs on real Postgres, as a role under row level security.

A profile with seven earlier synced runs of about 1000 rows, then a sync that landed 100 rows whose analysis is pending:
the interim monitor stores one volume_drop break, stores nothing twice, drops it when the next pass no longer finds it,
and leaves a finished run, a delta profile, a multi-module profile and another tenant alone.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_migration_waves_pg.py); skipped otherwise.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, urlunparse

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_interim_app"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _sync(c, tid, pid, rows, ago_days, status):
    """One completed sync of the profile with its tagged version (status = the version's analysis status)."""
    sid = str(uuid.uuid4())
    at = _NOW - timedelta(days=ago_days)
    c.execute(text("INSERT INTO sync_runs (id, tenant_id, profile_id, started_at, rows_extracted, status) "
                   "VALUES (:i, :t, :p, :at, :r, 'completed')"), {"i": sid, "t": tid, "p": pid, "at": at, "r": rows})
    return c.execute(text("INSERT INTO analysis_versions (tenant_id, run_number, run_at, status, metadata) VALUES "
                          "(:t, 1, :at, :s, CAST(:m AS jsonb)) RETURNING id::text"),
                     {"t": tid, "at": at, "s": status, "m": json.dumps({"sync_run_id": sid, "source": "sync"})}).scalar()


def _profile(c, tid, system, modules, mode="full"):
    pid = str(uuid.uuid4())
    c.execute(text("INSERT INTO sync_profiles (id, tenant_id, system_id, domain, modules, extraction_mode) "
                   "VALUES (:i, :t, :s, 'material_master', :m, :x)"),
              {"i": pid, "t": tid, "s": system, "m": modules, "x": mode})
    return pid


def _tenant(owner, last_rows=100, last_status="pending", modules=("material_master",), mode="full"):
    tid, system = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"M-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:i, :t, 'Sandbox')"), {"i": system, "t": tid})
        pid = _profile(c, tid, system, list(modules), mode)
        for n in range(7):
            _sync(c, tid, pid, 1000 + (n % 3) * 10, 10 - n, "complete")
        pending = _sync(c, tid, pid, last_rows, 0, last_status)
    return tid, pending


def _run(app, tid, fn):
    with Session(app) as s, s.begin():
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        return fn(s)


def _pass(app, tid):
    from api.services.learned_monitors_interim import detect_interim, store_interim
    return _run(app, tid, lambda s: store_interim(s, tid, detect_interim(s, tid)))


def _rows(owner, tid):
    with owner.begin() as c:
        return c.execute(text("SELECT version_id::text, kind, metric, source, status FROM learned_monitor_breaks "
                              "WHERE tenant_id = :t"), {"t": tid}).fetchall()


def test_a_pending_extraction_far_below_the_baseline_breaks_once(engines):
    owner, app = engines
    tid, pending = _tenant(owner)
    assert _pass(app, tid) == 1
    assert _rows(owner, tid) == [(pending, "volume_drop", "records", "interim", "open")]
    assert _pass(app, tid) == 0  # idempotent
    assert len(_rows(owner, tid)) == 1


def test_a_normal_extraction_raises_nothing(engines):
    owner, app = engines
    tid, _ = _tenant(owner, last_rows=1010)
    assert _pass(app, tid) == 0
    assert _rows(owner, tid) == []


def test_a_break_that_no_longer_holds_is_removed_and_a_finished_run_gets_none(engines):
    owner, app = engines
    tid, pending = _tenant(owner)
    assert _pass(app, tid) == 1
    with owner.begin() as c:  # the sync is re-measured at a normal size
        c.execute(text("UPDATE sync_runs SET rows_extracted = 1005 WHERE tenant_id = :t AND id::text = "
                       "(SELECT metadata->>'sync_run_id' FROM analysis_versions WHERE id = CAST(:v AS uuid))"),
                  {"t": tid, "v": pending})
    _pass(app, tid)
    assert _rows(owner, tid) == []
    with owner.begin() as c:  # back to 100 rows, but the analysis finished meanwhile: its own run detection owns it
        c.execute(text("UPDATE sync_runs SET rows_extracted = 100 WHERE tenant_id = :t AND id::text = "
                       "(SELECT metadata->>'sync_run_id' FROM analysis_versions WHERE id = CAST(:v AS uuid))"),
                  {"t": tid, "v": pending})
        c.execute(text("UPDATE analysis_versions SET status = 'complete' WHERE id = CAST(:v AS uuid)"), {"v": pending})
    assert _pass(app, tid) == 0
    assert _rows(owner, tid) == []


@pytest.mark.parametrize("kw", [{"mode": "delta"}, {"modules": ("material_master", "business_partner")}])
def test_delta_and_multi_module_profiles_are_left_out(engines, kw):
    owner, app = engines
    tid, _ = _tenant(owner, **kw)
    assert _pass(app, tid) == 0


def test_one_tenant_never_sees_the_others_syncs(engines):
    owner, app = engines
    t1, _ = _tenant(owner)
    t2, _ = _tenant(owner, last_rows=1000)
    assert _pass(app, t2) == 0
    assert _pass(app, t1) == 1
    assert _rows(owner, t2) == []
