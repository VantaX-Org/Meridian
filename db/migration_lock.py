"""Serialise `alembic upgrade head` across processes.

docker/entrypoint.api.sh migrates at every api start and scripts/update.sh migrates again after
recreating the api; two runs at once race on alembic_version and on the DDL. A session-level
Postgres advisory lock makes the second run wait, then find the schema already at head.
"""

from sqlalchemy import text
from sqlalchemy.engine import Connection

# Fixed key, shared by every process that migrates this database. "MERIDIAN" as ASCII, folded to int8.
MIGRATION_LOCK_KEY = 0x4D45524944494E


def take_migration_lock(connection: Connection) -> None:
    """Block until this session holds the migration lock. Postgres only; a no-op elsewhere.

    The lock is session-scoped, so it outlives the commit below and is released when the
    connection closes (env.py uses NullPool, so closing really closes it, even after a crash).
    """
    if connection.dialect.name != "postgresql":
        return
    connection.execute(text("SELECT pg_advisory_lock(:k)"), {"k": MIGRATION_LOCK_KEY})
    # End the implicit transaction the SELECT opened, or alembic's begin_transaction() joins it as a
    # nested no-op and the close rolls every migration back (see the SET in env.py).
    connection.commit()
