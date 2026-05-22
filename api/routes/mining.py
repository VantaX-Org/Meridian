"""Process mining API routes — dedup, anomalies, relationships.

Surfaces the output of the previously-orphaned mining Celery pipeline, plus
a manual trigger for operators to re-run mining on any analysis version.

Endpoints (all prefixed /api/v1):
    POST   /mining/run                     — fan out mining for a version
    GET    /mining/duplicates              — list detected duplicate pairs
    GET    /mining/anomalies               — list detected anomalies
    GET    /mining/relationships           — list detected field relationships
    GET    /mining/summary/{version_id}    — aggregated counts per module

Tenant isolation enforced via RLS — every query passes through an AsyncSession
that already has `app.tenant_id` set by the tenant middleware.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["mining"])
logger = logging.getLogger("meridian.mining_api")


# ── Request / response models ────────────────────────────────────────────────


class RunMiningRequest(BaseModel):
    version_id: str
    modules: Optional[list[str]] = None
    include: Optional[list[str]] = Field(
        default=None,
        description="Subset of ['dedup','anomaly','relationship']. Default = all.",
    )


class RunMiningResponse(BaseModel):
    task_id: str
    version_id: str
    include: list[str]


class DuplicatePair(BaseModel):
    id: str
    version_id: str
    module_id: str
    record_a: str
    record_b: str
    match_score: float
    id_field: Optional[str] = None
    matched_fields: Optional[list[str]] = None
    detected_at: str


class AnomalyItem(BaseModel):
    id: str
    version_id: str
    module_id: str
    field_name: str
    field_value: Optional[float] = None
    record_index: Optional[int] = None
    detection_method: str
    z_score: Optional[float] = None
    severity: str
    detected_at: str


class RelationshipItem(BaseModel):
    id: str
    version_id: str
    module_id: str
    field_a: str
    field_b: str
    relationship_type: str
    strength_score: float
    detected_at: str


class MiningSummary(BaseModel):
    version_id: str
    per_module: dict[str, dict[str, int]]
    totals: dict[str, int]


# ── POST /mining/run ─────────────────────────────────────────────────────────


@router.post("/mining/run", response_model=RunMiningResponse)
async def trigger_mining(
    body: RunMiningRequest,
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_permission("mdm.write")),
) -> RunMiningResponse:
    """Fan out dedup / anomaly / relationship tasks for an analysis version."""
    # Sanity-check the version exists and belongs to this tenant (RLS will also enforce).
    result = await db.execute(
        text("SELECT id FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
        {"vid": body.version_id, "tid": str(tenant.id)},
    )
    if result.fetchone() is None:
        raise HTTPException(status_code=404, detail="version not found")

    from workers.tasks.mining.orchestrator import run_mining_for_version

    include = body.include or ["dedup", "anomaly", "relationship"]
    async_result = run_mining_for_version.delay(
        str(tenant.id), body.version_id,
        modules=body.modules, include=include,
    )
    return RunMiningResponse(
        task_id=async_result.id,
        version_id=body.version_id,
        include=include,
    )


# ── Listing endpoints ────────────────────────────────────────────────────────


@router.get("/mining/duplicates", response_model=list[DuplicatePair])
async def list_duplicates(
    version_id: Optional[str] = Query(None),
    module_id: Optional[str] = Query(None),
    min_score: float = Query(0.0, ge=0.0, le=1.0),
    limit: int = Query(200, ge=1, le=1000),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_permission("mdm.read")),
) -> list[DuplicatePair]:
    clauses = ["tenant_id = :tid", "match_score >= :min_score"]
    params: dict = {"tid": str(tenant.id), "min_score": min_score, "limit": limit}
    if version_id:
        clauses.append("version_id = :vid")
        params["vid"] = version_id
    if module_id:
        clauses.append("module_id = :mod")
        params["mod"] = module_id

    result = await db.execute(
        text(f"""
            SELECT id::text, version_id::text, module_id, record_a, record_b,
                   match_score::float, id_field, matched_fields, detected_at::text
            FROM data_duplicates
            WHERE {' AND '.join(clauses)}
            ORDER BY match_score DESC, detected_at DESC
            LIMIT :limit
        """),
        params,
    )
    rows = result.fetchall()
    return [
        DuplicatePair(
            id=r[0], version_id=r[1], module_id=r[2],
            record_a=r[3], record_b=r[4], match_score=float(r[5]),
            id_field=r[6], matched_fields=r[7], detected_at=r[8],
        )
        for r in rows
    ]


@router.get("/mining/anomalies", response_model=list[AnomalyItem])
async def list_anomalies(
    version_id: Optional[str] = Query(None),
    module_id: Optional[str] = Query(None),
    severity: Optional[str] = Query(None, pattern="^(low|medium|high|critical)$"),
    limit: int = Query(200, ge=1, le=2000),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_permission("mdm.read")),
) -> list[AnomalyItem]:
    clauses = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id), "limit": limit}
    if version_id:
        clauses.append("version_id = :vid")
        params["vid"] = version_id
    if module_id:
        clauses.append("module_id = :mod")
        params["mod"] = module_id
    if severity:
        clauses.append("severity = :sev")
        params["sev"] = severity

    result = await db.execute(
        text(f"""
            SELECT id::text, version_id::text, module_id, field_name,
                   field_value::float, record_index, detection_method,
                   z_score::float, severity, detected_at::text
            FROM data_anomalies
            WHERE {' AND '.join(clauses)}
            ORDER BY CASE severity
                     WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                     WHEN 'medium'   THEN 2 ELSE 3 END,
                     detected_at DESC
            LIMIT :limit
        """),
        params,
    )
    rows = result.fetchall()
    return [
        AnomalyItem(
            id=r[0], version_id=r[1], module_id=r[2], field_name=r[3],
            field_value=r[4], record_index=r[5], detection_method=r[6],
            z_score=r[7], severity=r[8], detected_at=r[9],
        )
        for r in rows
    ]


@router.get("/mining/relationships", response_model=list[RelationshipItem])
async def list_relationships(
    version_id: Optional[str] = Query(None),
    module_id: Optional[str] = Query(None),
    min_strength: float = Query(0.3, ge=0.0, le=1.0),
    limit: int = Query(100, ge=1, le=500),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_permission("mdm.read")),
) -> list[RelationshipItem]:
    clauses = ["tenant_id = :tid", "strength_score >= :min_strength"]
    params: dict = {"tid": str(tenant.id), "min_strength": min_strength, "limit": limit}
    if version_id:
        clauses.append("version_id = :vid")
        params["vid"] = version_id
    if module_id:
        clauses.append("module_id = :mod")
        params["mod"] = module_id

    result = await db.execute(
        text(f"""
            SELECT id::text, version_id::text, module_id, field_a, field_b,
                   relationship_type, strength_score::float, detected_at::text
            FROM data_relationships
            WHERE {' AND '.join(clauses)}
            ORDER BY strength_score DESC, detected_at DESC
            LIMIT :limit
        """),
        params,
    )
    rows = result.fetchall()
    return [
        RelationshipItem(
            id=r[0], version_id=r[1], module_id=r[2],
            field_a=r[3], field_b=r[4], relationship_type=r[5],
            strength_score=float(r[6]), detected_at=r[7],
        )
        for r in rows
    ]


@router.get("/mining/summary/{version_id}", response_model=MiningSummary)
async def mining_summary(
    version_id: str,
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_permission("mdm.read")),
) -> MiningSummary:
    per_module: dict[str, dict[str, int]] = {}

    for source, key in (
        ("data_duplicates", "duplicates"),
        ("data_anomalies", "anomalies"),
        ("data_relationships", "relationships"),
    ):
        result = await db.execute(
            text(
                f"""
                SELECT module_id, COUNT(*)::int
                FROM {source}
                WHERE tenant_id = :tid AND version_id = :vid
                GROUP BY module_id
                """
            ),
            {"tid": str(tenant.id), "vid": version_id},
        )
        for module_id, count in result.fetchall():
            per_module.setdefault(module_id, {"duplicates": 0, "anomalies": 0, "relationships": 0})
            per_module[module_id][key] = int(count)

    totals = {
        "duplicates": sum(m["duplicates"] for m in per_module.values()),
        "anomalies": sum(m["anomalies"] for m in per_module.values()),
        "relationships": sum(m["relationships"] for m in per_module.values()),
    }

    return MiningSummary(version_id=version_id, per_module=per_module, totals=totals)


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard endpoints — power the /mining page (frontend/lib/api/mining.ts).
# The page wants a unified "patterns" view rather than the per-version,
# per-table shape above; these aggregate data_anomalies + data_duplicates into
# that view. Drift / PII have no detector yet, so those filters return empty.
# ─────────────────────────────────────────────────────────────────────────────


class MiningOverview(BaseModel):
    window_days: int
    total_patterns: int
    new_anomalies: int
    stable_patterns: int
    coverage_pct: float
    runs_total: int
    cost_usd: float


class MiningPattern(BaseModel):
    id: str
    name: str
    module: str
    pattern_type: str
    severity: str
    occurrences: int
    first_seen: str
    last_seen: str
    confidence: float
    trend: list = Field(default_factory=list)
    promoted_to_rule: bool = False


class MiningPatternsResponse(BaseModel):
    patterns: list[MiningPattern]


_SEVERITY_BY_RANK = {4: "critical", 3: "high", 2: "medium", 1: "low"}


def _severity_from_score(score: float) -> str:
    """Map a 0-1 duplicate match score to a severity band."""
    if score >= 0.95:
        return "critical"
    if score >= 0.85:
        return "high"
    if score >= 0.60:
        return "medium"
    return "low"


@router.get("/mining/summary", response_model=MiningOverview)
async def mining_overview(
    window_days: int = Query(30, ge=1, le=365),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_permission("mdm.read")),
) -> MiningOverview:
    """Aggregate mining KPIs for the /mining dashboard.

    A "pattern" is a distinct (module, field) anomaly group or a per-module
    duplicate group. Pattern counts are windowed by detected_at; runs_total
    and coverage are all-time.
    """
    tid = str(tenant.id)
    window = {"tid": tid, "wd": window_days}
    recent = "detected_at >= now() - (:wd * interval '1 day')"

    anomaly_patterns = (
        await db.execute(
            text(
                f"SELECT COUNT(DISTINCT (module_id, field_name)) "
                f"FROM data_anomalies WHERE tenant_id = :tid AND {recent}"
            ),
            window,
        )
    ).scalar() or 0

    duplicate_patterns = (
        await db.execute(
            text(
                f"SELECT COUNT(DISTINCT module_id) "
                f"FROM data_duplicates WHERE tenant_id = :tid AND {recent}"
            ),
            window,
        )
    ).scalar() or 0

    total_patterns = int(anomaly_patterns) + int(duplicate_patterns)
    new_anomalies = int(anomaly_patterns)
    stable_patterns = max(0, total_patterns - new_anomalies)

    runs_total = (
        await db.execute(
            text(
                "SELECT COUNT(DISTINCT version_id) FROM ("
                "  SELECT version_id FROM data_anomalies WHERE tenant_id = :tid"
                "  UNION SELECT version_id FROM data_duplicates WHERE tenant_id = :tid"
                "  UNION SELECT version_id FROM data_relationships WHERE tenant_id = :tid"
                ") v"
            ),
            {"tid": tid},
        )
    ).scalar() or 0

    mined_modules = (
        await db.execute(
            text(
                "SELECT COUNT(DISTINCT module_id) FROM ("
                "  SELECT module_id FROM data_anomalies WHERE tenant_id = :tid"
                "  UNION SELECT module_id FROM data_duplicates WHERE tenant_id = :tid"
                ") m"
            ),
            {"tid": tid},
        )
    ).scalar() or 0
    analysed_modules = (
        await db.execute(
            text("SELECT COUNT(DISTINCT module) FROM findings WHERE tenant_id = :tid"),
            {"tid": tid},
        )
    ).scalar() or 0
    coverage_pct = (
        round(min(100.0, 100.0 * int(mined_modules) / int(analysed_modules)), 1)
        if analysed_modules
        else 0.0
    )

    return MiningOverview(
        window_days=window_days,
        total_patterns=total_patterns,
        new_anomalies=new_anomalies,
        stable_patterns=stable_patterns,
        coverage_pct=coverage_pct,
        runs_total=int(runs_total),
        cost_usd=0.0,
    )


@router.get("/mining/patterns", response_model=MiningPatternsResponse)
async def mining_patterns(
    module: Optional[str] = Query(None),
    pattern_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_permission("mdm.read")),
) -> MiningPatternsResponse:
    """Unified pattern list for the /mining page — anomaly + duplicate groups."""
    tid = str(tenant.id)
    want_anomaly = pattern_type in (None, "anomaly")
    want_duplicate = pattern_type in (None, "duplicate", "dup")
    patterns: list[MiningPattern] = []

    if want_anomaly:
        clauses = ["tenant_id = :tid"]
        params: dict = {"tid": tid}
        if module:
            clauses.append("module_id = :mod")
            params["mod"] = module
        rows = (
            await db.execute(
                text(
                    f"""
                    SELECT module_id, field_name,
                           COUNT(*)::int AS occurrences,
                           MIN(detected_at)::text AS first_seen,
                           MAX(detected_at)::text AS last_seen,
                           MAX(CASE severity
                               WHEN 'critical' THEN 4 WHEN 'high' THEN 3
                               WHEN 'medium' THEN 2 ELSE 1 END) AS sev_rank,
                           AVG(LEAST(ABS(COALESCE(z_score, 0)) / 5.0, 1.0)) AS confidence
                    FROM data_anomalies
                    WHERE {' AND '.join(clauses)}
                    GROUP BY module_id, field_name
                    """
                ),
                params,
            )
        ).fetchall()
        for r in rows:
            patterns.append(
                MiningPattern(
                    id=f"anomaly:{r[0]}:{r[1]}",
                    name=f"Anomalous values in {r[1]}",
                    module=r[0] or "unknown",
                    pattern_type="anomaly",
                    severity=_SEVERITY_BY_RANK.get(int(r[5] or 1), "low"),
                    occurrences=int(r[2]),
                    first_seen=r[3] or "",
                    last_seen=r[4] or "",
                    confidence=round(float(r[6] or 0.0), 3),
                )
            )

    if want_duplicate:
        clauses = ["tenant_id = :tid"]
        params = {"tid": tid}
        if module:
            clauses.append("module_id = :mod")
            params["mod"] = module
        rows = (
            await db.execute(
                text(
                    f"""
                    SELECT module_id,
                           COUNT(*)::int AS occurrences,
                           MIN(detected_at)::text AS first_seen,
                           MAX(detected_at)::text AS last_seen,
                           AVG(match_score) AS avg_score
                    FROM data_duplicates
                    WHERE {' AND '.join(clauses)}
                    GROUP BY module_id
                    """
                ),
                params,
            )
        ).fetchall()
        for r in rows:
            score = float(r[4] or 0.0)
            patterns.append(
                MiningPattern(
                    id=f"duplicate:{r[0]}",
                    name=f"Duplicate records in {r[0]}",
                    module=r[0] or "unknown",
                    pattern_type="duplicate",
                    severity=_severity_from_score(score),
                    occurrences=int(r[1]),
                    first_seen=r[2] or "",
                    last_seen=r[3] or "",
                    confidence=round(score, 3),
                )
            )

    patterns.sort(key=lambda p: p.occurrences, reverse=True)
    return MiningPatternsResponse(patterns=patterns[:limit])
