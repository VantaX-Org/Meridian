"""Z-Object Intelligence API endpoints.

14 endpoints for Z-object detection, registry management, anomaly tracking,
rule governance, and standard-equivalent mapping.
"""

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.schemas.z_object_intelligence import (
    ZAnomalyFeedbackRequest,
    ZAnomalyListResponse,
    ZAnomalyResponse,
    ZCustomRuleRequest,
    ZDetectRequest,
    ZDormantResponse,
    ZDriftResponse,
    ZFullAnalysisResponse,
    ZGhostResponse,
    ZMappingListResponse,
    ZMappingResponse,
    ZProfileResponse,
    ZRegistryEntryResponse,
    ZRegistryListResponse,
    ZRegistryUpdateRequest,
    ZRuleListResponse,
    ZRuleTemplateResponse,
)
from api.services.z_object_intelligence.engine import ZObjectIntelligenceEngine
from api.services.z_object_intelligence.persistence import ZObjectPersistence
from api.services.z_object_intelligence.rule_builder import ZRuleBuilder
from api.services.z_object_intelligence.serializers import (
    anomaly_to_response,
    detection_to_response,
    finding_to_response,
    profile_to_response,
)

router = APIRouter(prefix="/api/v1/z-objects", tags=["z-object-intelligence"])
logger = logging.getLogger("meridian.z_object_intelligence")

persistence = ZObjectPersistence()


# ------------------------------------------------------------------
# 1. POST /detect — full Z analysis pipeline
# ------------------------------------------------------------------

@router.post("/detect", response_model=ZFullAnalysisResponse)
async def detect_z_objects(
    request: ZDetectRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Run full Z-Object Intelligence analysis pipeline."""
    tenant_id = str(tenant.id)
    run_id = str(uuid.uuid4())

    # Load existing baselines and registry status
    existing_baselines = await persistence.load_baselines(db, tenant_id)
    registry_status = await persistence.get_registry_status_map(db, tenant_id)

    # Run analysis
    engine = ZObjectIntelligenceEngine()
    result = engine.analyze(request.records, existing_baselines, registry_status)

    # Persist results
    z_object_ids: dict[str, str] = {}
    for obj in result.detection.detected_objects:
        profile = next(
            (p for p in result.profiles if p.object_name == obj.object_name), None
        )
        z_id = await persistence.upsert_registry_entry(db, tenant_id, obj, profile)
        z_object_ids[obj.object_name] = z_id

    await persistence.save_profiles(db, tenant_id, run_id, result.profiles, z_object_ids)
    await persistence.save_baselines(db, tenant_id, result.baselines, z_object_ids)
    await persistence.save_anomalies(db, tenant_id, run_id, result.anomalies, z_object_ids)
    await persistence.save_rule_findings(db, tenant_id, run_id, result.rule_findings, z_object_ids)

    return ZFullAnalysisResponse(
        run_id=run_id,
        detection=detection_to_response(run_id, result.detection),
        profiles=[profile_to_response(p) for p in result.profiles],
        anomalies=[anomaly_to_response(a) for a in result.anomalies],
        rule_findings=[finding_to_response(f) for f in result.rule_findings],
        total_z_objects=result.total_z_objects,
        total_anomalies=result.total_anomalies,
        total_rule_findings=result.total_rule_findings,
        modules_affected=result.modules_affected,
    )


# ------------------------------------------------------------------
# 2. GET /registry — Z-Object Registry list
# ------------------------------------------------------------------

@router.get("/registry", response_model=ZRegistryListResponse)
async def list_registry(
    module: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List Z-Object Registry entries, optionally filtered by module and/or status."""
    tid = str(tenant.id)
    entries = await persistence.get_registry(db, tid, module=module, status=status)
    return ZRegistryListResponse(
        total=len(entries),
        entries=[ZRegistryEntryResponse(**e) for e in entries],
    )


# ------------------------------------------------------------------
# 3. GET /registry/{z_id} — single Z object detail
# ------------------------------------------------------------------

@router.get("/registry/{z_id}", response_model=ZRegistryEntryResponse)
async def get_registry_entry(
    z_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Get a single Z-Object Registry entry with full profile and baseline."""
    tid = str(tenant.id)
    entry = await persistence.get_registry_entry(db, tid, z_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Z object '{z_id}' not found")
    return ZRegistryEntryResponse(**entry)


# ------------------------------------------------------------------
# 4. PUT /registry/{z_id} — update registry entry
# ------------------------------------------------------------------

@router.put("/registry/{z_id}", response_model=ZRegistryEntryResponse)
async def update_registry_entry(
    z_id: str,
    request: ZRegistryUpdateRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Update description, owner, standard_equivalent, status, or notes."""
    tid = str(tenant.id)
    updates = request.model_dump(exclude_none=True)
    updated = await persistence.update_registry_entry(db, tid, z_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Z object '{z_id}' not found or no changes")
    entry = await persistence.get_registry_entry(db, tid, z_id)
    return ZRegistryEntryResponse(**entry)


# ------------------------------------------------------------------
# 5. GET /profile/{z_id} — latest profile for a Z object
# ------------------------------------------------------------------

@router.get("/profile/{z_id}", response_model=ZProfileResponse)
async def get_profile(
    z_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Get the latest Z-Profiler output for a Z object."""
    tid = str(tenant.id)
    entry = await persistence.get_registry_entry(db, tid, z_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Z object '{z_id}' not found")

    profile = await persistence.get_latest_profile(db, tid, z_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"No profile found for Z object '{z_id}'")

    return ZProfileResponse(
        object_name=entry["object_name"],
        **profile,
    )


# ------------------------------------------------------------------
# 6. GET /anomalies — active anomalies
# ------------------------------------------------------------------

@router.get("/anomalies", response_model=ZAnomalyListResponse)
async def list_anomalies(
    run_id: Optional[str] = Query(None),
    status: Optional[str] = Query("active"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List Z-object anomalies, optionally filtered by run_id and status."""
    tid = str(tenant.id)
    anomalies = await persistence.get_anomalies(db, tid, run_id=run_id, status=status)
    effective_run_id = run_id or (anomalies[0]["run_id"] if anomalies else "")
    return ZAnomalyListResponse(
        run_id=effective_run_id,
        total=len(anomalies),
        anomalies=[ZAnomalyResponse(**a) for a in anomalies],
    )


# ------------------------------------------------------------------
# 7. POST /anomalies/{anomaly_id}/feedback — confirm/dismiss anomaly
# ------------------------------------------------------------------

@router.post("/anomalies/{anomaly_id}/feedback", response_model=ZAnomalyResponse)
async def submit_anomaly_feedback(
    anomaly_id: str,
    request: ZAnomalyFeedbackRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Update anomaly status to 'confirmed' or 'dismissed'."""
    if request.status not in ("confirmed", "dismissed"):
        raise HTTPException(status_code=400, detail="Status must be 'confirmed' or 'dismissed'")

    tid = str(tenant.id)
    user_id = str(tenant.id)  # In production this would be the actual user ID
    updated = await persistence.update_anomaly_feedback(db, tid, anomaly_id, request.status, user_id)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Anomaly '{anomaly_id}' not found")

    # Return updated anomaly
    anomalies = await persistence.get_anomalies(db, tid, status=None)
    match = next((a for a in anomalies if a["id"] == anomaly_id), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Anomaly '{anomaly_id}' not found")
    return ZAnomalyResponse(**match)


# ------------------------------------------------------------------
# 8. GET /ghost — ghost Z objects
# ------------------------------------------------------------------

@router.get("/ghost", response_model=list[ZGhostResponse])
async def list_ghost_z_objects(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Ghost Z objects — detected in config but zero or minimal transactions."""
    tid = str(tenant.id)
    ghosts = await persistence.get_ghost_z_objects(db, tid)
    return [
        ZGhostResponse(
            object_name=g["object_name"],
            category=g["category"],
            module=g["module"],
            source_field=g["category"],  # category doubles as source context
            last_active_date=g["last_active_date"],
            status=g["status"],
        )
        for g in ghosts
    ]


# ------------------------------------------------------------------
# 9. GET /dormant — dormant Z objects
# ------------------------------------------------------------------

@router.get("/dormant", response_model=list[ZDormantResponse])
async def list_dormant_z_objects(
    months: int = Query(6),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Dormant Z objects — no activity for N months."""
    tid = str(tenant.id)
    dormant = await persistence.get_dormant_z_objects(db, tid, months=months)
    return [
        ZDormantResponse(
            object_name=d["object_name"],
            category=d["category"],
            module=d["module"],
            last_active_date=d["last_active_date"],
            months_inactive=d["months_inactive"],
        )
        for d in dormant
    ]


# ------------------------------------------------------------------
# 10. GET /drift — new Z objects since last run
# ------------------------------------------------------------------

@router.get("/drift", response_model=list[ZDriftResponse])
async def list_z_drift(
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """New Z objects appearing since the last analysis run."""
    tid = str(tenant.id)
    drift = await persistence.get_z_drift(db, tid, run_id=run_id)
    return [
        ZDriftResponse(
            object_name=d["object_name"],
            module=d["module"],
            source_field=d["category"],
            change_type="new",
            first_detected=d["first_detected"],
        )
        for d in drift
    ]


# ------------------------------------------------------------------
# 11. GET /rules — templates + custom rules
# ------------------------------------------------------------------

@router.get("/rules", response_model=ZRuleListResponse)
async def list_rules(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List all 12 Z-rule templates and any custom rules."""
    tid = str(tenant.id)

    # Templates from the rule builder
    builder = ZRuleBuilder()
    templates = [
        ZRuleTemplateResponse(
            template_id=t.template_id,
            name=t.name,
            description=t.description,
            default_severity=t.default_severity,
            applicable_to=t.applicable_to,
        )
        for t in builder.templates.values()
    ]

    # Custom rules from DB
    custom_rules = await persistence.get_custom_rules(db, tid)

    return ZRuleListResponse(templates=templates, custom_rules=custom_rules)


# ------------------------------------------------------------------
# 12. POST /rules — create custom Z rule
# ------------------------------------------------------------------

@router.post("/rules", response_model=dict)
async def create_custom_rule(
    request: ZCustomRuleRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Create a custom Z rule."""
    tid = str(tenant.id)
    user_id = str(tenant.id)  # In production this would be the actual user ID
    rule_data = request.model_dump()
    rule_id = await persistence.create_custom_rule(db, tid, rule_data, user_id)
    return {"id": rule_id, "status": "created", **rule_data}


# ------------------------------------------------------------------
# 13. GET /report — comprehensive Z governance report
# ------------------------------------------------------------------

@router.get("/report", response_model=dict)
async def get_z_report(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Comprehensive Z-Object governance report."""
    tid = str(tenant.id)

    registry = await persistence.get_registry(db, tid)
    anomalies = await persistence.get_anomalies(db, tid, status="active")
    ghosts = await persistence.get_ghost_z_objects(db, tid)
    dormant = await persistence.get_dormant_z_objects(db, tid)
    mappings = await persistence.get_all_mappings(db, tid)

    # Aggregate by status
    status_counts: dict[str, int] = {}
    module_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}
    for entry in registry:
        s = entry["status"]
        status_counts[s] = status_counts.get(s, 0) + 1
        m = entry["module"]
        module_counts[m] = module_counts.get(m, 0) + 1
        c = entry["category"]
        category_counts[c] = category_counts.get(c, 0) + 1

    return {
        "total_z_objects": len(registry),
        "by_status": status_counts,
        "by_module": module_counts,
        "by_category": category_counts,
        "active_anomalies": len(anomalies),
        "ghost_objects": len(ghosts),
        "dormant_objects": len(dormant),
        "mapped_to_standard": len(mappings),
        "unmapped": len(registry) - len(mappings),
    }


# ------------------------------------------------------------------
# 14. GET /mapping — standard equivalent mappings
# ------------------------------------------------------------------

@router.get("/mapping", response_model=ZMappingListResponse)
async def list_mappings(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """All Z objects with standard_equivalent mappings."""
    tid = str(tenant.id)
    mappings = await persistence.get_all_mappings(db, tid)
    return ZMappingListResponse(
        total=len(mappings),
        mappings=[ZMappingResponse(**m) for m in mappings],
    )
