"""Migration 140: migration_reconciliations is tenant-isolated, status-constrained and reversible.

Runs with MERIDIAN_TEST_DB_URL. The app role is NOBYPASSRLS so the policy is really exercised.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid

import pytest

_ROLE = "meridian_recon_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(*args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def app_engine():
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic("upgrade", "head")
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _tenant(owner) -> str:
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"R-{tid[:8]}"})
    return tid


def _run(owner, tid: str) -> str:
    from sqlalchemy import text

    rid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO migration_runs (id, tenant_id, mode, modules, status) "
                       "VALUES (:r, :t, 'source_to_destination', '{material_master}', 'analysed')"),
                  {"r": rid, "t": tid})
    return rid


@pg
def test_reconciliations_are_tenant_isolated(app_engine):
    from sqlalchemy import text

    owner, app = app_engine
    a, b = _tenant(owner), _tenant(owner)
    run = _run(owner, a)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        c.execute(text("INSERT INTO migration_reconciliations (tenant_id, run_id) VALUES (:t, :r)"), {"t": a, "r": run})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": b})
        assert c.execute(text("SELECT COUNT(*) FROM migration_reconciliations")).scalar() == 0
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        row = c.execute(text("SELECT status, summary, tables FROM migration_reconciliations")).one()
        assert (row.status, row.summary, row.tables) == ("queued", {}, [])


@pg
def test_purging_either_version_clears_the_record_rows(app_engine):
    from sqlalchemy import text

    from api.services.purge import UNLINK

    owner, _ = app_engine
    tid = _tenant(owner)
    versions = {}
    for name in ("source", "target", "other"):
        with owner.begin() as c:
            versions[name] = str(c.execute(text("INSERT INTO analysis_versions (tenant_id, status) VALUES (:t, 'complete') "
                                                "RETURNING id"), {"t": tid}).scalar())

    def recon(source, target):
        run = _run(owner, tid)
        with owner.begin() as c:
            c.execute(text("UPDATE migration_runs SET source_version_id = :v WHERE id = :r"), {"v": source, "r": run})
            return c.execute(text("INSERT INTO migration_reconciliations (tenant_id, run_id, target_version_id, records) "
                                  "VALUES (:t, :r, :v, CAST('{\"MARA\": [{\"key\": \"MATNR=1\"}]}' AS jsonb)) "
                                  "RETURNING id"), {"t": tid, "r": run, "v": target}).scalar()

    by_target = recon(versions["other"], versions["target"])
    by_source = recon(versions["source"], versions["other"])
    untouched = recon(versions["other"], versions["other"])
    steps = [u for u in UNLINK if u[0] in ("migration_reconciliations", "migration_runs")]
    assert [u[0] for u in steps] == ["migration_reconciliations", "migration_runs"]
    with owner.begin() as c:
        for v in (versions["target"], versions["source"]):
            for table, sets, where in steps:
                c.execute(text(f"UPDATE {table} SET {sets} WHERE {where}"), {"t": tid, "v": v})
    with owner.connect() as c:
        rows = {r.id: r for r in c.execute(text("SELECT id, target_version_id, records FROM migration_reconciliations "
                                                "WHERE tenant_id = :t"), {"t": tid})}
    assert rows[by_target].records == {} and rows[by_target].target_version_id is None
    assert rows[by_source].records == {} and str(rows[by_source].target_version_id) == versions["other"]
    assert rows[untouched].records != {}


@pg
def test_other_tenant_cannot_insert(app_engine):
    from sqlalchemy import text
    from sqlalchemy.exc import ProgrammingError

    owner, app = app_engine
    a, b = _tenant(owner), _tenant(owner)
    run = _run(owner, a)
    with pytest.raises(ProgrammingError):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": b})
            c.execute(text("INSERT INTO migration_reconciliations (tenant_id, run_id) VALUES (:t, :r)"),
                      {"t": a, "r": run})


@pg
def test_status_is_constrained(app_engine):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    owner, _app = app_engine
    t = _tenant(owner)
    run = _run(owner, t)
    with pytest.raises(IntegrityError):
        with owner.begin() as c:
            c.execute(text("INSERT INTO migration_reconciliations (tenant_id, run_id, status) VALUES (:t, :r, 'bogus')"),
                      {"t": t, "r": run})


@pg
def test_downgrade_drops_and_upgrade_restores(app_engine):
    from sqlalchemy import text

    owner, _app = app_engine
    _alembic("downgrade", "139")
    with owner.begin() as c:
        assert c.execute(text("SELECT to_regclass('public.migration_reconciliations')")).scalar() is None
    _alembic("upgrade", "head")
    with owner.begin() as c:
        assert c.execute(text("SELECT to_regclass('public.migration_reconciliations')")).scalar() is not None
