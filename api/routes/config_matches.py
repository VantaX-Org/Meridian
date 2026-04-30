import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission
from db.queries.config_matches import (
    get_config_match_summary,
    get_config_matches,
    get_config_matches_for_export,
)

router = APIRouter(prefix="/api/v1", tags=["config-matches"])
logger = logging.getLogger("meridian.config_matches")


@router.get("/versions/{version_id}/config-matches")
async def list_config_matches(
    version_id: str,
    module: str | None = Query(None),
    classification: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    rows = await get_config_matches(
        db=db,
        version_id=version_id,
        tenant_id=str(tenant.id),
        module=module,
        classification=classification,
        limit=limit,
        offset=offset,
    )
    items = [dict(row._mapping) for row in rows]
    return {"items": items, "total": len(items), "limit": limit, "offset": offset}


@router.get("/versions/{version_id}/config-matches/summary")
async def get_config_matches_summary(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    summary = await get_config_match_summary(
        db=db,
        version_id=version_id,
        tenant_id=str(tenant.id),
    )
    if summary is None:
        return {"message": "No config match summary available"}
    return summary


@router.get("/versions/{version_id}/config-matches/export")
async def export_config_matches(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export")),
):
    from api.services.config_match_export import generate_config_match_excel

    rows = await get_config_matches_for_export(
        db=db,
        version_id=version_id,
        tenant_id=str(tenant.id),
    )
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No config-match records found for version {version_id}. "
                "Run an analysis that includes the config intelligence engine first."
            ),
        )
    export_rows = [dict(row._mapping) for row in rows]
    summary = await get_config_match_summary(
        db=db,
        version_id=version_id,
        tenant_id=str(tenant.id),
    ) or {
        "data_errors": 0,
        "config_deviations": 0,
        "ambiguous": 0,
        "modules_with_deviations": [],
    }
    stream = generate_config_match_excel(export_rows, summary, version_id)
    return Response(
        content=stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="meridian-config-{version_id[:8]}.xlsx"'
        },
    )
