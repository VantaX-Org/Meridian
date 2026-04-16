"""Config Intelligence API endpoints.

13 endpoints for running config intelligence analysis, querying results,
and bridging DQ findings to root-cause configuration issues.
"""

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.config_intelligence.engine import ConfigIntelligenceEngine
from api.services.config_intelligence.persistence import ConfigIntelligencePersistence
from api.services.config_intelligence.serializers import (
    AlignmentListResponse,
    ConfigDiscoverRequest,
    ConfigDiscoverResponse,
    ConfigInventoryListResponse,
    DriftEntryResponse,
    DriftListResponse,
    HealthScoreListResponse,
    LicenceUtilisationListResponse,
    LicenceUtilisationResponse,
    ProcessHealthResponse,
    ProcessListResponse,
    RootCauseResponse,
    config_element_to_response,
    drift_entry_to_response,
    finding_to_response,
    health_score_to_response,
    process_health_to_response,
    result_to_discover_response,
    root_cause_to_response,
)

router = APIRouter(prefix="/api/v1/config", tags=["config-intelligence"])
logger = logging.getLogger("meridian.config_intelligence")

persistence = ConfigIntelligencePersistence()


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

async def _resolve_run_id(
    db: AsyncSession, tenant_id: str, run_id: Optional[str]
) -> str:
    """Resolve run_id — use provided value or fall back to latest."""
    if run_id:
        return run_id
    latest = await persistence.get_latest_run_id(db, tenant_id)
    if not latest:
        raise HTTPException(status_code=404, detail="No config intelligence runs found")
    return latest


# ------------------------------------------------------------------
# 1. POST /discover — run full 3-layer analysis
# ------------------------------------------------------------------

@router.post("/discover", response_model=ConfigDiscoverResponse)
async def discover_config(
    request: ConfigDiscoverRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Run full config intelligence analysis on SAP transactional data."""
    tenant_id = str(tenant.id)
    run_id = str(uuid.uuid4())

    engine = ConfigIntelligenceEngine()
    result = engine.analyze(request.records)

    await persistence.save_run(db, tenant_id, run_id, result)

    # Drift detection against previous run
    previous_run_id = await persistence.get_previous_run_id(db, tenant_id, run_id)
    if previous_run_id:
        prev_inventory = await persistence.load_inventory(db, tenant_id, previous_run_id)
        drift = engine.detect_drift(prev_inventory, result.config_inventory)
        if drift:
            await persistence.save_drift(db, tenant_id, run_id, drift)

    return result_to_discover_response(run_id, result)


# ------------------------------------------------------------------
# 2. GET /inventory — config element inventory
# ------------------------------------------------------------------

@router.get("/inventory", response_model=ConfigInventoryListResponse)
async def list_inventory(
    run_id: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List discovered config elements, optionally filtered by module."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)
    elements = await persistence.load_inventory(db, tid, rid, module=module)
    return ConfigInventoryListResponse(
        run_id=rid,
        module=module,
        total=len(elements),
        elements=[config_element_to_response(e) for e in elements],
    )


# ------------------------------------------------------------------
# 3. GET /inventory/{module} — module-filtered inventory
# ------------------------------------------------------------------

@router.get("/inventory/{module}", response_model=ConfigInventoryListResponse)
async def get_inventory_by_module(
    module: str,
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List config elements for a specific SAP module."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)
    elements = await persistence.load_inventory(db, tid, rid, module=module)
    return ConfigInventoryListResponse(
        run_id=rid,
        module=module,
        total=len(elements),
        elements=[config_element_to_response(e) for e in elements],
    )


# ------------------------------------------------------------------
# 4. GET /processes — all process health summaries
# ------------------------------------------------------------------

@router.get("/processes", response_model=ProcessListResponse)
async def list_processes(
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List all 7 business process health summaries."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)
    processes = await persistence.load_processes(db, tid, rid)
    return ProcessListResponse(
        run_id=rid,
        processes=[process_health_to_response(p) for p in processes],
    )


# ------------------------------------------------------------------
# 5. GET /processes/{process_id} — single process detail
# ------------------------------------------------------------------

@router.get("/processes/{process_id}", response_model=ProcessHealthResponse)
async def get_process_detail(
    process_id: str,
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Get detailed health for a single business process (e.g. OTC, PTP)."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)
    process = await persistence.load_process_detail(db, tid, rid, process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Process '{process_id}' not found")
    return process_health_to_response(process)


# ------------------------------------------------------------------
# 6. GET /alignment — all alignment findings
# ------------------------------------------------------------------

@router.get("/alignment", response_model=AlignmentListResponse)
async def list_alignment_findings(
    run_id: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List alignment findings with optional severity/category filters."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)
    findings = await persistence.load_findings(
        db, tid, rid, severity=severity, category=category,
    )
    return AlignmentListResponse(
        run_id=rid,
        total=len(findings),
        findings=[finding_to_response(f) for f in findings],
    )


# ------------------------------------------------------------------
# 7. GET /alignment/{module} — module-filtered findings
# ------------------------------------------------------------------

@router.get("/alignment/{module}", response_model=AlignmentListResponse)
async def get_alignment_by_module(
    module: str,
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List alignment findings for a specific SAP module."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)
    findings = await persistence.load_findings(db, tid, rid, module=module)
    return AlignmentListResponse(
        run_id=rid,
        module=module,
        total=len(findings),
        findings=[finding_to_response(f) for f in findings],
    )


# ------------------------------------------------------------------
# 8. GET /ghost — Ghost Config Register
# ------------------------------------------------------------------

@router.get("/ghost", response_model=AlignmentListResponse)
async def list_ghost_config(
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Ghost Config Register — config elements with no transactional activity."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)
    findings = await persistence.load_findings_by_category(db, tid, rid, "ghost")
    return AlignmentListResponse(
        run_id=rid,
        total=len(findings),
        findings=[finding_to_response(f) for f in findings],
    )


# ------------------------------------------------------------------
# 9. GET /shadow — Shadow Process Alerts
# ------------------------------------------------------------------

@router.get("/shadow", response_model=AlignmentListResponse)
async def list_shadow_processes(
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Shadow Process Alerts — undocumented processes detected in data."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)
    findings = await persistence.load_findings_by_category(db, tid, rid, "shadow")
    return AlignmentListResponse(
        run_id=rid,
        total=len(findings),
        findings=[finding_to_response(f) for f in findings],
    )


# ------------------------------------------------------------------
# 10. GET /drift — config drift between runs
# ------------------------------------------------------------------

@router.get("/drift", response_model=DriftListResponse)
async def list_drift(
    run_id: Optional[str] = Query(None),
    previous_run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Config drift between the current and previous analysis runs."""
    tid = str(tenant.id)
    current_rid = await _resolve_run_id(db, tid, run_id)
    if not previous_run_id:
        previous_run_id = await persistence.get_previous_run_id(db, tid, current_rid)
    if not previous_run_id:
        return DriftListResponse(
            current_run_id=current_rid,
            previous_run_id="",
            drift_entries=[],
        )
    drift = await persistence.load_drift(db, tid, current_rid)
    return DriftListResponse(
        current_run_id=current_rid,
        previous_run_id=previous_run_id,
        drift_entries=[drift_entry_to_response(d) for d in drift],
    )


# ------------------------------------------------------------------
# 11. GET /licence-utilisation — module utilisation analysis
# ------------------------------------------------------------------

@router.get("/licence-utilisation", response_model=LicenceUtilisationListResponse)
async def list_licence_utilisation(
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Per-module licence utilisation based on config element activity."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)
    elements = await persistence.load_inventory(db, tid, rid)

    # Aggregate per module
    module_stats: dict[str, dict] = {}
    for e in elements:
        if e.module not in module_stats:
            module_stats[e.module] = {"count": 0, "txn": 0}
        module_stats[e.module]["count"] += 1
        module_stats[e.module]["txn"] += e.transaction_count

    modules = []
    for mod, stats in sorted(module_stats.items()):
        total_elements = stats["count"]
        total_txn = stats["txn"]
        # Utilisation: proportion of elements that are actively used (txn > 0)
        active_count = sum(
            1 for e in elements if e.module == mod and e.transaction_count > 0
        )
        pct = round((active_count / total_elements * 100) if total_elements else 0, 1)
        if pct > 50:
            status = "active"
        elif pct > 20:
            status = "underutilised"
        else:
            status = "minimal"
        modules.append(
            LicenceUtilisationResponse(
                module=mod,
                total_config_elements=total_elements,
                total_transactions=total_txn,
                utilisation_pct=pct,
                status=status,
            )
        )

    return LicenceUtilisationListResponse(run_id=rid, modules=modules)


# ------------------------------------------------------------------
# 12. GET /health-score — CHS per module
# ------------------------------------------------------------------

@router.get("/health-score", response_model=HealthScoreListResponse)
async def list_health_scores(
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Config Health Scores per SAP module."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)
    scores = await persistence.load_health_scores(db, tid, rid)
    return HealthScoreListResponse(
        run_id=rid,
        scores=[health_score_to_response(h) for h in scores],
    )


# ------------------------------------------------------------------
# 13. GET /root-cause/{finding_id} — DQ-to-config root cause bridge
# ------------------------------------------------------------------

@router.get("/root-cause/{finding_id}", response_model=RootCauseResponse)
async def get_root_cause(
    finding_id: str,
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Root cause analysis bridging a DQ or alignment finding to config issues."""
    tid = str(tenant.id)
    rid = await _resolve_run_id(db, tid, run_id)

    # Try to find the alignment finding by check_id
    finding_obj = await persistence.load_finding_by_check_id(db, tid, rid, finding_id)
    if not finding_obj:
        raise HTTPException(
            status_code=404,
            detail=f"Finding '{finding_id}' not found in run '{rid}'",
        )

    # Load context for root cause analysis
    inventory = await persistence.load_inventory(db, tid, rid)
    processes = await persistence.load_processes(db, tid, rid)

    engine = ConfigIntelligenceEngine()
    finding_dict = {
        "check_id": finding_obj.check_id,
        "module": finding_obj.module,
        "category": finding_obj.category.value,
        "severity": finding_obj.severity.value,
        "title": finding_obj.title,
        "description": finding_obj.description,
        "affected_elements": finding_obj.affected_elements,
    }
    rca = engine.root_cause_analysis(finding_dict, inventory, processes)
    return root_cause_to_response(rca)
