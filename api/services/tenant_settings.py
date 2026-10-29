"""Tenant settings keys (table tenant_settings, migration 103) and the tenant of an unauthenticated request.

Keys in use: ``theme`` (api/routes/theme.py) and ``maintenance`` (api/routes/status_page.py). Values are JSON;
every read and write runs under the tenant's row-level security.

Public endpoints (GET /api/v1/theme, GET /api/v1/status/page) are read before sign-in, so no token names the
tenant. A deployment holds one tenant (db/schema.py Tenant); sign-in and API keys already resolve it as the local
auth tenant. ``resolve_public_tenant`` does the same: an explicit ``tenant`` query parameter (the tenant id, for a
deployment that holds more than one) when it names an existing tenant, else the local auth tenant when it exists,
else the only tenant. Nothing else about the tenant is disclosed by the resolution.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001"


async def set_rls(db: AsyncSession, tenant_id: uuid.UUID | str) -> None:
    await db.execute(text(f"SET LOCAL app.tenant_id = '{uuid.UUID(str(tenant_id))}'"))


async def get_setting(db: AsyncSession, tenant_id: uuid.UUID | str, key: str) -> Optional[Any]:
    row = (await db.execute(text("SELECT value FROM tenant_settings WHERE tenant_id = :t AND key = :k"),
                            {"t": str(tenant_id), "k": key})).fetchone()
    return row[0] if row else None


async def put_setting(db: AsyncSession, tenant_id: uuid.UUID | str, key: str, value: Any,
                      user_id: Optional[str]) -> None:
    """Upsert one key (caller commits). ``updated_by`` only when it is a real user of the tenant."""
    by = None
    if user_id:
        try:
            uuid.UUID(str(user_id))
            hit = (await db.execute(text("SELECT 1 FROM users WHERE id = :u AND tenant_id = :t"),
                                    {"u": str(user_id), "t": str(tenant_id)})).fetchone()
            by = str(user_id) if hit else None
        except ValueError:
            by = None
    await db.execute(text(
        "INSERT INTO tenant_settings (tenant_id, key, value, updated_by, updated_at) "
        "VALUES (:t, :k, CAST(:v AS jsonb), :u, now()) "
        "ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, "
        "updated_at = now()"), {"t": str(tenant_id), "k": key, "v": json.dumps(value), "u": by})


async def resolve_public_tenant(db: AsyncSession, tenant: Optional[str]) -> uuid.UUID:
    """The tenant an unauthenticated request reads (see the module docstring). 404 when there is none."""
    if tenant:
        try:
            tid = uuid.UUID(tenant)
        except ValueError:
            raise HTTPException(status_code=404, detail="Tenant not found")
        if (await db.execute(text("SELECT 1 FROM tenants WHERE id = :t"), {"t": str(tid)})).fetchone():
            return tid
        raise HTTPException(status_code=404, detail="Tenant not found")
    if (await db.execute(text("SELECT 1 FROM tenants WHERE id = :t"), {"t": LOCAL_TENANT_ID})).fetchone():
        return uuid.UUID(LOCAL_TENANT_ID)
    rows = (await db.execute(text("SELECT id FROM tenants LIMIT 2"))).fetchall()
    if len(rows) == 1:
        return uuid.UUID(str(rows[0][0]))
    raise HTTPException(status_code=404, detail="Tenant not found")
