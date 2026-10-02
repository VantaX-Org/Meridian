"""Shared synchronous SQLAlchemy engine for all Celery workers.

Using a single module-level engine avoids creating a separate connection
pool per worker task, which previously exhausted Postgres max_connections
under concurrent load.
"""
import os

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

_engine: Engine | None = None


def get_sync_engine() -> Engine:
    """Return the process-wide shared sync SQLAlchemy engine."""
    global _engine
    if _engine is None:
        url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
        url = url.replace("postgresql+asyncpg://", "postgresql://")
        _engine = create_engine(
            url,
            pool_size=5,
            max_overflow=10,
            pool_recycle=1800,
            pool_pre_ping=True,
        )
    return _engine


def tenant_session(engine: Engine, tenant_id) -> Session:
    """Session that sets app.tenant_id at the start of every transaction.

    A session-level SET lives on one pooled connection; after a commit the
    session can check out another one (or a recycled one after pool_recycle),
    which then has no tenant and fails row-level security.
    """
    session = Session(engine)
    event.listen(session, "after_begin", lambda s, tx, conn: conn.execute(
        text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant_id)}))
    return session
