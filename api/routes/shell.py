"""Shell-wide badge counts for the left rail (spec section 3.2, 9.4)."""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission
from api.services.run_context import latest_run

router = APIRouter(prefix="/api/v1/shell", tags=["shell"])


@router.get("/counts")
async def shell_counts(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
) -> dict[str, int | str]:
    """Fix = records still to fix in the latest run's work list (cleaning proposals awaiting review when that
    run has none); Inbox = open stewardship items. ``fix_source`` says which of the two ``fix`` counts:
    "work" (records to fix) or "cleaning" (proposals to review), so a caller never labels one as the other."""
    vid = await latest_run(db, tenant.id)
    fix_result = None
    if vid:
        fix_result = await db.execute(
            text("SELECT COUNT(*) FROM work_records WHERE tenant_id = :tid AND version_id = CAST(:vid AS uuid) "
                 "AND status = 'to_fix'"),
            {"tid": str(tenant.id), "vid": vid},
        )
        if not (await db.execute(text("SELECT metadata ? 'worklist_built_at' FROM analysis_versions "
                                      "WHERE tenant_id = :tid AND id = CAST(:vid AS uuid)"),
                                 {"tid": str(tenant.id), "vid": vid})).scalar():
            fix_result = None
    fix_source = "work"
    if fix_result is None:
        fix_source = "cleaning"
        fix_result = await db.execute(
            text("SELECT COUNT(*) FROM cleaning_queue WHERE tenant_id = :tid AND status = 'detected'"),
            {"tid": str(tenant.id)},
        )
    inbox_result = await db.execute(
        text("SELECT COUNT(*) FROM stewardship_queue WHERE tenant_id = :tid AND status IN ('open', 'in_progress')"),
        {"tid": str(tenant.id)},
    )
    return {"fix": fix_result.scalar() or 0, "fix_source": fix_source, "inbox": inbox_result.scalar() or 0}
