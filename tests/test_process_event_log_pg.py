"""Migration 079: process event log is tenant-isolated, cascades from runs, and is reversible."""

from __future__ import annotations

import os
import subprocess
import uuid
from typing import Iterator

import pytest
from sqlalchemy.engine import Connection, Engine

_ROLE = "meridian_pd_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(*args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def engines() -> Iterator[tuple[Engine, Engine]]:
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    u = urlparse(url)
    resolved_port = u.port or 5432
    if resolved_port == 5432:
        pytest.skip("refusing to run migrations against port 5432")
    _alembic("upgrade", "head")
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {_ROLE}"))
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{resolved_port}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _tenant_and_system(owner: Engine) -> tuple[str, str]:
    from sqlalchemy import text

    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PD-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'S')"), {"s": sid, "t": tid})
    return tid, sid


def _run(c: Connection, tid: str, sid: str) -> str:
    from sqlalchemy import text

    return str(c.execute(text(
        "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status) "
        "VALUES (:t, :s, 'PTP', 'full', 'queued') RETURNING id"), {"t": tid, "s": sid}).scalar())


@pg
def test_rls_isolates_all_three_tables(engines: tuple[Engine, Engine]) -> None:
    from sqlalchemy import text

    owner, app = engines
    # Verify app role does not bypass RLS
    with app.begin() as c:
        bypass_rls = c.execute(text("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")).scalar()
        assert bypass_rls is False, f"App role should have rolbypassrls = false, got {bypass_rls}"

    a, sa = _tenant_and_system(owner)
    b, _ = _tenant_and_system(owner)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        rid = _run(c, a, sa)
        c.execute(text(
            "INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, ts, ts_precision, "
            "source_table, run_id) VALUES (:t, :s, 'PTP', 'po_item', '4500000001/00010', 'PO_CREATED', now(), "
            "'second', 'EKKO', :r)"), {"t": a, "s": sa, "r": rid})
        c.execute(text(
            "INSERT INTO process_discovery_variants (run_id, tenant_id, case_type, variant_hash, activities, "
            "case_count, share, sample_case_ids) VALUES (:r, :t, 'po_item', :h, '{PO_CREATED}', 1, 1, '{x}')"),
            {"r": rid, "t": a, "h": "a" * 32})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": b})
        for t in ("process_discovery_runs", "process_events", "process_discovery_variants"):
            assert c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() == 0, t
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        row = c.execute(text("SELECT coverage, filters, stats, seq FROM process_discovery_runs r "
                             "JOIN process_events e ON e.run_id = r.id")).one()
        assert (row.coverage, row.filters, row.stats, row.seq) == ("reference", {}, {}, 0)


@pg
def test_deleting_a_run_cascades(engines: tuple[Engine, Engine]) -> None:
    from sqlalchemy import text

    owner, app = engines
    a, sa = _tenant_and_system(owner)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        rid = _run(c, a, sa)
        c.execute(text(
            "INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, ts, ts_precision, "
            "source_table, run_id) VALUES (:t, :s, 'PTP', 'po_item', 'c', 'PO_CREATED', now(), 'day', 'EKKO', :r)"),
            {"t": a, "s": sa, "r": rid})
        c.execute(text("DELETE FROM process_discovery_runs WHERE id = :r"), {"r": rid})
        assert c.execute(text("SELECT COUNT(*) FROM process_events WHERE run_id = :r"), {"r": rid}).scalar() == 0


@pg
def test_timezone_column_and_downgrade(engines: tuple[Engine, Engine]) -> None:
    from sqlalchemy import create_engine, inspect, text

    owner, _ = engines
    cols = {c["name"] for c in inspect(owner).get_columns("sap_systems")}
    assert "timezone" in cols
    _alembic("downgrade", "078")
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    try:
        insp = inspect(eng)
        assert not insp.has_table("process_events")
        assert not insp.has_table("process_discovery_runs")
        assert not insp.has_table("process_discovery_variants")
        assert "timezone" not in {c["name"] for c in insp.get_columns("sap_systems")}
    finally:
        eng.dispose()
        _alembic("upgrade", "head")
        with owner.begin() as c:  # the downgrade dropped the tables, so their grants went with them
            c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))


@pg
def test_with_check_blocks_cross_tenant_insert(engines: tuple[Engine, Engine]) -> None:
    from sqlalchemy import exc, text

    owner, app = engines
    a, sa = _tenant_and_system(owner)
    b, sb = _tenant_and_system(owner)

    # Create a run in tenant A
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        rid_a = _run(c, a, sa)

    # Try to insert a row with tenant A data while tenant_id is set to B (should fail)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": b})
        with pytest.raises((exc.DBAPIError, exc.ProgrammingError)):
            c.execute(text(
                "INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status) "
                "VALUES (:t, :s, 'PTP', 'full', 'queued')"), {"t": a, "s": sa})
