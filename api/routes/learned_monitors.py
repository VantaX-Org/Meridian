"""Learned monitors: breaks from the baseline Meridian learns from its own run history (api/services/learned_monitors.py).

GET lists the latest run's breaks with the baseline each used and, per object, how many earlier runs it has (an object
under the minimum is "learning" and raises nothing). Stewards acknowledge, mark expected (exclude the run from later
baselines, or accept it as the new normal) or snooze a break; each is audited. Explain asks the model for a wording of
the figures; only sentences whose numbers are in the figures are kept, else the deterministic text stands.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.mining import field_text
from api.routes.record_issues import _rls
from api.services import learned_monitors as lm
from api.services.receipt_math import rule_names
from api.services.version_status import finished_sql
from api.services.rbac import current_user_label, require_permission, write_audit

router = APIRouter(prefix="/api/v1/aletheia/monitors", tags=["aletheia"])

COLS = """b.id::text, b.version_id::text, v.run_number, b.module, b.kind, b.metric, b.subject_code, b.severity,
          b.expected_low, b.expected_high, b.median, b.observed, b.baseline_runs, b.baseline_run_ids, b.method,
          b.status, b.baseline_effect, b.snoozed_until, b.decided_by, b.decided_at, b.note, b.explanation,
          b.detected_at, v.run_at"""


class Citation(BaseModel):
    run_id: str
    run_number: Optional[int] = None
    run_at: Optional[str] = None
    role: Literal["baseline", "current"]


class Explanation(BaseModel):
    source: Literal["ai", "template"]
    sentences: list[str]
    dropped: int = 0


class BreakOut(BaseModel):
    id: str
    version_id: str
    run_number: Optional[int] = None
    module: str
    kind: Literal["volume_drop", "volume_spike", "fail_rate_jump", "score_drop", "field_emptied"]
    metric: Literal["records", "score", "fail_rate", "blank_pct"]
    subject_code: str
    subject_description: Optional[str] = None
    severity: Literal["critical", "high", "medium", "low"]
    expected_low: Optional[float] = None
    expected_high: Optional[float] = None
    median: Optional[float] = None
    observed: float
    baseline_runs: int
    method: str
    status: Literal["open", "acknowledged", "expected", "snoozed"]
    baseline_effect: Optional[Literal["exclude", "accept"]] = None
    snoozed_until: Optional[str] = None
    decided_by: Optional[str] = None
    decided_at: Optional[str] = None
    note: Optional[str] = None
    explanation: Explanation
    citations: list[Citation]
    detected_at: str


class Coverage(BaseModel):
    module: str
    run_id: str
    run_number: Optional[int] = None
    baseline_runs: int
    min_runs: int
    state: Literal["learning", "active"]
    breaks: int


class MonitorsOut(BaseModel):
    min_runs: int
    history: int
    coverage: list[Coverage]
    breaks: list[BreakOut]


def _iso(x) -> Optional[str]:
    return x.isoformat() if x else None


async def _shape(db: AsyncSession, tenant: Tenant, rows) -> list[BreakOut]:
    """Rows of COLS as BreakOut: rule and field text, the explanation (cached or deterministic), the run citations."""
    if not rows:
        return []
    ids = {r[1] for r in rows} | {i for r in rows for i in (r[13] or [])}
    runs = {r[0]: (r[1], r[2]) for r in (await db.execute(text(
        "SELECT id::text, run_number, run_at FROM analysis_versions WHERE tenant_id = :t "
        "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": str(tenant.id), "ids": sorted(ids)})).fetchall()}
    names = await rule_names(db, tenant, sorted({r[6] for r in rows if r[5] == "fail_rate"}))
    now = datetime.now(timezone.utc)
    out = []
    for r in rows:
        desc = names.get(r[6]) if r[5] == "fail_rate" else field_text(r[6], r[3]) if r[5] == "blank_pct" else None
        b = {"kind": r[4], "metric": r[5], "subject_code": r[6], "expected_low": r[8], "expected_high": r[9],
             "median": r[10], "observed": r[11], "baseline_runs": r[12], "method": r[14]}
        exp = r[21] or lm.explanation(lm.facts(b, desc), None)
        cites = [Citation(run_id=i, run_number=runs.get(i, (None, None))[0], run_at=_iso(runs.get(i, (None, None))[1]),
                          role="baseline") for i in (r[13] or [])]
        cites.append(Citation(run_id=r[1], run_number=r[2], run_at=_iso(r[23]), role="current"))
        status = "open" if r[15] == "snoozed" and r[17] and r[17] <= now else r[15]
        out.append(BreakOut(id=r[0], version_id=r[1], run_number=r[2], module=r[3], kind=r[4], metric=r[5],
                            subject_code=r[6], subject_description=desc, severity=r[7], expected_low=r[8],
                            expected_high=r[9], median=r[10], observed=r[11], baseline_runs=r[12], method=r[14],
                            status=status, baseline_effect=r[16], snoozed_until=_iso(r[17]), decided_by=r[18],
                            decided_at=_iso(r[19]), note=r[20], explanation=Explanation(**exp), citations=cites,
                            detected_at=_iso(r[22]) or ""))
    return out


@router.get("", response_model=MonitorsOut, dependencies=[Depends(require_permission("view"))])
async def monitors(version_id: Optional[uuid.UUID] = None, limit: int = Query(300, ge=1, le=1000),
                   db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> MonitorsOut:
    """The latest finished run's breaks (or ``version_id``'s), and per object the earlier runs its baseline has."""
    await _rls(db, tenant)
    t = str(tenant.id)
    run = (await db.execute(text(f"""
        SELECT id::text, run_number, run_at, metadata->>'system_id' FROM analysis_versions
         WHERE tenant_id = :t AND {finished_sql()} AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
           AND metadata->>'archived' IS DISTINCT FROM 'true'
           AND (CAST(:vid AS uuid) IS NULL OR id = CAST(:vid AS uuid))
         ORDER BY run_at DESC LIMIT 1"""), {"t": t, "vid": str(version_id) if version_id else None})).fetchone()
    if not run:
        return MonitorsOut(min_runs=lm.MIN_RUNS, history=lm.HISTORY, coverage=[], breaks=[])
    mods = [r[0] for r in (await db.execute(text(
        "SELECT jsonb_object_keys(dqs_summary) FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = :t "
        "AND jsonb_typeof(dqs_summary) = 'object'"), {"v": run[0], "t": t})).fetchall()]
    cov = []
    for m in sorted(mods):
        n = (await db.execute(text(f"""
            SELECT count(*) FROM analysis_versions WHERE tenant_id = :t AND {finished_sql()} AND run_at < :at
               AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
               AND metadata->>'archived' IS DISTINCT FROM 'true'
               AND metadata->>'system_id' IS NOT DISTINCT FROM CAST(:sid AS text) AND dqs_summary ? :m"""),
            {"t": t, "at": run[2], "sid": run[3], "m": m})).scalar() or 0
        k = (await db.execute(text("SELECT count(*) FROM learned_monitor_breaks WHERE tenant_id = :t "
                                   "AND version_id = CAST(:v AS uuid) AND module = :m"), {"t": t, "v": run[0], "m": m})).scalar() or 0
        n = min(int(n), lm.HISTORY)
        cov.append(Coverage(module=m, run_id=run[0], run_number=run[1], baseline_runs=n, min_runs=lm.MIN_RUNS,
                            state="active" if n >= lm.MIN_RUNS else "learning", breaks=int(k)))
    rows = (await db.execute(text(f"""
        SELECT {COLS} FROM learned_monitor_breaks b JOIN analysis_versions v ON v.id = b.version_id
         WHERE b.tenant_id = :t AND b.version_id = CAST(:v AS uuid)
         ORDER BY CASE b.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  b.module, b.kind, b.subject_code LIMIT :n"""), {"t": t, "v": run[0], "n": limit})).fetchall()
    return MonitorsOut(min_runs=lm.MIN_RUNS, history=lm.HISTORY, coverage=cov, breaks=await _shape(db, tenant, rows))


async def _get(db: AsyncSession, tenant: Tenant, bid: uuid.UUID):
    await _rls(db, tenant)
    r = (await db.execute(text(f"""
        SELECT {COLS} FROM learned_monitor_breaks b JOIN analysis_versions v ON v.id = b.version_id
         WHERE b.id = CAST(:id AS uuid) AND b.tenant_id = :t"""), {"id": str(bid), "t": str(tenant.id)})).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Break not found")
    return r


async def _decide(db: AsyncSession, tenant: Tenant, request: Request, bid: uuid.UUID, action: str, status: str,
                  effect: Optional[str], until: Optional[datetime], note: Optional[str]) -> BreakOut:
    r = await _get(db, tenant, bid)
    await db.execute(text("""
        UPDATE learned_monitor_breaks SET status = :s, baseline_effect = :e, snoozed_until = :u, decided_by = :by,
               decided_at = now(), note = :n WHERE id = CAST(:id AS uuid) AND tenant_id = :t"""),
                     {"s": status, "e": effect, "u": until, "by": current_user_label(), "n": note, "id": str(bid),
                      "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, f"learned_monitor.{action}", "learned_monitor_break", str(bid),
                      {"status": r[15], "baseline_effect": r[16]},
                      {"status": status, "baseline_effect": effect, "snoozed_until": _iso(until), "note": note,
                       "kind": r[4], "module": r[3], "subject": r[6]})
    await db.commit()
    return (await _shape(db, tenant, [await _get(db, tenant, bid)]))[0]


class NoteIn(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class ExpectedIn(NoteIn):
    effect: Literal["exclude", "accept"] = "exclude"


class SnoozeIn(NoteIn):
    days: int = Field(7, ge=1, le=90)


@router.post("/{break_id}/acknowledge", response_model=BreakOut, dependencies=[Depends(require_permission("mdm.write"))])
async def acknowledge(break_id: uuid.UUID, request: Request, body: Optional[NoteIn] = None,
                      db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> BreakOut:
    return await _decide(db, tenant, request, break_id, "acknowledge", "acknowledged", None, None, body.note if body else None)


@router.post("/{break_id}/expected", response_model=BreakOut, dependencies=[Depends(require_permission("mdm.write"))])
async def expected(break_id: uuid.UUID, body: ExpectedIn, request: Request, db: AsyncSession = Depends(get_db),
                   tenant: Tenant = Depends(get_tenant)) -> BreakOut:
    """Mark the break expected. ``exclude``: this run is left out of later baselines. ``accept``: the baseline restarts
    at this run (older runs are dropped; the object relearns)."""
    return await _decide(db, tenant, request, break_id, "expected", "expected", body.effect, None, body.note)


@router.post("/{break_id}/snooze", response_model=BreakOut, dependencies=[Depends(require_permission("mdm.write"))])
async def snooze(break_id: uuid.UUID, body: SnoozeIn, request: Request, db: AsyncSession = Depends(get_db),
                 tenant: Tenant = Depends(get_tenant)) -> BreakOut:
    """Hide the break, and the same break in later runs, for ``days`` days."""
    until = datetime.now(timezone.utc) + timedelta(days=body.days)
    return await _decide(db, tenant, request, break_id, "snooze", "snoozed", None, until, body.note)


@router.post("/{break_id}/explain", response_model=BreakOut, dependencies=[Depends(require_permission("view"))])
async def explain(break_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                  tenant: Tenant = Depends(get_tenant)) -> BreakOut:
    """Aletheia's wording of the break. The model gets the break's kind, the rule or field code and its text, and the
    aggregate figures: never a record or a value. Its sentences are kept only when every number is one of the figures;
    otherwise (or with no model) the deterministic explanation is stored and shown."""
    import json
    r = await _get(db, tenant, break_id)
    shaped = (await _shape(db, tenant, [r]))[0]
    b = {"kind": r[4], "metric": r[5], "subject_code": r[6], "expected_low": r[8], "expected_high": r[9],
         "median": r[10], "observed": r[11], "baseline_runs": r[12], "method": r[14]}
    f = lm.facts(b, shaped.subject_description)
    exp = lm.explanation(f, await run_in_threadpool(lm.ai_sentences, f, lm.label_of(r[3], r[6])))
    await db.execute(text("UPDATE learned_monitor_breaks SET explanation = CAST(:e AS jsonb) "
                          "WHERE id = CAST(:id AS uuid) AND tenant_id = :t"),
                     {"e": json.dumps(exp), "id": str(break_id), "t": str(tenant.id)})
    await db.commit()
    shaped.explanation = Explanation(**exp)
    return shaped
