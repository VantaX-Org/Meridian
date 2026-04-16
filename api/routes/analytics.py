"""Phase C analytics routes — 11 endpoints across predictive, prescriptive,
impact, and operational analytics."""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import has_permission
from api.services.analytics_engine import (
    BusinessImpactAnalytics,
    OperationalAnalytics,
    PredictiveAnalytics,
    PrescriptiveAnalytics,
)
from db.schema import (
    AnalysisVersion,
    CleaningMetric,
    CleaningQueue,
    CostAvoidance,
    DqsHistory,
    Exception_,
    Finding,
    ImpactRecord,
    StewardMetric,
)

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])
logger = logging.getLogger("meridian.analytics")

predictive = PredictiveAnalytics()
prescriptive = PrescriptiveAnalytics()
impact_analytics = BusinessImpactAnalytics()
operational = OperationalAnalytics()


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _set_tenant(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))


def _row_to_dict(row) -> dict:
    """Convert a SQLAlchemy row to a plain dict."""
    obj = row[0] if hasattr(row, "__getitem__") else row
    d = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.key, None)
        if isinstance(val, datetime):
            val = val.isoformat()
        elif isinstance(val, uuid.UUID):
            val = str(val)
        elif hasattr(val, "as_integer_ratio"):  # Decimal/numeric
            val = float(val)
        d[col.key] = val
    return d


# ── 1. GET /analytics/predictive ─────────────────────────────────────────────


@router.get("/predictive")
async def get_predictive_analytics(
    module_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """DQS forecasting with early warnings."""
    await _set_tenant(db, tenant)

    query = select(DqsHistory).where(DqsHistory.tenant_id == tenant.id)
    if module_id:
        query = query.where(DqsHistory.module_id == module_id)
    query = query.order_by(DqsHistory.recorded_at.asc())

    result = await db.execute(query)
    rows = result.all()
    history = [_row_to_dict(r) for r in rows]

    if not history:
        logger.warning("No DQS history for tenant %s — returning empty forecasts", tenant.id)
        return {"forecasts": [], "early_warnings": []}

    forecasts = predictive.forecast_dqs(history)
    thresholds = {}  # Could load from tenant.alert_thresholds
    warnings = predictive.generate_early_warnings(forecasts, thresholds)

    return {"forecasts": forecasts, "early_warnings": warnings}


# ── 2. GET /analytics/prescriptive ───────────────────────────────────────────


@router.get("/prescriptive")
async def get_prescriptive_analytics(
    limit: int = Query(20, ge=1, le=50),
    type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Next-best actions ranked by ROI per hour."""
    await _set_tenant(db, tenant)

    # Load latest version findings
    latest_version = await db.execute(
        select(AnalysisVersion)
        .where(AnalysisVersion.tenant_id == tenant.id, AnalysisVersion.status == "complete")
        .order_by(AnalysisVersion.run_at.desc())
        .limit(1)
    )
    version_row = latest_version.first()

    findings_data: list[dict] = []
    if version_row:
        version = version_row[0]
        findings_result = await db.execute(
            select(Finding).where(
                Finding.tenant_id == tenant.id,
                Finding.version_id == version.id,
            )
        )
        findings_data = [_row_to_dict(r) for r in findings_result.all()]

    # Load cleaning queue
    queue_result = await db.execute(
        select(CleaningQueue).where(
            CleaningQueue.tenant_id == tenant.id,
            CleaningQueue.status.in_(["detected", "recommended"]),
        ).limit(100)
    )
    queue_data = [_row_to_dict(r) for r in queue_result.all()]

    # Load open exceptions
    exc_result = await db.execute(
        select(Exception_).where(
            Exception_.tenant_id == tenant.id,
            Exception_.status.in_(["open", "investigating"]),
        ).limit(100)
    )
    exc_data = [_row_to_dict(r) for r in exc_result.all()]

    actions = prescriptive.generate_next_best_actions(findings_data, queue_data, exc_data)

    if type:
        actions = [a for a in actions if a["type"] == type]

    actions = actions[:limit]
    sprints = prescriptive.generate_sprints(actions)

    return {"actions": actions, "sprints": sprints}


# ── 3. GET /analytics/impact ─────────────────────────────────────────────────


@router.get("/impact")
async def get_impact_analytics(
    version_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Business impact quantification across 8 categories."""
    await _set_tenant(db, tenant)

    # Determine version
    if version_id:
        vid = uuid.UUID(version_id)
    else:
        latest = await db.execute(
            select(AnalysisVersion)
            .where(AnalysisVersion.tenant_id == tenant.id, AnalysisVersion.status == "complete")
            .order_by(AnalysisVersion.run_at.desc())
            .limit(1)
        )
        row = latest.first()
        if not row:
            return {"impacts": [], "roi": {"subscription_annual": 0, "risk_mitigated": 0, "roi_multiple": 0, "payback_months": 0}}
        vid = row[0].id

    # Load findings
    findings_result = await db.execute(
        select(Finding).where(Finding.tenant_id == tenant.id, Finding.version_id == vid)
    )
    findings_data = [_row_to_dict(r) for r in findings_result.all()]

    # Load exceptions
    exc_result = await db.execute(
        select(Exception_).where(Exception_.tenant_id == tenant.id)
    )
    exc_data = [_row_to_dict(r) for r in exc_result.all()]

    impacts = impact_analytics.quantify_impact(findings_data, exc_data)

    # Default subscription — could come from tenant config
    monthly_sub = 15000.0
    roi = impact_analytics.calculate_roi(impacts, monthly_sub)

    return {"impacts": impacts, "roi": roi, "version_id": str(vid)}


# ── 4. GET /analytics/impact/{finding_id} ────────────────────────────────────


@router.get("/impact/{finding_id}")
async def get_finding_impact(
    finding_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Single finding impact with detailed calculation method."""
    await _set_tenant(db, tenant)

    fid = uuid.UUID(finding_id)
    result = await db.execute(
        select(Finding).where(Finding.tenant_id == tenant.id, Finding.id == fid)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Finding not found")

    finding_data = _row_to_dict(row)
    impacts = impact_analytics.quantify_impact([finding_data], [])

    return {
        "finding_id": finding_id,
        "finding": finding_data,
        "impacts": impacts,
    }


# ── 5. GET /analytics/operational ────────────────────────────────────────────


@router.get("/operational")
async def get_operational_analytics(
    period_type: Optional[str] = Query("daily"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Team KPIs, bottlenecks, and capacity planning."""
    await _set_tenant(db, tenant)

    # Load cleaning metrics
    cm_query = select(CleaningMetric).where(CleaningMetric.tenant_id == tenant.id)
    if period_type:
        cm_query = cm_query.where(CleaningMetric.period_type == period_type)
    cm_result = await db.execute(cm_query)
    cleaning_data = [_row_to_dict(r) for r in cm_result.all()]

    # Load steward metrics
    sm_result = await db.execute(
        select(StewardMetric).where(StewardMetric.tenant_id == tenant.id)
    )
    steward_data = [_row_to_dict(r) for r in sm_result.all()]

    kpis = operational.calculate_kpis(cleaning_data, steward_data)

    # Bottleneck analysis from queue
    queue_result = await db.execute(
        select(CleaningQueue).where(CleaningQueue.tenant_id == tenant.id)
    )
    queue_rows = queue_result.all()
    queue_items: list[dict] = []
    now = datetime.now(timezone.utc)
    for r in queue_rows:
        d = _row_to_dict(r)
        detected = r[0].detected_at or r[0].created_at
        d["age_hours"] = (now - detected).total_seconds() / 3600 if detected else 0
        queue_items.append(d)

    bottlenecks = operational.identify_bottlenecks(queue_items)

    # Capacity planning
    daily_inflow = kpis.get("throughput", 10) * 1.2
    unique_stewards = len(set(s.get("user_id") for s in steward_data if s.get("user_id")))
    avg_per_steward = kpis.get("throughput", 10) / max(1, unique_stewards) if unique_stewards else 20
    capacity = operational.capacity_planning(daily_inflow, avg_per_steward, max(1, unique_stewards))

    return {
        "kpis": kpis,
        "bottlenecks": bottlenecks,
        "capacity": capacity,
    }


# ── 6. GET /analytics/operational/team/{user_id} ─────────────────────────────


@router.get("/operational/team/{user_id}")
async def get_team_member_performance(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Steward-specific performance metrics."""
    await _set_tenant(db, tenant)

    uid = uuid.UUID(user_id)
    result = await db.execute(
        select(StewardMetric).where(
            StewardMetric.tenant_id == tenant.id,
            StewardMetric.user_id == uid,
        ).order_by(StewardMetric.period.desc())
    )
    rows = result.all()
    if not rows:
        raise HTTPException(status_code=404, detail="No metrics found for this user")

    metrics = [_row_to_dict(r) for r in rows]
    total_processed = sum(m.get("items_processed", 0) for m in metrics)
    total_approved = sum(m.get("items_approved", 0) for m in metrics)
    total_rejected = sum(m.get("items_rejected", 0) for m in metrics)
    total_hours = sum(m.get("total_review_hours", 0) for m in metrics)
    approval_rate = (total_approved / max(1, total_approved + total_rejected)) * 100

    return {
        "user_id": user_id,
        "periods": metrics,
        "summary": {
            "total_processed": total_processed,
            "total_approved": total_approved,
            "total_rejected": total_rejected,
            "total_review_hours": round(total_hours, 1),
            "approval_rate": round(approval_rate, 1),
            "avg_review_hours": round(total_hours / max(1, total_processed), 1),
        },
    }


# ── 7. GET /analytics/forecast/{module_id} ───────────────────────────────────


@router.get("/forecast/{module_id}")
async def get_module_forecast(
    module_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Single-module DQS forecast with detailed contributing factors."""
    await _set_tenant(db, tenant)

    result = await db.execute(
        select(DqsHistory)
        .where(DqsHistory.tenant_id == tenant.id, DqsHistory.module_id == module_id)
        .order_by(DqsHistory.recorded_at.asc())
    )
    rows = result.all()
    history = [_row_to_dict(r) for r in rows]

    if len(history) < 3:
        return {
            "module_id": module_id,
            "forecast": None,
            "history": history,
            "message": f"Need at least 3 data points for forecasting (have {len(history)})",
        }

    forecasts = predictive.forecast_dqs(history)
    forecast = forecasts[0] if forecasts else None

    return {
        "module_id": module_id,
        "forecast": forecast,
        "history": history,
    }


# ── 8. GET /analytics/roi ────────────────────────────────────────────────────


@router.get("/roi")
async def get_roi(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """ROI calculation from latest impact records and cost avoidance."""
    await _set_tenant(db, tenant)

    # Load latest impact records
    impact_result = await db.execute(
        select(ImpactRecord)
        .where(ImpactRecord.tenant_id == tenant.id)
        .order_by(ImpactRecord.recorded_at.desc())
        .limit(20)
    )
    impacts = [_row_to_dict(r) for r in impact_result.all()]

    # Load cost avoidance history
    ca_result = await db.execute(
        select(CostAvoidance)
        .where(CostAvoidance.tenant_id == tenant.id)
        .order_by(CostAvoidance.period.desc())
        .limit(12)
    )
    cost_avoidance = [_row_to_dict(r) for r in ca_result.all()]

    monthly_sub = 15000.0
    roi = impact_analytics.calculate_roi(impacts, monthly_sub)

    return {
        "roi": roi,
        "impact_records": impacts,
        "cost_avoidance_history": cost_avoidance,
    }


# ── 9. GET /analytics/sprints ────────────────────────────────────────────────


@router.get("/sprints")
async def get_sprints(
    max_hours: int = Query(40, ge=8, le=80),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Next-best actions grouped into sprint plans."""
    await _set_tenant(db, tenant)

    # Reuse prescriptive logic
    latest = await db.execute(
        select(AnalysisVersion)
        .where(AnalysisVersion.tenant_id == tenant.id, AnalysisVersion.status == "complete")
        .order_by(AnalysisVersion.run_at.desc())
        .limit(1)
    )
    version_row = latest.first()

    findings_data: list[dict] = []
    if version_row:
        findings_result = await db.execute(
            select(Finding).where(
                Finding.tenant_id == tenant.id,
                Finding.version_id == version_row[0].id,
            )
        )
        findings_data = [_row_to_dict(r) for r in findings_result.all()]

    actions = prescriptive.generate_next_best_actions(findings_data, [], [])
    sprints = prescriptive.generate_sprints(actions, max_hours)

    return {"sprints": sprints, "total_actions": len(actions)}


# ── 10. GET /analytics/bottlenecks ───────────────────────────────────────────


@router.get("/bottlenecks")
async def get_bottlenecks(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Current queue bottleneck analysis."""
    await _set_tenant(db, tenant)

    queue_result = await db.execute(
        select(CleaningQueue).where(CleaningQueue.tenant_id == tenant.id)
    )
    now = datetime.now(timezone.utc)
    queue_items: list[dict] = []
    for r in queue_result.all():
        d = _row_to_dict(r)
        detected = r[0].detected_at or r[0].created_at
        d["age_hours"] = (now - detected).total_seconds() / 3600 if detected else 0
        queue_items.append(d)

    bottlenecks = operational.identify_bottlenecks(queue_items)

    return {
        "bottlenecks": bottlenecks,
        "total_queue_size": len(queue_items),
    }


# ── 11. GET /analytics/capacity ──────────────────────────────────────────────


@router.get("/capacity")
async def get_capacity(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Current capacity planning recommendation."""
    await _set_tenant(db, tenant)

    # Compute daily inflow from recent cleaning metrics
    cm_result = await db.execute(
        select(CleaningMetric).where(
            CleaningMetric.tenant_id == tenant.id,
            CleaningMetric.period_type == "daily",
        ).order_by(CleaningMetric.period.desc()).limit(30)
    )
    cleaning_data = [_row_to_dict(r) for r in cm_result.all()]

    daily_inflow = (
        sum(m.get("detected", 0) for m in cleaning_data) / max(1, len(cleaning_data))
        if cleaning_data
        else 10
    )

    # Steward count and throughput
    sm_result = await db.execute(
        select(StewardMetric).where(StewardMetric.tenant_id == tenant.id)
    )
    steward_data = [_row_to_dict(r) for r in sm_result.all()]
    unique_stewards = len(set(s.get("user_id") for s in steward_data if s.get("user_id")))
    total_processed = sum(s.get("items_processed", 0) for s in steward_data)
    periods = len(set(s.get("period") for s in steward_data))
    avg_per_steward = (total_processed / max(1, unique_stewards) / max(1, periods)) if unique_stewards else 20

    capacity = operational.capacity_planning(daily_inflow, avg_per_steward, max(1, unique_stewards))

    return capacity


# ── 12. GET /analytics/mdm-health ──────────────────────────────────────────


@router.get("/mdm-health")
async def get_mdm_health(
    days: int = Query(56, ge=7, le=365),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """MDM health score history from mdm_metrics table. Strips AI fields for unprivileged roles."""
    await _set_tenant(db, tenant)

    user_role = getattr(request.state, 'user_role', 'viewer') if request else 'viewer'
    can_see_ai = has_permission(user_role, 'view_ai_confidence')

    result = await db.execute(text("""
        SELECT snapshot_date, mdm_health_score,
               golden_record_coverage_pct, avg_match_confidence,
               steward_sla_compliance_pct, source_consistency_pct,
               backlog_count,
               ai_projected_score, ai_narrative, ai_risk_flags
        FROM mdm_metrics
        WHERE tenant_id = :tid
          AND snapshot_date > now() - (:days || ' days')::interval
        ORDER BY snapshot_date ASC
    """), {'tid': str(tenant.id), 'days': days})
    rows = result.fetchall()

    data = []
    for r in rows:
        row = dict(r._mapping)
        if not can_see_ai:
            row['ai_projected_score'] = None
            row['ai_narrative'] = None
            row['ai_risk_flags'] = None
        # Convert date to string
        if hasattr(row.get('snapshot_date'), 'isoformat'):
            row['snapshot_date'] = row['snapshot_date'].isoformat()
        data.append(row)

    return {'data': data, 'days': days}
