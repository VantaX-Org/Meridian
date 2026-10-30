"""Prove a rule in SAP: the reconciliation pack of one rule in one run, and the workbook of the rules that fail most.

GET /api/v1/rules/{check_id}/reconcile?run=<version_id>
    The SE16 / SE16N selection that reproduces the rule's population and failing count of that run, what SE16 alone
    cannot express (in plain words), the record grain, the counts Meridian measured and five failing record keys
    (ALPHA-formatted for display, the stored key alongside). Built by api/services/reconcile.py from the rule's YAML,
    its check type, the population policy and the join graph. ``view``; tenant-scoped; 404 with a sentence when the
    rule or the run is unknown, or the run did not measure the rule.

GET /api/v1/runs/{run_id}/reconciliation.xlsx?top=10
    The reconciliation workbook: a summary sheet (one row per rule, with empty "SE16 count" and "Match" columns for
    the customer's team to fill in) and one sheet per rule with its selection, counts and sample keys, for the ``top``
    rules with the most failing records in the run. ``export``; audited (the rule ids, never record values).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.objects import _label
from api.routes.record_issues import _rls
from api.services import reconcile as rc
from api.services.rbac import require_permission, write_audit

router = APIRouter(prefix="/api/v1", tags=["rules"])


class SelectionLineOut(BaseModel):
    table: str
    field: str
    operator: str          # EQ NE GT LT GE LE CP initial not_initial in not_in
    values: list[str]
    part: str              # population | failing
    words: str


class ConditionOut(BaseModel):
    kind: str
    fields: list[str]
    params: dict[str, Any]
    words: str


class JoinOut(BaseModel):
    from_table: str
    to_table: str
    on: list[list[str]]
    words: str


class GrainOut(BaseModel):
    table: Optional[str] = None
    key_fields: list[str]


class KeyPartOut(BaseModel):
    field: Optional[str] = None
    raw: str
    display: str


class SampleKeyOut(BaseModel):
    raw: str
    display: str
    fields: list[KeyPartOut]


class ReconcileOut(BaseModel):
    check_id: str
    module: str
    label: str
    run_id: str
    run_at: Optional[datetime] = None
    run_label: Optional[str] = None
    check_class: Optional[str] = None
    message: Optional[str] = None
    field: Optional[str] = None
    system: str                      # abap | cloud
    transaction: Optional[str] = None
    tables: list[str]
    grain: GrainOut
    population_selection: list[SelectionLineOut]
    failing_selection: list[SelectionLineOut]
    conditions: list[ConditionOut]
    joins: list[JoinOut]
    se16: bool
    population: int
    failing: int
    excluded: dict[str, int]
    sample_keys: list[SampleKeyOut]


def _uuid(value: str) -> Optional[str]:
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError):
        return None


async def _run(db: AsyncSession, t: str, run: str) -> dict:
    rid = _uuid(run)
    row = (await db.execute(text(
        "SELECT id::text AS id, run_at, label, metadata FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) "
        "AND id = CAST(:r AS uuid)"), {"t": t, "r": rid})).mappings().first() if rid else None
    if row is None:
        raise HTTPException(status_code=404, detail=f"Run {run} was not found.")
    return dict(row)


async def _rule(db: AsyncSession, t: str, check_id: str, module: Optional[str]) -> tuple[dict, Optional[str]]:
    """(the rule as the run evaluated it, its catalogue category). The shipped YAML with the tenant's active version
    merged over it, else the tenant's own rule row; an empty rule when neither exists."""
    from api.services.rule_coverage import shipped_for
    entries = shipped_for(check_id)
    y = entries.get((check_id, module or "")) or next((r for (_, m), r in sorted(entries.items())), None)
    if y:
        rule = {k: v for k, v in y.items() if k != "category"}
        body = (await db.execute(text(
            "SELECT body FROM rule_versions WHERE tenant_id = CAST(:t AS uuid) AND rule_id = :r AND state = 'active'"),
            {"t": t, "r": check_id})).scalar()
        if isinstance(body, str):
            body = json.loads(body)
        if isinstance(body, dict) and body:
            rule = {**rule, **body, "id": check_id}
        return rule, y.get("category")
    row = (await db.execute(text(
        "SELECT conditions, module FROM rules WHERE tenant_id = CAST(:t AS uuid) AND split_part(name, ':', 1) = :c "
        "ORDER BY (module = CAST(:m AS text)) DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1"),
        {"t": t, "c": check_id, "m": module})).mappings().first()
    if row is None:
        return {}, None
    cond = row["conditions"]
    cond = json.loads(cond) if isinstance(cond, str) else cond
    cond = (cond[0] if isinstance(cond, list) and cond else cond) or {}
    return ({**cond, "id": check_id} if isinstance(cond, dict) else {"id": check_id}), None


async def _pack(db: AsyncSession, t: str, check_id: str, run: dict, finding: dict) -> dict:
    rule, category = await _rule(db, t, check_id, finding["module"])
    recs = (await db.execute(text(
        "SELECT record_key, grain FROM finding_records WHERE tenant_id = CAST(:t AS uuid) AND version_id = CAST(:v AS uuid) "
        "AND check_id = :c ORDER BY record_key LIMIT :n"),
        {"t": t, "v": run["id"], "c": check_id, "n": rc.SAMPLE_KEYS})).mappings().all()
    details = finding.get("details") or {}
    if isinstance(details, str):
        details = json.loads(details)
    keys = [r["record_key"] for r in recs] or sorted(
        str(s["record_key"]) for s in details.get("sample_failing_records") or [] if isinstance(s, dict) and s.get("record_key"))
    grain = next((r["grain"] for r in recs if r["grain"]), None)
    meta = run.get("metadata") or {}
    if isinstance(meta, str):
        meta = json.loads(meta)
    pack = rc.build_pack(rule=rule or {"id": check_id}, check_id=check_id, module=finding["module"], category=category,
                         finding={**finding, "details": details}, sample_keys=keys, grain=grain,
                         as_of=meta.get("checks_as_of") or run.get("run_at"))
    return {**pack, "label": _label(finding["module"]), "run_id": run["id"], "run_at": run.get("run_at"),
            "run_label": run.get("label")}


_FINDING_SQL = ("SELECT module, affected_count, total_count, details FROM findings WHERE tenant_id = CAST(:t AS uuid) "
                "AND version_id = CAST(:v AS uuid) AND check_id = :c ORDER BY module LIMIT 1")


@router.get("/rules/{check_id}/reconcile", response_model=ReconcileOut, dependencies=[Depends(require_permission("view"))])
async def reconcile_rule(check_id: str, run: str = Query(..., max_length=64),
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    t = str(tenant.id)
    r = await _run(db, t, run)
    finding = (await db.execute(text(_FINDING_SQL), {"t": t, "v": r["id"], "c": check_id})).mappings().first()
    if finding is None:
        rule, _ = await _rule(db, t, check_id, None)
        if not rule:
            raise HTTPException(status_code=404, detail=f"Rule {check_id} is not a rule of this tenant.")
        raise HTTPException(status_code=404, detail=f"Rule {check_id} was not measured in run {r['id']}.")
    return await _pack(db, t, check_id, r, dict(finding))


# ---- the workbook ----

def _rule_sheet(p: dict) -> list[dict[str, object]]:
    """One rule's sheet as (item, value) rows."""
    rows: list[tuple[str, object]] = [
        ("Rule", p["check_id"]), ("Message", p.get("message") or ""), ("Object", p["label"]),
        ("Check type", p.get("check_class") or ""), ("Tables", ", ".join(p["tables"])),
        ("Record grain", f"{p['grain']['table'] or ''} ({', '.join(p['grain']['key_fields'])})"),
        ("Transaction", p.get("transaction") or "Not an SAP GUI system"),
        ("Reproducible in SE16 alone", "Yes" if p["se16"] else "No: see the conditions"),
    ]
    for ln in p["population_selection"]:
        rows.append(("Population selection", f"{ln['table']}-{ln['field']} {rc._op_words(ln)}"))
    for ln in p["failing_selection"]:
        rows.append(("Failing selection", f"{ln['table']}-{ln['field']} {rc._op_words(ln)}"))
    for c in p["conditions"]:
        rows.append(("Condition SE16 cannot express", c["words"]))
    for i, s in enumerate(rc.steps_in_words(p), start=1):
        rows.append((f"Step {i}", s))
    rows += [("Population (Meridian)", p["population"]), ("Failing (Meridian)", p["failing"])]
    for k, n in sorted(p["excluded"].items()):
        rows.append((f"Left out ({k.replace('_', ' ')})", n))
    for s in p["sample_keys"]:
        rows.append(("Sample failing key", f"{s['display']}  (stored as {s['raw']})"))
    rows += [("SE16 count", ""), ("Match", "")]
    return [{"item": a, "value": str(b) if not isinstance(b, int) else f"{b:,}"} for a, b in rows]


@router.get("/runs/{run_id}/reconciliation.xlsx", dependencies=[Depends(require_permission("export"))])
async def reconciliation_workbook(run_id: str, request: Request, top: int = Query(10, ge=1, le=50),
                                  db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    from api.services.branded_xlsx import ColumnSpec, SheetSpec, build_workbook, xlsx_filename, xlsx_response
    await _rls(db, tenant)
    t = str(tenant.id)
    r = await _run(db, t, run_id)
    findings = (await db.execute(text(
        "SELECT check_id, module, affected_count, total_count, details FROM findings WHERE tenant_id = CAST(:t AS uuid) "
        "AND version_id = CAST(:v AS uuid) AND affected_count > 0 ORDER BY affected_count DESC, check_id LIMIT :n"),
        {"t": t, "v": r["id"], "n": top})).mappings().all()
    packs = [await _pack(db, t, f["check_id"], r, dict(f)) for f in findings]
    yes_no = ("Yes", "No")
    summary = SheetSpec(
        title="Summary",
        note="Fill in the SE16 count your team finds and whether it matches.",
        columns=[ColumnSpec("rule", "Rule", kind="mono"), ColumnSpec("object", "Object"),
                 ColumnSpec("grain", "Table (grain)", kind="mono"), ColumnSpec("selection", "SE16 selection", width=80),
                 ColumnSpec("se16", "SE16 alone", choices=yes_no), ColumnSpec("population", "Population (Meridian)", kind="int"),
                 ColumnSpec("failing", "Failing (Meridian)", kind="int"), ColumnSpec("se16_count", "SE16 count", kind="int"),
                 ColumnSpec("match", "Match", choices=yes_no), ColumnSpec("note", "Note", width=40)],
        rows=[{"rule": p["check_id"], "object": p["label"], "grain": p["grain"]["table"] or "",
               "selection": rc.selection_in_words(p), "se16": "Yes" if p["se16"] else "No",
               "population": p["population"], "failing": p["failing"], "se16_count": None, "match": None, "note": None}
              for p in packs])
    sheets = [summary] + [SheetSpec(title=p["check_id"], columns=[ColumnSpec("item", "Item", width=32),
                                                                  ColumnSpec("value", "Value", width=100)],
                                    rows=_rule_sheet(p)) for p in packs]
    data = build_workbook(tenant_name=tenant.name, run_label=r.get("label"), run_id=r["id"],
                          title="Reconciliation workbook", sheets=sheets)
    await write_audit(db, tenant.id, request, "export.reconciliation", "run", r["id"], None,
                      {"rules": [p["check_id"] for p in packs], "top": top})
    await db.commit()
    return xlsx_response(data, xlsx_filename("reconciliation", r.get("label")))
