"""Data-subject access and erasure (D-27). Admin only, tenant scoped.

* ``POST /api/v1/admin/subject-requests/search``  where the subject appears, per table.
* ``POST /api/v1/admin/subject-requests/export``  a zip of what is held for the subject.
* ``POST /api/v1/admin/subject-requests/erase``   dry run, then execute with a confirm word, a reason and the dry run id.
* ``GET  /api/v1/admin/subject-requests``         the ledger (hashes and counts, never the key).

The subject travels in the body, never the URL, and this path is skipped by the audit middleware (which would copy
the body); the service writes its own audit rows without the key. See api/services/subject_requests.py.
"""
from __future__ import annotations

import asyncio
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from api.deps import Tenant, get_tenant
from api.services import subject_requests as svc
from api.services.purge import Actor
from api.services.rate_limiter import rate_limit
from api.services.rbac import current_user_id, current_user_label, require_permission

router = APIRouter(prefix="/api/v1/admin/subject-requests", tags=["subject-requests"])


class SubjectBody(BaseModel):
    subject: str = Field(..., min_length=1, max_length=300)


class EraseBody(SubjectBody):
    dry_run: bool = True
    confirm: Optional[str] = None
    reason: Optional[str] = Field(None, max_length=1000)
    dry_run_id: Optional[str] = None


def _actor(request: Request) -> Actor:
    return Actor(user_id=current_user_id(request), email=current_user_label(),
                 method=request.method, path=request.url.path)


def _run(tenant_id: str, fn, *args, **kw):
    from workers.db import get_sync_engine, tenant_session
    try:
        with tenant_session(get_sync_engine(), tenant_id) as session:
            return fn(session, tenant_id, *args, **kw)
    except svc.SubjectError as e:
        raise HTTPException(status_code=e.status, detail={"error": e.code, "message": e.message})


@router.post("/search", dependencies=[Depends(require_permission("manage_settings")),
                                      Depends(rate_limit("subject_search", limit=60, window_s=3600))])
async def search(body: SubjectBody, request: Request, tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    return await asyncio.to_thread(_run, str(tenant.id), svc.search, body.subject, _actor(request))


@router.post("/export", dependencies=[Depends(require_permission("manage_settings")),
                                      Depends(rate_limit("subject_export", limit=20, window_s=3600))])
async def export(body: SubjectBody, request: Request, tenant: Tenant = Depends(get_tenant)) -> Response:
    data, rid = await asyncio.to_thread(_run, str(tenant.id), svc.export, body.subject, _actor(request))
    return Response(content=data, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="subject-export-{rid[:8]}.zip"', "X-Request-Id": rid})


@router.post("/erase", dependencies=[Depends(require_permission("manage_settings")),
                                     Depends(rate_limit("subject_erase", limit=30, window_s=3600))])
async def erase(body: EraseBody, request: Request, tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    return await asyncio.to_thread(
        _run, str(tenant.id), svc.erase, body.subject, _actor(request), dry_run=body.dry_run,
        confirm=body.confirm, reason=body.reason, dry_run_id=body.dry_run_id)


@router.get("", dependencies=[Depends(require_permission("manage_settings"))])
async def ledger(tenant: Tenant = Depends(get_tenant)) -> list[dict[str, Any]]:
    return await asyncio.to_thread(_run, str(tenant.id), svc.history)
