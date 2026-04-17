"""Config Impact API -- feature-level impact of data quality findings."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

router = APIRouter(prefix="/api/v1/config-impact", tags=["config_impact"])
logger = logging.getLogger("meridian.config_impact")


@router.get("/{version_id}")
async def get_config_impact(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return config impact results for an analysis version."""
    await db.execute(text(f"SET app.tenant_id TO '{tenant.id}'"))

    result = await db.execute(
        text("SELECT feature, system, status, blocking_findings, "
             "total_affected_records, blocked_transactions, "
             "opportunity_cost_summary, cross_system_dependencies "
             "FROM config_impact_results "
             "WHERE version_id = :vid AND tenant_id = :tid "
             "ORDER BY CASE status WHEN 'blocked' THEN 0 "
             "WHEN 'degraded' THEN 1 ELSE 2 END"),
        {"vid": version_id, "tid": str(tenant.id)},
    )
    rows = result.fetchall()

    results = [
        {
            "feature": r[0],
            "system": r[1],
            "status": r[2],
            "blocking_findings": r[3] or [],
            "total_affected_records": r[4],
            "blocked_transactions": r[5] or [],
            "opportunity_cost_summary": r[6] or "",
            "cross_system_dependencies": r[7] or {},
        }
        for r in rows
    ]

    blocked = sum(1 for r in results if r["status"] == "blocked")
    degraded = sum(1 for r in results if r["status"] == "degraded")

    return {
        "results": results,
        "summary": {
            "total_features_assessed": len(results),
            "features_blocked": blocked,
            "features_degraded": degraded,
            "features_ok": len(results) - blocked - degraded,
            "top_blocked_features": [r["feature"] for r in results
                                     if r["status"] == "blocked"][:10],
        },
    }
