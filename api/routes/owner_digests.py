"""On-demand owner digests: a thin wrapper over workers/tasks/send_owner_digests.py."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from api.deps import Tenant, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/owners/digests", tags=["owners"])


class DigestSendRequest(BaseModel):
    owner: Optional[str] = Field(None, min_length=1, max_length=200, description="Owner name; omit to send to every owner")


class DigestSendResponse(BaseModel):
    sent: int
    owner: Optional[str] = None


def _send(tenant_id: str, owner: Optional[str]) -> int:
    from workers.db import get_sync_engine
    from workers.tasks.send_owner_digests import send_digests_for_tenant

    return send_digests_for_tenant(get_sync_engine(), tenant_id, owner)


@router.post("/send", response_model=DigestSendResponse, dependencies=[Depends(require_permission("manage_rules"))])
async def send_digests(body: DigestSendRequest, tenant: Tenant = Depends(get_tenant)) -> DigestSendResponse:
    """Write the weekly digest notification now, for one owner or all of this tenant's owners."""
    sent = await run_in_threadpool(_send, str(tenant.id), body.owner)
    if body.owner is not None and sent == 0:
        raise HTTPException(status_code=404, detail="No open items are assigned to that owner")
    return DigestSendResponse(sent=sent, owner=body.owner)
