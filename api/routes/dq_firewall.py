"""Real-time data-quality firewall (api/services/dq_firewall.py).

  POST /api/v1/dq-firewall/validate   {module, records: [{"TABLE.FIELD": value}, ...], duplicates?} (1 to 100): synchronous
                                      verdict with every failing enabled rule per record; with ``duplicates`` also the
                                      existing master records each looks like; nothing stored but one audit row
  GET  /api/v1/dq-firewall/summary    the modules, the limits and the recent-call counts from the audit

Callers are people or API keys (service accounts, api/routes/api_keys.py) holding mdm.write; the tenant comes from the
credential and RLS is set before the audit row is written. The audit row holds the module, counts and failing rule ids,
never a record value (the duplicate search adds counts). The language model is never involved.

With ``route_to_steward`` a blocked or warned record also opens a change request of kind create (api/routes/change_requests.py,
the tenant's workflow routes it to a steward). It is opened as the caller: a person, or an API key's service user, whose
email is then the requester label. The same candidate (an HMAC of module and content) finds its open request instead of
opening another. If opening fails the verdict still stands and the record says the request was not opened.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes import change_requests as cr_routes
from api.services import change_requests as crs
from api.services import dq_firewall as fw
from api.services import entry_duplicates as ed
from api.services.rbac import current_user_id, current_user_label, require_permission, write_audit
from api.services.subject_requests import _hmac
from sap.bapi_create import MODULE_OF

logger = logging.getLogger("meridian.dq_firewall")
router = APIRouter(prefix="/api/v1/dq-firewall", tags=["dq-firewall"])
ACTION = "dq_firewall.validate"


class ValidateBody(BaseModel):
    module: str = Field(min_length=1, max_length=60)
    records: list[dict[str, Any]] = Field(min_length=1, max_length=fw.MAX_RECORDS)
    suggest: bool = Field(False, description="Add a grounded fix to failures that have one (rule definition only).")
    duplicates: bool = Field(False, description="Also search the tenant's master records for likely duplicates "
                             "(material_master, sd_customer_master, business_partner).")
    route_to_steward: bool = Field(False, description="Open a change request (kind create) for each record that is "
                                   "blocked or warned, so a steward sees it. Modules with no change request object open none.")


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
    found_by: str  # "exact" (same normalised value), "similar" (typo-tolerant pass on a free-text field) or "near" (identifier one edit away)
    found_field: Optional[str] = None  # for "near": the identifier field whose value is one edit from the stored one
    score: float
    band: str
    threshold: float  # the auto-merge threshold the score is judged against
    fields: list[DuplicateField]


class FuzzyRun(BaseModel):
    ran: bool  # false: the typo-tolerant pass did not run for this record, so a typo in its names was not looked for
    reason: Optional[str] = None  # extension_missing, index_missing, key_too_short, no_free_text_value, not_searched


class NearRun(BaseModel):
    ran: bool  # false: no identifier of this record was compared for a typo; the other passes still ran
    reason: Optional[str] = None  # index_missing, key_length, no_identifier_value, not_searched


class RecordDuplicates(BaseModel):
    verdict: str  # "warn" when a match reaches the auto-merge threshold or is a near-value match, else "pass"; never "block"
    searched: bool  # false: this record had no value to look up, so "pass" does not mean "no duplicates"
    scored: int
    truncated: bool
    matches: list[DuplicateMatch]
    fuzzy: FuzzyRun
    near: NearRun


class DuplicateSearch(BaseModel):
    searched: bool
    reason: Optional[str] = None  # why not: module_not_supported, no_match_rules, no_population, no_block_field_in_population
    cap: int
    thresholds: dict[str, float]
    rules: Optional[int] = None
    skipped_semantic: Optional[int] = None
    fuzzy: Optional[dict[str, Any]] = None  # available, reason, min_key_length, similarity of the typo-tolerant pass
    near: Optional[dict[str, Any]] = None  # available, reason, min_key_length, max_key_length of the near-value pass


class StewardRequest(BaseModel):
    request_id: Optional[str] = None  # none: no request was opened, see reason
    status: Optional[str] = None
    existing: bool = False  # true: the same candidate already had this open request
    reason: Optional[str] = None  # module_has_no_change_request, over_limit, not_accepted, not_opened
    detail: Optional[str] = None


class StewardRequest(BaseModel):
    request_id: Optional[str] = None  # none: no request was opened, see reason
    status: Optional[str] = None
    existing: bool = False  # true: the same candidate already had this open request
    reason: Optional[str] = None  # module_has_no_change_request, over_limit, not_accepted, not_opened
    detail: Optional[str] = None


class RecordOut(BaseModel):
    index: int
    verdict: str
    failures: list[Failure]
    duplicates: Optional[RecordDuplicates] = None
    steward_request: Optional[StewardRequest] = None  # only with route_to_steward, and only for a flagged record


class ValidateOut(BaseModel):
    verdict: str
    block_severity: str
    module: str
    rules_run: int
    records: list[RecordOut]
    duplicate_search: Optional[DuplicateSearch] = None


class GateRequest(BaseModel):
    id: str
    object: str
    title: Optional[str] = None
    status: str
    created_at: str


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
    requests: list[GateRequest] = []  # the latest change requests opened from the gate


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


OBJECT_OF = {m: o for o, m in MODULE_OF.items()}
MAX_ROUTED = 25  # requests one call may open; the rest say over_limit
# failed stays open: retry moves it back to creating, so a second request for the content would break the unique index.
_OPEN = ("draft", "submitted", "in_approval", "approved", "creating", "failed")


async def _open_request(db: AsyncSession, tenant: Tenant, request: Request, module: str, row: dict[str, str],
                        rec: dict[str, Any]) -> dict[str, Any]:
    """The open request of this candidate, or a new one submitted to the workflow. Never raises: a failure is logged
    (the type only, never a value) and answered as not_opened."""
    tid = str(tenant.id)

    async def find() -> Optional[dict[str, Any]]:
        r = (await db.execute(text(
            "SELECT id::text, status FROM change_requests WHERE tenant_id = CAST(:t AS uuid) "
            "AND entry_fingerprint = :f AND status = ANY(:o) LIMIT 1"), {"t": tid, "f": fp, "o": list(_OPEN)})).first()
        return {"request_id": r[0], "status": r[1], "existing": True} if r else None

    try:
        fp = await db.run_sync(lambda s: _hmac(s, tid, "entry_gate", module + json.dumps(row, sort_keys=True)))
        if found := await find():
            return found
        dups = (rec.get("duplicates") or {}).get("matches") or []
        title = f"Entry gate: new {OBJECT_OF[module].replace('_', ' ')}, {len(rec['failures'])} rule failure(s)" \
                + (f", {len(dups)} possible duplicate(s)" if dups else "")
        notes = "Opened by the entry gate. " + "; ".join(f"{f['rule_id']} ({f['severity']}): {f['description']}"
                                                         for f in rec["failures"][:20])
        if dups:
            notes += ". Possible duplicates: " + ", ".join(f"{m['key']} ({m['score']:.2f})" for m in dups[:5])
        try:
            async with db.begin_nested():
                cr = await cr_routes.draft_request(cr_routes.RequestCreate(kind="create", object=OBJECT_OF[module],
                                                                           title=title, payload=row),
                                                   request, db, tenant, fp)
                await cr_routes.start_approval(uuid.UUID(cr["id"]), request, db, tenant)
                await db.execute(text(
                    "INSERT INTO change_request_comments (tenant_id, request_id, author_id, author_label, body) "
                    "VALUES (CAST(:t AS uuid), CAST(:r AS uuid), CAST(:u AS uuid), :l, :b)"),
                    {"t": tid, "r": cr["id"], "u": current_user_id(request), "l": current_user_label(), "b": notes[:2000]})
            return {"request_id": cr["id"], "status": "in_approval"}
        except IntegrityError:  # a parallel call opened it first
            if found := await find():
                return found
            raise
    except HTTPException as e:
        logger.warning("entry gate request not opened for module %s: HTTP %s", module, e.status_code)
        d = e.detail.get("problems") if isinstance(e.detail, dict) else e.detail
        return {"reason": "not_accepted" if e.status_code == 422 else "not_opened",
                "detail": ("; ".join(d[:3]) if isinstance(d, list) else str(d))[:300]}
    except Exception as e:  # noqa: BLE001
        logger.error("entry gate request not opened for module %s: %s", module, type(e).__name__)
        return {"reason": "not_opened", "detail": "The change request could not be opened; the verdict stands."}


async def _route(db: AsyncSession, tenant: Tenant, request: Request, module: str, rows: list[dict[str, str]],
                 res: dict[str, Any]) -> int:
    """Attach ``steward_request`` to every blocked or warned record. Returns how many requests were opened or found."""
    n = 0
    for rec, row in zip(res["records"], rows):
        if not (rec["failures"] or (rec.get("duplicates") or {}).get("verdict") == "warn"):
            continue
        if module not in OBJECT_OF:
            rec["steward_request"] = {"reason": "module_has_no_change_request"}
        elif n >= MAX_ROUTED:
            rec["steward_request"] = {"reason": "over_limit"}
        else:
            rec["steward_request"] = await _open_request(db, tenant, request, module, row, rec)
            n += 1
    return sum(1 for r in res["records"] if (r.get("steward_request") or {}).get("request_id"))


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
            d["verdict"] = "warn" if any(m["score"] >= m["threshold"] or m["found_by"] == "near" for m in d["matches"]) else "pass"
            rec["duplicates"] = d
        ds = found["records"]
        dup_audit = {"duplicates_searched": found["search"]["searched"],
                     "duplicate_matches": sum(len(d["matches"]) for d in ds),
                     "duplicate_warned_records": sum(d["verdict"] == "warn" for d in ds),
                     "duplicate_truncated_records": sum(d["truncated"] for d in ds),
                     "duplicate_unsearched_records": sum(not d["searched"] for d in ds)}
    if body.route_to_steward:
        dup_audit["steward_requests"] = await _route(db, tenant, request, body.module,
                                                     fw._clean(body.module, body.records, allow), res)
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
    reqs = (await db.execute(text(
        "SELECT id::text, object, title, status, created_at FROM change_requests WHERE tenant_id = CAST(:t AS uuid) "
        "AND entry_fingerprint IS NOT NULL ORDER BY created_at DESC LIMIT 10"), {"t": str(tenant.id)})).fetchall()
    top = sorted(rule_n.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    return SummaryOut(modules=list(fw.modules()), max_records=fw.MAX_RECORDS, block_severity=fw.BLOCK_SEVERITY,
                      calls_24h=int(row[0] or 0), calls_7d=int(row[1] or 0),
                      last_call_at=row[2].isoformat() if row[2] else None,
                      days=[DayOut(day=k, **_tally(v)) for k, v in sorted(by_day.items())],
                      requests=[GateRequest(id=i, object=o, title=t, status=st, created_at=c.isoformat())
                                for i, o, t, st, c in reqs],
                      top_rules=[TopRule(rule_id=r, description=fw.describe(r) or "", blocked=n) for r, n in top],
                      by_module=[ModuleOut(module=m, **_tally(v)) for m, v in sorted(by_mod.items())
                                 if m in fw.modules()])
