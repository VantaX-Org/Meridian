"""Record history and time travel: one record across every run, and an object as it stood at any run.

GET /api/v1/work/records/{module}/{key}/history   every run of the record's system that measured the object, oldest
                                                  first: whether the record failed, its failing checks, the values of
                                                  its failing fields and its work status; and every decision on it in
                                                  order (record issue events, fix batch items, approvals, sends)
GET /api/v1/objects/{module}/as-of?run=           the object as it stood when run ``run`` finished: its newest run at
                                                  or before it (of the same system), with score, cap, breaches,
                                                  dimensions and rules
GET /api/v1/work/records?as_of_run=               the ledger as it stood at a run (api/routes/work.py records)

Read-only, permission view, RLS; every query carries the tenant id. Registered before the work router: its
``/records/{module}/{record_key:path}`` would otherwise swallow ``/history``. The history reads use migration 116's
(tenant, object, record key) indexes on work_records, record_issues and remediation_items and finding_records'
(tenant, record key) index, so one record is an index probe per table, not a scan of every run.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.rbac import require_permission, scope_from_path
from api.services.version_status import finished_sql

router = APIRouter(prefix="/api/v1", tags=["record-history"])

MAX_RUNS = 100
SEVERITIES = ("critical", "high", "medium", "low")


class HistoryRunOut(BaseModel):
    run_id: str = Field(description="Run id.")
    run_at: datetime = Field(description="When the run finished.")
    label: Optional[str] = Field(None, description="Run label.")
    system_id: Optional[str] = Field(None, description="SAP system of the run.")
    sandbox: bool = Field(False, description="True for a sandbox run.")
    failing: bool = Field(description="True when the record failed a rule in that run.")
    checks: list[str] = Field(description="Rule ids the record failed in that run.")
    values: dict[str, Optional[str]] = Field(description="The failing fields' values in that run (TABLE.FIELD -> value).")
    work_status: Optional[str] = Field(None, description="The record's work status on that run's row (today's).")
    severity: Optional[str] = Field(None, description="Highest severity the record failed in that run.")


class HistoryEventOut(BaseModel):
    at: Optional[datetime] = Field(None, description="When it happened.")
    kind: str = Field(description="Event kind: issue, fix_proposed, batch, fix_approved or fix_sent.")
    action: Optional[str] = Field(None, description="What was done.")
    check_id: Optional[str] = Field(None, description="Rule the event concerns.")
    run_id: Optional[str] = Field(None, description="Run the event concerns.")
    scope: Optional[str] = Field(None, description="Scope of the decision (record, rule or object).")
    from_value: Optional[str] = Field(None, description="Field value before the fix.")
    to_value: Optional[str] = Field(None, description="Field value after the fix.")
    note: Optional[str] = Field(None, description="Note left with the event.")
    by: Optional[str] = Field(None, description="Who did it.")
    batch_id: Optional[str] = Field(None, description="Fix batch id.")
    batch_status: Optional[str] = Field(None, description="Fix batch status.")


class HistoryOut(BaseModel):
    module: str = Field(description="Object (module id).")
    record_key: str = Field(description="SAP record key.")
    name: Optional[str] = Field(None, description="Record description, when known.")
    systems: list[str] = Field(description="SAP systems the record was read from.")
    runs: list[HistoryRunOut] = Field(description="The record in each run, newest first.")
    events: list[HistoryEventOut] = Field(description="Decisions and fixes on the record, newest first.")


def _value(v: Any) -> Optional[str]:
    return None if v is None else str(v)


@router.get("/work/records/{module}/{record_key:path}/history", response_model=HistoryOut,
            dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def record_history(module: str, record_key: str,
                         system: Optional[str] = Query(None, max_length=100, description="source system id, or 'upload'"),
                         limit: int = Query(50, ge=1, le=MAX_RUNS),
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Every run's values for the record's failing fields, and every decision on it, in order."""
    await _rls(db, tenant)
    t = str(tenant.id)
    p = {"t": t, "m": module, "k": record_key}
    work = (await db.execute(text(
        "SELECT version_id::text AS v, scope, status, sev_rank, checks, name FROM work_records "
        "WHERE tenant_id = CAST(:t AS uuid) AND module = :m AND record_key = :k"), p)).mappings().all()
    found = (await db.execute(text(
        "SELECT version_id::text AS v, check_id, field_values FROM finding_records "
        "WHERE tenant_id = CAST(:t AS uuid) AND record_key = :k AND module = :m"), p)).mappings().all()
    seen_runs = sorted({w["v"] for w in work} | {f["v"] for f in found})
    systems: list[str] = []
    if seen_runs:
        systems = sorted({r[0] for r in (await db.execute(text(
            "SELECT DISTINCT COALESCE(metadata->>'system_id', 'upload') FROM analysis_versions "
            "WHERE tenant_id = CAST(:t AS uuid) AND id = ANY(CAST(:ids AS uuid[]))"), {"t": t, "ids": seen_runs}))})
    if system:
        systems = [s for s in systems if s == system]
    if not systems:
        raise HTTPException(status_code=404, detail="No run has this record failing.")
    runs = (await db.execute(text(f"""
        SELECT id::text AS v, run_at, label, metadata->>'system_id' AS sid, metadata->>'sandbox' = 'true' AS sandbox
          FROM analysis_versions
         WHERE tenant_id = CAST(:t AS uuid) AND {finished_sql()} AND dqs_summary ? :m
           AND COALESCE(metadata->>'system_id', 'upload') = ANY(:sys)
           AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
         ORDER BY run_at DESC, id DESC LIMIT :n"""), {**p, "sys": systems, "n": limit})).mappings().all()
    work_of = {w["v"]: w for w in work}
    values: dict[str, dict[str, Optional[str]]] = {}
    checks_of: dict[str, set[str]] = {}
    for f in found:
        checks_of.setdefault(f["v"], set()).add(f["check_id"])
        for field, val in (f["field_values"] or {}).items() if isinstance(f["field_values"], dict) else []:
            values.setdefault(f["v"], {})[field] = _value(val)
    out_runs = []
    for r in reversed(runs):
        w = work_of.get(r["v"])
        checks = sorted(set(w["checks"] or []) | checks_of.get(r["v"], set()) if w else checks_of.get(r["v"], set()))
        out_runs.append({
            "run_id": r["v"], "run_at": r["run_at"], "label": r["label"], "system_id": r["sid"],
            "sandbox": bool(r["sandbox"]), "failing": bool(checks), "checks": checks,
            "values": values.get(r["v"], {}), "work_status": w["status"] if w else None,
            "severity": (SEVERITIES[w["sev_rank"]] if w["sev_rank"] < 4 else "info") if w else None})
    name = next((w["name"] for w in sorted(work, key=lambda x: x["v"]) if w["name"]), None)

    events: list[dict] = []
    for e in (await db.execute(text("""
        SELECT e.created_at AS at, e.action, ri.check_id, e.version_id::text AS run_id, ri.scope, e.from_value,
               e.to_value, e.note, e.user_label AS by
          FROM record_issues ri JOIN record_issue_events e ON e.issue_id = ri.id AND e.tenant_id = ri.tenant_id
         WHERE ri.tenant_id = CAST(:t AS uuid) AND ri.module = :m AND ri.record_key = :k"""), p)).mappings().all():
        events.append({"kind": "issue", **dict(e)})
    items = (await db.execute(text("""
        SELECT i.id::text AS item_id, i.updated_at, i.check_id, i.scope, i.field, i.current_value, i.proposed_value,
               i.proposal_source, b.id::text AS batch_id, b.status AS batch_status, b.created_by_label,
               b.approved_at, b.approved_by_label, b.exported_at
          FROM remediation_items i JOIN remediation_batches b ON b.id = i.batch_id AND b.tenant_id = i.tenant_id
         WHERE i.tenant_id = CAST(:t AS uuid) AND i.module = :m AND i.record_key = :k"""), p)).mappings().all()
    batch_done: set[tuple[str, str]] = set()
    for i in items:
        events.append({"kind": "fix_proposed", "at": i["updated_at"], "action": i["proposal_source"],
                       "check_id": i["check_id"], "scope": i["scope"], "from_value": i["current_value"],
                       "to_value": i["proposed_value"], "note": i["field"], "by": i["created_by_label"],
                       "batch_id": i["batch_id"], "batch_status": i["batch_status"]})
        if i["approved_at"] and (i["batch_id"], "approved") not in batch_done:
            batch_done.add((i["batch_id"], "approved"))
            events.append({"kind": "fix_approved", "at": i["approved_at"], "by": i["approved_by_label"],
                           "batch_id": i["batch_id"], "batch_status": i["batch_status"], "scope": i["scope"]})
        if i["exported_at"] and (i["batch_id"], "sent") not in batch_done:
            batch_done.add((i["batch_id"], "sent"))
            events.append({"kind": "fix_sent", "at": i["exported_at"], "batch_id": i["batch_id"],
                           "batch_status": i["batch_status"], "scope": i["scope"]})
    if items:
        for e in (await db.execute(text("""
            SELECT re.created_at AS at, re.action, re.from_value, re.to_value, re.user_label AS by,
                   re.version_id::text AS run_id, re.batch_id::text AS batch_id, i.check_id, i.scope
              FROM remediation_events re JOIN remediation_items i ON i.id = re.item_id AND i.tenant_id = re.tenant_id
             WHERE re.tenant_id = CAST(:t AS uuid) AND re.item_id = ANY(CAST(:ids AS uuid[]))"""),
                {"t": t, "ids": [i["item_id"] for i in items]})).mappings().all():
            events.append({"kind": "batch", **dict(e)})
    events.sort(key=lambda e: (e.get("at") is None, e.get("at") or datetime.min, e["kind"], e.get("check_id") or ""))
    return {"module": module, "record_key": record_key, "name": name, "systems": systems, "runs": out_runs,
            "events": events}


class AsOfRuleOut(BaseModel):
    check_id: str = Field(description="Rule id.")
    severity: str = Field(description="Rule severity.")
    dimension: Optional[str] = Field(None, description="DAMA dimension of the rule.")
    failing: int = Field(description="Records failing.")
    total: int = Field(description="Records checked.")
    pass_rate: Optional[float] = Field(None, description="Share of records passing, 0 to 100.")


class AsOfOut(BaseModel):
    module: str = Field(description="Object (module id).")
    as_of_run: str = Field(description="Run asked for.")
    as_of_at: datetime = Field(description="Time asked for.")
    run_id: str = Field(description="Run that answers (the last one on or before the time).")
    run_at: datetime = Field(description="When that run finished.")
    system_id: Optional[str] = Field(None, description="SAP system of the run.")
    score: Optional[float] = Field(None, description="Object score in that run, after caps.")
    raw_score: Optional[float] = Field(None, description="Score before caps.")
    capped: bool = Field(False, description="True when a critical cap applied.")
    cap_level: Optional[int] = Field(None, description="Cap applied (85 or 70).")
    breaches: list[str] = Field(description="Critical rules over tolerance.")
    dimensions: dict[str, float] = Field(description="Score per DAMA dimension.")
    records_checked: Optional[int] = Field(None, description="Records checked.")
    failing_records: int = Field(description="The run's failing records of the object (work list rows, else its stored failing records).")
    rules: list[AsOfRuleOut] = Field(description="Rule results in that run.")


@router.get("/objects/{module}/as-of", response_model=AsOfOut,
            dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def object_as_of(module: str, run: uuid.UUID = Query(..., description="the run whose moment to read"),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The object as it stood when ``run`` finished: its newest finished run of the same system (lineage) at or before
    it that measured the object."""
    from api.routes.objects import _measured_dimensions, breach_ids, cap_level_of, records_checked_of
    from api.services.run_lineage import same_lineage_as

    await _rls(db, tenant)
    t = str(tenant.id)
    at = (await db.execute(text("SELECT run_at FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                           {"v": str(run), "t": t})).scalar()
    if at is None:
        raise HTTPException(status_code=404, detail="Run not found")
    row = (await db.execute(text(f"""
        SELECT id::text AS v, run_at, metadata->>'system_id' AS sid, dqs_summary->:m AS summ
          FROM analysis_versions av
         WHERE tenant_id = CAST(:t AS uuid) AND {finished_sql()} AND dqs_summary ? :m AND run_at <= :at
           AND {same_lineage_as("v", "av")}
           AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
         ORDER BY run_at DESC, id DESC LIMIT 1"""), {"t": t, "m": module, "at": at, "v": str(run)})).mappings().first()
    if row is None or not isinstance(row["summ"], dict):
        raise HTTPException(status_code=404, detail="The object was not measured at or before this run")
    m = row["summ"]
    rules = (await db.execute(text(
        "SELECT check_id, severity, dimension, affected_count, total_count, pass_rate FROM findings "
        "WHERE version_id = CAST(:v AS uuid) AND tenant_id = CAST(:t AS uuid) AND module = :m "
        "ORDER BY affected_count DESC, check_id"), {"v": row["v"], "t": t, "m": module})).mappings().all()
    failing = (await db.execute(text(
        "SELECT count(*) FROM work_records WHERE tenant_id = CAST(:t AS uuid) AND version_id = CAST(:v AS uuid) "
        "AND module = :m"), {"v": row["v"], "t": t, "m": module})).scalar() or 0
    if not failing:  # an older run's work list is pruned (worklist.KEEP_RUNS); its failing records are still stored
        failing = (await db.execute(text(
            "SELECT count(DISTINCT record_key) FROM finding_records WHERE tenant_id = CAST(:t AS uuid) "
            "AND version_id = CAST(:v AS uuid) AND module = :m"), {"v": row["v"], "t": t, "m": module})).scalar() or 0
    widest = max((int(r["total_count"] or 0) for r in rules), default=0) or None
    return {
        "module": module, "as_of_run": str(run), "as_of_at": at, "run_id": row["v"], "run_at": row["run_at"],
        "system_id": row["sid"], "score": m.get("composite_score"), "raw_score": m.get("raw_score"),
        "capped": bool(m.get("capped")), "cap_level": cap_level_of(m), "breaches": breach_ids(m),
        "dimensions": _measured_dimensions(m), "records_checked": records_checked_of(m, widest),
        "failing_records": int(failing),
        "rules": [{"check_id": r["check_id"], "severity": r["severity"], "dimension": r["dimension"],
                   "failing": int(r["affected_count"] or 0), "total": int(r["total_count"] or 0),
                   "pass_rate": float(r["pass_rate"]) if r["pass_rate"] is not None else None} for r in rules],
    }
