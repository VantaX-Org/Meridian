"""Sandbox tenant mode (migration 115; api/services/sandbox.py).

GET  /api/v1/admin/sandbox         the flag, since when and by whom, the sandbox runs, deliveries held back (view)
POST /api/v1/admin/sandbox/enter   {copy: true}: copy the latest finished run into a sandbox run and turn the flag on
                                   (manage_system, audited); 409 when already in sandbox
POST /api/v1/admin/sandbox/exit    turn the flag off and discard the sandbox runs (manage_system, audited); 409 when
                                   not in sandbox

While the flag is on, nothing leaves the deployment (notifications, webhooks, digests, report mailouts and SAP
write-backs are held back and recorded with the reason ``sandbox``), decisions land on the sandbox run's rows only,
and the status strip carries ``sandbox: true``.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.cache import mark_work_changed
from api.routes.record_issues import _rls
from api.services import sandbox
from api.services.rbac import current_user_label, require_permission, write_audit
from api.services.run_context import latest_run

router = APIRouter(prefix="/api/v1/admin/sandbox", tags=["admin"])


class EnterBody(BaseModel):
    copy_run: bool = True       # copy the latest finished run into a sandbox run; false only turns the flag on


class SandboxOut(BaseModel):
    sandbox: bool
    since: Optional[datetime] = None
    by: Optional[str] = None
    runs: list[str]
    skipped_deliveries: int


class EnterOut(SandboxOut):
    source_run_id: Optional[str] = None
    sandbox_run_id: Optional[str] = None
    copied: dict[str, int]


class ExitOut(SandboxOut):
    discarded: dict[str, int]


@router.get("", response_model=SandboxOut, dependencies=[Depends(require_permission("view"))])
async def get_sandbox(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    return await sandbox.status(db, tenant.id)


@router.post("/enter", response_model=EnterOut, dependencies=[Depends(require_permission("manage_system"))])
async def enter_sandbox(request: Request, body: Optional[EnterBody] = None, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)):
    body = body or EnterBody()
    await _rls(db, tenant)
    t = str(tenant.id)
    locked = (await db.execute(text("SELECT sandbox FROM tenants WHERE id = CAST(:t AS uuid) FOR UPDATE"),
                               {"t": t})).scalar()
    if locked:
        raise HTTPException(status_code=409, detail="The tenant is already in sandbox mode.")
    source = await latest_run(db, tenant.id) if body.copy_run else None
    vid, copied = None, {}
    if source:
        vid, copied = await db.run_sync(lambda s: sandbox.copy_run(s, t, source))
    label = current_user_label()
    await db.execute(text("UPDATE tenants SET sandbox = true, sandbox_since = now(), sandbox_by = :by "
                          "WHERE id = CAST(:t AS uuid)"), {"t": t, "by": label})
    await write_audit(db, tenant.id, request, "sandbox_entered", "tenant", t, {"sandbox": False},
                      {"sandbox": True, "source_run_id": source, "sandbox_run_id": vid, "copied": copied})
    mark_work_changed(db, tenant.id)  # the status strip, landscape and work summary now read the sandbox
    await db.commit()
    return {**await sandbox.status(db, tenant.id), "source_run_id": source, "sandbox_run_id": vid, "copied": copied}


@router.post("/exit", response_model=ExitOut, dependencies=[Depends(require_permission("manage_system"))])
async def exit_sandbox(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    t = str(tenant.id)
    row = (await db.execute(text("SELECT sandbox, sandbox_since FROM tenants WHERE id = CAST(:t AS uuid) FOR UPDATE"),
                            {"t": t})).fetchone()
    if not row or not row[0]:
        raise HTTPException(status_code=409, detail="The tenant is not in sandbox mode.")
    before = await sandbox.status(db, tenant.id)
    since = row[1]
    discarded = await db.run_sync(lambda s: sandbox.discard(s, t, since))
    await db.execute(text("UPDATE tenants SET sandbox = false, sandbox_since = NULL, sandbox_by = NULL "
                          "WHERE id = CAST(:t AS uuid)"), {"t": t})
    await write_audit(db, tenant.id, request, "sandbox_exited", "tenant", t,
                      {"sandbox": True, "runs": before["runs"], "skipped_deliveries": before["skipped_deliveries"]},
                      {"sandbox": False, "discarded": discarded})
    mark_work_changed(db, tenant.id)
    await db.commit()
    return {**await sandbox.status(db, tenant.id), "discarded": discarded}
