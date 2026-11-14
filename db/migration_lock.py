"""Serialise `alembic upgrade head` across processes.

docker/entrypoint.api.sh migrates at every api start and scripts/update.sh migrates again after
recreating the api; two runs at once race on alembic_version and on the DDL. A session-level
Postgres advisory lock makes the second run wait, then find the schema already at head.
"""

from contextlib import contextmanager
from collections.abc import Iterator

from sqlalchemy import text
from sqlalchemy.engine import Connection

# Fixed key, shared by every process that migrates this database. "MERIDIAN" as ASCII, folded to int8.
MIGRATION_LOCK_KEY = 0x4D45524944494E


@contextmanager
def migration_lock(connection: Connection) -> Iterator[None]:
    """Hold the migration lock for the body of the block. Postgres only; a no-op elsewhere.

    The lock is session-scoped (it must outlive the commit below and alembic's own transaction),
    so it is released explicitly on exit: closing a pooled connection only returns it to the pool
    and would keep the lock, blocking every later migrator for the life of the process. A crash
    still releases it, because the session ends.
    """
    if connection.dialect.name != "postgresql":
        yield
        return
    connection.execute(text("SELECT pg_advisory_lock(:k)"), {"k": MIGRATION_LOCK_KEY})
    # End the implicit transaction the SELECT opened, or alembic's begin_transaction() joins it as a
    # nested no-op and the close rolls every migration back (see the SET in env.py).
    connection.commit()
    try:
        yield
    finally:
        if not connection.invalidated:
            connection.rollback()  # a failed migration can leave an aborted transaction open
            connection.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": MIGRATION_LOCK_KEY})
            connection.commit()
