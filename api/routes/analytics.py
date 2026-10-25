"""Phase C analytics routes — 11 endpoints across predictive, prescriptive,
impact, and operational analytics."""

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import has_permission
from api.services.version_status import FINISHED, finished_sql
from api.services.analytics_engine import (
    planner_config,
    BusinessImpactAnalytics,
    DQS_HISTORY_DAILY_SQL,
    OperationalAnalytics,
    PredictiveAnalytics,
    PrescriptiveAnalytics,
    RISK_CURRENCY,
)
from db.schema import (
    AnalysisVersion,
    CleaningMetric,
    CleaningQueue,
    CostAvoidance,
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


def _agg_row_to_dict(row) -> dict:
    """Convert a mapping from an aggregate (GROUP BY) query to a plain dict."""
    d = dict(row)
    for k, val in d.items():
        if isinstance(val, datetime):
            d[k] = val.isoformat()
        elif hasattr(val, "as_integer_ratio"):  # Decimal/numeric
            d[k] = float(val)
    return d


async def _dqs_history_daily(db: AsyncSession, tenant_id, module_id: Optional[str] = None) -> list[dict]:
    """One row per (module, day): the latest run of each system that day, averaged."""
    params = {"tid": str(tenant_id)}
    module_filter = ""
    if module_id:
        module_filter = "AND module_id = :module_id"
        params["module_id"] = module_id
    sql = DQS_HISTORY_DAILY_SQL.format(module_filter=module_filter)
    result = await db.execute(text(sql), params)
    return [_agg_row_to_dict(r) for r in result.mappings().all()]


DQS_HISTORY_EXTENT_SQL = """
    SELECT (SELECT COUNT(*) FROM analysis_versions v
             WHERE v.tenant_id = :tid AND {finished} {version_filter}) AS runs_seen,
           COUNT(DISTINCT (recorded_at AT TIME ZONE 'UTC')::date) AS days_seen
    FROM dqs_history
    WHERE tenant_id = :tid
    {module_filter}
"""


async def _dqs_history_extent(db: AsyncSession, tenant_id, module_id: Optional[str] = None) -> tuple[int, int]:
    """How many finished runs exist and how many distinct UTC days the DQS history holds.

    ``dqs_history`` keeps one row per system, module and day, so runs are counted on
    ``analysis_versions`` (a run lists its modules in ``metadata.modules``)."""
    params = {"tid": str(tenant_id)}
    module_filter = version_filter = ""
    if module_id:
        module_filter = "AND module_id = :module_id"
        version_filter = "AND jsonb_exists(COALESCE(v.metadata -> 'modules', '[]'::jsonb), :module_id)"
        params["module_id"] = module_id
    sql = DQS_HISTORY_EXTENT_SQL.format(finished=finished_sql("v.status"), module_filter=module_filter,
                                        version_filter=version_filter)
    row = (await db.execute(text(sql), params)).fetchone()
    return (int(row[0] or 0), int(row[1] or 0)) if row else (0, 0)


# ── 1. GET /analytics/predictive ─────────────────────────────────────────────


@router.get("/predictive")
async def get_predictive_analytics(
    module_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """DQS forecasting with early warnings.

    A module is forecast once it has scores on three different days (one point per
    module and UTC day; same-day runs collapse into one). With fewer, ``forecasts`` is
    empty and ``reason`` says why: ``no_history`` (no run has scored yet) or
    ``needs_three_days``. ``runs_seen`` and ``days_seen`` count the whole history
    (or the one module when ``module_id`` is given) so the page can show them."""
    await _set_tenant(db, tenant)

    history = await _dqs_history_daily(db, tenant.id, module_id)
    runs_seen, days_seen = await _dqs_history_extent(db, tenant.id, module_id)

    if not history:
        logger.warning("No DQS history for tenant %s — returning empty forecasts", tenant.id)
        return {"forecasts": [], "early_warnings": [], "reason": "no_history",
                "runs_seen": runs_seen, "days_seen": days_seen}

    forecasts = predictive.forecast_dqs(history)
    thresholds = {}  # Could load from tenant.alert_thresholds
    warnings = predictive.generate_early_warnings(forecasts, thresholds)

    out = {"forecasts": forecasts, "early_warnings": warnings, "runs_seen": runs_seen, "days_seen": days_seen}
    if not forecasts:
        out["reason"] = "needs_three_days"
    return out


# ── 2. GET /analytics/prescriptive ───────────────────────────────────────────


@router.get("/prescriptive")
async def get_prescriptive_analytics(
    limit: int = Query(20, ge=1, le=50),
    type: Optional[str] = Query(None),
    version_id: Optional[uuid.UUID] = Query(None, description="The run whose findings the actions come from; "
                                                              "default the latest finished run."),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Next-best actions ranked by ROI per hour."""
    await _set_tenant(db, tenant)

    # Load the findings of the named run, else of the latest finished one
    version_filter = [AnalysisVersion.tenant_id == tenant.id]
    if version_id is not None:
        version_filter.append(AnalysisVersion.id == version_id)
    else:
        version_filter.append(AnalysisVersion.status.in_(FINISHED))
    latest_version = await db.execute(
        select(AnalysisVersion)
        .where(*version_filter)
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

    cfg, weights = await _planner_inputs(db, tenant)
    planner = PrescriptiveAnalytics(cfg)
    actions = planner.generate_next_best_actions(findings_data, queue_data, exc_data)

    if type:
        actions = [a for a in actions if a["type"] == type]

    actions = actions[:limit]
    sprints = planner.generate_sprints(actions, findings=findings_data, weights=weights)

    return {
        "actions": actions,
        "sprints": sprints,
        "assumptions": cfg,
        "basis": {"version_id": str(version_row[0].id) if version_row else None,
                  "findings": len(findings_data), "cleaning_items": len(queue_data), "exceptions": len(exc_data)},
    }


async def _planner_inputs(db: AsyncSession, tenant: Tenant) -> tuple[dict, dict]:
    """The tenant's planner assumptions (Admin → Scoring & alerts) and DQS weights."""
    row = (await db.execute(
        text("SELECT dqs_weights, alert_thresholds FROM tenants WHERE id = :tid"), {"tid": str(tenant.id)}
    )).fetchone()
    weights = {k: v for k, v in ((row[0] if row and row[0] else {}) or {}).items() if k != "notification_config"}
    planner = ((row[1] if row and row[1] else {}) or {}).get("planner") or {}
    return planner_config(planner), weights


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
            .where(AnalysisVersion.tenant_id == tenant.id, AnalysisVersion.status.in_(FINISHED))
            .order_by(AnalysisVersion.run_at.desc())
            .limit(1)
        )
        row = latest.first()
        if not row:
            return {"impacts": [], "roi": {"subscription_annual": 0, "risk_mitigated": 0, "roi_multiple": 0, "payback_months": 0,
                                            "currency": RISK_CURRENCY}}
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


# Per-stage count and summed age (hours) of the tenant's cleaning queue, aggregated in Postgres:
# loading every queue row as an ORM object only to count it took seconds on a 60k-row queue.
_QUEUE_STAGES_SQL = """
    SELECT status, count(*) AS n,
           COALESCE(sum(extract(epoch FROM now() - COALESCE(detected_at, created_at))), 0) / 3600.0 AS total_age
      FROM cleaning_queue WHERE tenant_id = :tid
     GROUP BY status ORDER BY status
"""


async def _queue_stages(db: AsyncSession, tenant: Tenant) -> dict[str, dict]:
    rows = (await db.execute(text(_QUEUE_STAGES_SQL), {"tid": str(tenant.id)})).fetchall()
    return {r[0]: {"count": int(r[1]), "total_age": float(r[2] or 0)} for r in rows}


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
    stages = await _queue_stages(db, tenant)
    bottlenecks = operational.bottlenecks_from_stages(stages)

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

    history = await _dqs_history_daily(db, tenant.id, module_id)

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
        .where(AnalysisVersion.tenant_id == tenant.id, AnalysisVersion.status.in_(FINISHED))
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

    cfg, weights = await _planner_inputs(db, tenant)
    planner = PrescriptiveAnalytics(cfg)
    actions = planner.generate_next_best_actions(findings_data, [], [])
    sprints = planner.generate_sprints(actions, max_hours, findings=findings_data, weights=weights)

    return {"sprints": sprints, "total_actions": len(actions), "assumptions": cfg}


# ── 10. GET /analytics/bottlenecks ───────────────────────────────────────────


@router.get("/bottlenecks")
async def get_bottlenecks(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Current queue bottleneck analysis."""
    await _set_tenant(db, tenant)

    stages = await _queue_stages(db, tenant)
    bottlenecks = operational.bottlenecks_from_stages(stages)

    return {
        "bottlenecks": bottlenecks,
        "total_queue_size": sum(s["count"] for s in stages.values()),
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
          -- make_interval(days => :days), not the old string concatenation of the bound days
          -- parameter with a literal: the API runs on asyncpg, which type-checks parameters and
          -- refused an int where the concatenation needs text ("expected str, got int"). It
          -- worked under psycopg2, so only the async path broke - this endpoint returned 500 on
          -- every call until the bind was fixed.
          AND snapshot_date > now() - make_interval(days => :days)
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
