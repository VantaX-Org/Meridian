"""Real-time data-quality firewall (api/services/dq_firewall.py).

  POST /api/v1/dq-firewall/validate   {module, records: [{"TABLE.FIELD": value}, ...], duplicates?} (1 to 100): synchronous
                                      verdict with every failing enabled rule per record; with ``duplicates`` also the
                                      existing master records each looks like; nothing stored but one audit row
  GET  /api/v1/dq-firewall/summary    the modules, the limits and the recent-call counts from the audit

Callers are people or API keys (service accounts, api/routes/api_keys.py) holding mdm.write; the tenant comes from the
credential and RLS is set before the audit row is written. The audit row holds the module, counts and failing rule ids,
never a record value (the duplicate search adds counts). The language model is never involved.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import change_requests as crs
from api.services import dq_firewall as fw
from api.services import entry_duplicates as ed
from api.services.rbac import require_permission, write_audit

logger = logging.getLogger("meridian.dq_firewall")
router = APIRouter(prefix="/api/v1/dq-firewall", tags=["dq-firewall"])
ACTION = "dq_firewall.validate"


class ValidateBody(BaseModel):
    module: str = Field(min_length=1, max_length=60)
    records: list[dict[str, Any]] = Field(min_length=1, max_length=fw.MAX_RECORDS)
    suggest: bool = Field(False, description="Add a grounded fix to failures that have one (rule definition only).")
    duplicates: bool = Field(False, description="Also search the tenant's master records for likely duplicates "
                             "(material_master, sd_customer_master, business_partner).")


class AllowedValue(BaseModel):
    code: str
    text: Optional[str] = None


class Suggestion(BaseModel):
    kind: str  # "value" (a corrected value) or "allowed_values" (the values the rule accepts)
    field: str
    rule_id: str
    source: str
    verified: bool
    value: Optional[str] = None
    allowed_values: Optional[list[AllowedValue]] = None
    truncated: Optional[bool] = None


class Failure(BaseModel):
    rule_id: str
    description: str
    field: str
    severity: str
    dimension: str
    reason: str
    suggestion: Optional[Suggestion] = None


class DuplicateField(BaseModel):
    field: str
    comparator: str
    similarity: float
    weight: float
    threshold: Optional[float] = None
    met: bool


class DuplicateMatch(BaseModel):
    key: str  # the existing record's key; none of its values are returned
    found_by: str  # "exact" (same normalised value) or "similar" (typo-tolerant pass on a free-text field)
    score: float
    band: str
    threshold: float  # the auto-merge threshold the score is judged against
    fields: list[DuplicateField]


class FuzzyRun(BaseModel):
    ran: bool  # false: the typo-tolerant pass did not run for this record, so a typo in its names was not looked for
    reason: Optional[str] = None  # extension_missing, index_missing, key_too_short, no_free_text_value, not_searched


class RecordDuplicates(BaseModel):
    verdict: str  # "warn" when a match reaches the auto-merge threshold, else "pass"; never "block"
    searched: bool  # false: this record had no value to look up, so "pass" does not mean "no duplicates"
    scored: int
    truncated: bool
    matches: list[DuplicateMatch]
    fuzzy: FuzzyRun


class DuplicateSearch(BaseModel):
    searched: bool
    reason: Optional[str] = None  # why not: module_not_supported, no_match_rules, no_population, no_block_field_in_population
    cap: int
    thresholds: dict[str, float]
    rules: Optional[int] = None
    skipped_semantic: Optional[int] = None
    fuzzy: Optional[dict[str, Any]] = None  # available, reason, min_key_length, similarity of the typo-tolerant pass


class RecordOut(BaseModel):
    index: int
    verdict: str
    failures: list[Failure]
    duplicates: Optional[RecordDuplicates] = None


class ValidateOut(BaseModel):
    verdict: str
    block_severity: str
    module: str
    rules_run: int
    records: list[RecordOut]
    duplicate_search: Optional[DuplicateSearch] = None


class SummaryOut(BaseModel):
    modules: list[str]
    max_records: int
    block_severity: str
    calls_24h: int
    calls_7d: int
    last_call_at: Optional[str] = None
    days: list["DayOut"] = []
    top_rules: list["TopRule"] = []
    by_module: list["ModuleOut"] = []


class DayOut(BaseModel):
    day: str
    checked: int
    blocked: int
    warned: Optional[int] = None
    passed: Optional[int] = None


class TopRule(BaseModel):
    rule_id: str
    description: str
    blocked: int


class ModuleOut(BaseModel):
    module: str
    checked: int
    blocked: int
    warned: Optional[int] = None
    passed: Optional[int] = None


SummaryOut.model_rebuild()


def _count_blocking(fails: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for f in fails:
        if f["severity"] == fw.BLOCK_SEVERITY:
            out[f["rule_id"]] = out.get(f["rule_id"], 0) + 1
    return out


def _tally(rows: list[dict]) -> dict[str, Optional[int]]:
    """checked, blocked, warned, passed of audit payloads; warned and passed are None when any row predates the
    warned count (a missing value is shown as a dash, never as zero)."""
    checked = sum(int(r.get("records") or 0) for r in rows)
    blocked = sum(int(r.get("blocked_records") or 0) for r in rows)
    if any("warned_records" not in r for r in rows):
        return {"checked": checked, "blocked": blocked, "warned": None, "passed": None}
    warned = sum(int(r["warned_records"] or 0) for r in rows)
    return {"checked": checked, "blocked": blocked, "warned": warned, "passed": checked - blocked - warned}


async def _rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})


@router.post("/validate", response_model=ValidateOut, dependencies=[Depends(require_permission("mdm.write"))])
async def validate(body: ValidateBody, request: Request, db: AsyncSession = Depends(get_db),
                   tenant: Tenant = Depends(get_tenant)) -> ValidateOut:
    """Which enabled rules the candidate records fail, and whether to block them (any critical failure blocks)."""
    await _rls(db, tenant)
    overrides, authored = await db.run_sync(lambda s: crs.governance(s))
    allow = await ed.match_fields(db, str(tenant.id), body.module) if body.duplicates else frozenset()
    try:
        res = await asyncio.to_thread(fw.validate, str(tenant.id), body.module, body.records, overrides, authored,
                                      body.suggest, allow)
    except fw.FirewallError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except Exception as e:  # noqa: BLE001 - no trace to the caller; the type is logged
        logger.error("dq firewall failed for module %s: %s", body.module, type(e).__name__)
        raise HTTPException(status_code=500, detail="The check engine could not judge these records.") from None
    fails = [f for r in res["records"] for f in r["failures"]]
    dup_audit: dict[str, Any] = {}
    if body.duplicates:
        found = await ed.search(db, str(tenant.id), body.module, fw._clean(body.module, body.records, allow))
        res["duplicate_search"] = found["search"]
        for rec, d in zip(res["records"], found["records"]):
            d["verdict"] = "warn" if any(m["score"] >= m["threshold"] for m in d["matches"]) else "pass"
            rec["duplicates"] = d
        ds = found["records"]
        dup_audit = {"duplicates_searched": found["search"]["searched"],
                     "duplicate_matches": sum(len(d["matches"]) for d in ds),
                     "duplicate_warned_records": sum(d["verdict"] == "warn" for d in ds),
                     "duplicate_truncated_records": sum(d["truncated"] for d in ds),
                     "duplicate_unsearched_records": sum(not d["searched"] for d in ds)}
    await write_audit(db, tenant.id, request, ACTION, "dq_firewall", body.module, None, {
        "records": len(res["records"]), "blocked_records": sum(r["verdict"] == "block" for r in res["records"]),
        "failures": len(fails), "verdict": res["verdict"],
        "warned_records": sum(r["verdict"] == "pass" and bool(r["failures"]) for r in res["records"]),
        "blocking_rule_counts": dict(sorted(_count_blocking(fails).items(), key=lambda kv: -kv[1])[:50]),
        "blocking_rules": sorted({f["rule_id"] for f in fails if f["severity"] == fw.BLOCK_SEVERITY})[:50],
        **dup_audit})
    await db.commit()
    return ValidateOut(**res)


@router.get("/summary", response_model=SummaryOut, dependencies=[Depends(require_permission("mdm.read"))])
async def summary(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> SummaryOut:
    """The modules the firewall judges, its limits and how many calls the audit holds for 24 hours and 7 days."""
    await _rls(db, tenant)
    row = (await db.execute(text(
        "SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours'), count(*), max(created_at) "
        "FROM audit_log WHERE tenant_id = CAST(:t AS uuid) AND action = :a AND created_at > now() - interval '7 days'"),
        {"t": str(tenant.id), "a": ACTION})).fetchone()
    calls = (await db.execute(text(
        "SELECT created_at::date, entity_id, after_json FROM audit_log WHERE tenant_id = CAST(:t AS uuid) "
        "AND action = :a AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 5000"),
        {"t": str(tenant.id), "a": ACTION})).fetchall()
    by_day: dict[str, list[dict]] = {}
    by_mod: dict[str, list[dict]] = {}
    rule_n: dict[str, int] = {}
    for d, mod, aft in calls:
        a = aft if isinstance(aft, dict) else {}
        by_day.setdefault(d.isoformat(), []).append(a)
        by_mod.setdefault(mod or "", []).append(a)
        for rid, n in (a.get("blocking_rule_counts") or {}).items():
            rule_n[rid] = rule_n.get(rid, 0) + int(n)
    top = sorted(rule_n.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    return SummaryOut(modules=list(fw.modules()), max_records=fw.MAX_RECORDS, block_severity=fw.BLOCK_SEVERITY,
                      calls_24h=int(row[0] or 0), calls_7d=int(row[1] or 0),
                      last_call_at=row[2].isoformat() if row[2] else None,
                      days=[DayOut(day=k, **_tally(v)) for k, v in sorted(by_day.items())],
                      top_rules=[TopRule(rule_id=r, description=fw.describe(r) or "", blocked=n) for r, n in top],
                      by_module=[ModuleOut(module=m, **_tally(v)) for m, v in sorted(by_mod.items())
                                 if m in fw.modules()])
