"""alembic runs from docker/entrypoint.api.sh and from scripts/update.sh; they must not overlap."""

import os
import threading
import time
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from db.migration_lock import MIGRATION_LOCK_KEY, migration_lock

ENV_PY = Path(__file__).resolve().parents[1] / "db" / "migrations" / "env.py"


class _Conn:
    def __init__(self, dialect: str):
        self.dialect = type("D", (), {"name": dialect})()
        self.invalidated = False
        self.calls: list[str] = []

    def execute(self, stmt, params=None):
        self.calls.append(f"{stmt} {params}")

    def commit(self):
        self.calls.append("COMMIT")

    def rollback(self):
        self.calls.append("ROLLBACK")


def test_takes_the_lock_commits_then_releases_on_postgres():
    c = _Conn("postgresql")
    with migration_lock(c):
        assert "pg_advisory_lock" in c.calls[0] and str(MIGRATION_LOCK_KEY) in c.calls[0]
        assert c.calls[1] == "COMMIT"  # else alembic's begin_transaction() nests and the close rolls back
    assert "pg_advisory_unlock" in c.calls[-2] and c.calls[-1] == "COMMIT"


def test_releases_even_when_the_migration_raises():
    c = _Conn("postgresql")
    with pytest.raises(RuntimeError), migration_lock(c):
        raise RuntimeError("migration failed")
    assert any("pg_advisory_unlock" in x for x in c.calls)


def test_noop_on_other_dialects():
    c = _Conn("sqlite")
    with migration_lock(c):
        pass
    assert c.calls == []


def test_env_py_locks_around_the_migration():
    s = ENV_PY.read_text(encoding="utf-8")
    online = s[s.index("def run_migrations_online"):]
    assert online.index("migration_lock(connection)") < online.index("context.run_migrations()")


_DB = os.getenv("MERIDIAN_TEST_DB_URL")


@pytest.mark.skipif(not _DB, reason="MERIDIAN_TEST_DB_URL not set")
def test_a_second_migrator_waits_then_gets_the_lock_on_a_pooled_engine():
    """Default QueuePool on purpose: closing a pooled connection keeps its session, so a lock that
    is not unlocked explicitly stays held and every later `alembic upgrade` in the process hangs."""
    engine = create_engine(_DB.replace("postgresql+asyncpg://", "postgresql://"))
    got = threading.Event()
    errors: list[BaseException] = []

    def second():
        try:
            with engine.connect() as c:
                c.execute(text("SET lock_timeout = '10s'"))  # fail, never hang the shard
                c.commit()
                with migration_lock(c):
                    got.set()
        except BaseException as e:  # noqa: BLE001 - surfaced by the assert below
            errors.append(e)

    try:
        with engine.connect() as first, migration_lock(first):
            t = threading.Thread(target=second, daemon=True)
            t.start()
            time.sleep(0.5)
            assert not got.is_set(), "the second run must wait while the first holds the lock"
            first.execute(text("SELECT 1"))  # still usable after the commit
        t.join(15)
        assert got.is_set(), f"the lock was not released on exit: {errors}"
        with engine.connect() as c:  # and nothing in this process still holds it
            held = c.execute(text(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = :lo"
            ), {"lo": MIGRATION_LOCK_KEY & 0xFFFFFFFF}).scalar()
        assert held == 0
    finally:
        engine.dispose()
