"""The landscape: every (system, object) cell of the data estate on one screen, and the strip that heads it.

GET /api/v1/landscape  the matrix of systems x objects with score, verdict, breaches and open work, plus the
                       one-sentence summary ("11 of 15 objects held under 85; fix MM014 and MM031 to release 2")
GET /api/v1/status     the status strip on its own

Both are cached 30 s per tenant in Redis (api/middleware/cache.py cached_json), keyed with the tenant, the inputs and
the tenant's latest run, and dropped at once when the tenant's work changes (mark_work_changed); the status strip
falls back to this process when Redis is down. Open work per cell is read from work_counts (migration 108).

Read-only and additive. Every number is read from what the run stored (analysis_versions.dqs_summary, findings,
work_counts, sync_runs) and scored by api/services/scoring.py; a value that is not stored is null, never estimated.
Every query carries the tenant id and runs after ``app.tenant_id`` is set (RLS).
"""
import re
import uuid
from collections import Counter
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.licence import get_cached_manifest
from api.routes.objects import (_label, _measured_dimensions, _version_summary, breach_ids, cap_level_of, measured_of,
                                records_checked_of, sort_by_measured)
from api.routes.record_issues import _rls
from api.middleware.cache import cached_json
from api.services import work_counts
from api.services.cost_model_meta import CostModelOut, meta_of as cost_model_meta
from api.services.rbac import require_permission
from api.services.run_context import latest_run
from api.services.scoring import critical_over_tolerance, readiness_status, scoring_config
from api.services.version_status import finished_sql
from checks.cost import effective as effective_cost_model

router = APIRouter(prefix="/api/v1", tags=["landscape"])

STATUS_TTL_SECONDS = 30.0
LANDSCAPE_TTL_SECONDS = 30
Verdict = Literal["no-go", "at-risk", "go"]
SystemState = Literal["analysed", "extracted", "not_extracted"]


class StatusStripOut(BaseModel):
    run_at: Optional[datetime] = None          # when the latest finished run started
    records_checked: Optional[int] = None      # driving-object records of that run's objects; null if it stored none
    rules_measured: Optional[int] = None       # rules that produced a result in that run
    scored_in_s: Optional[int] = None          # first analysis step started to last one finished
    cost_model: Optional[str] = None           # the currency the tenant's cost model prices in
    cost_model_source: Optional[str] = None    # "tenant" once the tenant saved a cost model, else "default"
    licence_valid_to: Optional[str] = None     # YYYY-MM-DD from the cached licence manifest
    sandbox: bool = False                      # the tenant is in sandbox mode: nothing leaves (migration 115)


class LandscapeSystemOut(BaseModel):
    id: str
    name: str
    system_type: str
    version: Optional[str] = None              # sap_systems.sap_release
    client: Optional[str] = None
    health_status: Optional[str] = None
    last_extracted_at: Optional[datetime] = None
    records: Optional[int] = None              # rows of the system's latest completed extraction, summed over profiles
    state: SystemState
    latest_run_id: Optional[str] = None
    # SAP refused the system's credentials: its last health check failed authentication, or its latest extraction or
    # configuration job failed on the sign-in (F20)
    sign_in_failed: bool = False


class NextStepOut(BaseModel):
    kind: Literal["fix_sign_in", "extract", "analyse", "open"]
    system_id: str
    system_name: str
    label: str
    href: str


class LandscapeObjectOut(BaseModel):
    module: str
    label: str


class LandscapeCellOut(BaseModel):
    system_id: str
    module: str
    run_id: str
    score: Optional[float] = None              # the score as capped by a critical failure (85 / 70)
    raw_score: Optional[float] = None
    # the measured score before the critical cap (raw_score, else score when nothing caps it): rank by this
    measured_score: Optional[float] = None
    capped: bool = False
    cap_level: Optional[int] = None
    breaches: list[str] = []
    verdict: Optional[Verdict] = None          # null when no rule was measured
    coverage: Optional[float] = None
    low_confidence: bool = False
    records_checked: Optional[int] = None
    rules_measured: Optional[int] = None
    open_work: Optional[int] = None            # null while the run's work list is not built
    dimensions: dict[str, float] = {}
    contract_breaches: int = 0                 # breaches of the active data contracts covering the cell (any enforce)
    enforced_contract_breaches: int = 0        # of those, breaches of enforced contracts
    policy_breaches: int = 0                   # applied policy-pack classes with a failing critical rule (113)


class LandscapeSentenceOut(BaseModel):
    held_under_85: int                         # objects a critical failure caps (their score stops at 85 or 70)
    objects: int
    critical_over_tolerance: int               # critical rules over tolerance, summed over the objects
    release_if_fixed: list[str]                # the two rules that cap the most objects
    released: int                              # objects whose only breaches are those rules


class LandscapeCountsOut(BaseModel):
    go: int
    at_risk: int
    no_go: int


class LandscapeOut(BaseModel):
    scope: Literal["current", "run"]
    run_id: Optional[str] = None
    sort: str = "position"                     # the order of ``cells``: position (system, object) or -measured/measured
    # whether money on this landscape is priced by the tenant's own cost model or by the shipped defaults
    cost_model: Optional[CostModelOut] = None
    status_strip: StatusStripOut
    systems: list[LandscapeSystemOut]
    objects: list[LandscapeObjectOut]
    cells: list[LandscapeCellOut]
    sentence: LandscapeSentenceOut
    counts: LandscapeCountsOut
    # SAP Basis's next step: fix a refused sign-in before extracting or analysing (api/services/sign_in.py)
    basis_next_step: Optional[NextStepOut] = None


async def build_status(db: AsyncSession, tenant: Tenant) -> StatusStripOut:
    """The status strip for the tenant's latest finished run. Caller has set ``app.tenant_id``."""
    t = str(tenant.id)
    run_id = await latest_run(db, tenant.id)
    trow = (await db.execute(text("SELECT cost_model, sandbox FROM tenants WHERE id = :t"), {"t": t})).fetchone()
    cost_model = trow[0] if trow else None
    currency = str(effective_cost_model(cost_model if isinstance(cost_model, dict) else None)["currency"])
    expiry = get_cached_manifest().get("expiry_date")
    valid_to = str(expiry)[:10] if expiry and re.match(r"\d{4}-\d{2}-\d{2}", str(expiry)) else None
    out = StatusStripOut(cost_model=currency, cost_model_source=cost_model_meta(cost_model)["source"],
                         licence_valid_to=valid_to, sandbox=bool(trow and trow[1]))
    if run_id is None:
        return out
    row = (await db.execute(text("SELECT run_at, dqs_summary FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                            {"v": run_id, "t": t})).fetchone()
    if row is None:
        return out
    summary = row[1] if isinstance(row[1], dict) else {}
    mods = [m for m in summary.values() if isinstance(m, dict)]
    records = [records_checked_of(m) for m in mods]
    rules = [m.get("total_checks") for m in mods if isinstance(m.get("total_checks"), int)]
    took = (await db.execute(text(
        "SELECT extract(epoch FROM max(finished_at) - min(started_at)) FROM analysis_run_steps "
        "WHERE version_id = :v AND tenant_id = :t AND finished_at IS NOT NULL"), {"v": run_id, "t": t})).scalar()
    out.run_at = row[0]
    out.records_checked = sum(r for r in records if r) if any(records) else None
    out.rules_measured = sum(rules) if rules else None
    out.scored_in_s = int(round(float(took))) if took is not None else None
    return out


CACHE_PREFIX = "work"  # keyed per tenant; bumped by api.middleware.cache.mark_work_changed on every work write


@router.get("/status", response_model=StatusStripOut, dependencies=[Depends(require_permission("view"))])
async def get_status(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The status strip (latest run, records and rules checked, time to score, cost model, licence), cached 30 s per
    tenant and latest run (Redis; in this process when Redis is down)."""
    await _rls(db, tenant)

    async def produce() -> dict:
        return (await build_status(db, tenant)).model_dump(mode="json")

    return await cached_json(CACHE_PREFIX, "status", tenant.id, {"latest": await latest_run(db, tenant.id)},
                             int(STATUS_TTL_SECONDS), produce, memo_fallback=True)


# The newest finished run of every (system, object): the run set of api/services/run_context.py (no archived or
# process-discovery runs), each object read from its own newest run, per system.
_CELL_RUNS_SQL = f"""
    SELECT DISTINCT ON (sid, module) sid, module, run_id FROM (
        SELECT av.id::text AS run_id, av.run_at, av.metadata->>'system_id' AS sid, k.module
          FROM analysis_versions av
         CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(av.dqs_summary) = 'object'
                                                   THEN av.dqs_summary ELSE '{{}}'::jsonb END) AS k(module)
         WHERE av.tenant_id = CAST(:t AS uuid) AND {finished_sql('av.status')}
           AND av.metadata->>'system_id' IS NOT NULL
           AND av.metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
           AND av.metadata->>'archived' IS DISTINCT FROM 'true'
    ) x ORDER BY sid, module, run_at DESC, run_id DESC"""

_SYSTEMS_SQL = """
    SELECT s.id::text AS id, s.name, s.system_type, s.sap_release, s.client, s.health_status,
           (SELECT max(sr.completed_at) FROM sync_runs sr JOIN sync_profiles sp ON sp.id = sr.profile_id
             WHERE sp.system_id = s.id AND sp.tenant_id = s.tenant_id AND sr.tenant_id = s.tenant_id
               AND sr.status = 'completed') AS last_extracted_at,
           (SELECT sum(x.rows_extracted) FROM sync_profiles sp
              CROSS JOIN LATERAL (SELECT sr.rows_extracted FROM sync_runs sr
                                   WHERE sr.profile_id = sp.id AND sr.tenant_id = s.tenant_id AND sr.status = 'completed'
                                   ORDER BY sr.completed_at DESC LIMIT 1) x
             WHERE sp.system_id = s.id AND sp.tenant_id = s.tenant_id) AS records
      FROM sap_systems s WHERE s.tenant_id = CAST(:t AS uuid) AND s.is_active ORDER BY s.name, s.id"""


def _verdict(score: Optional[float], mod_summary: dict, thresholds: dict) -> Optional[str]:
    if score is None:
        return None
    status = readiness_status(score, critical_over_tolerance(mod_summary), thresholds)
    return "at-risk" if status == "conditional" else status


def sentence_of(cells: list[dict]) -> dict:
    """The one-sentence summary over the matrix cells: the two critical rules in the most cells' breaches, and the
    cells whose breaches are all among those two."""
    tally = Counter(cid for c in cells for cid in set(c["breaches"]))
    top = [cid for cid, _n in sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))[:2]]
    return {
        "held_under_85": sum(1 for c in cells if c["capped"]),
        "objects": len(cells),
        "critical_over_tolerance": sum(c.get("critical_over_tolerance", len(c["breaches"])) for c in cells),
        "release_if_fixed": top,
        "released": sum(1 for c in cells if c["breaches"] and set(c["breaches"]) <= set(top)) if top else 0,
    }


LandscapeSort = Literal["position", "measured", "-measured"]


@router.get("/landscape", response_model=LandscapeOut, dependencies=[Depends(require_permission("view"))])
async def get_landscape(scope: Literal["current", "run"] = Query("current"),
                        run: Optional[uuid.UUID] = Query(None),
                        sort: LandscapeSort = Query("position", description="cells in matrix position (system, object), "
                                                    "or ranked by the measured score: -measured (highest first) "
                                                    "or measured"),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Systems x objects. ``scope=current``: each object at the newest finished run that measured it, per system.
    ``scope=run&run=<id>``: the cells of that one run (404 when it is not this tenant's). Cached 30 s per tenant,
    scope, run and the tenant's latest run; a change to the tenant's work invalidates it at once."""
    await _rls(db, tenant)
    if scope == "run" and run is None:
        raise HTTPException(422, "scope=run needs run=<run id>")
    if scope == "current" and run is not None:
        raise HTTPException(422, "run is only for scope=run")

    async def produce() -> dict:
        return LandscapeOut.model_validate(await _landscape(scope, run, db, tenant, sort)).model_dump(mode="json")

    return await cached_json(CACHE_PREFIX, "landscape", tenant.id,
                             {"scope": scope, "run": run, "sort": sort, "latest": await latest_run(db, tenant.id)},
                             LANDSCAPE_TTL_SECONDS, produce)


async def _landscape(scope: str, run: uuid.UUID | None, db: AsyncSession, tenant: Tenant,
                     sort: str = "position") -> dict:
    t = str(tenant.id)
    trow = (await db.execute(text("SELECT dqs_weights, cost_model FROM tenants WHERE id = :t"), {"t": t})).fetchone()
    thresholds = scoring_config((trow[0] if trow else None) or {})["thresholds"]

    systems = (await db.execute(text(_SYSTEMS_SQL), {"t": t})).mappings().all()
    known = {s["id"] for s in systems}

    # (system, module, run) triples and the summaries they are read from
    triples: list[tuple[str, str, str]] = []
    summaries: dict[str, dict] = {}
    if scope == "run":
        summary, _ = await _version_summary(db, tenant, str(run))
        sid = (await db.execute(text("SELECT metadata->>'system_id' FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                                {"v": str(run), "t": t})).scalar()
        summaries[str(run)] = summary
        triples = [(sid, m, str(run)) for m, v in sorted(summary.items()) if isinstance(v, dict)] if sid else []
    else:
        for r in (await db.execute(text(_CELL_RUNS_SQL), {"t": t})).mappings().all():
            triples.append((r["sid"], r["module"], r["run_id"]))
        run_ids = sorted({r for _s, _m, r in triples})
        if run_ids:
            for rid, summ in (await db.execute(text(
                    "SELECT id::text, dqs_summary FROM analysis_versions WHERE tenant_id = :t "
                    "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": t, "ids": run_ids})).fetchall():
                summaries[rid] = summ if isinstance(summ, dict) else {}
    triples = [(s, m, r) for s, m, r in triples if s in known and isinstance(summaries.get(r, {}).get(m), dict)]

    ids = sorted({r for _s, _m, r in triples})
    open_work: dict[tuple[str, str], int] = {}
    built: set[str] = set()
    widest: dict[tuple[str, str], int] = {}
    if ids:
        p = {"t": t, "ids": ids}
        built = {r[0] for r in (await db.execute(text(
            "SELECT id::text FROM analysis_versions WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[])) "
            "AND metadata ? 'worklist_built_at'"), p)).fetchall()}
        open_work = await work_counts.open_by_run_module(db, t, ids)  # pre-aggregated (migration 108)
        widest = {(r[0], r[1]): int(r[2]) for r in (await db.execute(text(
            "SELECT version_id::text, module, max(total_count) FROM findings WHERE tenant_id = :t "
            "AND version_id = ANY(CAST(:ids AS uuid[])) GROUP BY 1, 2"), p)).fetchall() if r[2]}

    from api.services import contract_enforcement as ce
    from api.services import policy_packs
    contracts = await ce.active(db, t)
    policy = await policy_packs.breaches(db, t, ids)
    cells: list[dict] = []
    for sid, module, rid in triples:
        m = summaries[rid][module]
        cb = ce.breaches_of(contracts, {module: m}, [module]) if contracts else []
        score = m.get("composite_score")
        cov = m.get("coverage")
        cells.append({
            "system_id": sid, "module": module, "run_id": rid, "score": score, "raw_score": m.get("raw_score"),
            "measured_score": measured_of(m),
            "capped": bool(m.get("capped")), "cap_level": cap_level_of(m), "breaches": breach_ids(m),
            "verdict": _verdict(score, m, thresholds),
            "coverage": cov if isinstance(cov, (int, float)) else None,
            "low_confidence": bool(m.get("low_confidence")),
            "records_checked": records_checked_of(m, widest.get((rid, module))),
            "rules_measured": m.get("total_checks") if isinstance(m.get("total_checks"), int) else None,
            "open_work": open_work.get((rid, module), 0) if rid in built else None,
            "dimensions": _measured_dimensions(m),
            "contract_breaches": len(cb), "enforced_contract_breaches": sum(1 for b in cb if b["enforce"]),
            "policy_breaches": len(policy.get((rid, module), [])),
            "critical_over_tolerance": critical_over_tolerance(m),  # for the sentence; not part of a cell
        })
    sentence = sentence_of(cells)
    by_system: dict[str, bool] = {c["system_id"]: True for c in cells}

    import asyncio

    from api.services import jobs as job_registry
    from api.services.sign_in import basis_next_step, failed_sign_ins
    refused = failed_sign_ins(await asyncio.to_thread(job_registry.list_jobs, t, limit=job_registry.INDEX_KEEP))
    out_systems = []
    for s in systems:
        latest = await latest_run(db, tenant.id, system_id=s["id"])
        state = ("analysed" if latest or by_system.get(s["id"]) else "extracted" if s["last_extracted_at"] else "not_extracted")
        out_systems.append({
            "id": s["id"], "name": s["name"], "system_type": s["system_type"], "version": s["sap_release"],
            "client": s["client"], "health_status": s["health_status"], "last_extracted_at": s["last_extracted_at"],
            "records": int(s["records"]) if s["records"] is not None else None,
            "state": state, "latest_run_id": latest,
            "sign_in_failed": s["health_status"] == "auth_failed" or s["id"] in refused})
    order = {s["id"]: i for i, s in enumerate(out_systems)}
    cells.sort(key=lambda c: (order[c["system_id"]], c["module"]))
    if sort != "position":
        cells = sort_by_measured(cells, descending=sort == "-measured")
    modules = sorted({c["module"] for c in cells})
    return {
        "scope": scope, "run_id": str(run) if run else None, "sort": sort,
        "cost_model": cost_model_meta(trow[1] if trow else None),
        "status_strip": await build_status(db, tenant),
        "systems": out_systems,
        "objects": [{"module": m, "label": _label(m)} for m in modules],
        "cells": cells,
        "sentence": {k: v for k, v in sentence.items()},
        "counts": {"go": sum(1 for c in cells if c["verdict"] == "go"),
                   "at_risk": sum(1 for c in cells if c["verdict"] == "at-risk"),
                   "no_go": sum(1 for c in cells if c["verdict"] == "no-go")},
        "basis_next_step": basis_next_step(out_systems),
    }
