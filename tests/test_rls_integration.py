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
    """Sync engine against the test DB, with migrations applied once.

    Yields two engines:
      - `eng` (owner) for schema setup + tenant-table seeds. This is the
        superuser-ish role the migrations run under; it bypasses RLS.
      - `app_eng` (non-superuser role) for the RLS assertions themselves.
        FORCE ROW LEVEL SECURITY (migration 039) only applies to
        non-superusers, so this is what actually exercises the policy.
    """
    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    eng = create_engine(url, echo=False)

    # Apply migrations once per module (cheap via alembic programmatic).
    # We use a subprocess so the test doesn't import alembic internals.
    import subprocess

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # alembic env.py does `from db.schema import Base` — only works when
    # the repo root is on PYTHONPATH. Inherit-and-prepend.
    pythonpath = repo_root + (
        os.pathsep + os.environ["PYTHONPATH"]
        if os.environ.get("PYTHONPATH")
        else ""
    )
    env = {
        **os.environ,
        "DATABASE_URL_SYNC": url,
        "DATABASE_URL": url,
        "PYTHONPATH": pythonpath,
    }
    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=repo_root,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(f"alembic upgrade failed:\n{result.stderr}")

    # Create a NON-superuser role that can read/write every RLS-enabled
    # table but doesn't have BYPASSRLS. This is what the test uses for
    # the actual policy assertions — mirroring how prod *should* run
    # (dedicated app role, not the schema owner).
    with eng.begin() as conn:
        conn.execute(text("DROP ROLE IF EXISTS meridian_rls_app"))
        conn.execute(text("CREATE ROLE meridian_rls_app LOGIN PASSWORD 'rls_app_pw' NOSUPERUSER NOBYPASSRLS"))
        # Grant access to public schema + every table.
        conn.execute(text("GRANT USAGE ON SCHEMA public TO meridian_rls_app"))
        conn.execute(text("GRANT ALL ON ALL TABLES IN SCHEMA public TO meridian_rls_app"))
        conn.execute(text("GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO meridian_rls_app"))
        conn.execute(text(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            "GRANT ALL ON TABLES TO meridian_rls_app"
        ))

    # Build a second engine that connects as the non-superuser role.
    from urllib.parse import urlparse, urlunparse

    u = urlparse(url)
    # Replace credentials: meridian_rls_app:rls_app_pw
    netloc = f"meridian_rls_app:rls_app_pw@{u.hostname}"
    if u.port:
        netloc += f":{u.port}"
    app_url = urlunparse((u.scheme, netloc, u.path, u.params, u.query, u.fragment))
    app_eng = create_engine(app_url, echo=False)

    yield eng, app_eng

    app_eng.dispose()
    with eng.begin() as conn:
        conn.execute(text("DROP OWNED BY meridian_rls_app CASCADE"))
        conn.execute(text("DROP ROLE IF EXISTS meridian_rls_app"))
    eng.dispose()


@pytest.fixture()
def two_tenants(engine):
    eng, _app_eng = engine
    """Create two tenants and yield their UUIDs. Cleans up on exit."""
    from sqlalchemy import text

    tid_a = uuid.uuid4()
    tid_b = uuid.uuid4()
    with eng.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO tenants (id, name, licensed_modules) "
                "VALUES (:a, 'Test A', '{}'), (:b, 'Test B', '{}')"
            ),
            {"a": str(tid_a), "b": str(tid_b)},
        )

    yield tid_a, tid_b

    # Clean up — cascade through all owned rows. Under FORCE RLS we can't
    # just wipe both tenants in one connection; set the tenant context
    # before each DELETE batch.
    for tid in (tid_a, tid_b):
        with eng.begin() as conn:
            _set_tenant(conn, tid)
            # Some tables have FKs to others; order matters. Wipe in reverse.
            for table in (
                "audit_log",
                "purge_log",
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

    # tenants has no RLS — safe to delete without setting context.
    with eng.begin() as conn:
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

    eng, app_eng = engine

    tid_a, tid_b = two_tenants

    # Insert a version + finding for each tenant. Under FORCE RLS (migration
    # 039) even the owner's INSERTs go through the policy, so we must set
    # app.tenant_id before each per-tenant block.
    version_a = uuid.uuid4()
    version_b = uuid.uuid4()
    for tid, vid in ((tid_a, version_a), (tid_b, version_b)):
        with eng.begin() as conn:
            _set_tenant(conn, tid)
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
    with app_eng.connect() as conn:
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

    eng, app_eng = engine

    tid_a, tid_b = two_tenants
    version_b = uuid.uuid4()
    finding_b = uuid.uuid4()

    with eng.begin() as conn:
        _set_tenant(conn, tid_b)
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

    with app_eng.connect() as conn:
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
    with app_eng.connect() as conn:
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

    eng, app_eng = engine

    tid_a, tid_b = two_tenants

    for tid in (tid_a, tid_b):
        with eng.begin() as conn:
            _set_tenant(conn, tid)
            conn.execute(
                text(
                    "INSERT INTO audit_log (tenant_id, action, method, path, status_code) "
                    "VALUES (:tid, 'update', 'PATCH', '/api/v1/rules/x', 200)"
                ),
                {"tid": str(tid)},
            )

    with app_eng.connect() as conn:
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

    eng, app_eng = engine

    tid_a, _tid_b = two_tenants
    # Insert something so the table isn't empty to begin with. FORCE RLS
    # requires the context to be set at write time too.
    with eng.begin() as conn:
        _set_tenant(conn, tid_a)
        conn.execute(
            text(
                "INSERT INTO audit_log (tenant_id, action, method, path, status_code) "
                "VALUES (:tid, 'create', 'POST', '/api/v1/xyz', 200)"
            ),
            {"tid": str(tid_a)},
        )

    from sqlalchemy.exc import DBAPIError

    # A pooled connection keeps whatever app.tenant_id an earlier test set,
    # so this check needs a session that never set it.
    app_eng.dispose()
    with app_eng.connect() as conn:
        # Intentionally DO NOT call _set_tenant. The RLS policy is
        # `tenant_id = current_setting('app.tenant_id')::uuid`. With the GUC
        # never set (or reset to '') the cast raises, so the query fails
        # closed. Forgetting to SET must mean "see nothing" or an error,
        # never "see everything".
        try:
            rows = conn.execute(text("SELECT * FROM audit_log")).fetchall()
        except DBAPIError as exc:
            assert exc.orig.pgcode in ("42704", "22P02"), exc  # undefined GUC, bad uuid
            return
        assert len(rows) == 0, (
            f"RLS leak: unscoped session saw {len(rows)} row(s) — "
            "every table should return zero rows until app.tenant_id is set"
        )


# ── retention purge ──────────────────────────────────────────────────────────

_PURGE_TABLES = (
    "findings", "finding_records", "reports", "record_fixes", "impact_records", "analysis_run_steps",
    "field_profiles", "write_back_log", "finding_root_causes", "proven_cost_results",
)


def _seed_version(conn, tid: uuid.UUID, label: str, days_ago: int, archived: bool) -> tuple[uuid.UUID, uuid.UUID]:
    """One version with a row in every purge-relevant table. Returns (version_id, finding_id)."""
    from sqlalchemy import text

    vid, fid = uuid.uuid4(), uuid.uuid4()
    meta = '{"archived": true}' if archived else '{}'
    p = {"vid": str(vid), "tid": str(tid), "fid": str(fid), "label": label, "days": days_ago, "meta": meta}
    conn.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, label, run_at, metadata) "
                      "VALUES (:vid, :tid, 'complete', :label, now() - make_interval(days => :days), "
                      "CAST(:meta AS jsonb))"), p)
    conn.execute(text("INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, "
                      "affected_count, total_count, pass_rate) VALUES (:fid, :vid, :tid, 'business_partner', "
                      "'BP_001', 'high', 'completeness', 5, 100, 0.95)"), p)
    conn.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, record_key) "
                      "VALUES (:tid, :vid, 'BP_001', 'business_partner', 'PARTNER=1')"), p)
    conn.execute(text("INSERT INTO reports (id, version_id, tenant_id, report_json, pdf_path) "
                      "VALUES (gen_random_uuid(), :vid, :tid, '{}'::jsonb, 'reports/' || :tid || '/' || :vid || '.pdf')"), p)
    conn.execute(text("INSERT INTO record_fixes (id, tenant_id, version_id, check_id, module, record_id) "
                      "VALUES (gen_random_uuid(), :tid, :vid, 'BP_001', 'business_partner', '1')"), p)
    conn.execute(text("INSERT INTO impact_records (id, tenant_id, version_id, category) "
                      "VALUES (gen_random_uuid(), :tid, :vid, 'ops')"), p)
    conn.execute(text("INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name) "
                      "VALUES (:tid, :vid, 1, 'load')"), p)
    conn.execute(text("INSERT INTO field_profiles (id, tenant_id, version_id, module, table_name, field) "
                      "VALUES (gen_random_uuid(), :tid, :vid, 'business_partner', 'BUT000', 'NAME_ORG1')"), p)
    conn.execute(text("INSERT INTO write_back_log (id, tenant_id, finding_id, version_id, requested_by, dry_run, "
                      "applied_at) VALUES (gen_random_uuid(), :tid, :fid, :vid, 'u1', false, now())"), p)
    conn.execute(text("INSERT INTO finding_root_causes (tenant_id, version_id, check_id, status) "
                      "VALUES (:tid, :vid, 'BP_001', 'computed')"), p)
    conn.execute(text("INSERT INTO proven_cost_results (tenant_id, version_id, metric, amount, documents) "
                      "VALUES (:tid, :vid, 'blocked_invoices', 10, 1)"), p)
    return vid, fid


def _rows_for(conn, table: str, vid: uuid.UUID) -> int:
    from sqlalchemy import text

    return conn.execute(text(f"SELECT count(*) FROM {table} WHERE version_id = :v"), {"v": str(vid)}).scalar()


def _seed_issue(conn, tid: uuid.UUID, scope: str, key: str, status: str, first: uuid.UUID, last: uuid.UUID) -> uuid.UUID:
    from sqlalchemy import text

    iid = uuid.uuid4()
    conn.execute(text("INSERT INTO record_issues (id, tenant_id, scope, module, check_id, record_key, severity, "
                      "status, first_seen_version, last_seen_version) VALUES (:id, :t, :scope, 'business_partner', "
                      "'BP_001', :key, 'high', :st, :first, :last)"),
                 {"id": str(iid), "t": str(tid), "scope": scope, "key": key, "st": status,
                  "first": str(first), "last": str(last)})
    conn.execute(text("INSERT INTO record_issue_events (tenant_id, issue_id, action, to_value, version_id) "
                      "VALUES (:t, :id, 'status', :st, :v)"), {"t": str(tid), "id": str(iid), "st": status,
                                                              "v": str(last)})
    return iid


def test_purge_version_removes_every_dependent_row_and_nothing_else(engine, two_tenants, monkeypatch):
    """purge_version on a real Postgres: every version-keyed table ends empty for the purged
    version, the sibling version keeps every row, open write-backs block the purge, the
    exception that pointed at a purged finding survives with its pointer cleared, open record
    issues move to the newest remaining version of their system (or block the purge when
    there is none) and closed ones go."""
    from sqlalchemy import text

    from api.services import storage
    from api.services.purge import Actor, purge_version
    from workers.db import tenant_session

    eng, _app_eng = engine
    tid, _other = two_tenants
    monkeypatch.setattr(storage, "delete_prefix", lambda bucket, prefix: (1, 4096))
    monkeypatch.setattr(storage, "object_size", lambda bucket, name: 100)
    monkeypatch.setattr(storage, "delete_file", lambda bucket, name: None)

    with eng.begin() as conn:
        _set_tenant(conn, tid)
        v_old, f_old = _seed_version(conn, tid, "old run", 400, archived=True)
        v_new, f_new = _seed_version(conn, tid, "new run", 1, archived=False)
        # one extraction of a system that ran only once: its open issues have nowhere to go
        v_sys, _f_sys = _seed_version(conn, tid, "only sys run", 300, archived=True)
        conn.execute(text("UPDATE analysis_versions SET metadata = metadata || '{\"system_id\": \"sys-1\"}' "
                          "WHERE id = :v"), {"v": str(v_sys)})
        conn.execute(text("INSERT INTO exceptions (id, tenant_id, type, category, severity, title, description, "
                          "linked_finding_id) VALUES (gen_random_uuid(), :t, 'data_quality', 'bp', 'high', 'x', "
                          "'y', :f)"), {"t": str(tid), "f": str(f_old)})
        # the new version has a write-back that is approved but not applied: open work
        conn.execute(text("INSERT INTO write_back_log (id, tenant_id, finding_id, version_id, requested_by, "
                          "approved_by, dry_run) VALUES (gen_random_uuid(), :t, :f, :v, 'u1', 'u2', false)"),
                     {"t": str(tid), "f": str(f_new), "v": str(v_new)})
        # record issues of the upload scope: open ones first and last seen in the old run,
        # an in-progress one first seen there, a resolved and an accepted one last seen there
        i_open = _seed_issue(conn, tid, "upload", "PARTNER=1", "open", v_old, v_old)
        i_prog = _seed_issue(conn, tid, "upload", "PARTNER=2", "in_progress", v_old, v_new)
        i_done = _seed_issue(conn, tid, "upload", "PARTNER=3", "resolved", v_old, v_old)
        i_acc = _seed_issue(conn, tid, "upload", "PARTNER=4", "accepted", v_new, v_old)
        i_sys = [_seed_issue(conn, tid, "sys-1", f"PARTNER={k}", "open", v_sys, v_sys) for k in (5, 6)]

    try:
        with tenant_session(eng, tid) as session:
            blocked = purge_version(session, str(tid), str(v_new), dry_run=False, actor=None)
        assert "write-back" in (blocked["blocked_reason"] or "")

        # the system that ran once: its two open issues block the purge, and nothing moved
        with tenant_session(eng, tid) as session:
            stranded = purge_version(session, str(tid), str(v_sys), dry_run=False, actor=None)
        assert stranded["blocked_reason"] == \
            "2 open record issues were only observed in this run; resolve or dismiss them first"
        with eng.connect() as conn:
            _set_tenant(conn, tid)
            assert conn.execute(text("SELECT count(*) FROM record_issues WHERE last_seen_version = :v"),
                                {"v": str(v_sys)}).scalar() == 2

        with tenant_session(eng, tid) as session:
            dry = purge_version(session, str(tid), str(v_old), dry_run=True, actor=None, source="preview")
        assert dry["blocked_reason"] is None
        assert dry["rows_by_table"]["findings"] == 1 and dry["rows_by_table"]["analysis_versions"] == 1
        assert dry["rows_by_table"]["exceptions (unlinked)"] == 1
        assert dry["rows_by_table"]["record_issues"] == 2  # the resolved and the accepted one
        assert dry["rows_by_table"]["record_issues (unlinked)"] == 2  # the open one moves, the in-progress re-roots

        with eng.connect() as conn:
            _set_tenant(conn, tid)
            assert _rows_for(conn, "findings", v_old) == 1, "a dry run must delete nothing"

        with tenant_session(eng, tid) as session:
            real = purge_version(session, str(tid), str(v_old), dry_run=False,
                                 actor=Actor(user_id=None, email="admin@example.com", method="DELETE",
                                             path="/api/v1/versions/x"))
        assert real["blocked_reason"] is None and real["bytes_freed"] == 4096 + 100
        assert real["rows_by_table"]["write_back_log"] == 1
        assert real["rows_by_table"]["record_issues"] == 2

        with eng.connect() as conn:
            _set_tenant(conn, tid)
            for table in _PURGE_TABLES:
                assert _rows_for(conn, table, v_old) == 0, f"{table} still holds rows of the purged version"
                assert _rows_for(conn, table, v_new) == 1 + (table == "write_back_log"), \
                    f"{table} lost rows of the other version"
            assert conn.execute(text("SELECT count(*) FROM analysis_versions WHERE id = :v"),
                                {"v": str(v_old)}).scalar() == 0
            assert conn.execute(text("SELECT count(*) FROM analysis_versions WHERE id = :v"),
                                {"v": str(v_new)}).scalar() == 1
            exc = conn.execute(text("SELECT linked_finding_id FROM exceptions WHERE tenant_id = :t"),
                               {"t": str(tid)}).fetchall()
            assert exc == [(None,)], "the exception must survive with its finding pointer cleared"
            issues = {str(r[0]): (r[1], str(r[2]), str(r[3])) for r in conn.execute(text(
                "SELECT id, status, first_seen_version, last_seen_version FROM record_issues WHERE tenant_id = :t"),
                {"t": str(tid)}).fetchall()}
            assert str(i_done) not in issues and str(i_acc) not in issues, "closed issues last seen here are deleted"
            assert issues[str(i_open)] == ("open", str(v_new), str(v_new)), "an open issue moves to the newest run"
            assert issues[str(i_prog)] == ("in_progress", str(v_new), str(v_new))
            assert all(issues[str(i)] == ("open", str(v_sys), str(v_sys)) for i in i_sys)
            assert conn.execute(text("SELECT count(*) FROM record_issue_events WHERE issue_id = :i"),
                                {"i": str(i_open)}).scalar() == 1, "the moved issue keeps its history"
            assert conn.execute(text("SELECT count(*) FROM record_issue_events WHERE issue_id = :i"),
                                {"i": str(i_done)}).scalar() == 0, "a deleted issue's events cascade"
            logs = conn.execute(text("SELECT kind, dry_run, blocked_reason, bytes_freed, actor_email, source "
                                     "FROM purge_log WHERE tenant_id = :t ORDER BY created_at"),
                                {"t": str(tid)}).fetchall()
            assert [(r[0], r[1], bool(r[2]), r[5]) for r in logs] == [
                ("version", False, True, "manual"), ("version", False, True, "manual"),
                ("version", True, False, "preview"), ("version", False, False, "manual")]
            assert logs[-1][3] == 4196 and logs[-1][4] == "admin@example.com"
            audit = conn.execute(text("SELECT action, entity_type, entity_id, actor_email FROM audit_log "
                                      "WHERE tenant_id = :t"), {"t": str(tid)}).fetchall()
            assert audit == [("purge", "analysis_version", str(v_old), "admin@example.com")]
    finally:
        # leave the fixture nothing it cannot delete: clear the open work, purge the rest
        with eng.begin() as conn:
            _set_tenant(conn, tid)
            conn.execute(text("DELETE FROM write_back_log WHERE tenant_id = :t"), {"t": str(tid)})
            conn.execute(text("DELETE FROM exceptions WHERE tenant_id = :t"), {"t": str(tid)})
        for vid in (v_new, v_sys):
            with tenant_session(eng, tid) as session:
                purge_version(session, str(tid), str(vid), dry_run=False, actor=None, force=True)


def test_dry_run_gate_counts_only_nightly_rows_since_the_policy_changed(engine, two_tenants):
    """Previews never unlock the nightly purge, and saving the policy restarts the week."""
    from sqlalchemy import text

    from api.services.purge import write_purge_log
    from api.services.retention import enforcement, oldest_dry_run
    from workers.db import tenant_session

    eng, _app_eng = engine
    tid, _other = two_tenants

    def backdate(session, log_id: str, days: int) -> None:
        session.execute(text("UPDATE purge_log SET created_at = now() - make_interval(days => :d) WHERE id = :id"),
                        {"d": days, "id": log_id})

    def days(delta) -> int:
        return round(delta.total_seconds() / 86400)

    with tenant_session(eng, tid) as session:
        now = session.execute(text("SELECT now()")).scalar()
        backdate(session, write_purge_log(session, str(tid), "version", None, True, {}, 0, None, None,
                                          source="preview"), 30)
        backdate(session, write_purge_log(session, str(tid), "version", None, False, {}, 0, None, None,
                                          source="manual"), 20)
        session.commit()
        assert oldest_dry_run(session, str(tid)) is None, "a preview or a manual delete never starts the window"
        assert enforcement(oldest_dry_run(session, str(tid)), now, flag_enabled=True)["enforced"] is False

        nightly = write_purge_log(session, str(tid), "version", None, True, {}, 0, None, None, source="nightly")
        backdate(session, nightly, 10)
        session.commit()
        oldest = oldest_dry_run(session, str(tid))
        assert oldest is not None and days(now - oldest) == 10
        assert enforcement(oldest, now, flag_enabled=True)["enforced"] is True

        # the policy changes: only nightly rows after the change count
        session.execute(text("UPDATE tenants SET retention = retention || jsonb_build_object('updated_at', "
                             "(now() - make_interval(days => 2))::text) WHERE id = :t"), {"t": str(tid)})
        session.commit()
        assert oldest_dry_run(session, str(tid)) is None
        assert enforcement(None, now, flag_enabled=True)["enforced"] is False
        fresh = write_purge_log(session, str(tid), "version", None, True, {}, 0, None, None, source="nightly")
        backdate(session, fresh, 1)
        session.commit()
        oldest = oldest_dry_run(session, str(tid))
        assert days(now - oldest) == 1
        e = enforcement(oldest, now, flag_enabled=True)
        assert e["enforced"] is False and days(e["dry_run_until"] - now) == 6
        session.execute(text("DELETE FROM purge_log WHERE tenant_id = :t"), {"t": str(tid)})
        session.commit()
