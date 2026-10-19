"""Shared helpers for the query modules."""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def set_tenant_context(db: AsyncSession, tenant_id: uuid.UUID | str) -> None:
    """Set ``app.tenant_id`` for the RLS policies on the session's current connection.

    A ``commit()`` releases the session's connection to the pool, so a read that follows a
    commit (``refresh``, a SELECT) can run on another pooled connection where the setting is
    ``''`` and the policy's ``::uuid`` cast fails. Call this again after every commit that a
    read follows. Session-level (not LOCAL) on purpose: ``refresh`` opens its own transaction.
    """
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant_id)})
