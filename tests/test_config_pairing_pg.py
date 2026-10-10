"""Config pairing on Postgres: migration 075, SQL helpers, load_config, enqueue, routes and reports.

Runs with MERIDIAN_TEST_DB_URL. The app role is NOBYPASSRLS so tenant policies are really exercised.
"""

from __future__ import annotations

import os
import subprocess
import uuid

import pytest

_ROLE = "meridian_pairing_app"
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
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"P-{tid[:8]}"})
    return tid


def _system(app, tid: str, name: str, system_type: str = "ecc", role: str = "source",
            target: str | None = None) -> str:
    from sqlalchemy import text

    sid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, role, target_system_id) "
                       "VALUES (:s, :t, :n, :st, :r, CAST(:tg AS uuid))"),
                  {"s": sid, "t": tid, "n": name, "st": system_type, "r": role, "tg": target})
    return sid


def _load(app, tid: str, sid: str, items: list[tuple[str, str, dict]], origin: str = "connection",
          status: str = "completed", minutes_ago: int = 0) -> str:
    """One config_loads row plus its items; finished_at orders loads oldest first by minutes_ago."""
    import json

    from sqlalchemy import text

    lid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO config_loads (id, tenant_id, system_id, system_type, origin, status, "
                       "created_at, finished_at) SELECT :l, :t, id, system_type, :o, :st, "
                       "now() - make_interval(mins => :m), "
                       "CASE WHEN :st = 'completed' THEN now() - make_interval(mins => :m) END "
                       "FROM sap_systems WHERE id = :s"),
                  {"l": lid, "t": tid, "s": sid, "o": origin, "st": status, "m": minutes_ago})
        for obj, key, vals in items:
            c.execute(text('INSERT INTO config_items (tenant_id, load_id, object, key, "values") '
                           "VALUES (:t, :l, :o, :k, CAST(:v AS jsonb))"),
                      {"t": tid, "l": lid, "o": obj, "k": key, "v": json.dumps(vals)})
    return lid


@pg
def test_system_role_defaults_to_source_and_is_checked(app_engine):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    owner, app = app_engine
    tid = _tenant(owner)
    sid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'PRD')"), {"s": sid, "t": tid})
        assert c.execute(text("SELECT role FROM sap_systems WHERE id = :s"), {"s": sid}).scalar() == "source"
    with pytest.raises(IntegrityError):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE sap_systems SET role = 'archive' WHERE id = :s"), {"s": sid})
    with pytest.raises(IntegrityError):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE sap_systems SET target_system_id = id WHERE id = :s"), {"s": sid})


@pg
def test_deleting_a_target_clears_the_source_pointer(app_engine):
    from sqlalchemy import text

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM sap_systems WHERE id = :s"), {"s": tgt})
        assert c.execute(text("SELECT target_system_id FROM sap_systems WHERE id = :s"), {"s": src}).scalar() is None


@pg
def test_value_map_scope_is_unique_with_null_scope(app_engine):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    owner, app = app_engine
    tid = _tenant(owner)
    src = _system(app, tid, "PRD")
    ins = ("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value, "
           "source_system_id, status) VALUES (gen_random_uuid(), :t, 'config', 'T077K.KTOKK', 'LIEF', 'KRED', "
           "CAST(:s AS uuid), :st)")
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text(ins), {"t": tid, "s": None, "st": "confirmed"})
        c.execute(text(ins), {"t": tid, "s": src, "st": "proposed"})  # scoped row coexists with the global row
        assert c.execute(text("SELECT status FROM transfer_value_mappings WHERE source_system_id IS NULL")).scalar() \
            == "confirmed"
    with pytest.raises(IntegrityError):  # a second global row is a duplicate (NULLS NOT DISTINCT)
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text(ins), {"t": tid, "s": None, "st": "confirmed"})
    with pytest.raises(IntegrityError):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE transfer_value_mappings SET status = 'maybe'"))


@pg
def test_migration_075_downgrades_cleanly(app_engine):
    from sqlalchemy import text

    owner, _app = app_engine
    _alembic("downgrade", "068")
    with owner.begin() as c:
        cols = {r[0] for r in c.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'sap_systems'"))}
        assert "role" not in cols and "target_system_id" not in cols
        assert c.execute(text("SELECT 1 FROM pg_constraint WHERE conname = 'uq_transfer_value_mappings'")).scalar()
    _alembic("upgrade", "head")
