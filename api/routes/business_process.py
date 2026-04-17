"""Business Process Document API -- L1-L5 process readiness."""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

router = APIRouter(prefix="/api/v1/business-process", tags=["business_process"])
logger = logging.getLogger("meridian.business_process")


@router.get("/{version_id}/{module}")
async def get_business_process(
    version_id: str,
    module: str,
    system_id: str = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Generate L1-L5 business process document for a module and version."""
    await db.execute(text(f"SET app.tenant_id TO '{tenant.id}'"))

    # Load findings for this version
    result = await db.execute(
        text("""
            SELECT check_id, pass_rate, affected_count, severity,
                   details->>'message' as message, module
            FROM findings
            WHERE version_id = :vid AND tenant_id = :tid
        """),
        {"vid": version_id, "tid": str(tenant.id)},
    )
    rows = result.fetchall()
    findings_by_check = {
        r[0]: {"pass_rate": float(r[1]) if r[1] else 0,
               "affected_count": r[2], "severity": r[3],
               "message": r[4] or ""}
        for r in rows
    }

    # Load SPRO config (baseline fallback)
    from api.services.spro_reader import SPROReader

    reader = SPROReader("ecc", None)
    spro_config_dfs = reader.read_config(module)
    spro_config = {
        t: df.to_dict(orient="records") if not df.empty else []
        for t, df in spro_config_dfs.items()
    }

    # Load config impact results
    impact_result = await db.execute(
        text("SELECT feature, system, status, blocking_findings, "
             "total_affected_records, opportunity_cost_summary "
             "FROM config_impact_results "
             "WHERE version_id = :vid AND tenant_id = :tid"),
        {"vid": version_id, "tid": str(tenant.id)},
    )
    config_impact = [
        {"feature": r[0], "system": r[1], "status": r[2],
         "blocking_findings": r[3], "total_affected_records": r[4],
         "opportunity_cost_summary": r[5]}
        for r in impact_result.fetchall()
    ]

    from api.services.process_writer import generate_process_document

    doc = generate_process_document(module, findings_by_check, spro_config,
                                    config_impact)
    return {"version_id": version_id, "module": module, "processes": doc}
