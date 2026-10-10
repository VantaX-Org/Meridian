"""Migration 068: migration_waves is tenant-isolated, seeded from settings, and reversible.

Runs with MERIDIAN_TEST_DB_URL. The app role is NOBYPASSRLS so the policy is really exercised.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid

import pytest

_ROLE = "meridian_waves_app"
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


def _tenant(owner, thresholds: dict | None = None) -> str:
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name, alert_thresholds) VALUES (:t, :n, CAST(:a AS jsonb))"),
                  {"t": tid, "n": f"D-{tid[:8]}", "a": json.dumps(thresholds) if thresholds else None})
    return tid


@pg
def test_waves_are_tenant_isolated(app_engine):
    from sqlalchemy import text

    owner, app = app_engine
    a, b = _tenant(owner), _tenant(owner)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        c.execute(text("INSERT INTO migration_waves (tenant_id, name, modules) VALUES (:t, 'Wave 1', '{material_master}')"),
                  {"t": a})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": b})
        assert c.execute(text("SELECT COUNT(*) FROM migration_waves")).scalar() == 0
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        row = c.execute(text("SELECT stage, min_readiness, min_dqs FROM migration_waves")).one()
        assert (row.stage, row.min_readiness, row.min_dqs) == ("plan", 95.0, None)


@pg
def test_stage_is_constrained(app_engine):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    owner, _app = app_engine
    t = _tenant(owner)
    with pytest.raises(IntegrityError):
        with owner.begin() as c:
            c.execute(text("INSERT INTO migration_waves (tenant_id, name, stage) VALUES (:t, 'W', 'golive')"), {"t": t})


@pg
def test_settings_waves_are_copied_and_downgrade_is_clean(app_engine):
    from sqlalchemy import text

    owner, _app = app_engine
    t = _tenant(owner, {"readiness_dqs_threshold": 80,
                        "readiness_waves": {"Wave 1": ["material_master", "business_partner"], "Wave 2": []}})
    _alembic("downgrade", "067")
    try:
        with owner.begin() as c:
            assert c.execute(text("SELECT to_regclass('migration_waves')")).scalar() is None
            assert c.execute(text("SELECT 1 FROM information_schema.columns WHERE table_name = 'migration_runs' "
                                  "AND column_name = 'wave_id'")).scalar() is None
    finally:
        _alembic("upgrade", "head")
    with owner.begin() as c:
        rows = c.execute(text("SELECT name, modules, min_dqs FROM migration_waves WHERE tenant_id = :t ORDER BY name"),
                         {"t": t}).all()
    assert [(r.name, list(r.modules), r.min_dqs) for r in rows] == [
        ("Wave 1", ["material_master", "business_partner"], 80.0),
        ("Wave 2", [], 80.0),
    ]
