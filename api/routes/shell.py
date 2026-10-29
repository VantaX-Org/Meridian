"""Shell-wide badge counts for the left rail (spec section 3.2, 9.4)."""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.current_state import current_pairs, pairs_clause, run_ids
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/shell", tags=["shell"])


@router.get("/counts")
async def shell_counts(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
) -> dict[str, int | None]:
    """Fix = records still to fix in the current state's work lists, each object from its own latest run (the
    scope Fix work opens on; api/services/current_state.py), or null when no run of the current state has a work
    list built: the badge is then hidden and Fix offers to build the list. It is never substituted by cleaning
    proposals. Inbox = open, in-progress and escalated stewardship items (the statuses the inbox lists)."""
    pairs = await current_pairs(db, tenant.id)
    fix: int | None = None
    built = set((await db.execute(text(
        "SELECT id::text FROM analysis_versions WHERE tenant_id = :tid AND id = ANY(CAST(:ids AS uuid[])) "
        "AND COALESCE(metadata, '{}'::jsonb) ? 'worklist_built_at'"),
        {"tid": str(tenant.id), "ids": run_ids(pairs)})).scalars().all()) if pairs else set()
    pairs = [p for p in pairs if p["version_id"] in built]
    if pairs:
        params: dict = {"tid": str(tenant.id)}
        fix = (await db.execute(
            text(f"SELECT COALESCE(sum(c.count), 0)::bigint FROM work_counts c WHERE c.tenant_id = :tid "
                 f"AND {pairs_clause('c', pairs, params)} AND c.status = 'to_fix'"),  # migration 108
            params,
        )).scalar() or 0
    inbox_result = await db.execute(
        text("SELECT COUNT(*) FROM stewardship_queue WHERE tenant_id = :tid AND status IN ('open', 'in_progress', 'escalated')"),
        {"tid": str(tenant.id)},
    )
    return {"fix": fix, "inbox": inbox_result.scalar() or 0}
