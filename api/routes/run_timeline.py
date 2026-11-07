"""The run timeline and the before/after summary of two runs.

GET /api/v1/runs/timeline?system_id=&module=&limit=8  the last N finished runs of the scope (of the runs that
                                               scored ``module`` when given), oldest first, each with its
                                               run number, status, per-object scores, findings and value at risk,
                                               records checked, duration, baseline flag and job kind
GET /api/v1/runs/rule-trend?system_id=&limit=8  failing records of every rule across the last N finished runs of one
                                               system, oldest first; null where the rule did not run in that run
GET /api/v1/runs/{a}/vs/{b}/summary            per object before and after, and the rules that started failing,
                                               were fixed, got worse or better (api/routes/versions.py rules)
GET /api/v1/runs/{a}/vs/{b}/score-delta        one object's score change split into points per rule and dimension
                                               (api/services/score_delta.py), with a verified narrative

Read-only and additive. Scores come from analysis_versions.dqs_summary exactly as stored (``score`` is the capped
composite, ``raw_score`` the measured score before the cap); durations from analysis_run_steps; the baseline is the run
pinned through POST /versions/{id}/baseline (``metadata.baseline``). A value that was not stored is null.

Per object, ``findings_open`` is the failing records summed over the run's rules (findings.affected_count, rules that
errored left out). ``findings_new`` and ``findings_closed`` compare each rule with the same object in the previous
finished run of the same system: the rise and the fall in failing records, summed per rule. Findings do not store
record identities, so a record that moves from one rule to another counts as both; both are null for a system's first
run and when the previous run did not measure the object. ``value_at_risk`` is the sum of the findings' cost at risk in
the tenant's cost-model currency (the object receipt's figure); null when no finding was priced, never estimated.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.deps import Tenant, get_db, get_tenant
from api.routes.objects import _label
from api.routes.record_issues import _rls
from api.routes.versions import CHANGE_MIN_PERCENT, CHANGE_MIN_RECORDS, _CHECK_CHANGES_SQL, _resolve_pair, change_kind
from api.services.rbac import require_permission
from api.services.receipt_math import records_checked_of, rule_names
from api.services.version_status import finished_sql
from checks.cost import effective as effective_cost_model

router = APIRouter(prefix="/api/v1/runs", tags=["runs"], dependencies=[Depends(require_permission("view"))])


class MoneyOut(BaseModel):
    amount: float
    currency: str                          # the tenant's cost model currency


class TimelineObjectOut(BaseModel):
    score: Optional[float] = None          # the composite score, after the critical cap
    raw_score: Optional[float] = None      # the measured score before the cap
    capped: bool = False
    findings_open: Optional[int] = None    # failing records over the object's rules in this run; null: no findings stored
    findings_new: Optional[int] = None     # rise in failing records since the previous run of the system; null: none to compare
    findings_closed: Optional[int] = None  # fall in failing records since the previous run of the system
    value_at_risk: Optional[MoneyOut] = None  # null when no finding was priced


class TimelineRunOut(BaseModel):
    id: str
    run_at: Optional[datetime] = None
    label: Optional[str] = None
    run_number: Optional[int] = None       # 1-based within the system's lineage; null for runs that never got one
    status: str                            # the stored run status (complete, agents_complete, ...)
    system_id: Optional[str] = None
    baseline: bool                         # the run pinned as its lineage's comparison baseline
    kind: Optional[str] = None             # scheduled | manual | recheck | upload; null for runs from before it was stamped
    objects: dict[str, TimelineObjectOut]
    records_checked: Optional[int] = None  # driving-object records over the run's objects; null if it stored none
    duration_s: Optional[int] = None       # first analysis step started to last one finished; null without steps


class TimelineOut(BaseModel):
    system_id: Optional[str] = None
    limit: int
    runs: list[TimelineRunOut]             # oldest first


_RUNS_SQL = f"""
    SELECT id::text AS id, run_at, label, run_number, status, metadata->>'system_id' AS system_id,
           COALESCE((metadata->>'baseline') = 'true', false) AS baseline,
           COALESCE(metadata->>'trigger', CASE WHEN metadata->>'system_id' IS NULL OR metadata->>'upload_path' IS NOT NULL THEN 'upload' END) AS kind,
           dqs_summary,
           (SELECT p.id::text FROM analysis_versions p
             WHERE p.tenant_id = av.tenant_id AND {finished_sql('p.status')}
               AND p.metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
               AND p.metadata->>'archived' IS DISTINCT FROM 'true'
               AND p.metadata->>'system_id' = av.metadata->>'system_id'
               AND (p.run_at, p.id) < (av.run_at, av.id)
             ORDER BY p.run_at DESC, p.id DESC LIMIT 1) AS prev_id
      FROM analysis_versions av
     WHERE tenant_id = CAST(:t AS uuid) AND {finished_sql()}
       AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
       AND metadata->>'archived' IS DISTINCT FROM 'true'
       AND (CAST(:sid AS text) IS NULL OR metadata->>'system_id' = CAST(:sid AS text))
       AND (CAST(:mod AS text) IS NULL OR (dqs_summary -> CAST(:mod AS text)) IS NOT NULL)
     ORDER BY run_at DESC, id DESC LIMIT :n"""

# failing records and priced cost per (run, object, rule), for the listed runs and the runs before them
_FINDINGS_SQL = """
    SELECT version_id::text, module, check_id, affected_count, cost_at_risk FROM findings
     WHERE tenant_id = CAST(:t AS uuid) AND version_id = ANY(CAST(:ids AS uuid[])) AND details->>'error' IS NULL"""


def findings_delta(cur: dict[str, int], prev: Optional[dict[str, int]]) -> tuple[Optional[int], Optional[int]]:
    """(new, closed) failing records between two runs of one object, per rule (rule -> failing records); (None, None)
    when there is no previous run of the object to compare with."""
    if prev is None:
        return None, None
    rules = cur.keys() | prev.keys()
    return (sum(max(0, cur.get(c, 0) - prev.get(c, 0)) for c in rules),
            sum(max(0, prev.get(c, 0) - cur.get(c, 0)) for c in rules))


async def _widest(db: AsyncSession, t: str, ids: list[str]) -> dict[tuple[str, str], int]:
    """(run, module) -> the largest rule population among its findings (the fallback for records checked)."""
    if not ids:
        return {}
    return {(r[0], r[1]): int(r[2]) for r in (await db.execute(text(
        "SELECT version_id::text, module, max(total_count) FROM findings WHERE tenant_id = CAST(:t AS uuid) "
        "AND version_id = ANY(CAST(:ids AS uuid[])) GROUP BY 1, 2"), {"t": t, "ids": ids})).fetchall() if r[2]}


def _records(summary: dict, run: str, widest: dict[tuple[str, str], int]) -> Optional[int]:
    got = [records_checked_of(m, widest.get((run, mod))) for mod, m in summary.items() if isinstance(m, dict)]
    return sum(g for g in got if g) if any(got) else None


def _object(m: dict, run, mod: str, fails: dict, cost: dict, currency: str) -> dict:
    cur = fails.get((run["id"], mod))
    new, closed = findings_delta(cur, fails.get((run["prev_id"], mod))) if cur is not None else (None, None)
    return {"score": m.get("composite_score"), "raw_score": m.get("raw_score"), "capped": bool(m.get("capped")),
            "findings_open": sum(cur.values()) if cur is not None else None, "findings_new": new, "findings_closed": closed,
            "value_at_risk": {"amount": cost[(run["id"], mod)], "currency": currency} if (run["id"], mod) in cost else None}


@router.get("/timeline", response_model=TimelineOut)
async def timeline(system_id: Optional[uuid.UUID] = Query(None), module: Optional[str] = Query(None, max_length=64),
                   limit: int = Query(8, ge=1, le=50),
                   db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The last ``limit`` finished runs of one system (or of every system), oldest first. With ``module`` the limit
    counts only runs that scored that object, so an object last run long ago still has its runs."""
    await _rls(db, tenant)
    t = str(tenant.id)
    rows = (await db.execute(text(_RUNS_SQL), {"t": t, "sid": str(system_id) if system_id else None, "mod": module, "n": limit})).mappings().all()
    ids = [r["id"] for r in rows]
    widest = await _widest(db, t, ids)
    currency = str(effective_cost_model((await db.execute(text("SELECT cost_model FROM tenants WHERE id = CAST(:t AS uuid)"),
                                                           {"t": t})).scalar())["currency"])
    # (run, object) -> {rule: failing records}, and (run, object) -> summed cost at risk (None when nothing was priced)
    fails: dict[tuple[str, str], dict[str, int]] = {}
    cost: dict[tuple[str, str], float] = {}
    needed = sorted(set(ids) | {r["prev_id"] for r in rows if r["prev_id"]})
    for vid, mod, check, n, c in (await db.execute(text(_FINDINGS_SQL), {"t": t, "ids": needed})).fetchall() if needed else []:
        fails.setdefault((vid, mod), {})[check] = int(n or 0)
        if c is not None and (n or 0) > 0:
            cost[(vid, mod)] = cost.get((vid, mod), 0.0) + float(c)
    took: dict[str, int] = {}
    if ids:
        took = {r[0]: int(round(float(r[1]))) for r in (await db.execute(text(
            "SELECT version_id::text, extract(epoch FROM max(finished_at) - min(started_at)) FROM analysis_run_steps "
            "WHERE tenant_id = CAST(:t AS uuid) AND version_id = ANY(CAST(:ids AS uuid[])) AND finished_at IS NOT NULL "
            "GROUP BY 1"), {"t": t, "ids": ids})).fetchall() if r[1] is not None}
    runs = []
    for r in reversed(rows):
        summary = r["dqs_summary"] if isinstance(r["dqs_summary"], dict) else {}
        runs.append({
            "id": r["id"], "run_at": r["run_at"], "label": r["label"], "run_number": r["run_number"],
            "status": r["status"], "system_id": r["system_id"],
            "baseline": bool(r["baseline"]), "kind": r["kind"],
            "objects": {mod: _object(m, r, mod, fails, cost, currency)
                        for mod, m in sorted(summary.items()) if isinstance(m, dict)},
            "records_checked": _records(summary, r["id"], widest), "duration_s": took.get(r["id"]),
        })
    return {"system_id": str(system_id) if system_id else None, "limit": limit, "runs": runs}


# ── before / after ───────────────────────────────────────────────────────────


class SideOut(BaseModel):
    score: Optional[float] = None
    raw_score: Optional[float] = None
    capped: bool = False
    records_checked: Optional[int] = None
    coverage: Optional[float] = None


class CompareObjectOut(BaseModel):
    module: str
    label: str
    before: Optional[SideOut] = None       # null: the run did not measure this object
    after: Optional[SideOut] = None
    score_change: Optional[float] = None   # after - before, one decimal; null unless both have a score
    newly_failing: int = 0                 # rules that failed no records before and fail some now
    fixed: int = 0                         # rules that failed records before and fail none now
    worse: int = 0                         # failing in both, materially more records now
    better: int = 0                        # failing in both, materially fewer records now


class CompareRunOut(BaseModel):
    id: str
    run_at: Optional[datetime] = None
    label: Optional[str] = None


class CompareTotalsOut(BaseModel):
    records_checked_before: Optional[int] = None
    records_checked_after: Optional[int] = None
    newly_failing: int
    fixed: int
    worse: int
    better: int
    rules_compared: int                    # rules that ran cleanly in both runs
    rules_added: int                       # in the after run only
    rules_dropped: int                     # in the before run only


class CompareOut(BaseModel):
    a: CompareRunOut
    b: CompareRunOut
    objects: list[CompareObjectOut]
    totals: CompareTotalsOut
    method: str


def _side(summary: dict, mod: str, run: str, widest: dict) -> Optional[dict]:
    m = summary.get(mod)
    if not isinstance(m, dict):
        return None
    cov = m.get("coverage")
    return {"score": m.get("composite_score"), "raw_score": m.get("raw_score"), "capped": bool(m.get("capped")),
            "records_checked": records_checked_of(m, widest.get((run, mod))),
            "coverage": cov if isinstance(cov, (int, float)) else None}


class RuleTrendRunOut(BaseModel):
    id: str
    run_at: Optional[datetime] = None
    run_number: Optional[int] = None


class RuleTrendRowOut(BaseModel):
    module: str
    check_id: str
    failing: list[Optional[int]]           # one per run, in the order of ``runs``; null: the rule did not run cleanly


class RuleTrendOut(BaseModel):
    system_id: str
    runs: list[RuleTrendRunOut]            # oldest first
    rules: list[RuleTrendRowOut]


def rule_series(ids: list[str], found: list[tuple]) -> list[dict]:
    """Per (module, rule) its failing records in each run of ``ids``, from (run, module, rule, failing, ...) rows."""
    at = {vid: i for i, vid in enumerate(ids)}
    series: dict[tuple[str, str], list[Optional[int]]] = {}
    for vid, mod, check, n, *_ in found:
        series.setdefault((mod, check), [None] * len(ids))[at[vid]] = int(n or 0)
    return [{"module": m, "check_id": c, "failing": v} for (m, c), v in sorted(series.items())]


@router.get("/rule-trend", response_model=RuleTrendOut)
async def rule_trend(system_id: uuid.UUID = Query(...), limit: int = Query(8, ge=1, le=50),
                     db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Every rule's failing records across the last ``limit`` finished runs of one system, oldest first. One system
    only, because a rule's counts from two systems are not one trend."""
    await _rls(db, tenant)
    t = str(tenant.id)
    rows = (await db.execute(text(_RUNS_SQL), {"t": t, "sid": str(system_id), "mod": None, "n": limit})).mappings().all()
    runs = list(reversed(rows))
    ids = [r["id"] for r in runs]
    found = (await db.execute(text(_FINDINGS_SQL), {"t": t, "ids": ids})).fetchall() if ids else []
    return {"system_id": str(system_id), "rules": rule_series(ids, found),
            "runs": [{"id": r["id"], "run_at": r["run_at"], "run_number": r["run_number"]} for r in runs]}


@router.get("/{a}/vs/{b}/summary", response_model=CompareOut)
async def compare_summary(a: uuid.UUID, b: uuid.UUID, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)):
    """Run ``b`` (after) against run ``a`` (before): per object the score, raw score, records checked and coverage on
    each side, and the counts of rules newly failing, fixed, worse and better. 404 for a run that is not this tenant's,
    400 for runs of two different systems."""
    await _rls(db, tenant)
    t = str(tenant.id)
    owned = (await db.execute(text("SELECT count(*) FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) "
                                   "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": t, "ids": sorted({str(a), str(b)})})).scalar()
    if owned != len({a, b}):  # also keeps another tenant's run from being compared when RLS is not the only guard
        raise HTTPException(status_code=404, detail="One or both runs not found")
    vid_a, vid_b = await _resolve_pair(db, str(a), str(b))
    heads = {r["id"]: r for r in (await db.execute(text(
        "SELECT id::text AS id, run_at, label, dqs_summary, COALESCE((metadata->>'baseline') = 'true', false) AS baseline "
        "FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) "
        "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": t, "ids": [str(vid_a), str(vid_b)]})).mappings().all()}
    if str(vid_a) not in heads or str(vid_b) not in heads:
        raise HTTPException(status_code=404, detail="One or both runs not found")
    ha, hb = heads[str(vid_a)], heads[str(vid_b)]
    sa = ha["dqs_summary"] if isinstance(ha["dqs_summary"], dict) else {}
    sb = hb["dqs_summary"] if isinstance(hb["dqs_summary"], dict) else {}
    widest = await _widest(db, t, [str(vid_a), str(vid_b)])

    changes = (await db.execute(text(_CHECK_CHANGES_SQL), {
        "v1": vid_a, "v2": vid_b, "tid": t, "module": None,
        "min_records": CHANGE_MIN_RECORDS, "min_percent": CHANGE_MIN_PERCENT})).fetchall()
    counts: dict[str, dict[str, int]] = {}
    for r in changes:
        kind = change_kind(r.v1_affected, r.v2_affected)
        if kind is not None:
            counts.setdefault(r.module, {"newly_failing": 0, "fixed": 0, "worse": 0, "better": 0})[kind] += 1

    sets: dict[str, set[str]] = {}
    for vid in (str(vid_a), str(vid_b)):
        sets[vid] = {r[0] for r in (await db.execute(text(
            "SELECT DISTINCT check_id FROM findings WHERE version_id = CAST(:v AS uuid) AND tenant_id = CAST(:t AS uuid) "
            "AND details->>'error' IS NULL"), {"v": vid, "t": t})).fetchall()}
    common = sets[str(vid_a)] & sets[str(vid_b)]
    added, dropped = len(sets[str(vid_b)] - sets[str(vid_a)]), len(sets[str(vid_a)] - sets[str(vid_b)])

    modules = sorted({m for m, v in sa.items() if isinstance(v, dict)} | {m for m, v in sb.items() if isinstance(v, dict)}
                     | set(counts))
    objects = []
    for mod in modules:
        before, after = _side(sa, mod, str(vid_a), widest), _side(sb, mod, str(vid_b), widest)
        change = (round(after["score"] - before["score"], 1)
                  if before and after and before["score"] is not None and after["score"] is not None else None)
        objects.append({"module": mod, "label": _label(mod), "before": before, "after": after, "score_change": change,
                        **counts.get(mod, {"newly_failing": 0, "fixed": 0, "worse": 0, "better": 0})})

    def total(side: str) -> Optional[int]:
        vals = [o[side]["records_checked"] for o in objects if o[side] and o[side]["records_checked"]]
        return sum(vals) if vals else None

    sums = {k: sum(o[k] for o in objects) for k in ("newly_failing", "fixed", "worse", "better")}
    since = ("the baseline" if ha["baseline"] else "the earlier run") + (ha["run_at"].strftime(" of %-d %b %Y") if ha["run_at"] else "")
    plural = lambda n, word: f"{n} {word}" if n == 1 else f"{n} {word}s"  # noqa: E731
    method = (f"Rules are compared on the common set: the {plural(len(common), 'rule')} that ran cleanly in both runs. "
              + (f"{plural(added, 'rule')} added since {since} {'is' if added == 1 else 'are'} excluded. " if added
                 else f"No rules were added since {since}. ")
              + (f"{plural(dropped, 'rule')} that ran before but not now {'is' if dropped == 1 else 'are'} excluded. " if dropped else "")
              + f"A rule counts as changed when it flips between failing no records and some, or fails at least "
                f"{CHANGE_MIN_PERCENT}% and {CHANGE_MIN_RECORDS} records more or fewer.")
    return {
        "a": {"id": str(vid_a), "run_at": ha["run_at"], "label": ha["label"]},
        "b": {"id": str(vid_b), "run_at": hb["run_at"], "label": hb["label"]},
        "objects": objects,
        "totals": {"records_checked_before": total("before"), "records_checked_after": total("after"), **sums,
                   "rules_compared": len(common), "rules_added": added, "rules_dropped": dropped},
        "method": method,
    }


# ── why the score moved: points per rule ─────────────────────────────────────


class ContributionOut(BaseModel):
    kind: str                              # failing_records | record_count | new_rule | removed_rule | reweighting | unexplained | cap
    check_id: Optional[str] = None
    description: Optional[str] = None      # the rule's title
    dimension: Optional[str] = None
    severity: Optional[str] = None
    points: float                          # change in composite points
    before_failing: Optional[int] = None
    after_failing: Optional[int] = None
    before_records: Optional[int] = None
    after_records: Optional[int] = None


class DimensionDeltaOut(BaseModel):
    dimension: str
    points: float


class NarrativeOut(BaseModel):
    source: str                            # ai | template
    sentences: list[str]
    dropped: int = 0                       # model sentences removed because a number was not in the decomposition


class ScoreDeltaOut(BaseModel):
    module: str
    label: str
    before: float
    after: float
    delta: float                           # stored composite after minus before
    contributions: list[ContributionOut]   # largest first; they sum to delta within ``tolerance``
    by_dimension: list[DimensionDeltaOut]
    sum: float
    residual: float
    tolerance: float
    within_tolerance: bool
    reproduced: bool                       # the findings recompute the stored measured-score change
    narrative: NarrativeOut


@router.get("/{a}/vs/{b}/score-delta", response_model=ScoreDeltaOut)
async def score_delta(a: uuid.UUID, b: uuid.UUID, module: str = Query(..., min_length=1, max_length=64),
                      narrative: bool = Query(True, description="false: skip the model, template sentences only"),
                      db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Run ``b`` against run ``a`` for one object: the composite score change as points per rule, per DAMA dimension and
    for the critical cap. 404 when a run is not this tenant's or the object has no score in both; the model, when
    configured, sees only rule id, title, dimension and points."""
    from api.services import score_delta as sd
    await _rls(db, tenant)
    t = str(tenant.id)
    heads = {r["id"]: r["dqs_summary"] for r in (await db.execute(text(
        "SELECT id::text AS id, dqs_summary FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) "
        "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": t, "ids": sorted({str(a), str(b)})})).mappings().all()}
    if len(heads) != len({a, b}):
        raise HTTPException(status_code=404, detail="One or both runs not found")
    sums = [(heads[str(v)] or {}).get(module) for v in (a, b)]
    if not all(isinstance(s, dict) for s in sums):
        raise HTTPException(status_code=404, detail="The object has no score in one of these runs")
    rows = []
    for v in (a, b):
        rows.append([dict(r) for r in (await db.execute(text(
            "SELECT check_id, severity, dimension, affected_count, total_count, COALESCE(pass_rate, 100) AS pass_rate "
            "FROM findings WHERE tenant_id = CAST(:t AS uuid) AND version_id = CAST(:v AS uuid) AND module = :m "
            "AND finding_type = 'rule' AND details->>'error' IS NULL"), {"t": t, "v": str(v), "m": module})).mappings().all()])
    raw_scoring = (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = CAST(:t AS uuid)"), {"t": t})).scalar() or {}
    d = sd.decompose(rows[0], rows[1], sums[0], sums[1], raw_scoring)
    if d is None:
        raise HTTPException(status_code=404, detail="The object has no score in one of these runs")
    label = _label(module)
    names = await rule_names(db, tenant, sorted({c["check_id"] for c in d["contributions"] if c["check_id"]}))
    generated = (await run_in_threadpool(sd.ai_sentences, sd.top_facts(d, names), label, d["before"], d["after"])
                 if narrative else None)
    return {"module": module, "label": label, "before": d["before"], "after": d["after"], "delta": d["delta"],
            "contributions": [{**c, "description": names.get(c["check_id"] or "")} for c in d["contributions"]],
            "by_dimension": d["by_dimension"], "sum": d["sum"], "residual": d["residual"], "tolerance": sd.SUM_TOLERANCE,
            "within_tolerance": d["within_tolerance"], "reproduced": d["reproduced"],
            "narrative": sd.narrative(d, names, label, generated)}
