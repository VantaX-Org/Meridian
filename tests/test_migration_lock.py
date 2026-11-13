"""alembic runs from docker/entrypoint.api.sh and from scripts/update.sh; they must not overlap."""

import os
import threading
import time
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from db.migration_lock import MIGRATION_LOCK_KEY, take_migration_lock

ENV_PY = Path(__file__).resolve().parents[1] / "db" / "migrations" / "env.py"


class _Conn:
    def __init__(self, dialect: str):
        self.dialect = type("D", (), {"name": dialect})()
        self.calls: list[str] = []

    def execute(self, stmt, params=None):
        self.calls.append(f"{stmt} {params}")

    def commit(self):
        self.calls.append("COMMIT")


def test_takes_the_lock_then_commits_on_postgres():
    c = _Conn("postgresql")
    take_migration_lock(c)
    assert "pg_advisory_lock" in c.calls[0] and str(MIGRATION_LOCK_KEY) in c.calls[0]
    assert c.calls[1] == "COMMIT"  # else alembic's begin_transaction() nests and the close rolls back


def test_noop_on_other_dialects():
    c = _Conn("sqlite")
    take_migration_lock(c)
    assert c.calls == []


def test_env_py_locks_before_it_migrates():
    s = ENV_PY.read_text(encoding="utf-8")
    online = s[s.index("def run_migrations_online"):]
    assert online.index("take_migration_lock(connection)") < online.index("context.run_migrations()")


_DB = os.getenv("MERIDIAN_TEST_DB_URL")


@pytest.mark.skipif(not _DB, reason="MERIDIAN_TEST_DB_URL not set")
def test_a_second_migrator_waits_for_the_first():
    engine = create_engine(_DB.replace("postgresql+asyncpg://", "postgresql://"))
    got = threading.Event()
    with engine.connect() as first:
        take_migration_lock(first)

        def second():
            with engine.connect() as c:
                take_migration_lock(c)
                got.set()

        t = threading.Thread(target=second)
        t.start()
        time.sleep(0.5)
        assert not got.is_set(), "the second run must wait while the first holds the lock"
        first.execute(text("SELECT 1"))  # still usable after the commit
    t.join(10)  # closing the first connection releases the session lock
    assert got.is_set()
    engine.dispose()
