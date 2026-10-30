"""Settings endpoints — tenant configuration, DQS weights, alert thresholds, notifications."""

import json
import math
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from api.services.rbac import require_permission, write_audit
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, get_tenant, Tenant as TenantDep
from api.config import settings as app_settings
from api.services.scoring import DEFAULT_THRESHOLDS, scoring_config

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
    critical_threshold: int = Field(1, ge=0)
    high_threshold: int = Field(10, ge=0)
    dqs_drop_threshold: float = Field(5, ge=0)
    # module -> minimum DQS; an analysis scoring a module below its floor raises an alert
    module_floors: dict[str, Annotated[float, Field(ge=0, le=100)]] = Field(default_factory=dict)
    # readiness grid (api/services/insights_readiness.py): DQS floor for a module/wave cell
    # to read "ready", and the tenant's wave -> [module] grouping for that grid.
    readiness_dqs_threshold: int = Field(int(DEFAULT_THRESHOLDS["warning"]), ge=0, le=100)
    readiness_waves: dict[str, list[str]] = Field(default_factory=dict)


class PlannerConfig(BaseModel):
    """Assumptions behind the prescriptive planner's effort and value figures."""
    minutes_per_record: float = 3.0
    investigation_hours: float = 1.0
    cleaning_item_hours: float = 0.25
    exception_hours: float = 2.0
    sprint_hours: float = 40.0
    cost_per_record: Optional[float] = None
    # Kept for stored settings only: planner amounts are named by the cost model's currency
    # (GET/PUT /settings/cost-model), which replaces this when the planner runs.
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
    # One place to read what PATCH /settings/tenant writes (additive)
    currency: Optional[str] = None
    cost_model: Optional[dict] = None
    scoring_weights: Optional[DimensionWeights] = None
    cap_rule: Optional["CapRule"] = None
    tolerance: Optional["Tolerance"] = None
    retention_days: Optional[int] = None
    # Whether this deployment writes approved fixes back to SAP itself (MERIDIAN_LIVE_WRITEBACK_ENABLED); off, they
    # are delivered with the export. Read by the batch inspector to offer "Send to SAP" live.
    live_writeback: bool = False


# ─── GET /settings ──────────────────────────────────────────────────

DEFAULT_CAP_RULE = {"one_critical": 85.0, "two_plus": 70.0}


class CapRule(BaseModel):
    """The DQS ceiling when critical rules are over tolerance: ``one_critical`` for one, ``two_plus`` for two or more."""
    one_critical: float = Field(DEFAULT_CAP_RULE["one_critical"], ge=0, le=100)
    two_plus: float = Field(DEFAULT_CAP_RULE["two_plus"], ge=0, le=100)


class Tolerance(BaseModel):
    """A failing critical rule caps the score only at or above ``pct`` percent failing records or ``rows`` rows."""
    pct: float = Field(ge=0, le=100)
    rows: int = Field(ge=0)


TenantSettingsResponse.model_rebuild()


async def _settings_document(db: AsyncSession, tenant: TenantDep) -> TenantSettingsResponse:
    from checks import cost
    from api.services.scoring import effective_weights

    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    result = await db.execute(
        text("SELECT name, licensed_modules, dqs_weights, alert_thresholds, stripe_customer_id, cost_model, retention "
             "FROM tenants WHERE id = :tid"),
        {"tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    dqs_weights_raw = dict(row[2] or {})
    nc = dqs_weights_raw.pop("notification_config", None)
    own_cost = row[5] if isinstance(row[5], dict) else {}
    retention = row[6] if isinstance(row[6], dict) else {}
    cfg = scoring_config(dqs_weights_raw)
    stored_cap = dqs_weights_raw.get("cap_rule") if isinstance(dqs_weights_raw.get("cap_rule"), dict) else {}

    return TenantSettingsResponse(
        name=row[0],
        licensed_modules=row[1] or [],
        dqs_weights=DimensionWeights(**dqs_weights_raw) if dqs_weights_raw and "completeness" in dqs_weights_raw else None,
        alert_thresholds=AlertThresholds(**{k: v for k, v in row[3].items() if k != "planner"}) if row[3] else None,
        planner_config=PlannerConfig(**row[3]["planner"]) if row[3] and isinstance(row[3].get("planner"), dict) else PlannerConfig(),
        notification_config=NotificationConfig(**nc) if nc else None,
        stripe_customer_id=row[4],
        currency=cost.effective(own_cost).get("currency"),
        cost_model=own_cost,
        scoring_weights=DimensionWeights(**{d: round(w, 4) for d, w in effective_weights(dqs_weights_raw).items()}),
        cap_rule=CapRule(**{**DEFAULT_CAP_RULE, **{k: v for k, v in stored_cap.items() if k in DEFAULT_CAP_RULE}}),
        tolerance=Tolerance(pct=round(cfg["critical_tolerance"]["pct"] * 100, 4), rows=int(cfg["critical_tolerance"]["rows"])),
        retention_days=retention.get("versions_days"),
        live_writeback=bool(app_settings.live_writeback_enabled),
    )


@router.get("", response_model=TenantSettingsResponse, dependencies=[Depends(require_permission("view"))])
async def get_settings(
    db: AsyncSession = Depends(get_db),
    tenant: TenantDep = Depends(get_tenant),
):
    return await _settings_document(db, tenant)


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
        # merge: the column also holds notification_config, module weights and thresholds
        text("UPDATE tenants SET dqs_weights = COALESCE(dqs_weights, '{}'::jsonb) || CAST(:w AS jsonb) WHERE id = :tid"),
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
        # only the sent keys: a save without module_floors must not wipe them
        {"t": json.dumps(thresholds.model_dump(exclude_unset=True)), "tid": str(tenant.id)},
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


# ─── /settings/scoring ──────────────────────────────────────────────
# Dimension weights, module weights and pass/warn thresholds, kept in
# tenants.dqs_weights beside notification_config. Each run records the config it
# scored under (analysis_versions.metadata.scoring) for GET /api/v1/scores/history.

class ScoringThresholds(BaseModel):
    """The one DQS band set (api/services/scoring.py). ``pass``/``warn`` are the
    pre-calibration names of target/warning, still accepted."""
    target: float = Field(DEFAULT_THRESHOLDS["target"], ge=0, le=100, validation_alias=AliasChoices("target", "pass"))
    warning: float = Field(DEFAULT_THRESHOLDS["warning"], ge=0, le=100, validation_alias=AliasChoices("warning", "warn"))
    critical: float = Field(DEFAULT_THRESHOLDS["critical"], ge=0, le=100)


class ScoringConfig(BaseModel):
    dimension_weights: DimensionWeights
    module_weights: dict[str, float] = {}
    thresholds: ScoringThresholds = ScoringThresholds()
    # per-severity rule weight and failure-rate multiplier, and the critical-cap tolerance;
    # unset keys keep the defaults in api/services/scoring.py
    severity_weights: dict[str, Annotated[float, Field(gt=0)]] = {}  # 0 would leave a dimension with no denominator
    severity_multipliers: dict[str, Annotated[float, Field(ge=1)]] = {}
    critical_tolerance: dict[str, Annotated[float, Field(ge=0)]] = {}


@router.get("/scoring", dependencies=[Depends(require_permission("view"))])
async def get_scoring(db: AsyncSession = Depends(get_db), tenant: TenantDep = Depends(get_tenant)):
    """The effective scoring config: dimension weights normalised to 1, module weights
    (unlisted modules weigh 1) and thresholds, with the defaults filled in."""
    raw = (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :tid"),
                            {"tid": str(tenant.id)})).scalar() or {}
    return {**scoring_config(raw), "defaults": scoring_config({})}


@router.put("/scoring", dependencies=[Depends(require_permission("manage_settings"))])
async def put_scoring(body: ScoringConfig, db: AsyncSession = Depends(get_db),
                      tenant: TenantDep = Depends(get_tenant)):
    """Replace the scoring config. Applies to scores computed from now on; earlier runs
    keep the config they were scored under (GET /api/v1/scores/history shows both)."""
    w = body.dimension_weights.model_dump()
    if any(v < 0 for v in w.values()) or abs(sum(w.values()) - 100) > 0.01:
        raise HTTPException(status_code=422, detail=f"Dimension weights must be >= 0 and sum to 100, got {sum(w.values())}")
    if any(v < 0 for v in body.module_weights.values()):
        raise HTTPException(status_code=422, detail="Module weights must be >= 0")
    t = body.thresholds
    if not t.critical <= t.warning <= t.target:
        raise HTTPException(status_code=422, detail="Thresholds must satisfy critical <= warning <= target")
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    await db.execute(
        text("UPDATE tenants SET dqs_weights = COALESCE(dqs_weights, '{}'::jsonb) || CAST(:w AS jsonb) WHERE id = :tid"),
        {"w": json.dumps({**w, "module_weights": body.module_weights,
                          "thresholds": t.model_dump(),
                          **body.model_dump(include={"severity_weights", "severity_multipliers",
                                                     "critical_tolerance"})}), "tid": str(tenant.id)},
    )
    await db.commit()
    return {"status": "ok"}


# ─── /settings/cost-model ───────────────────────────────────────────
# Cost of poor data quality (checks/cost.py): the tenant's overrides of
# checks/cost_model.yaml. Applies from the next analysis or re-analysis.

# Sane ceilings: no amount (per record, per unit, per feature, a month) above a trillion, at most
# _COST_MAX_ENTRIES keys in any section, and every number finite (NaN/Infinity would poison every total).
# Checked in put_cost_model, not by pydantic: a pydantic error echoes the input, and a NaN/Infinity
# input cannot be rendered as JSON (the 422 would become a 500).
_COST_MAX_AMOUNT = 1e12
_COST_MAX_ENTRIES = 500


def _cost_number_errors(path: str, value: object) -> list[str]:
    """Every non-finite or out-of-range number anywhere under ``value``."""
    if isinstance(value, dict):
        if len(value) > _COST_MAX_ENTRIES:
            return [f"{path}: at most {_COST_MAX_ENTRIES} entries"]
        return [e for k, v in value.items() for e in _cost_number_errors(f"{path}.{k}", v)]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value):
            return [f"{path}: must be a finite number"]
        if value < 0:
            return [f"{path}: must be a number >= 0"]
        if value > _COST_MAX_AMOUNT:
            return [f"{path}: must be at most {_COST_MAX_AMOUNT:.0e}"]
    return []


class RunCost(BaseModel):
    per_hour: Optional[float] = Field(None, ge=0, le=1e9)
    per_million_records: Optional[float] = Field(None, ge=0, le=1e9)


class CostModel(BaseModel):
    # ISO 4217 code every amount of the model is in (risk, ROI, value at risk, planner, config impact).
    currency: Optional[str] = Field(None, pattern=r"^[A-Z]{3}$")
    severity: dict[str, dict] = {}
    modules: dict[str, dict] = {}
    rules: dict[str, dict] = {}
    # feature -> value per blocked record (api/services/insights_impact.py value_at_risk).
    # Plain floats, not cost specs: not routed through validate_spec's per_record/field shapes.
    features: dict[str, float] = {}
    # defect type -> {unit_cost, factor, mitigation} (api/services/analytics_engine.py BusinessImpactAnalytics).
    impact: dict[str, dict] = {}
    # alignment finding type -> estimated impact of one unit (config_intelligence/alignment_validator.py).
    config_alignment: dict[str, float] = {}
    # what the tenant pays a month, for the ROI multiple and payback; None: no ROI multiple.
    subscription_monthly: Optional[float] = None
    # what one run costs to run (GET /runs/predict): per hour of run time and per million records checked.
    run_cost: Optional[RunCost] = None


def _validate_cost_model(body: "CostModel") -> None:
    """422 for any number, feature, severity key, spec or alignment type the cost model cannot hold."""
    from checks import cost
    from api.services.insights_impact import impact_features
    sections = ("severity", "modules", "rules", "features", "impact", "config_alignment")
    numbers = [e for section in sections for e in _cost_number_errors(section, getattr(body, section))]
    numbers += _cost_number_errors("subscription_monthly", body.subscription_monthly)
    if numbers:
        raise HTTPException(status_code=422, detail=numbers)
    feature_names = {f["feature"] for f in impact_features()}
    unknown = sorted(set(body.features) - feature_names)
    if unknown:
        raise HTTPException(status_code=422, detail=[f"features.{k}: not a config impact feature" for k in unknown])
    if set(body.severity) - set(cost.SEVERITY_FACTOR):
        raise HTTPException(status_code=422, detail=f"severity keys are {sorted(cost.SEVERITY_FACTOR)}")
    errors = [f"{section}.{key}: {err}" for section in ("severity", "modules", "rules")
              for key, spec in getattr(body, section).items() if (err := cost.validate_spec(spec))]
    errors += [f"impact.{key}: {err}" for key, spec in body.impact.items() if (err := cost.validate_impact(key, spec))]
    known = set(cost.defaults().get("config_alignment") or {})
    errors += [f"config_alignment.{key}: alignment types are {sorted(known)}"
               for key in body.config_alignment if key not in known]
    if errors:
        raise HTTPException(status_code=422, detail=errors)


@router.get("/cost-model", dependencies=[Depends(require_permission("view"))])
async def get_cost_model(db: AsyncSession = Depends(get_db), tenant: TenantDep = Depends(get_tenant)):
    from checks import cost
    own = (await db.execute(text("SELECT cost_model FROM tenants WHERE id = :tid"),
                            {"tid": str(tenant.id)})).scalar() or {}
    return {"defaults": cost.defaults(), "tenant": own, "effective": cost.effective(own)}


@router.get("/cost-model/features", dependencies=[Depends(require_permission("view"))])
async def get_cost_model_features() -> dict:
    """The SAP features a value per blocked record can be set for (``features`` of the cost
    model): every target feature of the config impact rules. Static rule metadata, no tenant data."""
    from api.services.insights_impact import impact_features
    return {"features": impact_features()}


@router.put("/cost-model", dependencies=[Depends(require_permission("manage_settings"))])
async def put_cost_model(body: CostModel, db: AsyncSession = Depends(get_db),
                         tenant: TenantDep = Depends(get_tenant)):
    """Replace the tenant's cost model. Each spec is {per_record: n} or
    {field: "TABLE.FIELD"}, either with an optional factor."""
    from checks import cost
    _validate_cost_model(body)
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    await db.execute(text("UPDATE tenants SET cost_model = CAST(:m AS jsonb) WHERE id = :tid"),
                     {"m": json.dumps(body.model_dump(exclude_none=True)), "tid": str(tenant.id)})
    await db.commit()
    return {"status": "ok", "effective": cost.effective(body.model_dump(exclude_none=True))}


# ─── PATCH /settings/tenant ─────────────────────────────────────────
# Everything GET /settings exposes as a tenant-wide setting, writable in one call. Only the keys sent change.

class TenantPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    cost_model: Optional[CostModel] = None
    currency: Optional[str] = Field(None, pattern=r"^[A-Z]{3}$")
    # fractions that sum to 1.0 (stored as percentages, like PUT /settings/scoring)
    scoring_weights: Optional[DimensionWeights] = None
    cap_rule: Optional[CapRule] = None
    tolerance: Optional[Tolerance] = None
    # days an archived run is kept before the retention policy may purge it (retention.versions_days)
    retention_days: Optional[int] = Field(None, ge=1, le=3650)


@router.patch("/tenant", response_model=TenantSettingsResponse, dependencies=[Depends(require_permission("manage_settings"))])
async def patch_tenant_settings(
    body: TenantPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: TenantDep = Depends(get_tenant),
):
    """Change tenant-wide settings in one validated, audited call and return the settings document.

    scoring_weights: six dimensions, each 0..1, summing to 1.0. cap_rule: both ceilings 0..100 and two_plus <= one_critical.
    tolerance: pct 0..100, rows >= 0. cost_model replaces the cost model as PUT /settings/cost-model does; currency
    then overrides its currency. retention_days sets the retention policy's versions_days."""
    sent = body.model_fields_set
    if not sent:
        raise HTTPException(status_code=422, detail="Nothing to update")
    for key in sent:
        if getattr(body, key) is None:
            raise HTTPException(status_code=422, detail=f"{key} cannot be null")
    errors: list[str] = []
    if body.scoring_weights is not None:
        w = body.scoring_weights.model_dump()
        if any(v < 0 or v > 1 for v in w.values()):
            errors.append("scoring_weights: each weight must be between 0 and 1")
        elif abs(sum(w.values()) - 1.0) > 0.001:
            errors.append(f"scoring_weights: must sum to 1.0, got {round(sum(w.values()), 4)}")
    if body.cap_rule is not None and body.cap_rule.two_plus > body.cap_rule.one_critical:
        errors.append("cap_rule: two_plus cannot be higher than one_critical")
    if body.name is not None and not body.name.strip():
        errors.append("name: cannot be blank")
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    if body.cost_model is not None:
        _validate_cost_model(body.cost_model)

    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    row = (await db.execute(
        text("SELECT name, dqs_weights, cost_model, retention FROM tenants WHERE id = :tid FOR UPDATE"),
        {"tid": str(tenant.id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    weights = dict(row[1] or {})
    own_cost = dict(row[2]) if isinstance(row[2], dict) else {}
    retention = dict(row[3]) if isinstance(row[3], dict) else {}
    before: dict = {}
    after: dict = {}

    if body.name is not None:
        before["name"], after["name"] = row[0], body.name.strip()
    if body.scoring_weights is not None:
        from api.services.scoring import effective_weights
        before["scoring_weights"] = {d: round(v, 4) for d, v in effective_weights(weights).items()}
        after["scoring_weights"] = {d: round(v, 4) for d, v in body.scoring_weights.model_dump().items()}
        weights.update({d: v * 100 for d, v in after["scoring_weights"].items()})
    if body.cap_rule is not None:
        before["cap_rule"] = weights.get("cap_rule") or DEFAULT_CAP_RULE
        after["cap_rule"] = weights["cap_rule"] = body.cap_rule.model_dump()
    if body.tolerance is not None:
        old = scoring_config(weights)["critical_tolerance"]
        before["tolerance"] = {"pct": round(old["pct"] * 100, 4), "rows": int(old["rows"])}
        weights["critical_tolerance"] = {"pct": body.tolerance.pct / 100, "rows": body.tolerance.rows}
        after["tolerance"] = body.tolerance.model_dump()
    if body.cost_model is not None or body.currency is not None:
        before["cost_model"] = own_cost
        new_cost = body.cost_model.model_dump(exclude_none=True) if body.cost_model is not None else dict(own_cost)
        if body.currency is not None:
            new_cost["currency"] = body.currency
        own_cost = after["cost_model"] = new_cost
    if body.retention_days is not None:
        before["retention_days"] = retention.get("versions_days")
        after["retention_days"] = body.retention_days
        # the dry-run window of the nightly purge restarts with the policy (api/services/retention.py)
        from datetime import datetime, timezone
        from api.services.retention import POLICY_UPDATED_KEY
        retention = {**retention, "versions_days": body.retention_days,
                     POLICY_UPDATED_KEY: datetime.now(timezone.utc).isoformat()}

    await db.execute(
        text("UPDATE tenants SET name = :n, dqs_weights = CAST(:w AS jsonb), cost_model = CAST(:c AS jsonb), "
             "retention = CAST(:r AS jsonb) WHERE id = :tid"),
        {"n": after.get("name", row[0]), "w": json.dumps(weights), "c": json.dumps(own_cost),
         "r": json.dumps(retention), "tid": str(tenant.id)})
    await write_audit(db, tenant.id, request, "tenant_settings.update", "tenant_settings", str(tenant.id), before, after)
    await db.commit()
    return await _settings_document(db, tenant)
