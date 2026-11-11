"""Every migration reverses (D-22): upgrade head, downgrade base, upgrade head on a throwaway database.

The schema after the round trip must match the schema of the first upgrade, and downgrade base must leave
nothing behind but alembic_version. Runs in its own database on the MERIDIAN_TEST_DB_URL server (so the
shared test database keeps its data); skipped when MERIDIAN_TEST_DB_URL is not set.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Everything a migration can create in public, one text row per object, comparable across databases.
SCHEMA_SQL = """
SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable
       || ' ' || coalesce(column_default, '') FROM information_schema.columns WHERE table_schema = 'public'
UNION ALL SELECT 'idx ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL SELECT 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace
UNION ALL SELECT 'pol ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '')
       || ' ' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'rls ' || relname || ' ' || relrowsecurity::text || ' ' || relforcerowsecurity::text
       FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')
UNION ALL SELECT 'rel ' || relkind::text || ' ' || relname FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p', 'v', 'm', 'S')
UNION ALL SELECT 'fn ' || oid::regprocedure::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace
UNION ALL SELECT 'trg ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
UNION ALL SELECT 'type ' || typname FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype IN ('e', 'd')
UNION ALL SELECT 'ext ' || extname FROM pg_extension WHERE extname <> 'plpgsql'
"""


def _alembic(url: str, *args: str) -> None:
    r = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": ROOT})
    assert r.returncode == 0, f"alembic {' '.join(args)} failed:\n{r.stderr[-1500:]}"


def _schema(url: str) -> set[str]:
    eng = create_engine(url)
    try:
        with eng.connect() as c:
            return {row[0] for row in c.execute(text(SCHEMA_SQL))}
    finally:
        eng.dispose()


@pytest.fixture()
def scratch_db() -> str:
    base = make_url(os.environ["MERIDIAN_TEST_DB_URL"])
    name = f"meridian_rt_{uuid.uuid4().hex[:8]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield base.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def test_upgrade_downgrade_base_upgrade_round_trip(scratch_db: str) -> None:
    _alembic(scratch_db, "upgrade", "head")
    first = _schema(scratch_db)
    assert any(s.startswith("rel r findings") for s in first)

    _alembic(scratch_db, "downgrade", "base")
    left = {s for s in _schema(scratch_db) if "alembic_version" not in s}
    assert left == set(), f"downgrade base left objects behind: {sorted(left)[:40]}"

    _alembic(scratch_db, "upgrade", "head")
    second = _schema(scratch_db)
    assert first == second, (f"only after first upgrade: {sorted(first - second)[:20]}; "
                             f"only after round trip: {sorted(second - first)[:20]}")


def test_downgrade_below_030_refuses_while_cloud_systems_exist(scratch_db: str) -> None:
    _alembic(scratch_db, "upgrade", "head")
    eng = create_engine(scratch_db)
    with eng.begin() as c:
        tid = c.execute(text("INSERT INTO tenants (name) VALUES ('rt') RETURNING id")).scalar()
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tid)})
        c.execute(text("INSERT INTO sap_systems (tenant_id, name, system_type) VALUES (:t, 'cloud', 'successfactors')"),
                  {"t": tid})
    eng.dispose()
    r = subprocess.run([sys.executable, "-m", "alembic", "downgrade", "029"], cwd=ROOT, capture_output=True,
                       text=True, env={**os.environ, "DATABASE_URL_MIGRATE": scratch_db, "PYTHONPATH": ROOT})
    assert r.returncode != 0
    assert "Cannot downgrade below 030: 1 system(s)" in r.stderr
    # Migrations with autocommit blocks (061, 084, 103, 135, 139) commit their step, so a refused downgrade
    # stops above 030 rather than rolling back whole; upgrade head returns from there.
    assert int(_alembic_current(scratch_db)) > 30
    _alembic(scratch_db, "upgrade", "head")


def _alembic_current(url: str) -> str:
    eng = create_engine(url)
    try:
        with eng.connect() as c:
            return c.execute(text("SELECT version_num FROM alembic_version")).scalar() or ""
    finally:
        eng.dispose()
