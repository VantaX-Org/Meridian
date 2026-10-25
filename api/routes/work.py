"""Fix work: the steward work list read from work_groups / work_records (api/services/worklist.py).

  GET  /work/summary                       per object: records to fix, issues, by work status
  GET  /work/groups                        what fails, ranked: (check × object) with counts
  GET  /work/records                       failing records, worst first, keyset paged
  GET  /work/records/{module}/{key}        one record: every failing check, current and suggested value, status
  GET  /work/search                        a record by key or name, across objects
  POST /work/decide                        accept / edit / not an issue / undo / assign, for records
  POST /work/groups/{check_id}/accept-all  every machine-proposed value of a group, into my draft batch

Every decision is the existing machinery: a value goes into the user's draft fix batch
(remediation_items, four eyes on approval), a sign-off is a record_issues status with its event.
"""
import base64
import json
import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import worklist
from api.services.rbac import (Scope, _grants_allow, actions_for, current_user_id, current_user_label,
                               dev_role_override, grants_for, has_permission, require_permission)
from api.services.record_issues import scope_of
from api.services.run_context import latest_run

router = APIRouter(prefix="/api/v1/work", tags=["work"])

Status = Literal["to_fix", "proposed", "approved", "sent", "not_an_issue", "fixed"]
OPEN = ("to_fix", "proposed", "approved", "sent")
PAGE = 50
COUNT_CAP = 100_000
MAX_ACCEPT = 50_000
SEVERITIES = ("critical", "high", "medium", "low")


async def _run(db: AsyncSession, tenant: Tenant, version_id: Optional[uuid.UUID]) -> tuple[str, str]:
    """(run id, scope) of the requested run, else the latest; 404 when there is none."""
    vid = str(version_id) if version_id else await latest_run(db, tenant.id)
    if not vid:
        raise HTTPException(status_code=404, detail="No finished run yet.")
    meta = (await db.execute(text("SELECT metadata FROM analysis_versions WHERE id = CAST(:v AS uuid) "
                                  "AND tenant_id = :t"), {"v": vid, "t": str(tenant.id)})).fetchone()
    if not meta:
        raise HTTPException(status_code=404, detail="Run not found.")
    return vid, scope_of(meta[0] or {})


async def _built(db: AsyncSession, vid: str) -> bool:
    """True once the run's work list build finished (api/services/worklist.py build sets the marker last)."""
    return bool((await db.execute(text("SELECT metadata ? 'worklist_built_at' FROM analysis_versions "
                                       "WHERE id = CAST(:v AS uuid)"), {"v": vid})).scalar())


def _cursor(row) -> str:
    return base64.urlsafe_b64encode(json.dumps([row.sev_rank, row.module, row.record_key]).encode()).decode()


def _uncursor(c: str) -> tuple[int, str, str]:
    try:
        rank, module, key = json.loads(base64.urlsafe_b64decode(c.encode()))
        return int(rank), str(module), str(key)
    except Exception:
        raise HTTPException(status_code=422, detail="after is not a cursor from this list")


@router.get("/summary")
async def summary(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """Per object of the run: records and issues to fix, by work status, and its groups' size."""
    await _rls(db, tenant)
    vid, scope = await _run(db, tenant, version_id)
    rows = (await db.execute(text("""
        SELECT module, status, count(*) AS records, sum(issues) AS issues,
               count(*) FILTER (WHERE sev_rank = 0) AS critical, count(*) FILTER (WHERE proposed > 0) AS proposed,
               count(*) FILTER (WHERE due_at < now()) AS overdue
          FROM work_records WHERE tenant_id = :t AND version_id = CAST(:v AS uuid)
         GROUP BY module, status"""), {"t": str(tenant.id), "v": vid})).fetchall()
    objects: dict[str, dict] = {}
    for r in rows:
        o = objects.setdefault(r.module, {"module": r.module, "records": 0, "open": 0, "issues": 0, "critical": 0,
                                          "proposed": 0, "overdue": 0, "statuses": {}})
        o["records"] += r.records
        o["statuses"][r.status] = r.records
        if r.status in OPEN:
            o["open"] += r.records
            o["issues"] += int(r.issues or 0)
            o["critical"] += r.critical
            o["proposed"] += r.proposed
            o["overdue"] += r.overdue
    out = sorted(objects.values(), key=lambda o: (-o["critical"], -o["open"], o["module"]))
    return {"version_id": vid, "scope": scope, "built": await _built(db, vid), "objects": out,
            "totals": {k: sum(o[k] for o in out) for k in ("records", "open", "issues", "critical", "proposed", "overdue")}}


@router.get("/groups")
async def groups(
    version_id: Optional[uuid.UUID] = None,
    module: Optional[str] = None,
    severity: Optional[str] = Query(None, pattern="^(critical|high|medium|low)$"),
    proposed: Optional[bool] = Query(None, description="only groups with machine-proposed values"),
    q: Optional[str] = Query(None, max_length=200),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """What fails in the run, worst first: one row per check, with its records by work status."""
    await _rls(db, tenant)
    vid, _ = await _run(db, tenant, version_id)
    where, p = ["tenant_id = :t", "version_id = CAST(:v AS uuid)"], {"t": str(tenant.id), "v": vid, "limit": limit}
    if module:
        where.append("module = :m")
        p["m"] = module
    if severity:
        where.append("severity = :s")
        p["s"] = severity
    if proposed:
        where.append("proposed > 0")
    if q:
        where.append("(check_id ILIKE :q OR message ILIKE :q OR field ILIKE :q)")
        p["q"] = f"%{q}%"
    rows = (await db.execute(text(f"""
        SELECT check_id, module, severity, dimension, message, field, records, population, proposed, truncated, statuses
          FROM work_groups WHERE {' AND '.join(where)}
         ORDER BY sev_rank, records DESC, check_id LIMIT :limit"""), p)).mappings().all()
    total = (await db.execute(text(f"SELECT count(*) FROM work_groups WHERE {' AND '.join(where)}"), p)).scalar()
    return {"version_id": vid, "built": await _built(db, vid), "total": int(total or 0),
            "groups": [{**dict(r), "open": sum(int((r["statuses"] or {}).get(s, 0)) for s in OPEN)} for r in rows]}


def _records_where(tenant: Tenant, vid: str, request: Request, module, check_id, severity, status, assigned,
                   proposed, q, due=None, part=None) -> tuple[list[str], dict]:
    where, p = ["w.tenant_id = :t", "w.version_id = CAST(:v AS uuid)"], {"t": str(tenant.id), "v": vid}
    if module:
        where.append("w.module = :m")
        p["m"] = module
    if check_id:
        where.append("w.checks @> ARRAY[CAST(:c AS text)]")
        p["c"] = check_id
    if severity:
        where.append("w.sev_rank = :sr")
        p["sr"] = SEVERITIES.index(severity)
    if status == "open":
        where.append("w.status = ANY(:st)")
        p["st"] = list(OPEN)
    elif status:
        where.append("w.status = :st")
        p["st"] = status
    if assigned == "me":
        where.append("w.assigned_to = CAST(:a AS uuid)")
        p["a"] = current_user_id(request)
    elif assigned == "unassigned":
        where.append("w.assigned_to IS NULL")
    elif assigned:
        where.append("w.assigned_to = CAST(:a AS uuid)")
        p["a"] = assigned
    if proposed:
        where.append("w.proposed > 0")
    if part:  # one part of the key, e.g. BUKRS=1000: the records of one company code, plant, sales org
        field, _, value = part.partition("=")
        if not field or not value or not field.replace("_", "").isalnum():
            raise HTTPException(status_code=422, detail="part must look like FIELD=VALUE, e.g. BUKRS=1000")
        where.append("w.record_key ~ :part")
        p["part"] = rf"(^|\|){field.upper()}=0*{re.escape(value.lstrip('0') or '0')}($|\|)"
    if due == "overdue":
        where.append("w.due_at < now()")
    elif due == "today":
        where.append("w.due_at < now() + interval '1 day'")
    if q:
        term = q.strip()
        if "=" in term:  # a key as the record shows it: LIFNR=0000100234
            where.append("w.record_key LIKE :qk")
            p["qk"] = term.replace("%", r"\%").replace("_", r"\_") + "%"
        else:  # a name, or a key value with or without its leading zeros
            where.append("(lower(w.name) LIKE :qn OR w.record_key ~ :qr)")
            p["qn"] = term.lower().replace("%", r"\%").replace("_", r"\_") + "%"
            p["qr"] = r"(^|\|)[A-Z0-9_]+=0*" + "".join("\\" + ch if not ch.isalnum() else ch for ch in term.lstrip("0")) + r"($|\|)"
    return where, p


@router.get("/records")
async def records(
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    module: Optional[str] = None,
    check_id: Optional[str] = None,
    severity: Optional[str] = Query(None, pattern="^(critical|high|medium|low)$"),
    status: Optional[str] = Query("open", pattern="^(open|to_fix|proposed|approved|sent|not_an_issue|fixed)$"),
    assigned: Optional[str] = Query(None, description="'me', 'unassigned' or a user id"),
    proposed: Optional[bool] = None,
    due: Optional[str] = Query(None, pattern="^(overdue|today)$", description="SLA: past due, or due within a day"),
    part: Optional[str] = Query(None, max_length=200, description="a key part, FIELD=VALUE (BUKRS=1000)"),
    q: Optional[str] = Query(None, max_length=200),
    after: Optional[str] = Query(None, description="cursor from the previous page"),
    limit: int = Query(PAGE, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """Failing records of the run, worst first, a page at a time (keyset: no deep OFFSET at millions)."""
    await _rls(db, tenant)
    vid, _ = await _run(db, tenant, version_id)
    where, p = _records_where(tenant, vid, request, module, check_id, severity, status, assigned, proposed, q, due, part)
    page_where = list(where)
    if after:
        rank, mod, key = _uncursor(after)
        page_where.append("(w.sev_rank, w.module, w.record_key) > (:ar, :am, :ak)")
        p.update(ar=rank, am=mod, ak=key)
    rows = (await db.execute(text(f"""
        SELECT w.module, w.record_key, w.name, w.issues, w.sev_rank, w.checks, w.proposed, w.status,
               w.due_at, w.assigned_to, u.email AS assignee_email, g.message AS top_message, g.field AS top_field
          FROM work_records w
          LEFT JOIN users u ON u.id = w.assigned_to
          LEFT JOIN work_groups g ON g.version_id = w.version_id AND g.check_id = w.checks[1]
         WHERE {' AND '.join(page_where)}
         ORDER BY w.sev_rank, w.module, w.record_key LIMIT :lim"""), {**p, "lim": limit + 1})).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    total = (await db.execute(text(f"SELECT count(*) FROM (SELECT 1 FROM work_records w WHERE {' AND '.join(where)} "
                                   f"LIMIT {COUNT_CAP + 1}) x"), p)).scalar() or 0
    return {
        "version_id": vid, "total": min(total, COUNT_CAP), "total_capped": total > COUNT_CAP,
        "next": _cursor(rows[-1]) if more and rows else None,
        "items": [{"module": r.module, "record_key": r.record_key, "name": r.name, "issues": r.issues,
                   "severity": SEVERITIES[r.sev_rank] if r.sev_rank < 4 else "info", "checks": list(r.checks),
                   "proposed": r.proposed, "status": r.status,
                   "due_at": r.due_at.isoformat() if r.due_at else None,
                   "assigned_to": str(r.assigned_to) if r.assigned_to else None, "assignee_email": r.assignee_email,
                   "top_message": r.top_message, "top_field": r.top_field} for r in rows],
    }


@router.get("/search")
async def search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=200),
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """A failing record by key or name across every object of the run (the top bar's search)."""
    await _rls(db, tenant)
    vid, _ = await _run(db, tenant, version_id)
    where, p = _records_where(tenant, vid, request, None, None, None, None, None, None, q)
    rows = (await db.execute(text(f"""
        SELECT w.module, w.record_key, w.name, w.issues, w.sev_rank, w.status FROM work_records w
         WHERE {' AND '.join(where)} ORDER BY w.sev_rank, w.module, w.record_key LIMIT 20"""), p)).fetchall()
    return {"version_id": vid, "items": [{"module": r.module, "record_key": r.record_key, "name": r.name,
                                          "issues": r.issues, "status": r.status,
                                          "severity": SEVERITIES[r.sev_rank] if r.sev_rank < 4 else "info"}
                                         for r in rows]}


async def _cleaning_rows(db: AsyncSession, p: dict) -> list:
    """The record's open cleaning-engine proposals (p: t, m, k)."""
    return (await db.execute(text("""
        SELECT record_data_after, confidence, check_id, field FROM cleaning_queue
         WHERE tenant_id = :t AND object_type = :m AND record_key = :k AND status IN ('detected', 'pending', 'approved')
           AND record_data_after IS NOT NULL AND record_data_after <> '{}'::jsonb
         ORDER BY detected_at DESC LIMIT 5"""), p)).mappings().all()


def _cleaning_value(cleaning: list, field: Optional[str], check_id: str) -> Optional[tuple[str, str]]:
    """(value, confidence) a cleaning proposal gives ``field`` for this check, the record panel's and decide's one
    rule: the full TABLE.FIELD or the bare field, from a proposal for this check or for none."""
    bare = field.split(".")[-1] if field else None
    for c in cleaning:
        after = c["record_data_after"] or {}
        hit = after.get(field) if field in after else after.get(bare) if bare else None
        if hit is not None and c["check_id"] in (None, check_id):
            conf = float(c["confidence"] or 0)
            return str(hit), "high" if conf >= 85 or 0.85 <= conf <= 1 else "medium"
    return None


def _value_fix(vfm: Optional[dict], current: Optional[str]) -> Optional[dict]:
    if not vfm or current is None:
        return None
    hit = vfm.get(current)
    return hit if isinstance(hit, dict) else None


@router.get("/records/{module}/{record_key:path}")
async def record(
    module: str,
    record_key: str,
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """One record: every check it fails in the run, the field, its current value, the suggested value and
    where it comes from, the issue's status and history, and what the user may do."""
    await _rls(db, tenant)
    vid, scope = await _run(db, tenant, version_id)
    p = {"t": str(tenant.id), "v": vid, "m": module, "k": record_key, "scope": scope}
    head = (await db.execute(text("""
        SELECT w.name, w.issues, w.sev_rank, w.status, w.assigned_to, u.email AS assignee_email
          FROM work_records w LEFT JOIN users u ON u.id = w.assigned_to
         WHERE w.tenant_id = :t AND w.version_id = CAST(:v AS uuid) AND w.module = :m AND w.record_key = :k"""),
        p)).fetchone()
    rows = (await db.execute(text("""
        SELECT fr.check_id, fr.field_values, f.severity, f.dimension, f.details->>'message' AS message,
               f.details->>'field_checked' AS field, f.remediation_text, f.value_fix_map,
               f.rule_context->>'why_it_matters' AS why, f.rule_context->>'sap_impact' AS impact,
               (SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array' THEN f.record_fixes ELSE '[]'::jsonb END) e
                 WHERE e->>'record_key' = fr.record_key LIMIT 1) AS record_fix,
               ri.id AS issue_id, ri.status AS issue_status, ri.resolution, ri.steward_verdict, ri.first_seen_at,
               ri.reopened_count, ri.due_at, ri.sla_state,
               f.affected_count, f.total_count, f.pass_rate, f.cost_at_risk, f.module AS rule_module,
               f.rule_context->'valid_values_with_labels' AS valid_values, f.rule_context->>'rule_authority' AS authority,
               (SELECT g.records FROM work_groups g WHERE g.version_id = fr.version_id AND g.check_id = fr.check_id)
                 AS group_records,
               rem.batch_id, rem.batch_status, rem.batch_name, rem.proposed_value AS decided_value,
               rem.proposal_source AS decided_source, rem.updated_at AS decided_at, rem.recon_status
          FROM finding_records fr
          JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
          LEFT JOIN record_issues ri ON ri.tenant_id = fr.tenant_id AND ri.scope = :scope
                                    AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
          LEFT JOIN LATERAL (
                SELECT i.batch_id, b.status AS batch_status, b.name AS batch_name, i.proposed_value,
                       i.proposal_source, i.updated_at, i.recon_status
                  FROM remediation_items i JOIN remediation_batches b ON b.id = i.batch_id
                 WHERE i.tenant_id = fr.tenant_id AND i.scope = :scope AND i.check_id = fr.check_id
                   AND i.record_key = fr.record_key
                 ORDER BY i.updated_at DESC LIMIT 1) rem ON true
         WHERE fr.version_id = CAST(:v AS uuid) AND fr.module = :m AND fr.record_key = :k
         ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  fr.check_id"""), p)).mappings().all()
    if not rows:
        raise HTTPException(status_code=404, detail="This record does not fail any check in this run.")
    cleaning = await _cleaning_rows(db, p)

    rule_rows = await _tenant_rules(db, tenant, module, sorted({r["check_id"] for r in rows}))
    values: dict = {}
    issues = []
    for r in rows:
        fv = r["field_values"] or {}
        values.update({k: v for k, v in fv.items() if k not in values})
        field = r["field"]
        current = fv.get(field) if field else None
        current = None if current is None else str(current)
        rf = r["record_fix"] or {}
        vf = _value_fix(r["value_fix_map"], current)
        suggestion = None
        if rf.get("proposed_value") is not None:
            suggestion = {"value": rf["proposed_value"], "source": "rule", "confidence": rf.get("confidence"),
                          "why": rf.get("fix_instruction")}
        elif vf and vf.get("suggested_value") is not None:
            suggestion = {"value": vf["suggested_value"], "source": "value_map", "confidence": None,
                          "why": vf.get("fix_instruction")}
        elif (hit := _cleaning_value(cleaning, field, r["check_id"])) is not None:
            suggestion = {"value": hit[0], "source": "cleaning", "confidence": hit[1],
                          "why": "Proposed by the cleaning engine"}
        status = ("fixed" if r["issue_status"] == "resolved" else "not_an_issue" if r["issue_status"] == "accepted"
                  else "to_fix" if r["recon_status"] == "still_failing"
                  else "sent" if r["batch_status"] == "exported" else "approved" if r["batch_status"] == "approved"
                  else "proposed" if r["batch_status"] == "draft" and r["decided_value"] is not None else "to_fix")
        failing = r["group_records"] if r["group_records"] is not None else (r["affected_count"] or 0)
        population = r["total_count"] or None
        issues.append({
            "rule": _rule_meta(r, rule_rows.get(r["check_id"])),
            "others_failing": max(int(failing) - 1, 0),
            "failing": int(failing), "population": population,
            "pass_rate": _pass_rate(r["pass_rate"], failing, population),
            "allowed_values": _allowed_values(r["valid_values"], r["rule_module"], r["check_id"]),
            "check_id": r["check_id"], "severity": r["severity"], "dimension": r["dimension"],
            "message": r["message"] or r["check_id"], "field": field, "current_value": current,
            "instruction": rf.get("fix_instruction") or (vf or {}).get("fix_instruction") or r["remediation_text"],
            "why_it_matters": r["why"], "sap_impact": r["impact"], "suggestion": suggestion, "status": status,
            "issue_id": str(r["issue_id"]) if r["issue_id"] else None, "resolution": r["resolution"],
            "first_seen_at": r["first_seen_at"].isoformat() if r["first_seen_at"] else None,
            "reopened_count": r["reopened_count"] or 0,
            "due_at": r["due_at"].isoformat() if r["due_at"] else None, "sla_state": r["sla_state"],
            "decision": None if r["batch_id"] is None else {
                "batch_id": str(r["batch_id"]), "batch_status": r["batch_status"], "batch_name": r["batch_name"],
                "value": r["decided_value"], "source": r["decided_source"], "still_failing": r["recon_status"] == "still_failing",
                "at": r["decided_at"].isoformat() if r["decided_at"] else None},
        })
    events = []
    ids = [i["issue_id"] for i in issues if i["issue_id"]]
    if ids:
        events = [dict(e) for e in (await db.execute(text("""
            SELECT e.action, e.from_value, e.to_value, e.note, e.user_label, e.created_at, ri.check_id
              FROM record_issue_events e JOIN record_issues ri ON ri.id = e.issue_id
             WHERE e.issue_id = ANY(CAST(:ids AS uuid[])) ORDER BY e.created_at DESC LIMIT 50"""),
            {"ids": ids})).mappings().all()]
        for e in events:
            e["created_at"] = e["created_at"].isoformat() if e["created_at"] else None
    role = _perm
    return {
        "version_id": vid, "module": module, "record_key": record_key,
        "name": head.name if head else None,
        "status": head.status if head else issues[0]["status"],
        "assigned_to": str(head.assigned_to) if head and head.assigned_to else None,
        "assignee_email": head.assignee_email if head else None,
        "values": {k: (None if v is None else str(v)) for k, v in values.items()},
        "issues": issues, "events": events,
        "other_runs": await _previous_run(db, tenant, vid, scope, module, record_key, [i["check_id"] for i in issues]),
        **(await _mdm_links(db, tenant, module, record_key)),
        "currency": await _currency(db, tenant) if any(i["rule"]["cost_at_risk"] is not None for i in issues) else None,
        "can": {k: await _allowed(db, tenant, request, role, a)
                for k, a in (("fix", "apply"), ("sign_off", "approve"), ("assign", "assign"), ("comment", "analyse"))},
    }


MAX_ALLOWED = 60


def _pass_rate(stored, failing, population) -> Optional[float]:
    """The check's pass rate in the run, in percent (0 to 100): from the counts, else the stored one."""
    if population:
        return round(max(population - failing, 0) * 100 / population, 1)
    return None if stored is None else round(float(stored), 1)


async def _tenant_rules(db: AsyncSession, tenant: Tenant, module: str, checks: list[str]) -> dict[str, dict]:
    """check id -> the tenant's rules row (id, name) for it: the rule library page opens /rules/<id>."""
    if not checks:
        return {}
    rows = (await db.execute(text("""
        SELECT DISTINCT ON (split_part(name, ':', 1)) split_part(name, ':', 1) AS check_id, id, name FROM rules
         WHERE tenant_id = :t AND module = :m AND split_part(name, ':', 1) = ANY(:c)
         ORDER BY split_part(name, ':', 1), updated_at DESC NULLS LAST"""),
        {"t": str(tenant.id), "m": module, "c": checks})).mappings().all()
    return {r["check_id"]: {"id": str(r["id"]), "name": r["name"]} for r in rows}


def _shipped_rule(module: Optional[str], check_id: str) -> dict:
    from api.services.rule_coverage import shipped
    return shipped().get((check_id, module or ""), {}) or {}


def _rule_meta(r, row: Optional[dict]) -> dict:
    """The rule behind an issue: its library id and name, dimension, authority and the money it puts at risk."""
    y = _shipped_rule(r["rule_module"], r["check_id"])
    name = row["name"].split(":", 1)[1].strip() if row and ":" in row["name"] else (row or {}).get("name")
    failing = r["group_records"] if r["group_records"] is not None else (r["affected_count"] or 0)
    cost = float(r["cost_at_risk"]) if r["cost_at_risk"] is not None else None
    return {
        "id": row["id"] if row else None,
        "name": name or y.get("label") or y.get("message"),
        "dimension": r["dimension"] or y.get("dimension"),
        "authority": r["authority"] or y.get("rule_authority"),
        "cost_at_risk": cost,
        "cost_per_record": round(cost / failing, 2) if cost is not None and failing else None,
    }


def _allowed_values(stored, module: Optional[str], check_id: str) -> Optional[list[dict]]:
    """The values the rule accepts, with their meaning where the rule gives one; None for a rule without a list."""
    src = stored if isinstance(stored, dict) and stored else None
    if src is None:
        y = _shipped_rule(module, check_id)
        src = y.get("valid_values_with_labels") or y.get("allowed_values") or y.get("domain_values")
    if isinstance(src, dict):
        out = [{"value": str(k), "label": None if v is None else str(v)} for k, v in src.items()]
    elif isinstance(src, (list, tuple)):
        out = [{"value": "" if v is None else str(v), "label": None} for v in src]
    else:
        return None
    return out[:MAX_ALLOWED] or None


async def _previous_run(db: AsyncSession, tenant: Tenant, vid: str, scope: str, module: str, record_key: str,
                        checks_now: list[str]) -> Optional[dict]:
    """The record in the system's previous kept run (one with a work list): its issues then against now."""
    prev = (await db.execute(text("""
        SELECT av.id::text AS version_id, av.run_at FROM analysis_versions av
         WHERE av.tenant_id = :t AND av.id <> CAST(:v AS uuid)
           AND av.run_at < (SELECT run_at FROM analysis_versions WHERE id = CAST(:v AS uuid))
           AND EXISTS (SELECT 1 FROM work_records w WHERE w.tenant_id = :t AND w.version_id = av.id AND w.scope = :scope)
         ORDER BY av.run_at DESC LIMIT 1"""), {"t": str(tenant.id), "v": vid, "scope": scope})).mappings().first()
    if not prev:
        return None
    then = (await db.execute(text("""
        SELECT issues, checks, status FROM work_records
         WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND module = :m AND record_key = :k"""),
        {"t": str(tenant.id), "v": prev["version_id"], "m": module, "k": record_key})).mappings().first()
    before = list(then["checks"]) if then else []
    return {
        "version_id": prev["version_id"], "run_at": prev["run_at"].isoformat() if prev["run_at"] else None,
        "on_list": then is not None, "issues": then["issues"] if then else 0, "status": then["status"] if then else None,
        "checks": before, "fixed_since": [c for c in before if c not in checks_now],
        "new_since": [c for c in checks_now if c not in before],
    }


async def _currency(db: AsyncSession, tenant: Tenant) -> str:
    """The currency findings.cost_at_risk is priced in (checks/cost.py: the tenant's cost model, else the default)."""
    from checks.cost import effective
    model = (await db.execute(text("SELECT cost_model FROM tenants WHERE id = :t"), {"t": str(tenant.id)})).scalar()
    return str(effective(model if isinstance(model, dict) else None)["currency"])


def _key_candidates(record_key: str) -> list[str]:
    """The record key as the MDM tables may hold it: whole, and the bare value of its first part (MATNR=1 -> 1)."""
    out = [record_key]
    first = record_key.split("|", 1)[0]
    if "=" in first:
        bare = first.split("=", 1)[1]
        if bare and bare not in out:
            out.append(bare)
    return out


async def _mdm_links(db: AsyncSession, tenant: Tenant, module: str, record_key: str) -> dict:
    """The golden record that keys this record and its open duplicate candidates. Best effort under a short
    statement timeout: a slow MDM table never holds the panel up (the fields are None then)."""
    import logging

    from sqlalchemy.exc import SQLAlchemyError

    out: dict = {"golden_record": None, "duplicates": None}
    p = {"t": str(tenant.id), "m": module, "keys": _key_candidates(record_key)}
    try:
        async with db.begin_nested():
            await db.execute(text("SET LOCAL statement_timeout = '1500ms'"))
            g = (await db.execute(text("""
                SELECT id::text AS id, status, sap_object_key FROM master_records
                 WHERE tenant_id = :t AND domain = :m AND sap_object_key = ANY(:keys) AND merged_into IS NULL
                 ORDER BY (status = 'golden') DESC, updated_at DESC LIMIT 1"""), p)).mappings().first()
            if g:
                out["golden_record"] = {"id": g["id"], "status": g["status"], "key": g["sap_object_key"],
                                        "href": f"/mdm/golden/{g['id']}"}
            n = (await db.execute(text("""
                SELECT count(*) FROM dedup_candidates
                 WHERE tenant_id = :t AND object_type = :m AND status = 'pending'
                   AND (record_key_a = ANY(:keys) OR record_key_b = ANY(:keys))"""), p)).scalar() or 0
            out["duplicates"] = {"open": int(n), "href": "/fix?tab=dedup"}
            await db.execute(text("SET LOCAL statement_timeout = DEFAULT"))
    except SQLAlchemyError as e:  # a timeout or a missing MDM table: the panel shows the record without these links
        logging.getLogger(__name__).info("work record: MDM links skipped for %s: %s", module, type(e).__name__)
    return out


class Decision(BaseModel):
    module: str = Field(min_length=1, max_length=64)
    record_key: str = Field(min_length=1, max_length=2000)
    check_id: Optional[str] = Field(None, max_length=200, description="None: every failing check of the record")
    action: Literal["accept", "edit", "not_an_issue", "accept_risk", "undo", "assign", "comment"]
    value: Optional[str] = Field(None, max_length=4000)
    note: Optional[str] = Field(None, max_length=4000)
    assignee: Optional[str] = Field(None, description="user id, '' to unassign, 'me'")


class DecideBody(BaseModel):
    version_id: Optional[uuid.UUID] = None
    items: list[Decision] = Field(min_length=1, max_length=5000)


_NEEDS = {"accept": "apply", "edit": "apply", "undo": "apply", "not_an_issue": "approve", "accept_risk": "approve",
          "assign": "assign", "comment": "analyse"}


async def _allowed(db: AsyncSession, tenant: Tenant, request: Request, role: str, action: str) -> bool:
    """The caller may do ``action`` tenant-wide, resolved as require_permission resolves it: the role (built-in or
    custom), then the user's unscoped grants."""
    if has_permission(role, action) or action in await actions_for(role, tenant.id, db):
        return True
    uid = getattr(request.state, "local_user_id", None)
    if not uid or dev_role_override(request) is not None:
        return False
    grants = [g for g in await grants_for(db, uid, tenant.id) if g[1] == Scope()]
    return await _grants_allow(grants, action, Scope(), tenant.id, db)


async def _my_draft(db: AsyncSession, tenant: Tenant, request: Request) -> str:
    """The user's open work-list draft batch, created on first use."""
    uid = current_user_id(request)
    found = (await db.execute(text("""
        SELECT id::text FROM remediation_batches
         WHERE tenant_id = :t AND status = 'draft' AND filter->>'source' = 'worklist'
           AND created_by IS NOT DISTINCT FROM CAST(:u AS uuid)
         ORDER BY created_at DESC LIMIT 1"""), {"t": str(tenant.id), "u": uid})).scalar()
    if found:
        return found
    bid = str(uuid.uuid4())
    label = current_user_label()
    await db.execute(text("""
        INSERT INTO remediation_batches (id, tenant_id, name, filter, created_by, created_by_label)
        VALUES (CAST(:id AS uuid), :t, :name, CAST('{"source": "worklist"}' AS jsonb), CAST(:u AS uuid), :label)"""),
        {"id": bid, "t": str(tenant.id), "name": f"Fixes by {label}", "u": uid, "label": label})
    return bid


async def _event(db, tenant: Tenant, request: Request, issue_ids: list[str], action: str, frm, to, note) -> None:
    if issue_ids:
        await db.execute(text("""
            INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, from_value, to_value, note)
            SELECT :t, id, CAST(:u AS uuid), :label, :a, :f, :to, :note FROM record_issues WHERE id = ANY(CAST(:ids AS uuid[]))"""),
            {"t": str(tenant.id), "u": current_user_id(request), "label": current_user_label(), "a": action,
             "f": frm, "to": to, "note": note, "ids": issue_ids})


@router.post("/decide")
async def decide(
    body: DecideBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
):
    """Apply decisions to failing records. Values go to the user's draft fix batch (a second person approves it);
    "not an issue" and "accept the risk" sign the issues off; undo takes a value back out of the draft."""
    missing = sorted({a for a in {_NEEDS[d.action] for d in body.items} if not await _allowed(db, tenant, request, role, a)})
    if missing:
        raise HTTPException(status_code=403, detail=f"Your role cannot {', '.join(missing)}.")
    for d in body.items:
        if d.action == "edit" and (d.value is None or not d.value.strip()):
            raise HTTPException(status_code=400, detail="Give the value to use.")
        if d.action in ("not_an_issue", "accept_risk") and not (d.note or "").strip():
            raise HTTPException(status_code=400, detail="Say why: a sign-off needs a reason.")
        if d.action == "comment" and not (d.note or "").strip():
            raise HTTPException(status_code=400, detail="Write the comment.")
    await _rls(db, tenant)
    vid, scope = await _run(db, tenant, body.version_id)
    uid = current_user_id(request)
    draft: Optional[str] = None
    touched: list[tuple[str, str]] = []
    done = 0
    for d in body.items:
        p = {"t": str(tenant.id), "v": vid, "m": d.module, "k": d.record_key, "scope": scope, "c": d.check_id}
        rows = (await db.execute(text("""
            SELECT fr.check_id, fr.grain, fr.field_values ->> (f.details->>'field_checked') AS current_value,
                   f.details->>'field_checked' AS field, f.value_fix_map,
                   (SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array' THEN f.record_fixes ELSE '[]'::jsonb END) e
                     WHERE e->>'record_key' = fr.record_key AND e->>'proposed_value' IS NOT NULL LIMIT 1) AS record_fix,
                   ri.id::text AS issue_id, ri.status AS issue_status
              FROM finding_records fr
              JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
              LEFT JOIN record_issues ri ON ri.tenant_id = fr.tenant_id AND ri.scope = :scope
                                        AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
             WHERE fr.version_id = CAST(:v AS uuid) AND fr.module = :m AND fr.record_key = :k
               AND (CAST(:c AS text) IS NULL OR fr.check_id = :c)"""), p)).mappings().all()
        if not rows:
            raise HTTPException(status_code=404, detail=f"{d.record_key} does not fail {d.check_id or 'any check'} in this run.")
        issue_ids = [r["issue_id"] for r in rows if r["issue_id"]]
        if d.action in ("accept", "edit"):
            draft = draft or await _my_draft(db, tenant, request)
            for r in rows:
                if d.action == "edit":
                    value, source, conf = d.value, "steward", None
                else:
                    rf, vf = r["record_fix"] or {}, _value_fix(r["value_fix_map"], r["current_value"]) or {}
                    if rf.get("proposed_value") is not None:
                        value, source, conf = rf["proposed_value"], "rule", rf.get("confidence")
                    elif vf.get("suggested_value") is not None:
                        value, source, conf = vf["suggested_value"], "rule", None
                    elif (hit := _cleaning_value(await _cleaning_rows(db, p), r["field"], r["check_id"])) is not None:
                        value, source, conf = hit[0], "cleaning", hit[1]
                    else:
                        if d.check_id:
                            raise HTTPException(status_code=409, detail="No proposed value to accept: enter one.")
                        continue
                await db.execute(text("""
                    INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key,
                                                   grain, field, current_value, proposed_value, proposal_source, confidence)
                    VALUES (:t, CAST(:b AS uuid), CAST(:i AS uuid), :scope, :m, :c, :k, :g, :f, :cur, :val, :src, :conf)
                    ON CONFLICT (batch_id, check_id, record_key) DO UPDATE
                       SET proposed_value = EXCLUDED.proposed_value, proposal_source = EXCLUDED.proposal_source,
                           confidence = EXCLUDED.confidence, accepted = false, updated_at = now()"""),
                    {"t": str(tenant.id), "b": draft, "i": r["issue_id"], "scope": scope, "m": d.module,
                     "c": r["check_id"], "k": d.record_key, "g": r["grain"], "f": r["field"],
                     "cur": r["current_value"], "val": value, "src": source, "conf": conf})
                touched.append((r["check_id"], d.record_key))
                done += 1
            open_ids = [r["issue_id"] for r in rows if r["issue_id"] and r["issue_status"] == "open"]
            if open_ids:
                await db.execute(text("UPDATE record_issues SET status = 'in_progress', updated_at = now(), "
                                      "acknowledged_at = COALESCE(acknowledged_at, now()) WHERE id = ANY(CAST(:ids AS uuid[]))"),
                                 {"ids": open_ids})
                await _event(db, tenant, request, open_ids, "status", "open", "in_progress", d.note or "Fix proposed")
        elif d.action == "undo":
            res = await db.execute(text("""
                DELETE FROM remediation_items i USING remediation_batches b
                 WHERE b.id = i.batch_id AND b.status = 'draft' AND b.created_by IS NOT DISTINCT FROM CAST(:u AS uuid)
                   AND i.tenant_id = :t AND i.scope = :scope AND i.module = :m AND i.record_key = :k
                   AND (CAST(:c AS text) IS NULL OR i.check_id = :c)
                RETURNING i.check_id"""), {**p, "u": uid})
            gone = [c for (c,) in res.fetchall()]
            back = [r["issue_id"] for r in rows if r["issue_id"] and r["issue_status"] in ("in_progress", "accepted")]
            if back:
                await db.execute(text("UPDATE record_issues SET status = 'open', resolution = NULL, resolved_at = NULL, "
                                      "steward_verdict = NULL, updated_at = now() WHERE id = ANY(CAST(:ids AS uuid[]))"),
                                 {"ids": back})
                for prev in ("in_progress", "accepted"):  # the from-value tells analytics a sign-off was withdrawn
                    ids = [r["issue_id"] for r in rows if r["issue_id"] in back and r["issue_status"] == prev]
                    await _event(db, tenant, request, ids, "status", prev, "open", d.note or "Decision undone")
            touched += [(c, d.record_key) for c in gone] + [(r["check_id"], d.record_key) for r in rows]
            done += len(gone) + len(back)
        elif d.action in ("not_an_issue", "accept_risk"):
            res = "false_positive" if d.action == "not_an_issue" else "accepted_risk"
            if issue_ids:
                await db.execute(text("""
                    UPDATE record_issues SET status = 'accepted', resolution = :res, resolved_at = now(), updated_at = now(),
                           steward_verdict = CASE WHEN :res = 'false_positive' THEN 'false_positive' ELSE 'real' END
                     WHERE id = ANY(CAST(:ids AS uuid[]))"""), {"res": res, "ids": issue_ids})
                await _event(db, tenant, request, issue_ids, "status", None, "accepted", d.note)
            touched += [(r["check_id"], d.record_key) for r in rows]
            done += len(issue_ids)
        elif d.action == "assign":
            assignee = uid if d.assignee == "me" else (d.assignee or None)
            if assignee and not (await db.execute(text("SELECT 1 FROM users WHERE id = CAST(:u AS uuid)"),
                                                  {"u": assignee})).scalar():
                raise HTTPException(status_code=404, detail="Assignee not found.")
            if issue_ids:
                await db.execute(text("UPDATE record_issues SET assigned_to = CAST(:a AS uuid), assigned_at = now(), "
                                      "updated_at = now() WHERE id = ANY(CAST(:ids AS uuid[]))"),
                                 {"a": assignee, "ids": issue_ids})
                await _event(db, tenant, request, issue_ids, "assign", None, assignee, d.note)
            touched += [(r["check_id"], d.record_key) for r in rows]
            done += len(issue_ids)
        elif d.action == "comment":
            await _event(db, tenant, request, issue_ids, "comment", None, None, d.note)
            done += len(issue_ids)
    if touched:
        await db.run_sync(lambda s: worklist.refresh(s, str(tenant.id), scope, touched))
    await db.commit()
    return {"updated": done, "draft_batch_id": draft}


@router.post("/groups/{check_id}/accept-all")
async def accept_all(
    check_id: str,
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("apply")),
):
    """Every machine-proposed value of one group (still to fix) into the user's draft batch, set-based."""
    await _rls(db, tenant)
    vid, scope = await _run(db, tenant, version_id)
    draft = await _my_draft(db, tenant, request)
    p = {"t": str(tenant.id), "v": vid, "c": check_id, "scope": scope, "b": draft, "cap": MAX_ACCEPT}
    res = await db.execute(text("""
        WITH f AS (SELECT * FROM findings WHERE version_id = CAST(:v AS uuid) AND check_id = :c),
             auto AS (SELECT e->>'record_key' AS record_key, e->>'proposed_value' AS value, e->>'confidence' AS conf
                        FROM f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array' THEN f.record_fixes ELSE '[]'::jsonb END) e
                       WHERE e->>'proposed_value' IS NOT NULL),
             cand AS (
                SELECT fr.module, fr.record_key, fr.grain, f.details->>'field_checked' AS field,
                       fr.field_values ->> (f.details->>'field_checked') AS current_value,
                       COALESCE(a.value, f.value_fix_map -> (fr.field_values ->> (f.details->>'field_checked'))
                                                         ->> 'suggested_value') AS value,
                       a.conf, ri.id AS issue_id, ri.status AS issue_status
                  FROM finding_records fr JOIN f ON f.check_id = fr.check_id
                  LEFT JOIN auto a ON a.record_key = fr.record_key
                  LEFT JOIN record_issues ri ON ri.tenant_id = fr.tenant_id AND ri.scope = :scope
                                            AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
                 WHERE fr.version_id = CAST(:v AS uuid) AND fr.check_id = :c
                   AND COALESCE(ri.status, 'open') IN ('open', 'in_progress')
                   AND NOT EXISTS (SELECT 1 FROM remediation_items i JOIN remediation_batches b ON b.id = i.batch_id
                                    WHERE i.tenant_id = fr.tenant_id AND i.scope = :scope AND i.check_id = fr.check_id
                                      AND i.record_key = fr.record_key AND b.status IN ('approved', 'exported'))
                 LIMIT :cap),
             ins AS (
                INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key, grain,
                                               field, current_value, proposed_value, proposal_source, confidence)
                SELECT :t, CAST(:b AS uuid), issue_id, :scope, module, :c, record_key, grain, field, current_value,
                       value, 'rule', conf FROM cand WHERE value IS NOT NULL
                ON CONFLICT (batch_id, check_id, record_key) DO UPDATE
                   SET proposed_value = EXCLUDED.proposed_value, proposal_source = 'rule',
                       confidence = EXCLUDED.confidence, updated_at = now()
                 -- a value the steward entered stays: accept-all only fills undecided records
                 WHERE remediation_items.proposal_source IS DISTINCT FROM 'steward'
                RETURNING record_key, issue_id)
        SELECT record_key, issue_id::text FROM ins"""), p)
    rows = res.fetchall()
    open_ids = [i for _, i in rows if i]
    if open_ids:
        await db.execute(text("UPDATE record_issues SET status = 'in_progress', updated_at = now(), "
                              "acknowledged_at = COALESCE(acknowledged_at, now()) "
                              "WHERE id = ANY(CAST(:ids AS uuid[])) AND status = 'open'"), {"ids": open_ids})
        await _event(db, tenant, request, open_ids, "status", "open", "in_progress", "Proposed values accepted for the group")
    if rows:
        await db.run_sync(lambda s: worklist.refresh(s, str(tenant.id), scope, [(check_id, k) for k, _ in rows]))
    await db.commit()
    return {"accepted": len(rows), "draft_batch_id": draft}


@router.post("/build")
async def build_now(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("analyse")),
):
    """Queue a work-list build for a run that has none (runs from before the work list, or a failed build)."""
    await _rls(db, tenant)
    vid, _ = await _run(db, tenant, version_id)
    from workers.tasks.build_worklist import build_worklist
    build_worklist.delay(vid, str(tenant.id))
    return {"version_id": vid, "queued": True}


class SetValue(BaseModel):
    value: str = Field(min_length=1, max_length=4000)
    only_blank: bool = Field(False, description="only records whose current value is blank")


@router.post("/groups/{check_id}/set-value")
async def set_value(
    check_id: str,
    body: SetValue,
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("apply")),
):
    """One value for every open record of a group (mass edit), into the user's draft batch, set-based."""
    await _rls(db, tenant)
    vid, scope = await _run(db, tenant, version_id)
    draft = await _my_draft(db, tenant, request)
    blank = "AND COALESCE(btrim(fr.field_values ->> (f.details->>'field_checked')), '') = ''" if body.only_blank else ""
    rows = (await db.execute(text(f"""
        WITH ins AS (
            INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key, grain,
                                           field, current_value, proposed_value, proposal_source)
            SELECT :t, CAST(:b AS uuid), ri.id, :scope, fr.module, fr.check_id, fr.record_key, fr.grain,
                   f.details->>'field_checked', fr.field_values ->> (f.details->>'field_checked'), :val, 'steward'
              FROM finding_records fr
              JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
              LEFT JOIN record_issues ri ON ri.tenant_id = fr.tenant_id AND ri.scope = :scope
                                        AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
             WHERE fr.version_id = CAST(:v AS uuid) AND fr.check_id = :c {blank}
               AND COALESCE(ri.status, 'open') IN ('open', 'in_progress')
             LIMIT :cap
            ON CONFLICT (batch_id, check_id, record_key) DO UPDATE
               SET proposed_value = EXCLUDED.proposed_value, proposal_source = 'steward', confidence = NULL,
                   accepted = false, updated_at = now()
            RETURNING record_key, issue_id)
        SELECT record_key, issue_id::text FROM ins"""),
        {"t": str(tenant.id), "b": draft, "scope": scope, "v": vid, "c": check_id, "val": body.value,
         "cap": MAX_ACCEPT})).fetchall()
    open_ids = [i for _, i in rows if i]
    if open_ids:
        await db.execute(text("UPDATE record_issues SET status = 'in_progress', updated_at = now(), "
                              "acknowledged_at = COALESCE(acknowledged_at, now()) "
                              "WHERE id = ANY(CAST(:ids AS uuid[])) AND status = 'open'"), {"ids": open_ids})
        await _event(db, tenant, request, open_ids, "status", "open", "in_progress", f"Value set for the group: {body.value}")
    if rows:
        await db.run_sync(lambda s: worklist.refresh(s, str(tenant.id), scope, [(check_id, k) for k, _ in rows]))
    await db.commit()
    return {"updated": len(rows), "draft_batch_id": draft}


# ── spreadsheet round trip ───────────────────────────────────────────────────

SHEET = "Fix sheet"
_SHEET_COLUMNS = [
    ("module", "Object"), ("record_key", "Record"), ("name", "Name"), ("check_id", "Check"),
    ("severity", "Severity"), ("message", "Issue"), ("field", "Field"), ("current_value", "Current value"),
    ("suggested_value", "Suggested value"), ("new_value", "New value"), ("decision", "Decision"),
    ("reason", "Reason"),
]
DECISIONS = {"fix": "accept", "not an issue": "not_an_issue", "accept risk": "accept_risk"}
MAX_IMPORT = 5000
MAX_IMPORT_BYTES = 25 * 1024 * 1024


@router.get("/export")
async def export_sheet(
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    module: Optional[str] = None,
    check_id: Optional[str] = None,
    severity: Optional[str] = Query(None, pattern="^(critical|high|medium|low)$"),
    status: Optional[str] = Query("open", pattern="^(open|to_fix|proposed|approved|sent|not_an_issue|fixed)$"),
    assigned: Optional[str] = None,
    proposed: Optional[bool] = None,
    due: Optional[str] = Query(None, pattern="^(overdue|today)$"),
    part: Optional[str] = Query(None, max_length=200),
    q: Optional[str] = Query(None, max_length=200),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("export")),
):
    """The filtered work list as a fix sheet: one row per record and failing check, with its current and
    suggested value and blank New value / Decision / Reason columns to fill in and import back."""
    from api.services.branded_xlsx import ROW_CAP, ColumnSpec, SheetSpec, build_workbook, xlsx_filename, xlsx_response

    await _rls(db, tenant)
    vid, _ = await _run(db, tenant, version_id)
    where, p = _records_where(tenant, vid, request, module, check_id, severity, status, assigned, proposed, q, due, part)
    check_filter = "AND fr.check_id = :c" if check_id else ""
    rows = (await db.execute(text(f"""
        WITH auto AS (
            SELECT f.check_id, e->>'record_key' AS record_key, e->>'proposed_value' AS value
              FROM findings f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array'
                                                         THEN f.record_fixes ELSE '[]'::jsonb END) e
             WHERE f.version_id = CAST(:v AS uuid) AND e->>'proposed_value' IS NOT NULL)
        SELECT w.module, w.record_key, w.name, fr.check_id, f.severity, f.details->>'message' AS message,
               f.details->>'field_checked' AS field,
               fr.field_values ->> (f.details->>'field_checked') AS current_value,
               COALESCE(a.value, CASE WHEN jsonb_typeof(f.value_fix_map) = 'object' THEN
                        f.value_fix_map -> (fr.field_values ->> (f.details->>'field_checked')) ->> 'suggested_value' END)
                 AS suggested_value
          FROM work_records w
          JOIN finding_records fr ON fr.version_id = w.version_id AND fr.module = w.module AND fr.record_key = w.record_key
          JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
          LEFT JOIN auto a ON a.check_id = fr.check_id AND a.record_key = fr.record_key
         WHERE {' AND '.join(where)} {check_filter}
         ORDER BY w.sev_rank, w.module, w.record_key, fr.check_id
         LIMIT :lim"""), {**p, "lim": ROW_CAP + 1})).mappings().all()
    data = build_workbook(
        tenant_name=tenant.name, run_label=None, run_id=vid, title="Fix sheet",
        sheets=[SheetSpec(
            title=SHEET, rows=[dict(r) for r in rows],
            note="Fill in New value (or Decision: fix, not an issue, accept risk, with a Reason) and import it back.",
            columns=[ColumnSpec(key=k, header=h, kind="mono" if k in ("record_key", "check_id", "field") else "text")
                     for k, h in _SHEET_COLUMNS])],
    )
    return xlsx_response(data, xlsx_filename("fix-sheet", vid))


@router.post("/import")
async def import_sheet(
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("apply")),
):
    """Read a filled-in fix sheet (from /work/export) back as decisions: a New value is an edit, a Decision of
    fix accepts the suggested value, not an issue / accept risk sign the issue off with the Reason."""
    import io

    from openpyxl import load_workbook

    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=400, detail="Attach the fix sheet as 'file'.")
    content = await upload.read()
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 25 MB.")
    if content[:4] != b"PK\x03\x04":
        raise HTTPException(status_code=422, detail="This is not an .xlsx file.")
    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(status_code=422, detail="The workbook could not be read.")
    if SHEET not in wb.sheetnames:
        raise HTTPException(status_code=422, detail=f"No '{SHEET}' sheet: export the fix sheet from Meridian first.")
    it = wb[SHEET].iter_rows(values_only=True)
    header = [str(h or "").strip() for h in next(it, ())]
    col = {key: header.index(h) for key, h in _SHEET_COLUMNS if h in header}
    if not {"module", "record_key", "check_id", "new_value", "decision"} <= set(col):
        raise HTTPException(status_code=422, detail="The sheet's columns were changed: export a fresh fix sheet.")
    items, skipped = [], []
    for n, row in enumerate(it, start=2):
        cell = lambda k: (None if k not in col or col[k] >= len(row) or row[col[k]] is None else str(row[col[k]]).strip())
        new, decision, reason = cell("new_value"), (cell("decision") or "").lower(), cell("reason")
        if not new and not decision:
            continue
        action = "edit" if new else DECISIONS.get(decision)
        if action is None:
            skipped.append(f"row {n}: decision '{decision}' is not fix, not an issue or accept risk")
            continue
        if action in ("not_an_issue", "accept_risk") and not reason:
            skipped.append(f"row {n}: a sign-off needs a reason")
            continue
        items.append(Decision(module=cell("module") or "", record_key=cell("record_key") or "",
                              check_id=cell("check_id"), action=action, value=new, note=reason))
    if not items:
        return {"updated": 0, "rows": 0, "skipped": skipped[:50]}
    if len(items) > MAX_IMPORT:
        raise HTTPException(status_code=400, detail=f"More than {MAX_IMPORT} decisions in one file; split it.")
    await _rls(db, tenant)
    vid, _ = await _run(db, tenant, version_id)
    failing = set((await db.execute(text("""
        SELECT fr.module, fr.record_key, fr.check_id FROM finding_records fr
          JOIN unnest(CAST(:m AS text[]), CAST(:k AS text[]), CAST(:c AS text[])) AS x(module, record_key, check_id)
            ON fr.module = x.module AND fr.record_key = x.record_key AND fr.check_id = x.check_id
         WHERE fr.version_id = CAST(:v AS uuid)"""),
        {"v": vid, "m": [i.module for i in items], "k": [i.record_key for i in items],
         "c": [i.check_id or "" for i in items]})).fetchall())
    kept = [i for i in items if (i.module, i.record_key, i.check_id) in failing]
    skipped += [f"{i.record_key} {i.check_id}: does not fail this check in the run" for i in items if i not in kept]
    if not kept:
        return {"updated": 0, "rows": 0, "skipped": skipped[:50]}
    items = kept
    out = await decide(DecideBody(version_id=version_id, items=items), request, db, tenant, role)
    return {**out, "rows": len(items), "skipped": skipped[:50]}
