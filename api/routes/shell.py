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
) -> dict[str, int | str]:
    """Fix = records still to fix in the current state's work lists, each object from its own latest run (the
    scope Fix work opens on; api/services/current_state.py), or cleaning proposals awaiting review when none of
    those runs has a work list; Inbox = open, in-progress and escalated stewardship items (the statuses the inbox
    lists). ``fix_source`` says which of the two ``fix`` counts: "work" (records to fix) or "cleaning" (proposals
    to review), so a caller never labels one as the other."""
    pairs = await current_pairs(db, tenant.id)
    fix_result = None
    built = set((await db.execute(text(
        "SELECT id::text FROM analysis_versions WHERE tenant_id = :tid AND id = ANY(CAST(:ids AS uuid[])) "
        "AND COALESCE(metadata, '{}'::jsonb) ? 'worklist_built_at'"),
        {"tid": str(tenant.id), "ids": run_ids(pairs)})).scalars().all()) if pairs else set()
    pairs = [p for p in pairs if p["version_id"] in built]
    if pairs:
        params: dict = {"tid": str(tenant.id)}
        fix_result = await db.execute(
            text(f"SELECT COUNT(*) FROM work_records w WHERE w.tenant_id = :tid AND {pairs_clause('w', pairs, params)} "
                 "AND w.status = 'to_fix'"),
            params,
        )
    fix_source = "work"
    if fix_result is None:
        fix_source = "cleaning"
        fix_result = await db.execute(
            text("SELECT COUNT(*) FROM cleaning_queue WHERE tenant_id = :tid AND status = 'detected'"),
            {"tid": str(tenant.id)},
        )
    inbox_result = await db.execute(
        text("SELECT COUNT(*) FROM stewardship_queue WHERE tenant_id = :tid AND status IN ('open', 'in_progress', 'escalated')"),
        {"tid": str(tenant.id)},
    )
    return {"fix": fix_result.scalar() or 0, "fix_source": fix_source, "inbox": inbox_result.scalar() or 0}
