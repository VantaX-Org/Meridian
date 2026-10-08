"""Shell-wide badge counts for the left rail (spec section 3.2, 9.4)."""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/shell", tags=["shell"])


@router.get("/counts")
async def shell_counts(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
) -> dict[str, int]:
    """Fix = cleaning proposals awaiting review; Inbox = open stewardship items."""
    fix_result = await db.execute(
        text("SELECT COUNT(*) FROM cleaning_queue WHERE tenant_id = :tid AND status = 'detected'"),
        {"tid": str(tenant.id)},
    )
    inbox_result = await db.execute(
        text("SELECT COUNT(*) FROM stewardship_queue WHERE tenant_id = :tid AND status IN ('open', 'in_progress')"),
        {"tid": str(tenant.id)},
    )
    return {"fix": fix_result.scalar() or 0, "inbox": inbox_result.scalar() or 0}
