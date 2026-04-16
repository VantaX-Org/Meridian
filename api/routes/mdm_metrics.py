"""MDM metrics API — serves governance dashboard data with role-based filtering.

GET /api/v1/mdm-metrics          — latest snapshot + trend data
GET /api/v1/mdm-metrics/history  — time-series for sparklines

Role visibility:
  - Admin, Steward, ai_reviewer: full data including ai_narrative, ai_projected_score, ai_risk_flags
  - Analyst: mdm_health_score visible, ai_narrative/ai_projected_score/ai_risk_flags stripped
  - Viewer: no MDM data (403 — viewer only sees DQS)
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import PERMISSIONS, has_permission, require_permission

router = APIRouter(prefix="/api/v1", tags=["mdm-metrics"])


# ── Response models ──────────────────────────────────────────────────────────


class MdmMetricOut(BaseModel):
    snapshot_date: str
    domain: Optional[str] = None
    golden_record_count: int = 0
    golden_record_coverage_pct: float = 0.0
    avg_match_confidence: float = 0.0
    steward_sla_compliance_pct: float = 0.0
    source_consistency_pct: float = 0.0
    mdm_health_score: float = 0.0
    backlog_count: int = 0
    sync_coverage_pct: float = 0.0
    # AI fields — stripped for roles without view_ai_confidence
    ai_narrative: Optional[str] = None
    ai_projected_score: Optional[float] = None
    ai_risk_flags: Optional[list[str]] = None


class MdmDashboardResponse(BaseModel):
    latest: Optional[MdmMetricOut] = None
    trend: list[MdmMetricOut] = []
    active_systems_count: int = 0


class MdmHistoryResponse(BaseModel):
    history: list[MdmMetricOut] = []


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _get_user_role(request: Request, tenant: Tenant, db: AsyncSession) -> str:
    """Resolve role — mirrors rbac._get_user_role logic."""
    role_header = request.headers.get("x-user-role")
    if role_header and role_header in PERMISSIONS:
        return role_header

    # Use local auth user ID to look up role
    local_user_id = getattr(request.state, "local_user_id", None)
    if local_user_id:
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
        result = await db.execute(
            text("SELECT role, is_active FROM users WHERE id = :uid AND tenant_id = :tid"),
            {"uid": local_user_id, "tid": str(tenant.id)},
        )
        row = result.fetchone()
        if row:
            if not row[1]:
                raise HTTPException(status_code=403, detail="User account is deactivated")
            return row[0]

    return "analyst"


def _strip_ai_fields(metric: dict) -> dict:
    """Remove AI narrative fields for roles without view_ai_confidence."""
    metric["ai_narrative"] = None
    metric["ai_projected_score"] = None
    metric["ai_risk_flags"] = None
    return metric


def _should_see_ai_panel(role: str) -> bool:
    """Admin, Steward, and ai_reviewer see the AI panel. Analyst sees score only."""
    return role in ("admin", "steward", "ai_reviewer")


# ── Routes ───────────────────────────────────────────────────────────────────


@router.get("/mdm-metrics", response_model=MdmDashboardResponse)
async def get_mdm_dashboard(
    request: Request,
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    role: str = Depends(require_permission("view")),
):
    """Get MDM governance dashboard data — latest snapshot + 28-day trend."""
    user_role = await _get_user_role(request, tenant, db)

    # Viewer role: no MDM data at all
    if user_role == "viewer":
        return MdmDashboardResponse()

    tid = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{str(tid)}\'"))

    # Latest aggregate snapshot (domain IS NULL)
    result = await db.execute(
        text("""
            SELECT snapshot_date, domain, golden_record_count, golden_record_coverage_pct,
                   avg_match_confidence, steward_sla_compliance_pct, source_consistency_pct,
                   mdm_health_score, backlog_count, sync_coverage_pct,
                   ai_narrative, ai_projected_score, ai_risk_flags
            FROM mdm_metrics
            WHERE tenant_id = :tid AND domain IS NULL
            ORDER BY snapshot_date DESC
            LIMIT 1
        """),
        {"tid": tid},
    )
    row = result.fetchone()
    latest = None
    if row:
        latest = {
            "snapshot_date": str(row[0]),
            "domain": row[1],
            "golden_record_count": row[2],
            "golden_record_coverage_pct": float(row[3]),
            "avg_match_confidence": float(row[4]),
            "steward_sla_compliance_pct": float(row[5]),
            "source_consistency_pct": float(row[6]),
            "mdm_health_score": float(row[7]),
            "backlog_count": row[8],
            "sync_coverage_pct": float(row[9]),
            "ai_narrative": row[10],
            "ai_projected_score": float(row[11]) if row[11] is not None else None,
            "ai_risk_flags": row[12],
        }
        if not _should_see_ai_panel(user_role):
            latest = _strip_ai_fields(latest)

    # 28-day trend (aggregate)
    trend_result = await db.execute(
        text("""
            SELECT snapshot_date, domain, golden_record_count, golden_record_coverage_pct,
                   avg_match_confidence, steward_sla_compliance_pct, source_consistency_pct,
                   mdm_health_score, backlog_count, sync_coverage_pct,
                   ai_narrative, ai_projected_score, ai_risk_flags
            FROM mdm_metrics
            WHERE tenant_id = :tid AND domain IS NULL
              AND snapshot_date >= CURRENT_DATE - INTERVAL '28 days'
            ORDER BY snapshot_date ASC
        """),
        {"tid": tid},
    )
    trend = []
    for r in trend_result.fetchall():
        entry = {
            "snapshot_date": str(r[0]),
            "domain": r[1],
            "golden_record_count": r[2],
            "golden_record_coverage_pct": float(r[3]),
            "avg_match_confidence": float(r[4]),
            "steward_sla_compliance_pct": float(r[5]),
            "source_consistency_pct": float(r[6]),
            "mdm_health_score": float(r[7]),
            "backlog_count": r[8],
            "sync_coverage_pct": float(r[9]),
            "ai_narrative": r[10],
            "ai_projected_score": float(r[11]) if r[11] is not None else None,
            "ai_risk_flags": r[12],
        }
        if not _should_see_ai_panel(user_role):
            entry = _strip_ai_fields(entry)
        trend.append(entry)

    # Active systems count
    sys_result = await db.execute(
        text("SELECT COUNT(*) FROM sap_systems WHERE tenant_id = :tid AND is_active = true"),
        {"tid": tid},
    )
    active_systems = sys_result.scalar() or 0

    return MdmDashboardResponse(
        latest=MdmMetricOut(**latest) if latest else None,
        trend=[MdmMetricOut(**t) for t in trend],
        active_systems_count=active_systems,
    )


@router.get("/mdm-metrics/history", response_model=MdmHistoryResponse)
async def get_mdm_history(
    request: Request,
    days: int = Query(default=90, ge=7, le=365),
    domain: Optional[str] = Query(default=None),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    role: str = Depends(require_permission("view")),
):
    """Get MDM metrics history for trend charts."""
    user_role = await _get_user_role(request, tenant, db)

    if user_role == "viewer":
        return MdmHistoryResponse()

    tid = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{str(tid)}\'"))

    if domain:
        result = await db.execute(
            text("""
                SELECT snapshot_date, domain, golden_record_count, golden_record_coverage_pct,
                       avg_match_confidence, steward_sla_compliance_pct, source_consistency_pct,
                       mdm_health_score, backlog_count, sync_coverage_pct,
                       ai_narrative, ai_projected_score, ai_risk_flags
                FROM mdm_metrics
                WHERE tenant_id = :tid AND domain = :domain
                  AND snapshot_date >= CURRENT_DATE - :days * INTERVAL '1 day'
                ORDER BY snapshot_date ASC
            """),
            {"tid": tid, "domain": domain, "days": days},
        )
    else:
        result = await db.execute(
            text("""
                SELECT snapshot_date, domain, golden_record_count, golden_record_coverage_pct,
                       avg_match_confidence, steward_sla_compliance_pct, source_consistency_pct,
                       mdm_health_score, backlog_count, sync_coverage_pct,
                       ai_narrative, ai_projected_score, ai_risk_flags
                FROM mdm_metrics
                WHERE tenant_id = :tid AND domain IS NULL
                  AND snapshot_date >= CURRENT_DATE - :days * INTERVAL '1 day'
                ORDER BY snapshot_date ASC
            """),
            {"tid": tid, "days": days},
        )

    history = []
    for r in result.fetchall():
        entry = {
            "snapshot_date": str(r[0]),
            "domain": r[1],
            "golden_record_count": r[2],
            "golden_record_coverage_pct": float(r[3]),
            "avg_match_confidence": float(r[4]),
            "steward_sla_compliance_pct": float(r[5]),
            "source_consistency_pct": float(r[6]),
            "mdm_health_score": float(r[7]),
            "backlog_count": r[8],
            "sync_coverage_pct": float(r[9]),
            "ai_narrative": r[10],
            "ai_projected_score": float(r[11]) if r[11] is not None else None,
            "ai_risk_flags": r[12],
        }
        if not _should_see_ai_panel(user_role):
            entry = _strip_ai_fields(entry)
        history.append(entry)

    return MdmHistoryResponse(history=[MdmMetricOut(**h) for h in history])
