"""Aletheia verified survivorship: where the model picked a golden-record winner and whether the server proved it.

The model sees only the shape of each source's value (api/services/ai_survivorship.py); its pick wins only when
``verify`` passes. The GET lists every such pick stored on the master records, with the checks. It returns no field
value: a golden value can be personal data, and the screen needs only the field, the source, the proof and each
candidate's shape.

A steward accepts a pick or overrides it with another offered source (never free text). A decision that changes the
golden value goes through ``mdm_merge.set_overrides``, the existing steward-override path. Each decision is stored in
``survivorship_decisions``; ``GET /accuracy`` turns those rows into the acceptance and override rates.
"""
import json
import uuid
from collections import defaultdict
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.merge_explain import _mutate
from api.routes.mining import field_text
from api.routes.record_issues import _rls
from api.services import mdm_merge
from api.services.fix_drafter import mask_of
from api.services.golden_record_engine import AI_APPROVAL_SETTING
from api.services.rbac import current_user_id, require_permission, write_audit
from api.services.tenant_settings import get_setting, put_setting, set_rls

router = APIRouter(prefix="/api/v1/aletheia/survivorship", tags=["aletheia"])

REASON_CODES = {
    "wrong_source": "This source is not the right one for the field",
    "stale_value": "The picked value is out of date",
    "incomplete_value": "The picked value is incomplete",
    "format_issue": "The picked value is in the wrong format",
    "other": "Another reason",
}


class Check(BaseModel):
    code: str
    passed: bool


class Candidate(BaseModel):
    source_system: str
    shape: str
    length: int
    blank: bool
    picked: bool


class Pick(BaseModel):
    domain: str
    sap_object_key: str
    field: str
    field_text: Optional[str] = None
    recommended_source: str
    confidence: Optional[float] = None
    reasoning: str = ""
    verified: bool
    checks: list[Check]
    applied: bool = False
    state: Literal["pending", "accepted", "overridden", "rejected"] = "pending"
    decided_source: Optional[str] = None
    reason_code: Optional[str] = None
    note: Optional[str] = None
    decided_by: Optional[str] = None
    decided_at: Optional[str] = None
    candidates: list[Candidate] = []


class DomainCount(BaseModel):
    domain: str
    verified: int
    rejected: int


class PickCounts(BaseModel):
    """Proved picks only. proposed: waits for a steward. approved: a steward accepted or overrode it. rejected: a
    steward turned it down. auto_applied: applied at once under the tenant's opt-in auto-approve, never decided."""
    proposed: int = 0
    approved: int = 0
    rejected: int = 0
    auto_applied: int = 0


class Survivorship(BaseModel):
    domains: list[DomainCount]
    counts: PickCounts = PickCounts()
    picks: list[Pick]


def _candidates(c: dict) -> list[dict]:
    """Shape and source of each offered candidate; the value itself never leaves the server."""
    out = []
    for o in c.get("ai_candidates") or []:
        t = "" if o.get("value") is None else str(o["value"]).strip()
        out.append({"source_system": o["source_system"], "shape": mask_of(t), "length": len(t), "blank": not t,
                    "picked": o["source_system"] == c.get("ai_recommendation")})
    return out


def summarise(rows: list[tuple], limit: int) -> dict:
    """Group stored ``(domain, key, field, contribution[, decision, new_source, reason_code])`` rows into per-domain
    counts and the newest ``limit`` picks."""
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    tot = {"proposed": 0, "approved": 0, "rejected": 0, "auto_applied": 0}
    picks: list[dict] = []
    for domain, key, field, c, *d in rows:
        # entries written before verification existed carry no proof; they count as rejected, never as verified
        v = c.get("ai_verification") or {"verified": False, "checks": []}
        counts[domain][0 if v["verified"] else 1] += 1
        dec, src, reason, note, by, at = (d + [None] * 6)[:6]
        if v["verified"]:
            tot["rejected" if dec == "reject" else "approved" if dec in ("accept", "override")
                else "auto_applied" if c.get("ai_applied") else "proposed"] += 1
        if len(picks) < limit:
            picks.append({"domain": domain, "sap_object_key": key, "field": field, "field_text": field_text(field, domain),
                          "recommended_source": c["ai_recommendation"], "confidence": c.get("ai_confidence"),
                          "reasoning": c.get("ai_reasoning") or "", "verified": bool(v["verified"]), "checks": v["checks"],
                          "applied": bool(c.get("ai_applied")),
                          "state": {"accept": "accepted", "override": "overridden", "reject": "rejected"}.get(dec, "pending"),
                          "decided_source": src, "reason_code": reason, "note": note,
                          "decided_by": str(by) if by else None, "decided_at": at.isoformat() if at else None,
                          "candidates": _candidates(c)})
    return {"domains": [{"domain": d, "verified": a, "rejected": b} for d, (a, b) in sorted(counts.items())],
            "counts": tot, "picks": picks}


_PICKS_SQL = """
    SELECT m.domain, m.sap_object_key, e.key, e.value, d.decision, d.new_source, d.reason_code, d.note, d.actor,
           d.decided_at
    FROM master_records m
    CROSS JOIN LATERAL jsonb_each(m.source_contributions) e
    LEFT JOIN LATERAL (
        SELECT s.decision, s.new_source, s.reason_code, s.note, s.actor, s.decided_at FROM survivorship_decisions s
         WHERE s.tenant_id = m.tenant_id AND s.domain = m.domain AND s.sap_object_key = m.sap_object_key
           AND s.field = e.key AND s.decided_at >= m.updated_at   -- a later re-ingest makes the pick pending again
         ORDER BY s.decided_at DESC LIMIT 1) d ON true
    WHERE m.tenant_id = :tid AND e.value ? 'ai_recommendation'
    ORDER BY m.updated_at DESC
"""


@router.get("", response_model=Survivorship, dependencies=[Depends(require_permission("view"))])
async def survivorship(limit: int = Query(50, ge=1, le=200), db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    rows = (await db.execute(text(_PICKS_SQL), {"tid": str(tenant.id)})).fetchall()
    return summarise([tuple(r) for r in rows], limit)


# -- steward decision ---------------------------------------------------------------------------------------------


class SurvivorshipDecisionBody(BaseModel):
    domain: str
    sap_object_key: str
    field: str
    decision: Literal["accept", "override", "reject"]
    source_system: Optional[str] = None  # override only: one of the offered candidates
    reason_code: Optional[Literal["wrong_source", "stale_value", "incomplete_value", "format_issue", "other"]] = None
    note: Optional[str] = Field(default=None, max_length=500)  # required for a rejection

    @model_validator(mode="after")
    def _reject_needs_reason(self):
        if self.decision == "reject" and not (self.note or "").strip():
            raise ValueError("a rejection needs a reason")
        return self


def plan_decision(entry: dict, decision: str, source: Optional[str]) -> tuple[str, str, object]:
    """``(prior_source, new_source, value to pin)`` for a decision on one stored pick; ValueError when not allowed."""
    prior = entry.get("ai_recommendation")
    cands = {o["source_system"]: o for o in entry.get("ai_candidates") or []}
    if not prior or prior not in cands:
        raise ValueError("this pick has no offered candidates to decide on")
    if decision == "accept":
        return prior, prior, cands[prior]["value"]
    if decision == "reject":
        if entry.get("ai_applied"):
            raise ValueError("this pick is already applied; override it with another source instead")
        return prior, prior, None
    if source not in cands:
        raise ValueError("override must be one of the offered candidate sources")
    if source == prior:
        raise ValueError("override must differ from the AI pick; use accept")
    return prior, source, cands[source]["value"]


async def apply_decision(db: AsyncSession, tid: str, body: SurvivorshipDecisionBody, user_id: Optional[str],
                         request: Optional[Request] = None) -> dict:
    row = (await db.execute(text(
        "SELECT id, source_contributions -> :f AS entry FROM master_records "
        "WHERE tenant_id = :tid AND domain = :d AND sap_object_key = :k"),
        {"tid": tid, "d": body.domain, "k": body.sap_object_key, "f": body.field})).first()
    entry = row.entry if row is not None else None
    if isinstance(entry, str):
        entry = json.loads(entry)
    if not entry or "ai_recommendation" not in entry:
        raise mdm_merge.MergeStateError("no AI pick for this record and field")
    try:
        prior, new, value = plan_decision(entry, body.decision, body.source_system)
    except ValueError as e:
        raise mdm_merge.MergeStateError(str(e))
    # Four eyes: whoever triggered the run that proposed a held-back pick cannot decide it. A run with no user (a
    # scheduled ingest) has nobody to compare with; an unknown deciding user can never pass the check.
    maker = entry.get("proposed_by")
    if not entry.get("ai_applied") and maker and (user_id is None or user_id == maker):
        raise HTTPException(status_code=403, detail="A different user must decide this pick")
    # An override, or an accept of a pick the approval policy held back, changes the golden value through the
    # steward-override path. ponytail: that pins the field as a steward override; clear it on the merge explain
    # screen to return to survivorship. A reject leaves the golden value as the deterministic chain set it.
    if body.decision == "override" or (body.decision == "accept" and not entry.get("ai_applied")):
        await mdm_merge.set_overrides(db, tid, str(row.id), {body.field: value}, user_id,
                                      f"AI survivorship {body.decision}: {prior} -> {new}")
    await db.execute(text("""
        INSERT INTO survivorship_decisions (tenant_id, domain, sap_object_key, field, decision, prior_source,
                                            new_source, reason_code, actor, note)
        VALUES (:tid, :d, :k, :f, :dec, :p, :n, :rc, CAST(:u AS uuid), :note)
    """), {"tid": tid, "d": body.domain, "k": body.sap_object_key, "f": body.field, "dec": body.decision, "p": prior,
           "n": new, "rc": body.reason_code, "u": user_id, "note": (body.note or "").strip() or None})
    if request is not None:  # sources and reasons only, never a value
        await write_audit(db, uuid.UUID(tid), request, f"survivorship.{body.decision}", "survivorship_pick",
                          f"{body.domain}:{body.sap_object_key}:{body.field}",
                          {"state": "applied" if entry.get("ai_applied") else "proposed", "recommended_source": prior},
                          {"decision": body.decision, "source": new, "reason_code": body.reason_code,
                           "note": (body.note or "").strip() or None})
    return {"decision": body.decision, "prior_source": prior, "new_source": new, "field": body.field}


def _uid() -> Optional[str]:
    uid = current_user_id()
    try:
        return str(uuid.UUID(uid)) if uid else None
    except ValueError:
        return None


@router.post("/decision")
async def decide(body: SurvivorshipDecisionBody, request: Request, _: str = Depends(require_permission("approve")),
                 db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    """Approve (accept), override or reject one proposed AI pick; the approver must not be whoever triggered the run.
    The decision, with approver, time, prior and new source, reason and note, is in survivorship_decisions and in an
    audit_log row (survivorship.<decision>)."""
    await _rls(db, tenant)
    return await _mutate(db, apply_decision(db, str(tenant.id), body, _uid(), request))


class PickRef(BaseModel):
    domain: str
    sap_object_key: str
    field: str


class BulkApproveBody(BaseModel):
    picks: list[PickRef] = Field(min_length=1, max_length=200)


@router.post("/decision/bulk")
async def approve_bulk(body: BulkApproveBody, request: Request, _: str = Depends(require_permission("approve")),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    """Approve each listed pick. A pick that cannot be approved (not found, four eyes) is reported and skipped; the
    others are approved. ponytail: one transaction for all picks, no per-pick savepoint."""
    await _rls(db, tenant)
    uid, done, failed = _uid(), 0, []
    for ref in body.picks:
        try:
            await apply_decision(db, str(tenant.id), SurvivorshipDecisionBody(**ref.model_dump(), decision="accept"),
                                 uid, request)
            done += 1
        except HTTPException as e:
            failed.append({**ref.model_dump(), "detail": str(e.detail)})
        except mdm_merge.MergeStateError as e:
            failed.append({**ref.model_dump(), "detail": str(e)})
    await db.commit()
    return {"approved": done, "failed": failed}


# -- accuracy -----------------------------------------------------------------------------------------------------


def _week(d) -> str:
    d = d.date() if hasattr(d, "date") else d
    return (d - timedelta(days=d.weekday())).isoformat()


def _rate(a: int, n: int) -> Optional[float]:
    return round(a / n, 4) if n else None


def accuracy(decisions: list[tuple], pending: list[tuple]) -> dict:
    """Rates from ``(domain, field, decision, decided_at)`` rows and ``(domain, field)`` of undecided picks."""
    def tally(keyf):
        t: dict = defaultdict(lambda: {"accepted": 0, "overridden": 0, "pending": 0})
        for dom, fld, dec, at in decisions:
            t[keyf(dom, fld, at)]["accepted" if dec == "accept" else "overridden"] += 1
        return t

    def rows(t, names):
        out = []
        for k, v in sorted(t.items()):
            n = v["accepted"] + v["overridden"]
            out.append({**dict(zip(names, k if isinstance(k, tuple) else (k,))), **v,
                        "acceptance_rate": _rate(v["accepted"], n), "override_rate": _rate(v["overridden"], n)})
        return out

    by_obj, by_field, by_week = tally(lambda d, f, a: d), tally(lambda d, f, a: (d, f)), tally(lambda d, f, a: _week(a))
    for dom, fld in pending:  # pending has no date, so it is not bucketed by week
        by_obj[dom]["pending"] += 1
        by_field[(dom, fld)]["pending"] += 1
    acc = sum(1 for x in decisions if x[2] == "accept")
    n = len(decisions)
    return {"accepted": acc, "overridden": n - acc, "pending": len(pending),
            "acceptance_rate": _rate(acc, n), "override_rate": _rate(n - acc, n),
            "by_object": rows(by_obj, ("domain",)), "by_field": rows(by_field, ("domain", "field")),
            "by_week": rows(by_week, ("week",))}


@router.get("/accuracy", dependencies=[Depends(require_permission("view"))])
async def survivorship_accuracy(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    """Aletheia's proof of accuracy: how often stewards keep the AI pick. Weekly buckets start on Monday."""
    await _rls(db, tenant)
    tid = {"tid": str(tenant.id)}
    dec = (await db.execute(text("SELECT domain, field, decision, decided_at FROM survivorship_decisions "
                                 "WHERE tenant_id = :tid AND decision <> 'reject'"), tid)).fetchall()
    pend = (await db.execute(text(_PICKS_SQL), tid)).fetchall()
    out = accuracy([tuple(r) for r in dec],
                   [(r[0], r[2]) for r in pend if r[4] is None and r[3].get("ai_candidates")])
    for f in out["by_field"]:
        f["field_text"] = field_text(f["field"], f["domain"])
    return {**out, "reason_codes": [{"code": k, "text": v} for k, v in REASON_CODES.items()]}


class ApprovalSetting(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required: bool


@router.get("/approval-setting", response_model=ApprovalSetting, dependencies=[Depends(require_permission("view"))])
async def get_approval_setting(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> ApprovalSetting:
    """Whether a proved AI pick waits for a steward's approval before it is applied (tenant setting
    survivorship_ai_approval). On unless the tenant opted into auto-approve with required=false."""
    await set_rls(db, tenant.id)
    return ApprovalSetting(required=bool(((await get_setting(db, tenant.id, AI_APPROVAL_SETTING)) or {}).get("required", True)))


@router.put("/approval-setting", response_model=ApprovalSetting, dependencies=[Depends(require_permission("manage_settings"))])
async def put_approval_setting(body: ApprovalSetting, request: Request, db: AsyncSession = Depends(get_db),
                               tenant: Tenant = Depends(get_tenant)) -> ApprovalSetting:
    await set_rls(db, tenant.id)
    before = await get_setting(db, tenant.id, AI_APPROVAL_SETTING)
    after = {"required": body.required}
    await put_setting(db, tenant.id, AI_APPROVAL_SETTING, after, current_user_id(request))
    await write_audit(db, tenant.id, request, "survivorship.approval_setting", "tenant_settings", AI_APPROVAL_SETTING,
                      before if isinstance(before, dict) else None, after)
    await db.commit()
    return body
