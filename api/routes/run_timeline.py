"""The run timeline and the before/after summary of two runs.

GET /api/v1/runs/timeline?system_id=&limit=8   the last N finished runs of the scope, oldest first, each with its
                                               per-object scores, records checked, duration, baseline flag and job kind
GET /api/v1/runs/{a}/vs/{b}/summary            per object before and after, and the rules that started failing,
                                               were fixed, got worse or better (api/routes/versions.py rules)

Read-only and additive. Scores come from analysis_versions.dqs_summary exactly as stored (``score`` is the capped
composite, ``raw_score`` the measured score before the cap); durations from analysis_run_steps; the baseline is the run
pinned through POST /versions/{id}/baseline (``metadata.baseline``). A value that was not stored is null.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.objects import _label
from api.routes.record_issues import _rls
from api.routes.versions import CHANGE_MIN_PERCENT, CHANGE_MIN_RECORDS, _CHECK_CHANGES_SQL, _resolve_pair, change_kind
from api.services.rbac import require_permission
from api.services.receipt_math import records_checked_of
from api.services.version_status import finished_sql

router = APIRouter(prefix="/api/v1/runs", tags=["runs"], dependencies=[Depends(require_permission("view"))])


class TimelineObjectOut(BaseModel):
    score: Optional[float] = None          # the composite score, after the critical cap
    raw_score: Optional[float] = None      # the measured score before the cap
    capped: bool = False


class TimelineRunOut(BaseModel):
    id: str
    run_at: Optional[datetime] = None
    label: Optional[str] = None
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
    SELECT id::text AS id, run_at, label, metadata->>'system_id' AS system_id,
           COALESCE((metadata->>'baseline') = 'true', false) AS baseline,
           COALESCE(metadata->>'trigger', CASE WHEN metadata->>'system_id' IS NULL OR metadata->>'upload_path' IS NOT NULL THEN 'upload' END) AS kind,
           dqs_summary
      FROM analysis_versions
     WHERE tenant_id = CAST(:t AS uuid) AND {finished_sql()}
       AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
       AND metadata->>'archived' IS DISTINCT FROM 'true'
       AND (CAST(:sid AS text) IS NULL OR metadata->>'system_id' = CAST(:sid AS text))
     ORDER BY run_at DESC, id DESC LIMIT :n"""


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


@router.get("/timeline", response_model=TimelineOut)
async def timeline(system_id: Optional[uuid.UUID] = Query(None), limit: int = Query(8, ge=1, le=50),
                   db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The last ``limit`` finished runs of one system (or of every system), oldest first."""
    await _rls(db, tenant)
    t = str(tenant.id)
    rows = (await db.execute(text(_RUNS_SQL), {"t": t, "sid": str(system_id) if system_id else None, "n": limit})).mappings().all()
    ids = [r["id"] for r in rows]
    widest = await _widest(db, t, ids)
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
            "id": r["id"], "run_at": r["run_at"], "label": r["label"], "system_id": r["system_id"],
            "baseline": bool(r["baseline"]), "kind": r["kind"],
            "objects": {mod: {"score": m.get("composite_score"), "raw_score": m.get("raw_score"),
                              "capped": bool(m.get("capped"))}
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
