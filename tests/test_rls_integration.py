"""RLS integration tests — verify that Postgres row-level security actually
isolates tenants for every table that ENABLE ROW LEVEL SECURITY.

Requires a real Postgres (the tests round-trip through the server). Skipped
cleanly when MERIDIAN_TEST_DB_URL is not set so the default `pytest` run in
a dev environment without DB stays green.

To run locally:
  docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=meridian_test postgres:16-alpine
  MERIDIAN_TEST_DB_URL=postgresql://postgres:pw@localhost:5433/meridian_test \\
      pytest tests/test_rls_integration.py -v

The GitHub Actions RLS job (.github/workflows/rls-tests.yml) runs this
against a postgres service automatically on every PR.
"""

from __future__ import annotations

import os
import uuid

import pytest


pytestmark = pytest.mark.skipif(
    not os.environ.get("MERIDIAN_TEST_DB_URL"),
    reason="MERIDIAN_TEST_DB_URL not set — skipping RLS integration tests",
)


@pytest.fixture(scope="module")
def engine():
    """Sync engine against the test DB, with migrations applied once."""
    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    eng = create_engine(url, echo=False)

    # Apply migrations once per module (cheap via alembic programmatic).
    # We use a subprocess so the test doesn't import alembic internals.
    import subprocess

    env = {**os.environ, "DATABASE_URL_SYNC": url, "DATABASE_URL": url}
    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(f"alembic upgrade failed:\n{result.stderr}")

    yield eng
    eng.dispose()


@pytest.fixture()
def two_tenants(engine):
    """Create two tenants and yield their UUIDs. Cleans up on exit."""
    from sqlalchemy import text

    tid_a = uuid.uuid4()
    tid_b = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO tenants (id, name, licensed_modules) "
                "VALUES (:a, 'Test A', '{}'), (:b, 'Test B', '{}')"
            ),
            {"a": str(tid_a), "b": str(tid_b)},
        )

    yield tid_a, tid_b

    with engine.begin() as conn:
        # Clean up — cascade through all owned rows. Run with RLS bypassed
        # (superuser or owner) so we can reach both tenants' data.
        for tid in (tid_a, tid_b):
            # Some tables have FKs to others; order matters. Wipe in reverse.
            for table in (
                "audit_log",
                "findings",
                "analysis_versions",
                "master_records",
                "users",
                "sap_systems",
            ):
                try:
                    conn.execute(
                        text(f"DELETE FROM {table} WHERE tenant_id = :t"),
                        {"t": str(tid)},
                    )
                except Exception:
                    pass
        conn.execute(
            text("DELETE FROM tenants WHERE id IN (:a, :b)"),
            {"a": str(tid_a), "b": str(tid_b)},
        )


def _set_tenant(conn, tid: uuid.UUID) -> None:
    from sqlalchemy import text

    conn.execute(text(f"SET app.tenant_id = '{tid}'"))


def test_findings_rls_isolates_tenants(engine, two_tenants):
    """Tenant A's SELECT on findings must not return tenant B's rows."""
    from sqlalchemy import text

    tid_a, tid_b = two_tenants

    # Insert a version + finding for each tenant (RLS disabled — we're owner here).
    version_a = uuid.uuid4()
    version_b = uuid.uuid4()
    with engine.begin() as conn:
        for tid, vid in ((tid_a, version_a), (tid_b, version_b)):
            conn.execute(
                text(
                    "INSERT INTO analysis_versions (id, tenant_id, status) "
                    "VALUES (:vid, :tid, 'complete')"
                ),
                {"vid": str(vid), "tid": str(tid)},
            )
            conn.execute(
                text(
                    "INSERT INTO findings "
                    "(id, version_id, tenant_id, module, check_id, severity, "
                    "dimension, affected_count, total_count, pass_rate) "
                    "VALUES (gen_random_uuid(), :vid, :tid, 'business_partner', "
                    ":ck, 'high', 'completeness', 5, 100, 0.95)"
                ),
                {
                    "vid": str(vid),
                    "tid": str(tid),
                    "ck": f"check_{tid.hex[:8]}",
                },
            )

    # Connect as RLS-scoped user (current session inherits privileges of the
    # connect user; RLS applies because the policy uses current_setting).
    with engine.connect() as conn:
        _set_tenant(conn, tid_a)
        rows_a = conn.execute(text("SELECT tenant_id FROM findings")).fetchall()
        assert len(rows_a) == 1, f"tenant A saw {len(rows_a)} rows (expected 1)"
        assert rows_a[0][0] == tid_a, "tenant A saw a row belonging to a different tenant"

        _set_tenant(conn, tid_b)
        rows_b = conn.execute(text("SELECT tenant_id FROM findings")).fetchall()
        assert len(rows_b) == 1, f"tenant B saw {len(rows_b)} rows (expected 1)"
        assert rows_b[0][0] == tid_b


def test_findings_rls_blocks_cross_tenant_update(engine, two_tenants):
    """Even with tenant_id in the WHERE, a SET app.tenant_id=A session must not UPDATE B's rows."""
    from sqlalchemy import text

    tid_a, tid_b = two_tenants
    version_b = uuid.uuid4()
    finding_b = uuid.uuid4()

    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO analysis_versions (id, tenant_id, status) "
                "VALUES (:vid, :tid, 'complete')"
            ),
            {"vid": str(version_b), "tid": str(tid_b)},
        )
        conn.execute(
            text(
                "INSERT INTO findings "
                "(id, version_id, tenant_id, module, check_id, severity, "
                "dimension, affected_count, total_count, pass_rate) "
                "VALUES (:fid, :vid, :tid, 'business_partner', 'ck1', "
                "'high', 'completeness', 5, 100, 0.95)"
            ),
            {
                "fid": str(finding_b),
                "vid": str(version_b),
                "tid": str(tid_b),
            },
        )

    with engine.connect() as conn:
        _set_tenant(conn, tid_a)
        # Try to update B's finding from A's session — should affect 0 rows
        result = conn.execute(
            text("UPDATE findings SET severity = 'low' WHERE id = :fid"),
            {"fid": str(finding_b)},
        )
        conn.commit()
        assert result.rowcount == 0, (
            f"RLS leak: tenant A was able to UPDATE {result.rowcount} row(s) belonging to B"
        )

    # Verify B's row is unchanged
    with engine.connect() as conn:
        _set_tenant(conn, tid_b)
        row = conn.execute(
            text("SELECT severity FROM findings WHERE id = :fid"),
            {"fid": str(finding_b)},
        ).fetchone()
        assert row is not None, "tenant B can no longer see its own row"
        assert row[0] == "high", f"tenant B's severity was modified to {row[0]!r}"


def test_audit_log_rls(engine, two_tenants):
    """audit_log must obey the same RLS discipline as every other tenant table."""
    from sqlalchemy import text

    tid_a, tid_b = two_tenants

    with engine.begin() as conn:
        for tid in (tid_a, tid_b):
            conn.execute(
                text(
                    "INSERT INTO audit_log (tenant_id, action, method, path, status_code) "
                    "VALUES (:tid, 'update', 'PATCH', '/api/v1/rules/x', 200)"
                ),
                {"tid": str(tid)},
            )

    with engine.connect() as conn:
        _set_tenant(conn, tid_a)
        rows = conn.execute(text("SELECT tenant_id FROM audit_log")).fetchall()
        assert all(r[0] == tid_a for r in rows)
        assert len(rows) == 1


def test_unset_tenant_returns_nothing(engine, two_tenants):
    """With no app.tenant_id set, RLS should return an empty result set.

    This guards against forgetting to SET — the worst-case "silent leak"
    scenario is an SELECT that forgot to set context and accidentally
    sees every tenant's data.
    """
    from sqlalchemy import text

    tid_a, _tid_b = two_tenants
    # Insert something so the table isn't empty to begin with
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO audit_log (tenant_id, action, method, path, status_code) "
                "VALUES (:tid, 'create', 'POST', '/api/v1/xyz', 200)"
            ),
            {"tid": str(tid_a)},
        )

    with engine.connect() as conn:
        # Intentionally DO NOT call _set_tenant.
        # Postgres will raise when current_setting('app.tenant_id') is unset
        # (because ::uuid cast on empty string fails). That's the intended
        # behaviour — be explicit: the error is the safety net.
        with pytest.raises(Exception):
            conn.execute(text("SELECT * FROM audit_log")).fetchall()
