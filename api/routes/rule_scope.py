"""Where one rule applies: its definition, authority, the objects and systems it runs on, and what it touches.

GET /api/v1/rules/{check_id}/scope?module=

  definition  the shipped YAML rule (check class, field and table, expression, parameters); a customer-authored rule
              reads from the tenant's rules row
  authority   rule_authority, why_it_matters and sap_impact from the same rule
  objects     one row per (system, object) in the current state that ran it: failing and checked records, pass rate
  systems     the systems behind those rows, with their failing records
  features    config-impact features it blocks or degrades in those runs
  versions    the tenant's rule_versions (version, state, created, author) and the shipped file identity
  contracts   data contracts that name it, or that set a threshold on its dimension for its object

"Current state" is the newest finished run of every (system, object), as the landscape reads it. Read-only,
tenant-scoped, ``view`` permission; a value that is not stored is null.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.objects import _label
from api.routes.record_issues import _rls
from api.services.contract_compliance import declared_modules
from api.services.rbac import require_permission
from api.services.receipt_math import rule_names
from api.services.version_status import finished_sql

router = APIRouter(prefix="/api/v1", tags=["rules"])

# Prose and fix machinery stay out of the parameters: they have their own fields or belong to the fix screens.
_NOT_PARAMS = {"id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
               "sap_impact", "fix_map", "record_fix_template", "auto_fix", "category", "enabled"}
_EXPRESSION_KEYS = ("fail_when", "condition", "pattern")

# The newest finished run of every (system, module): the same set the landscape reads.
_CELL_RUNS_SQL = f"""
    SELECT DISTINCT ON (sid, module) sid, module, run_id, run_at FROM (
        SELECT av.id AS run_id, av.run_at, av.metadata->>'system_id' AS sid, k.module
          FROM analysis_versions av
         CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(av.dqs_summary) = 'object'
                                                   THEN av.dqs_summary ELSE '{{}}'::jsonb END) AS k(module)
         WHERE av.tenant_id = CAST(:t AS uuid) AND {finished_sql('av.status')}
           AND av.metadata->>'system_id' IS NOT NULL
           AND av.metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
           AND av.metadata->>'archived' IS DISTINCT FROM 'true'
    ) x ORDER BY sid, module, run_at DESC, run_id DESC"""


class DefinitionOut(BaseModel):
    source: Optional[str] = None            # shipped | tenant; null when only its results are stored
    check_class: Optional[str] = None
    field: Optional[str] = None             # TABLE.FIELD
    table: Optional[str] = None
    dimension: Optional[str] = None
    severity: Optional[str] = None
    message: Optional[str] = None
    expression: Optional[str] = None        # fail_when / condition / pattern of the rule
    params: dict[str, Any] = {}


class AuthorityOut(BaseModel):
    rule_authority: Optional[str] = None
    why_it_matters: Optional[str] = None
    sap_impact: Optional[str] = None


class ScopeObjectOut(BaseModel):
    system_id: str
    system_name: Optional[str] = None
    module: str
    label: str
    run_id: str
    run_at: Optional[datetime] = None
    severity: Optional[str] = None
    failing: int
    checked: Optional[int] = None
    pass_rate: Optional[float] = None


class ScopeSystemOut(BaseModel):
    id: str
    name: Optional[str] = None
    failing: int
    objects: int


class FailingByObjectOut(BaseModel):
    module: str
    label: str
    failing: int


class FeatureOut(BaseModel):
    feature: str
    status: str                             # blocked | degraded
    system_id: Optional[str] = None


class ScopeVersionOut(BaseModel):
    version: int
    state: str
    created_at: Optional[datetime] = None
    author: Optional[str] = None
    approved_by: Optional[str] = None
    note: Optional[str] = None


class ShippedOut(BaseModel):
    source: str
    hash: str
    app_version: str


class ScopeContractOut(BaseModel):
    id: str
    name: str
    status: str
    via: str                                # names_rule | dimension_threshold
    threshold: Optional[float] = None       # the contract's minimum for the rule's dimension, when it sets one


class RuleScopeOut(BaseModel):
    check_id: str
    name: Optional[str] = None
    module: Optional[str] = None
    definition: DefinitionOut
    authority: AuthorityOut
    objects: list[ScopeObjectOut]
    systems: list[ScopeSystemOut]
    failing_records: int
    failing_by_object: list[FailingByObjectOut]
    features: list[FeatureOut]
    versions: list[ScopeVersionOut]
    shipped: Optional[ShippedOut] = None
    contracts: list[ScopeContractOut]


def _shipped(check_id: str, module: Optional[str]) -> tuple[Optional[str], dict]:
    """(module, rule) of the shipped YAML rule: the requested module, else the first module that ships it."""
    from api.services.rule_coverage import shipped
    table = shipped()
    if module and (check_id, module) in table:
        return module, table[(check_id, module)]
    for (cid, mod), rule in sorted(table.items()):
        if cid == check_id and not module:
            return mod, rule
    return module, {}


def _touches(blocking: object, check_id: str) -> bool:
    items = blocking if isinstance(blocking, list) else []
    return any((i.get("check_id") if isinstance(i, dict) else i) == check_id for i in items)


@router.get("/rules/{check_id}/scope", response_model=RuleScopeOut, dependencies=[Depends(require_permission("view"))])
async def rule_scope(check_id: str, module: Optional[str] = Query(None, max_length=100, pattern=r"^[a-z0-9_]+$"),
                     db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    t = str(tenant.id)
    mod, y = _shipped(check_id, module)

    # tenant rule row (customer-authored or mined rules have no shipped YAML)
    trow = (await db.execute(text(
        "SELECT name, module, severity, conditions FROM rules WHERE tenant_id = CAST(:t AS uuid) "
        "AND split_part(name, ':', 1) = CAST(:c AS text) AND (CAST(:m AS text) IS NULL OR module = CAST(:m AS text)) "
        "ORDER BY (module = CAST(:m AS text)) DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1"),
        {"t": t, "c": check_id, "m": mod})).mappings().first()

    cells = (await db.execute(text(f"""
        WITH cells AS ({_CELL_RUNS_SQL})
        SELECT c.sid, s.name AS system_name, c.module, c.run_id::text AS run_id, c.run_at, f.severity, f.affected_count,
               f.total_count, f.pass_rate
          FROM cells c JOIN findings f ON f.version_id = c.run_id AND f.module = c.module AND f.check_id = :c
                                      AND f.tenant_id = CAST(:t AS uuid)
          LEFT JOIN sap_systems s ON s.id = CAST(c.sid AS uuid) AND s.tenant_id = CAST(:t AS uuid)
         WHERE CAST(:m AS text) IS NULL OR c.module = CAST(:m AS text)
         ORDER BY s.name, c.module"""), {"t": t, "c": check_id, "m": module})).mappings().all()

    if not y and not trow and not cells:
        raise HTTPException(status_code=404, detail="Rule not found")
    if mod is None and cells:
        mod = cells[0]["module"]

    d: dict[str, Any] = {}
    if y:
        d = {"source": "shipped", "check_class": y.get("check_class"), "field": y.get("field"),
             "dimension": y.get("dimension"), "severity": y.get("severity"), "message": y.get("message"),
             "expression": next((str(y[k]) for k in _EXPRESSION_KEYS if y.get(k) is not None), None),
             "params": {k: v for k, v in y.items() if k not in _NOT_PARAMS and k not in _EXPRESSION_KEYS and v is not None}}
    elif trow:
        from api.services.rule_coverage import describe
        meta = describe(dict(trow))
        cond = trow["conditions"]
        cond = json.loads(cond) if isinstance(cond, str) else cond
        cond = (cond[0] if isinstance(cond, list) and cond else cond) if cond else {}
        cond = cond if isinstance(cond, dict) else {}
        d = {"source": "tenant", "check_class": meta["check_class"], "field": meta["field"], "dimension": meta["dimension"],
             "severity": meta["severity"], "message": meta["message"],
             "expression": next((str(cond[k]) for k in _EXPRESSION_KEYS if cond.get(k) is not None), None),
             "params": {k: v for k, v in cond.items() if k not in _NOT_PARAMS and k not in _EXPRESSION_KEYS and v is not None}}
    else:
        d = {"severity": cells[0]["severity"]}
    if d.get("field") and "." in str(d["field"]):
        d["table"] = str(d["field"]).split(".", 1)[0]
    if d.get("severity") is None and cells:
        d["severity"] = cells[0]["severity"]

    names = await rule_names(db, tenant, [check_id])
    name = names.get(check_id) or d.get("message")

    objects = [{
        "system_id": c["sid"], "system_name": c["system_name"], "module": c["module"], "label": _label(c["module"]),
        "run_id": c["run_id"], "run_at": c["run_at"], "severity": c["severity"], "failing": int(c["affected_count"] or 0),
        "checked": int(c["total_count"]) if c["total_count"] else None,
        "pass_rate": round(float(c["pass_rate"]), 2) if c["pass_rate"] is not None else None} for c in cells]
    systems: dict[str, dict] = {}
    for o in objects:
        s = systems.setdefault(o["system_id"], {"id": o["system_id"], "name": o["system_name"], "failing": 0, "objects": 0})
        s["failing"] += o["failing"]
        s["objects"] += 1
    by_object: dict[str, int] = {}
    for o in objects:
        by_object[o["module"]] = by_object.get(o["module"], 0) + o["failing"]

    features: list[dict] = []
    run_ids = sorted({o["run_id"] for o in objects})
    if run_ids:
        for r in (await db.execute(text(
                "SELECT feature, status, blocking_findings, version_id::text AS v FROM config_impact_results "
                "WHERE tenant_id = CAST(:t AS uuid) AND version_id = ANY(CAST(:ids AS uuid[])) "
                "AND status IN ('blocked', 'degraded') ORDER BY status, feature"), {"t": t, "ids": run_ids})).mappings().all():
            if _touches(r["blocking_findings"], check_id):
                sys_ids = sorted({o["system_id"] for o in objects if o["run_id"] == r["v"]})
                features.append({"feature": r["feature"], "status": r["status"], "system_id": sys_ids[0] if sys_ids else None})
    seen: set[tuple] = set()
    features = [f for f in features if not ((f["feature"], f["status"], f["system_id"]) in seen or seen.add((f["feature"], f["status"], f["system_id"])))]

    versions = [dict(author=r["created_by"], **{k: r[k] for k in ("version", "state", "created_at", "approved_by", "note")})
                for r in (await db.execute(text(
                    "SELECT version, state, created_at, created_by, approved_by, note FROM rule_versions "
                    "WHERE tenant_id = CAST(:t AS uuid) AND rule_id = :r ORDER BY version DESC"), {"t": t, "r": check_id})).mappings().all()]
    from checks.lifecycle import shipped_info
    info = shipped_info(check_id)

    contracts: list[dict] = []
    dim = d.get("dimension")
    for r in (await db.execute(text(
            "SELECT id::text AS id, name, status, producer, consumer, schema_contract, quality_contract, freshness_contract, "
            "volume_contract FROM contracts WHERE tenant_id = CAST(:t AS uuid) ORDER BY created_at DESC"), {"t": t})).mappings().all():
        row = dict(r)
        blob = json.dumps({k: row[k] for k in ("schema_contract", "quality_contract", "freshness_contract", "volume_contract")},
                          default=str)
        if f'"{check_id}"' in blob:
            contracts.append({"id": row["id"], "name": row["name"], "status": row["status"], "via": "names_rule", "threshold": None})
            continue
        qc = row["quality_contract"] if isinstance(row["quality_contract"], dict) else {}
        scope = declared_modules(row)
        if dim and isinstance(qc.get(dim), (int, float)) and (scope is None or (mod and mod in scope)):
            contracts.append({"id": row["id"], "name": row["name"], "status": row["status"], "via": "dimension_threshold",
                              "threshold": float(qc[dim])})

    return {
        "check_id": check_id, "name": name, "module": mod,
        "definition": d,
        "authority": {"rule_authority": y.get("rule_authority") if y else ("customer_configured" if trow else None),
                      "why_it_matters": y.get("why_it_matters") if y else None,
                      "sap_impact": y.get("sap_impact") if y else None},
        "objects": objects, "systems": list(systems.values()),
        "failing_records": sum(o["failing"] for o in objects),
        "failing_by_object": [{"module": m, "label": _label(m), "failing": n} for m, n in sorted(by_object.items())],
        "features": features, "versions": versions,
        "shipped": ({"source": info["source"], "hash": info["hash"], "app_version": info["app_version"]} if info else None),
        "contracts": contracts,
    }
