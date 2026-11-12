"""Pilot scorecard per system: precision per rule from steward decisions, recall
against the records the stewards already know are wrong. See
api/services/pilot_scorecard.py — every number is a count, no LLM involved.
"""

import csv
import io
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import pilot_scorecard as sc
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/systems", tags=["pilot"])

_MODULE = r"^[a-z][a-z0-9_]{1,63}$"
_MAX_KNOWN = 200_000
_MAX_MISSED = 500
_FORMULA = ("=", "+", "@", "\t", "\r")


class KnownIssuesUploadOut(BaseModel):
    records: int
    rejected: int


class PilotPrecision(BaseModel):
    reviewed: int
    false_positives: int
    precision: float | None = None
    min_reviewed_per_rule: int
    target: float


class PilotRule(BaseModel):
    check_id: str
    module: str | None = None
    severity: str | None = None
    message: str | None = None
    flagged: int
    open: int
    false_positive: int
    real: int
    reviewed: int
    precision: float | None = None
    rated: bool
    needs_tuning: bool


class KnownIssue(BaseModel):
    module: str | None = None
    record_ref: str
    note: str | None = None


class PilotRecall(BaseModel):
    known: int
    caught: int
    recall: float | None = None
    missed: list[KnownIssue]
    missed_total: int
    objects_not_analysed: list[str]


class PilotScorecard(BaseModel):
    precision: PilotPrecision
    rules: list[PilotRule]
    recall: PilotRecall


async def _system(db: AsyncSession, tenant: Tenant, system_id: uuid.UUID) -> str:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
    if not (await db.execute(text("SELECT 1 FROM sap_systems WHERE id = :sid"), {"sid": str(system_id)})).scalar():
        raise HTTPException(404, "System not found")
    return str(system_id)


@router.post("/{system_id}/pilot/known-issues", response_model=KnownIssuesUploadOut,
             dependencies=[Depends(require_permission("manage_systems"))])
async def upload_known_issues(system_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                              tenant: Tenant = Depends(get_tenant)):
    """Records the stewards know are wrong, as CSV: object,record[,note]. object is the Meridian
    object (e.g. accounts_payable) or blank for any; record is the SAP key, parts separated by
    '|' (e.g. 1000|100001 or LIFNR=100001). Replaces the system's current list."""
    raw = (await request.body())[: 32 * 1024 * 1024]
    try:
        body = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "The file must be UTF-8 text (CSV: object,record,note).")
    rows: dict[tuple[str, str], str | None] = {}
    bad = 0
    for i, rec in enumerate(csv.reader(io.StringIO(body))):
        if len(rec) < 2 or not rec[1].strip():
            continue
        module, ref = rec[0].strip().lower(), rec[1].strip()
        note = rec[2].strip()[:500] if len(rec) > 2 and rec[2].strip() else None
        if i == 0 and module in ("object", "module") and ref.lower() in ("record", "key", "record_key"):
            continue  # header
        if (module and not re.fullmatch(_MODULE, module)) or ref.startswith(_FORMULA) or len(ref) > 300 \
                or not sc.key_values(ref) or (note and note.startswith(_FORMULA)):
            bad += 1
            continue
        rows[(module, ref)] = note
        if len(rows) > _MAX_KNOWN:
            raise HTTPException(413, f"More than {_MAX_KNOWN:,} known issues.")
    if not rows:
        raise HTTPException(400, "No valid rows (expected CSV columns: object,record,note).")
    if bad > len(rows):
        raise HTTPException(400, f"{bad} rows are not 'object,record,note' — check the file layout.")
    scope = await _system(db, tenant, system_id)
    await db.execute(text("DELETE FROM known_issues WHERE scope = :s"), {"s": scope})
    await db.execute(text("""
        INSERT INTO known_issues (tenant_id, scope, module, record_ref, note)
        SELECT :tid, :s, m, r, n FROM unnest(CAST(:m AS text[]), CAST(:r AS text[]), CAST(:n AS text[])) AS t(m, r, n)
    """), {"tid": str(tenant.id), "s": scope, "m": [m for m, _ in rows], "r": [r for _, r in rows],
           "n": list(rows.values())})
    await db.commit()
    return {"records": len(rows), "rejected": bad}


@router.get("/{system_id}/pilot/scorecard", response_model=PilotScorecard,
            dependencies=[Depends(require_permission("view"))])
async def scorecard(system_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    scope = await _system(db, tenant, system_id)
    # the rule's message comes from this system's run that last saw it, not any run of any system
    agg = (await db.execute(text("""
        WITH r AS (
            SELECT ri.check_id, ri.module, (array_agg(ri.severity ORDER BY ri.last_seen_at DESC))[1] AS severity,
                   (array_agg(ri.last_seen_version ORDER BY ri.last_seen_at DESC))[1] AS vid,
                   count(*) AS flagged,
                   count(*) FILTER (WHERE ri.status IN ('open', 'in_progress')) AS open,
                   count(*) FILTER (WHERE ri.steward_verdict = 'false_positive') AS false_positive,
                   count(*) FILTER (WHERE ri.steward_verdict = 'real') AS real
              FROM record_issues ri WHERE ri.tenant_id = :t AND ri.scope = :s
             GROUP BY ri.check_id, ri.module)
        SELECT r.check_id, r.module, r.severity, r.flagged, r.open, r.false_positive, r.real,
               (SELECT f.details->>'message' FROM findings f
                 WHERE f.tenant_id = :t AND f.version_id = r.vid AND f.check_id = r.check_id
                 LIMIT 1) AS message
          FROM r
    """), {"t": str(tenant.id), "s": scope})).mappings().all()
    rules = sc.rate_rules(dict(r) for r in agg)
    reviewed = sum(r["reviewed"] for r in rules)
    real = sum(r["real"] for r in rules)

    known = [dict(r) for r in (await db.execute(text(
        "SELECT module, record_ref, note FROM known_issues WHERE scope = :s ORDER BY module, record_ref"),
        {"s": scope})).mappings().all()]
    issues = (await db.execute(text("SELECT DISTINCT module, record_key FROM record_issues WHERE scope = :s"),
                               {"s": scope})).all()
    caught, missed = sc.recall(known, ((m, k) for m, k in issues))
    analysed = {m for m, _ in issues}
    return {
        "precision": {"reviewed": reviewed, "false_positives": reviewed - real,
                      "precision": round(real / reviewed, 4) if reviewed else None,
                      "min_reviewed_per_rule": sc.MIN_REVIEWED, "target": sc.TARGET_PRECISION},
        "rules": rules,
        "recall": {"known": len(known), "caught": len(caught),
                   "recall": round(len(caught) / len(known), 4) if known else None,
                   "missed": missed[:_MAX_MISSED], "missed_total": len(missed),
                   "objects_not_analysed": sorted({k["module"] for k in known if k["module"]} - analysed)},
    }
