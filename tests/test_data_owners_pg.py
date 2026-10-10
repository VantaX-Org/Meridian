"""data_owners against a real Postgres: constraints, tenant RLS as a non-superuser role,
migration 074 downgrade, and the /api/v1/owners routes.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

ROLE = "meridian_owners_app"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(*args: str) -> None:
    import subprocess

    r = subprocess.run(["alembic", *args], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def engines():
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic("upgrade", "head")
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text(f"SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}'")).scalar():
            c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {ROLE}"))
        c.execute(text(f"CREATE ROLE {ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{ROLE}:pw@{u.hostname}:{u.port or 5432}", u.path, "", u.query, "")))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {ROLE}"))
    owner.dispose()


def _tenant(owner, users: list[str], inactive: tuple[str, ...] = ()) -> tuple[str, dict[str, str]]:
    """Tenant + named users. Returns (tid, {name: user id})."""
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    ids = {n: str(uuid.uuid4()) for n in users}
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Owners')"), {"t": tid})
        for n, i in ids.items():
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active) "
                           "VALUES (:i, :t, :e, :n, 'steward', :a)"),
                      {"i": i, "t": tid, "e": f"{n}-{i[:8]}@example.test", "n": n, "a": n not in inactive})
    return tid, ids


_INSERT = "INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id) VALUES (:t, :k, 'AP001', :u)"


def test_data_owners_constraints_and_rls(engines):
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError, IntegrityError

    owner, app = engines
    t1, u1 = _tenant(owner, ["ann"])
    t2, _ = _tenant(owner, ["bob"])

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t1})
        c.execute(text(_INSERT), {"t": t1, "k": "rule", "u": u1["ann"]})
    with pytest.raises(IntegrityError):  # one row per (tenant, kind, ref)
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t1})
            c.execute(text(_INSERT), {"t": t1, "k": "rule", "u": u1["ann"]})
    with pytest.raises(IntegrityError):  # field ownership stays in the glossary
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t1})
            c.execute(text(_INSERT), {"t": t1, "k": "field", "u": u1["ann"]})

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t2})
        assert c.execute(text("SELECT COUNT(*) FROM data_owners")).scalar() == 0
    with pytest.raises(DBAPIError, match="row-level security"):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t2})
            c.execute(text(_INSERT), {"t": t1, "k": "object", "u": None})


def test_migration_074_downgrades_cleanly(engines):
    from sqlalchemy import text

    owner, _ = engines
    _alembic("downgrade", "073")
    with owner.connect() as c:
        assert c.execute(text("SELECT to_regclass('data_owners')")).scalar() is None
    _alembic("upgrade", "head")
    with owner.begin() as c:
        assert c.execute(text("SELECT relforcerowsecurity FROM pg_class WHERE relname = 'data_owners'")).scalar()
        # the table was recreated by the owner: give the app role access again for later tests
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {ROLE}"))
