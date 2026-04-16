"""Shared synchronous SQLAlchemy engine for all Celery workers.

Using a single module-level engine avoids creating a separate connection
pool per worker task, which previously exhausted Postgres max_connections
under concurrent load.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

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
