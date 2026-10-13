"""POST /api/v1/client-errors: the browser reports an unhandled UI error.

No third-party error tracker: the report lands in the customer's own audit_log
with action="client_error", so admins find it beside every other mutation.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rate_limiter import rate_limit
from api.services.rbac import require_permission, write_audit

router = APIRouter(prefix="/api/v1", tags=["client-errors"])

# A crash loop in one browser must not fill the audit log.
_client_error_rate_limit = rate_limit("client_errors", limit=20, window_s=60)


class ClientErrorBody(BaseModel):
    digest: str = Field(min_length=1, max_length=128, description="Error id from the framework, or a fingerprint")
    message: str = Field(max_length=2000)
    stack: Optional[str] = Field(None, max_length=8000)
    pathname: str = Field(max_length=512)
    user_agent: str = Field(max_length=512)
    time: str = Field(max_length=64, description="Client timestamp, ISO 8601")


class ClientErrorOut(BaseModel):
    status: str


@router.post(
    "/client-errors",
    response_model=ClientErrorOut,
    status_code=202,
    dependencies=[Depends(_client_error_rate_limit), Depends(require_permission("view"))],
)
async def report_client_error(
    body: ClientErrorBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> ClientErrorOut:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    await write_audit(
        db, tenant.id, request, "client_error", "client_error", body.digest,
        None, body.model_dump(),
    )
    await db.commit()
    return ClientErrorOut(status="recorded")
