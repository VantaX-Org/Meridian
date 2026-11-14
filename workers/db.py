"""Shared synchronous SQLAlchemy engine for all Celery workers.

Using a single module-level engine avoids creating a separate connection
pool per worker task, which previously exhausted Postgres max_connections
under concurrent load.
"""
import os
import re

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import TextClause

_engine: Engine | None = None


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def reset_tenant_on_checkin(engine: Engine) -> Engine:
    """Clear app.tenant_id whenever a connection goes back to the pool, so the next borrower never inherits
    another tenant's row-level-security context.

    A session-level ``SET app.tenant_id`` (or ``set_config(..., false)``) survives a commit and stays on the
    pooled connection; many routes still issue one. Rolling back first and then RESET-and-commit makes the reset
    stick whatever state the borrower left. A failure here propagates, and the pool then discards the connection
    instead of returning it with an unknown tenant. Pass ``async_engine.sync_engine`` for an async engine."""
    @event.listens_for(engine, "reset")
    def _reset(dbapi_connection, _record, reset_state) -> None:  # type: ignore[no-untyped-def]
        if reset_state.terminate_only:  # the connection is being closed, not pooled
            return
        dbapi_connection.rollback()
        cur = dbapi_connection.cursor()
        try:
            cur.execute("RESET app.tenant_id")
        finally:
            cur.close()
        dbapi_connection.commit()
    return engine


_SESSION_TENANT_SET = re.compile(
    r"^\s*(?:SET\s+app\.tenant_id\s*(?:=|TO)\s*(?:'(?P<lit>[^']*)'|:(?P<bind>\w+))"
    r"|SELECT\s+set_config\(\s*'app\.tenant_id'\s*,\s*:(?P<cfg>\w+)\s*,\s*false\s*\))",
    re.IGNORECASE)
_SET_LOCAL_TENANT = text("SELECT set_config('app.tenant_id', :tid, true)")


@event.listens_for(Session, "do_orm_execute")
def _remember_session_tenant(state) -> None:  # type: ignore[no-untyped-def]
    """Note the tenant a Session sets with a session-level SET, so every later transaction of that Session gets it.

    reset_tenant_on_checkin clears the tenant when a commit hands the connection back to the pool. Code that sets
    the tenant once, commits, and queries again would then run with no tenant; this keeps the tenant on the Session
    (one unit of work, one tenant) instead of on the shared connection."""
    if not isinstance(state.statement, TextClause):
        return
    m = _SESSION_TENANT_SET.match(state.statement.text)
    if not m:
        return
    params = state.parameters if isinstance(state.parameters, dict) else {}
    tid = m.group("lit") if m.group("lit") is not None else params.get(m.group("bind") or m.group("cfg"))
    if tid is not None:
        state.session.info["tenant_id"] = str(tid)


@event.listens_for(Session, "after_begin")
def _reapply_session_tenant(session, _transaction, connection) -> None:  # type: ignore[no-untyped-def]
    tid = session.info.get("tenant_id")
    if tid:
        connection.execute(_SET_LOCAL_TENANT, {"tid": tid})


def get_sync_engine() -> Engine:
    """Return the process-wide shared sync SQLAlchemy engine. Pool sizes come from MERIDIAN_WORKER_DB_POOL_SIZE
    and MERIDIAN_WORKER_DB_MAX_OVERFLOW (defaults 5 and 10), recycle from MERIDIAN_DB_POOL_RECYCLE (1800 s)."""
    global _engine
    if _engine is None:
        url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
        url = url.replace("postgresql+asyncpg://", "postgresql://")
        _engine = reset_tenant_on_checkin(create_engine(
            url,
            pool_size=max(1, _env_int("MERIDIAN_WORKER_DB_POOL_SIZE", 5)),
            max_overflow=max(0, _env_int("MERIDIAN_WORKER_DB_MAX_OVERFLOW", 10)),
            pool_recycle=_env_int("MERIDIAN_DB_POOL_RECYCLE", 1800),
            pool_pre_ping=True,
        ))
    return _engine


def tenant_session(engine: Engine, tenant_id) -> Session:
    """Session that sets app.tenant_id at the start of every transaction.

    A session-level SET lives on one pooled connection; after a commit the
    session can check out another one (or a recycled one after pool_recycle),
    which then has no tenant and fails row-level security.
    """
    session = Session(engine)
    event.listen(session, "after_begin", lambda s, tx, conn: conn.execute(
        text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": str(tenant_id)}))
    return session
