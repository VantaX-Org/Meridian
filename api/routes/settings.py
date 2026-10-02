"""Settings endpoints — tenant configuration, DQS weights, alert thresholds, notifications."""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from api.services.rbac import require_permission
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, get_tenant, Tenant as TenantDep

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


# ─── Response / request models ─────────────────────────────────────

class DimensionWeights(BaseModel):
    completeness: float
    accuracy: float
    consistency: float
    timeliness: float
    uniqueness: float
    validity: float


class AlertThresholds(BaseModel):
    critical_threshold: int = 1
    high_threshold: int = 10
    dqs_drop_threshold: int = 5


class PlannerConfig(BaseModel):
    """Assumptions behind the prescriptive planner's effort and value figures."""
    minutes_per_record: float = 3.0
    investigation_hours: float = 1.0
    cleaning_item_hours: float = 0.25
    exception_hours: float = 2.0
    sprint_hours: float = 40.0
    cost_per_record: Optional[float] = None
    currency: str = "ZAR"


class NotificationConfig(BaseModel):
    email: str = ""
    teams_webhook: str = ""
    daily_digest: bool = False
    weekly_summary: bool = False
    monthly_report: bool = False


class TenantSettingsResponse(BaseModel):
    name: str
    licensed_modules: list[str]
    dqs_weights: Optional[DimensionWeights] = None
    alert_thresholds: Optional[AlertThresholds] = None
    notification_config: Optional[NotificationConfig] = None
    planner_config: Optional[PlannerConfig] = None
    stripe_customer_id: Optional[str] = None


# ─── GET /settings ──────────────────────────────────────────────────

@router.get("", response_model=TenantSettingsResponse, dependencies=[Depends(require_permission("view"))])
async def get_settings(
    db: AsyncSession = Depends(get_db),
    tenant: TenantDep = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    result = await db.execute(
        text("SELECT name, licensed_modules, dqs_weights, alert_thresholds, stripe_customer_id FROM tenants WHERE id = :tid"),
        {"tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    dqs_weights_raw = row[2] or {}
    nc = dqs_weights_raw.pop("notification_config", None) if isinstance(dqs_weights_raw, dict) else None

    return TenantSettingsResponse(
        name=row[0],
        licensed_modules=row[1] or [],
        dqs_weights=DimensionWeights(**dqs_weights_raw) if dqs_weights_raw and "completeness" in dqs_weights_raw else None,
        alert_thresholds=AlertThresholds(**{k: v for k, v in row[3].items() if k != "planner"}) if row[3] else None,
        planner_config=PlannerConfig(**row[3]["planner"]) if row[3] and isinstance(row[3].get("planner"), dict) else PlannerConfig(),
        notification_config=NotificationConfig(**nc) if nc else None,
        stripe_customer_id=row[4],
    )


# ─── PATCH /settings/dqs-weights ────────────────────────────────────

@router.patch("/dqs-weights", dependencies=[Depends(require_permission("manage_settings"))])
async def update_dqs_weights(
    weights: DimensionWeights,
    db: AsyncSession = Depends(get_db),
    tenant: TenantDep = Depends(get_tenant),
):
    total = (
        weights.completeness
        + weights.accuracy
        + weights.consistency
        + weights.timeliness
        + weights.uniqueness
        + weights.validity
    )
    if abs(total - 100) > 0.01:
        raise HTTPException(
            status_code=422,
            detail=f"Weights must sum to 100, got {total}",
        )

    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    await db.execute(
        text("UPDATE tenants SET dqs_weights = CAST(:w AS jsonb) WHERE id = :tid"),
        {"w": json.dumps(weights.model_dump()), "tid": str(tenant.id)},
    )
    await db.commit()
    return {"status": "ok"}


# ─── PATCH /settings/alert-thresholds ───────────────────────────────

@router.patch("/alert-thresholds", dependencies=[Depends(require_permission("manage_settings"))])
async def update_alert_thresholds(
    thresholds: AlertThresholds,
    db: AsyncSession = Depends(get_db),
    tenant: TenantDep = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    await db.execute(
        text("UPDATE tenants SET alert_thresholds = COALESCE(alert_thresholds, '{}'::jsonb) || CAST(:t AS jsonb) WHERE id = :tid"),
        {"t": json.dumps(thresholds.model_dump()), "tid": str(tenant.id)},
    )
    await db.commit()
    return {"status": "ok"}


# ─── POST /settings/notifications ───────────────────────────────────

@router.post("/notifications", dependencies=[Depends(require_permission("manage_settings"))])
async def save_notifications(
    config: NotificationConfig,
    db: AsyncSession = Depends(get_db),
    tenant: TenantDep = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    await db.execute(
        text("""
            UPDATE tenants
            SET dqs_weights = COALESCE(dqs_weights, '{}'::jsonb) || jsonb_build_object('notification_config', CAST(:nc AS jsonb))
            WHERE id = :tid
        """),
        {"nc": config.model_dump_json(), "tid": str(tenant.id)},
    )
    await db.commit()
    return {"status": "ok"}


# ─── POST /settings/planner ─────────────────────────────────────────

@router.post("/planner", dependencies=[Depends(require_permission("manage_settings"))])
async def save_planner_config(
    config: PlannerConfig,
    db: AsyncSession = Depends(get_db),
    tenant: TenantDep = Depends(get_tenant),
):
    """Planner assumptions live beside the alert thresholds (no new column)."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    await db.execute(
        text("""
            UPDATE tenants
            SET alert_thresholds = COALESCE(alert_thresholds, '{}'::jsonb) || jsonb_build_object('planner', CAST(:p AS jsonb))
            WHERE id = :tid
        """),
        {"p": config.model_dump_json(), "tid": str(tenant.id)},
    )
    await db.commit()
    return {"status": "ok"}
