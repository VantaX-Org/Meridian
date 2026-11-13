"""Tenant context never crosses pooled connections (edge-ops #40, edge-security batch E row 7).

A session-level SET app.tenant_id stayed on the connection after it went back to the pool, so the next borrower ran
as the previous tenant. workers.db.reset_tenant_on_checkin clears it on checkin; the Session listeners in workers.db
reapply the tenant a Session set to each of its later transactions, so set-commit-query code keeps working.

The Postgres tests need MERIDIAN_TEST_DB_URL (CI sets it); the rest run anywhere.
"""
from __future__ import annotations

import os
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from workers.db import reset_tenant_on_checkin

TA = "00000000-0000-0000-0000-0000000000a1"
TB = "00000000-0000-0000-0000-0000000000b2"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


# -- unit: the checkin reset -----------------------------------------------------------------------------------------

class _FakeDBAPI:
    def __init__(self):
        self.calls: list[str] = []

    def rollback(self):
        self.calls.append("rollback")

    def commit(self):
        self.calls.append("commit")

    def cursor(self):
        calls = self.calls
        return SimpleNamespace(execute=lambda sql: calls.append(sql), close=lambda: None)


def _reset_listener():
    eng = create_engine("sqlite://")
    reset_tenant_on_checkin(eng)
    fns = list(eng.pool.dispatch.reset)
    assert fns, "reset listener not registered"
    return fns[-1]


def test_checkin_rolls_back_then_resets_and_commits():
    dbapi = _FakeDBAPI()
    _reset_listener()(dbapi, None, SimpleNamespace(terminate_only=False))
    assert dbapi.calls == ["rollback", "RESET app.tenant_id", "commit"]


def test_checkin_skips_a_connection_being_closed():
    dbapi = _FakeDBAPI()
    _reset_listener()(dbapi, None, SimpleNamespace(terminate_only=True))
    assert dbapi.calls == []


# -- unit: a Session keeps its tenant across commits -----------------------------------------------------------------

def _recording_engine():
    """SQLite engine that records tenant statements and runs them as no-ops (SQLite has no GUCs)."""
    eng = create_engine("sqlite://", poolclass=StaticPool)
    seen: list[tuple[str, object]] = []

    @event.listens_for(eng, "before_cursor_execute", retval=True)
    def _swap(conn, cursor, statement, parameters, context, executemany):  # type: ignore[no-untyped-def]
        if "tenant_id" in statement:
            seen.append((" ".join(statement.split()), parameters))
            return "SELECT 1", ()
        return statement, parameters

    return eng, seen


@pytest.mark.parametrize("stmt,params", [
    ("SET app.tenant_id = :tid", {"tid": TA}),                        # workers/scheduler._set_rls, run_checks
    (f"SET app.tenant_id = '{TA}'", {}),                               # api routes
    ("SELECT set_config('app.tenant_id', :t, false)", {"t": TA}),     # set_config(..., false)
])
def test_session_reapplies_its_tenant_after_commit(stmt, params):
    eng, seen = _recording_engine()
    with Session(eng) as s:
        s.execute(text(stmt), params)
        s.commit()  # the connection goes back to the pool and is reset
        seen.clear()
        s.execute(text("SELECT 1"))
    assert any("set_config('app.tenant_id', ?, true)" in q and TA in p for q, p in seen), seen


def test_other_sessions_do_not_inherit_the_tenant():
    eng, seen = _recording_engine()
    with Session(eng) as s:
        s.execute(text("SET app.tenant_id = :tid"), {"tid": TA})
        s.commit()
    seen.clear()
    with Session(eng) as s:
        s.execute(text("SELECT 1"))
    assert seen == []


# -- Postgres: real pooled reuse -------------------------------------------------------------------------------------

@pytest.fixture
def one_conn_engine():
    eng = reset_tenant_on_checkin(create_engine(os.environ["MERIDIAN_TEST_DB_URL"], pool_size=1, max_overflow=0))
    yield eng
    eng.dispose()


def _tenant(conn) -> str:
    return conn.execute(text("SELECT coalesce(current_setting('app.tenant_id', true), '')")).scalar()


@pg
def test_pg_session_level_set_does_not_leak_to_next_borrower(one_conn_engine):
    with one_conn_engine.connect() as c:
        pid = c.execute(text("SELECT pg_backend_pid()")).scalar()
        c.execute(text("SET app.tenant_id = :tid"), {"tid": TA})
        c.commit()
        assert _tenant(c) == TA
    with one_conn_engine.connect() as c:
        assert c.execute(text("SELECT pg_backend_pid()")).scalar() == pid  # same pooled connection
        assert _tenant(c) == ""


@pg
def test_pg_session_keeps_tenant_after_commit_but_next_session_does_not(one_conn_engine):
    with Session(one_conn_engine) as s:
        s.execute(text("SET app.tenant_id = :tid"), {"tid": TA})
        s.commit()
        assert s.execute(text("SELECT current_setting('app.tenant_id', true)")).scalar() == TA
    with Session(one_conn_engine) as s:
        assert (s.execute(text("SELECT current_setting('app.tenant_id', true)")).scalar() or "") == ""
        s.execute(text("SET app.tenant_id = :tid"), {"tid": TB})
        assert s.execute(text("SELECT current_setting('app.tenant_id', true)")).scalar() == TB


def test_worker_pool_settings_come_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    import workers.db as wdb

    monkeypatch.setattr(wdb, "_engine", None)
    monkeypatch.setenv("DATABASE_URL_SYNC", "postgresql://u:p@127.0.0.1:1/x")
    monkeypatch.setenv("MERIDIAN_WORKER_DB_POOL_SIZE", "3")
    monkeypatch.setenv("MERIDIAN_WORKER_DB_MAX_OVERFLOW", "2")
    monkeypatch.setenv("MERIDIAN_DB_POOL_RECYCLE", "600")
    eng = wdb.get_sync_engine()
    try:
        assert eng.pool.size() == 3 and eng.pool._max_overflow == 2 and eng.pool._recycle == 600
        assert eng.pool._pre_ping is True
        assert list(eng.pool.dispatch.reset)
    finally:
        eng.dispose()
        monkeypatch.setattr(wdb, "_engine", None)
