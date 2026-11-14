"""Migration 175 against real Postgres: every insert is chained, edits and deletes are refused, a retention purge
leaves a checkpoint the rest verifies from, a subject erasure may null payloads and nothing else, and verify finds
a row that was changed behind the guard's back."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from api.services.audit_chain import GENESIS, purge_prefix, verify

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


@pytest.fixture(scope="module")
def eng():
    import subprocess

    from tests import workflow_seed as seed

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    e = seed.engine()
    yield e
    e.dispose()


@pytest.fixture
def tid(eng):
    t = str(uuid.uuid4())
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": t})
    yield t
    with eng.begin() as c:
        c.execute(text("SET LOCAL app.audit_purge = 'on'"))
        c.execute(text("DELETE FROM audit_log WHERE tenant_id = :t"), {"t": t})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": t})


def _add(eng, tid, n, when=None, after=None):
    with eng.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        for i in range(n):
            c.execute(text("INSERT INTO audit_log (tenant_id, action, method, path, status_code, after_json, created_at) "
                           "VALUES (:t, 'update', 'POST', '/x', 200, CAST(:a AS jsonb), :w)"),
                      {"t": tid, "a": after or f'{{"i": {i}}}', "w": when or datetime.now(timezone.utc)})


def _verify(eng, tid):
    with Session(eng) as s:
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        return verify(s, tid)


def test_inserts_are_chained_and_verify(eng, tid):
    _add(eng, tid, 3)
    with eng.connect() as c:
        rows = c.execute(text("SELECT chain_seq, prev_hash, row_hash FROM audit_log WHERE tenant_id = :t "
                              "ORDER BY chain_seq"), {"t": tid}).fetchall()
    assert [r[0] for r in rows] == [1, 2, 3] and rows[0][1] == GENESIS and rows[1][1] == rows[0][2]
    assert _verify(eng, tid) == {"ok": True, "rows_checked": 3, "first_seq": 1, "last_seq": 3, "errors": [],
                                 "payloads_erased": 0}


@pytest.mark.parametrize("sql", ["UPDATE audit_log SET action = 'x' WHERE tenant_id = :t",
                                 "DELETE FROM audit_log WHERE tenant_id = :t", "TRUNCATE audit_log"])
def test_edits_deletes_and_truncate_are_refused(eng, tid, sql):
    _add(eng, tid, 1)
    with pytest.raises(DBAPIError, match="append-only"):
        with eng.begin() as c:
            c.execute(text(sql), {"t": tid})


def test_purge_leaves_a_checkpoint_and_the_rest_verifies(eng, tid):
    old = datetime.now(timezone.utc) - timedelta(days=400)
    _add(eng, tid, 4, when=old)
    _add(eng, tid, 2)
    with Session(eng) as s:
        assert purge_prefix(s, tid, datetime.now(timezone.utc) - timedelta(days=365)) == 4
        s.commit()
    out = _verify(eng, tid)
    assert out["ok"], out
    assert out["first_seq"] == 5 and out["last_seq"] == 7  # 5, 6 kept, 7 is the checkpoint


def test_erasure_may_null_payloads_and_nothing_else(eng, tid):
    _add(eng, tid, 2, after='{"key": "MATNR=1"}')
    with eng.begin() as c:
        c.execute(text("SET LOCAL app.subject_erasure = 'on'"))
        c.execute(text("UPDATE audit_log SET before_json = NULL, after_json = NULL WHERE tenant_id = :t "
                       "AND chain_seq = 1"), {"t": tid})
    out = _verify(eng, tid)
    assert out["ok"] and out["payloads_erased"] == 1
    with pytest.raises(DBAPIError, match="append-only"):
        with eng.begin() as c:
            c.execute(text("SET LOCAL app.subject_erasure = 'on'"))
            c.execute(text("UPDATE audit_log SET after_json = NULL, actor_email = 'x' WHERE tenant_id = :t"),
                      {"t": tid})


def test_a_row_changed_behind_the_guard_is_found(eng, tid):
    _add(eng, tid, 3)
    with eng.begin() as c:  # the table owner can lift the guard; the chain still tells
        c.execute(text("ALTER TABLE audit_log DISABLE TRIGGER audit_log_guard"))
        c.execute(text("UPDATE audit_log SET status_code = 500 WHERE tenant_id = :t AND chain_seq = 2"), {"t": tid})
        c.execute(text("ALTER TABLE audit_log ENABLE TRIGGER audit_log_guard"))
    out = _verify(eng, tid)
    assert not out["ok"] and out["errors"] == ["row 2: its contents no longer match its hash"]
