import json
import logging
import uuid
from functools import lru_cache
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import current_user_id, require_permission
from api.services.tenant_seed import rule_catalogue
from db.schema import Finding, Report

router = APIRouter(prefix="/api/v1", tags=["findings"])
logger = logging.getLogger("meridian.findings")


@lru_cache(maxsize=1)
def _check_classes() -> dict[tuple[str, str], str]:
    return {(r["module"], r["rid"]): json.loads(r["conditions"])[0].get("check_class")
            for r in rule_catalogue()}


def check_class_of(module: str, check_id: str) -> Optional[str]:
    """The YAML rule's check_class (e.g. ``domain_value_check``); None for rules not
    shipped in the YAML catalogue (tenant custom rules)."""
    return _check_classes().get((module, check_id))


_COMPLETE = "status IN ('complete', 'agents_running', 'agents_complete', 'agents_failed', 'ai_enriching', 'ai_enriched')"


async def _latest_version_ids(db: AsyncSession, tenant: Tenant) -> list[uuid.UUID]:
    """Current state: the latest complete run of each system (uploads count as one
    lineage) — never the same check counted once per historical run."""
    return list((await db.execute(text(f"""
        SELECT DISTINCT ON (COALESCE(metadata->>'system_id', 'upload')) id FROM analysis_versions
         WHERE tenant_id = :tid AND {_COMPLETE}
         ORDER BY COALESCE(metadata->>'system_id', 'upload'), run_at DESC
    """), {"tid": str(tenant.id)})).scalars().all())


def composite_dqs(summaries: list[dict], scoring: dict | None = None) -> dict:
    """One DQS over several modules/versions: module scores weighted by the number of
    checks behind them times the tenant's module weight (``scoring`` = the raw
    ``tenants.dqs_weights``; ``dqs_summary`` = {module: DQSResult}). Pure — tested directly."""
    from api.services.scoring import scoring_config, tier
    cfg = scoring_config(scoring)
    mods: dict[str, dict] = {}
    for s in summaries:
        for module, r in (s or {}).items():
            if isinstance(r, dict) and r.get("composite_score") is not None:
                mods[module] = r
    weight = {m: cfg["module_weights"].get(m, 1.0) * max(1, int(r.get("total_checks") or 1)) for m, r in mods.items()}
    total = sum(weight.values())
    if not total:
        return {"composite": None, "dimension_scores": {}, "modules": {}}
    dims: dict[str, float] = {}
    for d in ("completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"):
        have = [(m, r["dimension_scores"][d]) for m, r in mods.items() if d in (r.get("dimension_scores") or {})]
        if have:
            w = sum(weight[m] for m, _ in have)
            if w:
                dims[d] = round(sum(v * weight[m] for m, v in have) / w, 2)
    composite = round(sum(r["composite_score"] * weight[m] for m, r in mods.items()) / total, 2)
    return {"composite": composite, "tier": tier(composite, cfg["thresholds"]),
            "dimension_scores": dims,
            "modules": {m: round(float(r["composite_score"]), 2) for m, r in mods.items()},
            "capped": any(r.get("capped") for r in mods.values())}


async def _scoring_raw(db: AsyncSession, tenant: Tenant) -> dict:
    """The tenant's raw scoring config (``tenants.dqs_weights``)."""
    return (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :tid"),
                             {"tid": str(tenant.id)})).scalar() or {}


@router.get("/findings/aggregate")
async def aggregate_findings(
    version_id: Optional[str] = Query(None, description="One version; default = latest complete run per system"),
    module: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    dimension: Optional[str] = Query(None),
    check_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Severity, module and dimension totals plus the composite DQS, computed server-side
    over the whole result set — the figures the Command Centre headline is built from.
    The same filters as GET /findings narrow the totals (not the DQS, a version figure)."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": str(tenant.id)})
    ids = [uuid.UUID(version_id)] if version_id else await _latest_version_ids(db, tenant)
    if not ids:
        return {"version_ids": [], "total": 0, "affected_records": 0,
                "severity": {"critical": 0, "high": 0, "medium": 0, "low": 0}, "by_module": [], "by_dimension": [], "avg_pass_rate": None,
                "dqs": composite_dqs([]), "previous_dqs": None}
    p = {"ids": [str(i) for i in ids]}
    narrow = {k: v for k, v in (("module", module), ("severity", severity), ("dimension", dimension),
                                ("check_id", check_id)) if v}
    where = "".join(f" AND {k} = :{k}" for k in narrow)
    rows = (await db.execute(text(f"""
        SELECT module, severity, dimension, count(*) AS n, COALESCE(sum(affected_count), 0) AS affected,
               avg(pass_rate) AS avg_pass, COALESCE(sum(cost_at_risk) FILTER (WHERE affected_count > 0), 0) AS cost
          FROM findings WHERE version_id = ANY(CAST(:ids AS uuid[])){where}
         GROUP BY module, severity, dimension
    """), {**p, **narrow})).mappings().all()
    sev = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    by_module: dict[str, dict] = {}
    by_dim: dict[str, dict] = {}
    for r in rows:
        n = int(r["n"])
        sev[r["severity"]] = sev.get(r["severity"], 0) + n
        m = by_module.setdefault(r["module"], {"module": r["module"], "findings": 0, "affected": 0,
                                               "critical": 0, "high": 0, "medium": 0, "low": 0, "_pass": [],
                                               "cost_at_risk": 0.0})
        m["findings"] += n
        m["cost_at_risk"] = round(m["cost_at_risk"] + float(r["cost"]), 2)
        m["affected"] += int(r["affected"])
        m[r["severity"]] = m.get(r["severity"], 0) + n
        d = by_dim.setdefault(r["dimension"], {"dimension": r["dimension"], "findings": 0, "_pass": []})
        d["findings"] += n
        if r["avg_pass"] is not None:
            m["_pass"].append((float(r["avg_pass"]), n))
            d["_pass"].append((float(r["avg_pass"]), n))

    def _avg(entry: dict) -> dict:
        pairs = entry.pop("_pass")
        entry["avg_pass_rate"] = round(sum(v * n for v, n in pairs) / sum(n for _, n in pairs), 2) if pairs else None
        return entry

    summaries = (await db.execute(text(
        "SELECT dqs_summary FROM analysis_versions WHERE id = ANY(CAST(:ids AS uuid[]))"), p)).scalars().all()
    # the run before each of these in its own lineage, for the delta
    previous = (await db.execute(text(f"""
        SELECT DISTINCT ON (lineage) dqs_summary FROM (
            SELECT av.dqs_summary, av.run_at, COALESCE(av.metadata->>'system_id', 'upload') AS lineage
              FROM analysis_versions av
              JOIN analysis_versions cur ON cur.id = ANY(CAST(:ids AS uuid[]))
               AND COALESCE(cur.metadata->>'system_id', 'upload') = COALESCE(av.metadata->>'system_id', 'upload')
             WHERE av.tenant_id = :tid AND av.{_COMPLETE} AND av.run_at < cur.run_at AND av.id <> cur.id
        ) x ORDER BY lineage, run_at DESC
    """), {**p, "tid": str(tenant.id)})).scalars().all()
    scoring = await _scoring_raw(db, tenant)
    prev = composite_dqs(list(previous), scoring)
    overall = _avg({"_pass": [pair for d in by_dim.values() for pair in d["_pass"]]})
    return {
        "version_ids": p["ids"],
        "total": sum(sev.values()),
        "affected_records": sum(m["affected"] for m in by_module.values()),
        "severity": sev,
        "by_module": sorted((_avg(m) for m in by_module.values()),
                            key=lambda m: (-m["critical"], -m["high"], -m["findings"])),
        "by_dimension": sorted((_avg(d) for d in by_dim.values()), key=lambda d: d["dimension"]),
        "cost_at_risk": round(sum(m["cost_at_risk"] for m in by_module.values()), 2),
        "avg_pass_rate": overall["avg_pass_rate"],
        "dqs": composite_dqs(list(summaries), scoring),
        "previous_dqs": prev["composite"],
    }


@router.get("/scores/history")
async def score_history(
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Composite DQS per complete run, newest first, twice: under the scoring config in
    force when the run was scored (``metadata.scoring``; runs before it was recorded
    count as the defaults) and re-weighted under the tenant's current config."""
    from api.services.scoring import rescore
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": str(tenant.id)})
    current = await _scoring_raw(db, tenant)
    rows = (await db.execute(text(f"""
        SELECT id, run_at, dqs_summary, metadata->'scoring' AS scoring, metadata->>'system_id' AS system_id
          FROM analysis_versions WHERE tenant_id = :tid AND {_COMPLETE} AND dqs_summary IS NOT NULL
         ORDER BY run_at DESC LIMIT :lim
    """), {"tid": str(tenant.id), "lim": limit})).mappings().all()
    out = []
    for r in rows:
        summary = r["dqs_summary"] or {}
        then = composite_dqs([summary], r["scoring"])
        now = composite_dqs([{m: rescore(v, current) for m, v in summary.items() if isinstance(v, dict)}], current)
        out.append({"version_id": str(r["id"]), "run_at": r["run_at"].isoformat() if r["run_at"] else None,
                    "system_id": r["system_id"], "scoring_recorded": r["scoring"] is not None,
                    "at_the_time": {"composite": then["composite"], "tier": then.get("tier"), "scoring": r["scoring"]},
                    "under_current": {"composite": now["composite"], "tier": now.get("tier"),
                                      "modules": now["modules"]}})
    return {"history": out}


@router.get("/findings")
async def list_findings(
    version_id: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    dimension: Optional[str] = Query(None),
    check_id: Optional[str] = Query(None),
    baseline: Optional[str] = Query(None, pattern="^(live_config|sap_standard|s4_target)$"),
    sort: Literal["severity", "impact"] = Query("severity", description="impact = $ at risk × blocked SAP features × severity"),
    finding_type: Optional[str] = Query(None, alias="type", description="rule | anomaly"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    filters_applied: dict = {}
    base = select(Finding).where(Finding.tenant_id == tenant.id)

    if version_id:
        vid = uuid.UUID(version_id)
        base = base.where(Finding.version_id == vid)
        filters_applied["version_id"] = version_id
    else:
        base = base.where(Finding.version_id.in_(await _latest_version_ids(db, tenant)))
        filters_applied["version_id"] = "latest"
    if check_id:
        base = base.where(Finding.check_id == check_id)
        filters_applied["check_id"] = check_id

    if finding_type:
        base = base.where(Finding.finding_type == finding_type)
        filters_applied["type"] = finding_type
    if module:
        base = base.where(Finding.module == module)
        filters_applied["module"] = module
    if severity:
        base = base.where(Finding.severity == severity)
        filters_applied["severity"] = severity
    if dimension:
        base = base.where(Finding.dimension == dimension)
        filters_applied["dimension"] = dimension
    if baseline:
        tag = Finding.details["baseline"].astext
        # findings stored before the tag existed were judged against the live system
        base = base.where(or_(tag == baseline, tag.is_(None)) if baseline == "live_config" else tag == baseline)
        filters_applied["baseline"] = baseline

    # Get total count
    count_stmt = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    # Get paginated results — worst findings first
    severity_order = case(
        (Finding.severity == "critical", 1),
        (Finding.severity == "high", 2),
        (Finding.severity == "medium", 3),
        (Finding.severity == "low", 4),
        else_=5,
    )
    order = [severity_order, Finding.pass_rate.asc()]
    if sort == "impact":
        order.insert(0, Finding.impact_score.desc().nulls_last())
        filters_applied["sort"] = "impact"
    stmt = base.order_by(*order).offset(offset).limit(limit)
    result = await db.execute(stmt)
    findings = result.scalars().all()

    # Glossary enrichment: batch-lookup business names for check_ids
    check_ids = list({f.check_id for f in findings if f.check_id})
    glossary_lookup: dict[str, dict] = {}
    if check_ids:
        placeholders = ", ".join(f":cid{i}" for i in range(len(check_ids)))
        gparams = {"tid": str(tenant.id)}
        gparams.update({f"cid{i}": cid for i, cid in enumerate(check_ids)})
        glossary_result = await db.execute(
            text(f"""
                SELECT gtr.rule_id, gt.business_name, gt.id AS glossary_term_id,
                       gt.business_definition
                FROM glossary_term_rules gtr
                JOIN glossary_terms gt ON gt.id = gtr.term_id AND gt.tenant_id = gtr.tenant_id
                WHERE gtr.rule_id IN ({placeholders})
                  AND gtr.tenant_id = :tid
            """),
            gparams,
        )
        for row in glossary_result.fetchall():
            glossary_lookup[row[0]] = {
                "business_name": row[1],
                "glossary_term_id": str(row[2]),
                "business_definition": row[3],
            }

    return {
        "findings": [
            {
                "id": str(f.id),
                "version_id": str(f.version_id),
                "module": f.module,
                "check_id": f.check_id,
                "check_class": check_class_of(f.module, f.check_id),
                "finding_type": f.finding_type,
                "severity": f.severity,
                "dimension": f.dimension,
                "affected_count": f.affected_count,
                "total_count": f.total_count,
                "pass_rate": float(f.pass_rate) if f.pass_rate is not None else None,
                "details": f.details or {},
                "baseline": (f.details or {}).get("baseline", "live_config"),
                "remediation_text": f.remediation_text,
                "rule_context": f.rule_context,
                "value_fix_map": f.value_fix_map,
                "record_fixes": f.record_fixes,
                "cost_at_risk": float(f.cost_at_risk) if f.cost_at_risk is not None else None,
                "cost_formula": f.cost_formula,
                "impact_score": float(f.impact_score) if f.impact_score is not None else None,
                "created_at": f.created_at.isoformat() if f.created_at else None,
                "business_name": glossary_lookup.get(f.check_id, {}).get("business_name"),
                "glossary_term_id": glossary_lookup.get(f.check_id, {}).get("glossary_term_id"),
                "business_definition": glossary_lookup.get(f.check_id, {}).get("business_definition"),
            }
            for f in findings
        ],
        "total": total,
        "filters_applied": filters_applied,
    }


@router.get("/findings/{finding_id}/report-context")
async def get_finding_report_context(
    finding_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return report-level context for a single finding (cross-finding patterns,
    effort estimates, fix sequencing) extracted from the report JSON."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    fid = uuid.UUID(finding_id)

    # Get the finding
    result = await db.execute(
        select(Finding).where(Finding.id == fid, Finding.tenant_id == tenant.id)
    )
    finding = result.scalar_one_or_none()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    # Get the report for this version
    report_result = await db.execute(
        select(Report).where(
            Report.version_id == finding.version_id,
            Report.tenant_id == tenant.id,
        )
    )
    report = report_result.scalar_one_or_none()
    report_json = report.report_json if report else None

    # Extract context relevant to this finding's check_id
    report_context = None
    if report_json:
        check_id = finding.check_id
        remediations = report_json.get("remediations", {})

        # Extract cross_finding_patterns that include this check_id
        cross_patterns = [
            p for p in remediations.get("cross_finding_patterns", [])
            if check_id in p.get("affected_check_ids", [])
        ]

        # Extract effort estimate for this check_id
        effort_estimate = next(
            (e for e in remediations.get("effort_estimates", [])
             if e.get("check_id") == check_id),
            None,
        )

        # Extract fix sequence position for this check_id
        fix_sequence = next(
            (s for s in remediations.get("fix_sequence", [])
             if s.get("check_id") == check_id),
            None,
        )

        # Extract flags for this check_id
        flags = [
            f for f in remediations.get("flags", [])
            if f.get("check_id") == check_id
        ]

        report_context = {
            "cross_finding_patterns": cross_patterns,
            "effort_estimate": effort_estimate,
            "fix_sequence": fix_sequence,
            "flags": flags,
            "executive_summary": report_json.get("executive_summary"),
        }

    return {
        "finding_id": str(finding.id),
        "check_id": finding.check_id,
        "module": finding.module,
        "report_context": report_context,
    }


# ── saved views: a user's named filter sets per page ─────────────────────────


class SavedViewIn(BaseModel):
    route: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    filters: dict[str, str] = Field(default_factory=dict)


def _view_owner(request: Request) -> str:
    # AUTH_MODE=local without a login: one shared owner per tenant
    return current_user_id(request) or "local"


@router.get("/saved-views")
async def list_saved_views(
    request: Request,
    route: str = Query(..., min_length=1, max_length=64),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """The current user's saved views for one page, by name."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    rows = await db.execute(text("""
        SELECT id::text, name, filters, created_at FROM saved_views
         WHERE tenant_id = :tid AND user_id = :uid AND route = :route ORDER BY lower(name)
    """), {"tid": str(tenant.id), "uid": _view_owner(request), "route": route})
    return {"views": [dict(r._mapping) for r in rows.fetchall()]}


@router.post("/saved-views", dependencies=[Depends(require_permission("view"))])
async def save_view(
    body: SavedViewIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Create, or overwrite by name, one of the current user's views."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required")
    row = (await db.execute(text("""
        INSERT INTO saved_views (tenant_id, user_id, route, name, filters)
        VALUES (:tid, :uid, :route, :name, CAST(:filters AS jsonb))
        ON CONFLICT (tenant_id, user_id, route, name) DO UPDATE SET filters = EXCLUDED.filters
        RETURNING id::text, name, filters, created_at
    """), {"tid": str(tenant.id), "uid": _view_owner(request), "route": body.route,
           "name": name, "filters": json.dumps(body.filters)})).fetchone()
    await db.commit()
    return dict(row._mapping)


@router.delete("/saved-views/{view_id}", status_code=204, dependencies=[Depends(require_permission("view"))])
async def delete_saved_view(
    view_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Delete one of the current user's views (another user's view is a 404)."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    gone = (await db.execute(text("DELETE FROM saved_views WHERE id = :id AND tenant_id = :tid AND user_id = :uid"),
                             {"id": view_id, "tid": str(tenant.id), "uid": _view_owner(request)})).rowcount
    if not gone:
        raise HTTPException(status_code=404, detail="View not found")
    await db.commit()
