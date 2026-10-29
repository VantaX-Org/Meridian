"""The landscape: every (system, object) cell of the data estate on one screen, and the strip that heads it.

GET /api/v1/landscape  the matrix of systems x objects with score, verdict, breaches and open work, plus the
                       one-sentence summary ("11 of 15 objects held under 85; fix MM014 and MM031 to release 2")
GET /api/v1/status     the status strip on its own (cached 30 s per tenant, in process)

Read-only and additive. Every number is read from what the run stored (analysis_versions.dqs_summary, findings,
work_records, sync_runs) and scored by api/services/scoring.py; a value that is not stored is null, never estimated.
Every query carries the tenant id and runs after ``app.tenant_id`` is set (RLS).
"""
import re
import time
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
from api.routes.objects import _label, _measured_dimensions, _version_summary, breach_ids, cap_level_of, records_checked_of
from api.routes.record_issues import _rls
from api.services.rbac import require_permission
from api.services.run_context import latest_run
from api.services.scoring import critical_over_tolerance, readiness_status, scoring_config
from api.services.version_status import finished_sql
from checks.cost import effective as effective_cost_model

router = APIRouter(prefix="/api/v1", tags=["landscape"])

_OPEN_WORK = ("to_fix", "proposed", "approved", "sent")  # api/routes/work.py OPEN
STATUS_TTL_SECONDS = 30.0
Verdict = Literal["no-go", "at-risk", "go"]
SystemState = Literal["analysed", "extracted", "not_extracted"]


class StatusStripOut(BaseModel):
    run_at: Optional[datetime] = None          # when the latest finished run started
    records_checked: Optional[int] = None      # driving-object records of that run's objects; null if it stored none
    rules_measured: Optional[int] = None       # rules that produced a result in that run
    scored_in_s: Optional[int] = None          # first analysis step started to last one finished
    cost_model: Optional[str] = None           # the currency the tenant's cost model prices in
    licence_valid_to: Optional[str] = None     # YYYY-MM-DD from the cached licence manifest


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


class LandscapeObjectOut(BaseModel):
    module: str
    label: str


class LandscapeCellOut(BaseModel):
    system_id: str
    module: str
    run_id: str
    score: Optional[float] = None
    raw_score: Optional[float] = None
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
    status_strip: StatusStripOut
    systems: list[LandscapeSystemOut]
    objects: list[LandscapeObjectOut]
    cells: list[LandscapeCellOut]
    sentence: LandscapeSentenceOut
    counts: LandscapeCountsOut


async def build_status(db: AsyncSession, tenant: Tenant) -> StatusStripOut:
    """The status strip for the tenant's latest finished run. Caller has set ``app.tenant_id``."""
    t = str(tenant.id)
    run_id = await latest_run(db, tenant.id)
    cost_model = (await db.execute(text("SELECT cost_model FROM tenants WHERE id = :t"), {"t": t})).scalar()
    currency = str(effective_cost_model(cost_model if isinstance(cost_model, dict) else None)["currency"])
    expiry = get_cached_manifest().get("expiry_date")
    valid_to = str(expiry)[:10] if expiry and re.match(r"\d{4}-\d{2}-\d{2}", str(expiry)) else None
    out = StatusStripOut(cost_model=currency, licence_valid_to=valid_to)
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


_STATUS_CACHE: dict[str, tuple[float, StatusStripOut]] = {}


@router.get("/status", response_model=StatusStripOut, dependencies=[Depends(require_permission("view"))])
async def get_status(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The status strip (latest run, records and rules checked, time to score, cost model, licence), cached 30 s per tenant."""
    key = str(tenant.id)
    hit = _STATUS_CACHE.get(key)
    if hit and time.monotonic() - hit[0] < STATUS_TTL_SECONDS:
        return hit[1]
    await _rls(db, tenant)
    strip = await build_status(db, tenant)
    _STATUS_CACHE[key] = (time.monotonic(), strip)
    return strip


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
        "critical_over_tolerance": sum(c["critical_over_tolerance"] for c in cells),
        "release_if_fixed": top,
        "released": sum(1 for c in cells if c["breaches"] and set(c["breaches"]) <= set(top)) if top else 0,
    }


@router.get("/landscape", response_model=LandscapeOut, dependencies=[Depends(require_permission("view"))])
async def get_landscape(scope: Literal["current", "run"] = Query("current"),
                        run: Optional[uuid.UUID] = Query(None),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Systems x objects. ``scope=current``: each object at the newest finished run that measured it, per system.
    ``scope=run&run=<id>``: the cells of that one run (404 when it is not this tenant's)."""
    await _rls(db, tenant)
    t = str(tenant.id)
    if scope == "run" and run is None:
        raise HTTPException(422, "scope=run needs run=<run id>")
    if scope == "current" and run is not None:
        raise HTTPException(422, "run is only for scope=run")
    thresholds = scoring_config((await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"),
                                                  {"t": t})).scalar() or {})["thresholds"]

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
        open_work = {(r[0], r[1]): int(r[2]) for r in (await db.execute(text(
            "SELECT version_id::text, module, count(*) FROM work_records WHERE tenant_id = :t "
            "AND version_id = ANY(CAST(:ids AS uuid[])) AND status = ANY(:open) GROUP BY 1, 2"),
            {**p, "open": list(_OPEN_WORK)})).fetchall()}
        widest = {(r[0], r[1]): int(r[2]) for r in (await db.execute(text(
            "SELECT version_id::text, module, max(total_count) FROM findings WHERE tenant_id = :t "
            "AND version_id = ANY(CAST(:ids AS uuid[])) GROUP BY 1, 2"), p)).fetchall() if r[2]}

    cells: list[dict] = []
    for sid, module, rid in triples:
        m = summaries[rid][module]
        score = m.get("composite_score")
        cov = m.get("coverage")
        cells.append({
            "system_id": sid, "module": module, "run_id": rid, "score": score, "raw_score": m.get("raw_score"),
            "capped": bool(m.get("capped")), "cap_level": cap_level_of(m), "breaches": breach_ids(m),
            "verdict": _verdict(score, m, thresholds),
            "coverage": cov if isinstance(cov, (int, float)) else None,
            "low_confidence": bool(m.get("low_confidence")),
            "records_checked": records_checked_of(m, widest.get((rid, module))),
            "rules_measured": m.get("total_checks") if isinstance(m.get("total_checks"), int) else None,
            "open_work": open_work.get((rid, module), 0) if rid in built else None,
            "dimensions": _measured_dimensions(m),
            "critical_over_tolerance": critical_over_tolerance(m),  # for the sentence; not part of a cell
        })
    sentence = sentence_of(cells)
    by_system: dict[str, bool] = {c["system_id"]: True for c in cells}

    out_systems = []
    for s in systems:
        latest = await latest_run(db, tenant.id, system_id=s["id"])
        state = ("analysed" if latest or by_system.get(s["id"]) else "extracted" if s["last_extracted_at"] else "not_extracted")
        out_systems.append({
            "id": s["id"], "name": s["name"], "system_type": s["system_type"], "version": s["sap_release"],
            "client": s["client"], "health_status": s["health_status"], "last_extracted_at": s["last_extracted_at"],
            "records": int(s["records"]) if s["records"] is not None else None,
            "state": state, "latest_run_id": latest})
    order = {s["id"]: i for i, s in enumerate(out_systems)}
    cells.sort(key=lambda c: (order[c["system_id"]], c["module"]))
    modules = sorted({c["module"] for c in cells})
    return {
        "scope": scope, "run_id": str(run) if run else None,
        "status_strip": await build_status(db, tenant),
        "systems": out_systems,
        "objects": [{"module": m, "label": _label(m)} for m in modules],
        "cells": cells,
        "sentence": {k: v for k, v in sentence.items()},
        "counts": {"go": sum(1 for c in cells if c["verdict"] == "go"),
                   "at_risk": sum(1 for c in cells if c["verdict"] == "at-risk"),
                   "no_go": sum(1 for c in cells if c["verdict"] == "no-go")},
    }
