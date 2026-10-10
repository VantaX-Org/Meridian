"""Source/target config pairing: compare a source's config with its target, propose matches, finding context."""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import config_pairing as cp
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/config-pairing", tags=["config-pairing"])


class ProposeOut(BaseModel):
    proposed: int
    skipped: int
    target: str


async def _system(db: AsyncSession, tenant: Tenant, system_id: str) -> str:
    await db.execute(text(f"SET app.tenant_id = '{tenant.id}'"))
    try:
        uuid.UUID(system_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="System not found")
    found = (await db.execute(
        text("SELECT 1 FROM sap_systems WHERE id = CAST(:s AS uuid) "
             "AND tenant_id = CAST(current_setting('app.tenant_id') AS uuid)"), {"s": system_id})).scalar()
    if not found:
        raise HTTPException(status_code=404, detail="System not found")
    return system_id


@router.get("/compare/{system_id}", dependencies=[Depends(require_permission("view"))])
async def compare_config(system_id: str, object: Optional[str] = None,
                         db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> dict[str, object]:
    sid = await _system(db, tenant, system_id)
    return await db.run_sync(lambda s: cp.compare(s, sid, object))


@router.post("/propose/{system_id}", dependencies=[Depends(require_permission("analyse"))])
async def propose_matches(system_id: str, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> ProposeOut:
    sid = await _system(db, tenant, system_id)
    out = await db.run_sync(lambda s: cp.propose(s, str(tenant.id), sid))
    await db.commit()
    return ProposeOut(proposed=int(out["proposed"]), skipped=int(out["skipped"]), target=str(out["target"]))


@router.get("/finding-context", dependencies=[Depends(require_permission("view"))])
async def get_finding_context(rule_id: str, module: str, version_id: Optional[str] = None,
                              fields: list[str] = Query(default_factory=list),
                              db: AsyncSession = Depends(get_db),
                              tenant: Tenant = Depends(get_tenant)) -> dict[str, object]:
    await db.execute(text(f"SET app.tenant_id = '{tenant.id}'"))
    if version_id:
        try:
            uuid.UUID(version_id)
        except ValueError:
            version_id = None
    return await db.run_sync(lambda s: cp.finding_context(s, rule_id, module, version_id, fields))
