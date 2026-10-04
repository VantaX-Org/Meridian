"""Rules API — read-only list/detail endpoints for the customer-side rules viewer.

Rules are managed centrally in Meridian HQ and pushed via the licence manifest.
Customer admins can view rules but cannot create, edit, or delete them.

One exception: the `enabled` flag is mutable per-tenant so a steward can
silence a noisy rule without waiting for the next HQ push. The toggle
writes to the tenant's own rules row; the next HQ sync may overwrite it.

Second exception: a steward can accept a dependency mined from profiled data
("A determines B", field_dependencies) as a check. It is stored with
source='mined', which HQ sync does not own.

Third exception: a steward can author a check from an existing check type
(null, domain value, regex, cross-field, dependency, uniqueness), dry-run it
against a version's stored extract and save it with source='custom'. Fields
are validated against the data dictionary; HQ sync does not own these rows.
"""

import hashlib
import json
import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["rules"])


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


# ── GET /api/v1/rules ─────────────────────────────────────────────────────────


@router.get("/rules")
async def list_rules(
    category: Optional[str] = Query(None, description="Filter by category: ecc, successfactors, warehouse"),
    module: Optional[str] = Query(None, description="Filter by module name"),
    severity: Optional[str] = Query(None, description="Filter by severity: critical, high, medium, low, info"),
    enabled: Optional[bool] = Query(None, description="Filter by enabled status"),
    search: Optional[str] = Query(None, description="Text search across name and description"),
    source: Optional[str] = Query(None, description="Filter by source: yaml, hq, mined, custom"),
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List all rules for this tenant. Admin role required."""
    await _set_rls(db, tenant.id)

    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}

    if category:
        conditions.append("category = :category")
        params["category"] = category

    if module:
        conditions.append("module = :module")
        params["module"] = module

    if severity:
        conditions.append("severity = :severity")
        params["severity"] = severity

    if enabled is not None:
        conditions.append("enabled = :enabled")
        params["enabled"] = enabled

    if source:
        conditions.append("source = :source")
        params["source"] = source

    if search:
        conditions.append("(name ILIKE :search OR description ILIKE :search)")
        params["search"] = f"%{search}%"

    where_clause = " AND ".join(conditions)

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM rules WHERE {where_clause}"),
        params,
    )
    total = count_result.scalar() or 0

    params["limit"] = limit
    params["offset"] = offset
    # last_pass_rate: the rule's most recent finding (findings.check_id = rule id before the ':')
    result = await db.execute(
        text(f"""
            SELECT r.id, r.name, r.description, r.module, r.category, r.severity,
                   r.enabled, r.conditions, r.thresholds, r.tags, r.source_yaml, r.source,
                   r.created_at, r.updated_at, f.pass_rate AS last_pass_rate, f.created_at AS last_run_at
            FROM (SELECT * FROM rules WHERE {where_clause}
                  ORDER BY category, module, name LIMIT :limit OFFSET :offset) r
            LEFT JOIN (
                SELECT DISTINCT ON (check_id, module) check_id, module, pass_rate, created_at
                FROM findings WHERE tenant_id = :tid
                ORDER BY check_id, module, created_at DESC
            ) f ON f.check_id = split_part(r.name, ':', 1) AND f.module = r.module
            ORDER BY r.category, r.module, r.name
        """),
        params,
    )
    rules = [_row_to_dict(r) for r in result.fetchall()]

    # Serialise UUIDs and datetimes for JSON response
    for rule in rules:
        if rule.get("id"):
            rule["id"] = str(rule["id"])
        if rule.get("last_pass_rate") is not None:
            rule["last_pass_rate"] = float(rule["last_pass_rate"])
        for dt_field in ("created_at", "updated_at", "last_run_at"):
            if rule.get(dt_field):
                rule[dt_field] = rule[dt_field].isoformat()

    return {"rules": rules, "total": total, "limit": limit, "offset": offset}


# ── GET /api/v1/rules/summary ─────────────────────────────────────────────────


@router.get("/rules/summary")
async def rules_summary(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return rule counts grouped by category and severity."""
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("""
            SELECT category, severity, enabled, source,
                   COUNT(*) AS count
            FROM rules
            WHERE tenant_id = :tid
            GROUP BY category, severity, enabled, source
            ORDER BY category, severity
        """),
        {"tid": str(tenant.id)},
    )
    rows = [_row_to_dict(r) for r in result.fetchall()]
    return {"summary": rows}


# ── GET /api/v1/rules/{rule_id} ───────────────────────────────────────────────


@router.get("/rules/{rule_id}")
async def get_rule(
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return a single rule by ID."""
    await _set_rls(db, tenant.id)

    try:
        uid = uuid.UUID(rule_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid rule ID")

    result = await db.execute(
        text("""
            SELECT id, name, description, module, category, severity,
                   enabled, conditions, thresholds, tags, source_yaml, source,
                   created_at, updated_at
            FROM rules
            WHERE id = :rid AND tenant_id = :tid
        """),
        {"rid": str(uid), "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule = _row_to_dict(row)
    rule["id"] = str(rule["id"])
    for dt_field in ("created_at", "updated_at"):
        if rule.get(dt_field):
            rule[dt_field] = rule[dt_field].isoformat()

    return rule


# ── PATCH /api/v1/rules/{rule_id} ─────────────────────────────────────────────


class RulePatch(BaseModel):
    enabled: Optional[bool] = None


@router.patch("/rules/{rule_id}", dependencies=[Depends(require_permission("manage_rules"))])
async def patch_rule(
    rule_id: str,
    body: RulePatch,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Tenant-level rule override: toggle `enabled` only.

    Everything else on the rule (conditions, reference_values, applies_when,
    severity, etc.) is HQ-managed and immutable from the customer side.
    A future HQ push may overwrite the `enabled` flag; that's a product
    choice — the toggle is meant for immediate relief on a noisy rule
    between syncs, not permanent configuration.
    """
    await _set_rls(db, tenant.id)

    try:
        uid = uuid.UUID(rule_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid rule ID")

    if body.enabled is None:
        raise HTTPException(
            status_code=400,
            detail="Provide `enabled` — it is the only mutable field",
        )

    result = await db.execute(
        text(
            """
            UPDATE rules
            SET enabled = :enabled, updated_at = now()
            WHERE id = :rid AND tenant_id = :tid
            RETURNING id, name, description, module, category, severity,
                      enabled, conditions, thresholds, tags, source_yaml, source,
                      created_at, updated_at
            """
        ),
        {"rid": str(uid), "tid": str(tenant.id), "enabled": body.enabled},
    )
    row = result.fetchone()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.commit()

    rule = _row_to_dict(row)
    rule["id"] = str(rule["id"])
    for dt_field in ("created_at", "updated_at"):
        if rule.get(dt_field):
            rule[dt_field] = rule[dt_field].isoformat()
    return rule


# ── POST /api/v1/rules/mined ─────────────────────────────────────────────────


class MinedRuleIn(BaseModel):
    module: str
    determinant: str
    dependent: str
    severity: Literal["critical", "high", "medium", "low"] = "medium"


@router.post("/rules/mined", status_code=201, dependencies=[Depends(require_permission("manage_rules"))])
async def accept_mined_rule(
    body: MinedRuleIn,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Turn a mined dependency into a check run on every later analysis."""
    await _set_rls(db, tenant.id)
    dep = (await db.execute(text(
        "SELECT table_name FROM field_dependencies WHERE tenant_id = :tid AND module = :m "
        "AND determinant = :a AND dependent = :b LIMIT 1"),
        {"tid": str(tenant.id), "m": body.module, "a": body.determinant, "b": body.dependent})).fetchone()
    if not dep:
        raise HTTPException(status_code=404, detail="No such mined dependency")
    rid = "HR-" + hashlib.sha1(f"{body.module}|{body.determinant}|{body.dependent}".encode()).hexdigest()[:8].upper()
    row = (await db.execute(text(
        """
        INSERT INTO rules (tenant_id, name, description, module, category, severity, enabled, conditions, source)
        VALUES (:tid, :name, :desc, :m, 'consistency', :sev, true, CAST(:cond AS jsonb), 'mined')
        ON CONFLICT (tenant_id, name, module) DO UPDATE SET enabled = true, severity = EXCLUDED.severity,
                                                            updated_at = now()
        RETURNING id, name, module, severity, enabled
        """),
        {"tid": str(tenant.id), "name": f"{rid}: {body.determinant} determines {body.dependent}",
         "desc": f"{body.dependent} differs from the value {body.determinant} decides on the other records",
         "m": body.module, "sev": body.severity,
         "cond": json.dumps({"check_class": "dependency_check", "determinant": body.determinant,
                             "field": body.dependent, "grain": dep.table_name})})).fetchone()
    await db.commit()
    return {**_row_to_dict(row), "id": str(row.id)}


# ── POST /api/v1/rules/custom · /rules/dry-run ───────────────────────────────

_CHECK_CLASSES = Literal["null_check", "domain_value_check", "regex_check",
                         "cross_field_check", "dependency_check", "uniqueness_check"]
_REQUIRED = {
    "null_check": ["field"], "domain_value_check": ["field", "allowed_values"],
    "regex_check": ["field", "pattern"], "cross_field_check": ["fail_when"],
    "dependency_check": ["determinant", "field"], "uniqueness_check": ["fields"],
}
_BACKTICKED = re.compile(r"`[^`]*`")
_QUOTED = re.compile(r"'[^']*'|\"[^\"]*\"")
_EXPR_WORDS = re.compile(r"\b(isna|notna|and|or|not|True|False)\b")
_EXPR_REST = re.compile(r"[\s\d.()<>=!&|~+\-*/,]*")


class CustomRuleIn(BaseModel):
    module: str
    check_class: _CHECK_CLASSES
    message: str
    severity: Literal["critical", "high", "medium", "low"] = "medium"
    dimension: Optional[Literal["completeness", "accuracy", "consistency",
                                "timeliness", "uniqueness", "validity"]] = None
    field: Optional[str] = None
    allowed_values: Optional[list[str]] = None
    pattern: Optional[str] = None
    fail_when: Optional[str] = None
    determinant: Optional[str] = None
    fields: Optional[list[str]] = None
    grain: Optional[str] = None
    version_id: Optional[str] = None  # DDIC of this version's system; dry-run data source


def _safe_expression(expr: str) -> bool:
    """Only backticked columns, quoted literals, numbers, comparison/boolean operators and isna/notna.

    The expression runs through ``DataFrame.eval(engine="python")`` in the worker,
    so anything else (attribute access, calls, names) is refused here.
    """
    rest = _EXPR_WORDS.sub(" ", _QUOTED.sub(" ", _BACKTICKED.sub(" ", expr)))
    return bool(_BACKTICKED.search(expr)) and _EXPR_REST.fullmatch(rest) is not None


def _build_rule(body: CustomRuleIn) -> dict:
    """Check-engine rule dict for a draft, or 422 naming what is wrong."""
    from checks.runner import REGISTRY, _find_module_yaml

    try:
        _find_module_yaml(body.module)
    except FileNotFoundError:
        raise HTTPException(status_code=422, detail=f"Unknown module {body.module}")
    if not body.message.strip():
        raise HTTPException(status_code=422, detail="Message is required")
    required = _REQUIRED[body.check_class]
    missing = [k for k in required if not getattr(body, k)]
    if missing:
        raise HTTPException(status_code=422, detail=f"{body.check_class} needs {', '.join(missing)}")
    if "pattern" in required:
        try:
            re.compile(body.pattern or "")
        except re.error as e:
            raise HTTPException(status_code=422, detail=f"Pattern does not compile: {e}")
    if "fail_when" in required and not _safe_expression(body.fail_when or ""):
        raise HTTPException(status_code=422, detail="Expression may use only `TABLE.FIELD` columns, "
                            "quoted values, numbers, comparisons, & | ~ and isna()/notna()")
    cond = {k: getattr(body, k) for k in [*required, "grain"] if getattr(body, k)}
    cond["check_class"] = body.check_class
    cond["dimension"] = body.dimension or REGISTRY[body.check_class].default_dimension
    digest = hashlib.sha1(f"{body.module}|{json.dumps(cond, sort_keys=True)}".encode()).hexdigest()
    return {"id": "CR-" + digest[:8].upper(), "module": body.module, "severity": body.severity,
            "message": body.message.strip(), **cond}


def _missing_fields(rule: dict, dictionaries: list) -> list[str]:
    """Columns the rule reads that no candidate dictionary knows."""
    from checks.runner import rule_columns

    return [c for c in rule_columns(rule)
            if "." not in c or not any(d.resolve(c) for d in dictionaries)]


def _version_context(tenant_id: uuid.UUID, version_id: Optional[str]) -> tuple[dict, list]:
    """(version metadata, dictionaries to validate against). Sync — run in a threadpool."""
    from sqlalchemy.orm import Session

    from api.services.source_design import dictionary_for
    from sap.ddic import get_dictionary
    from workers.db import get_sync_engine

    if not version_id:
        return {}, [get_dictionary("s4hana"), get_dictionary("ecc6")]
    with Session(get_sync_engine()) as s:
        s.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        row = s.execute(text("SELECT metadata FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
                        {"vid": version_id, "tid": str(tenant_id)}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Version not found")
        meta = row[0] or {}
        return meta, [dictionary_for(s, meta.get("system_id"))]


async def _validated(body: CustomRuleIn, tenant: Tenant) -> tuple[dict, dict, list]:
    rule = _build_rule(body)
    if body.version_id:
        try:
            uuid.UUID(body.version_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid version ID")
    meta, dictionaries = await run_in_threadpool(_version_context, tenant.id, body.version_id)
    missing = _missing_fields(rule, dictionaries)
    if missing:
        raise HTTPException(status_code=422, detail=f"Not in the data dictionary: {', '.join(missing)}")
    return rule, meta, dictionaries


@router.post("/rules/custom", status_code=201, dependencies=[Depends(require_permission("manage_rules"))])
async def create_custom_rule(
    body: CustomRuleIn,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """A steward's own check, built from an existing check type. Runs on every later analysis."""
    rule, _, _ = await _validated(body, tenant)
    await _set_rls(db, tenant.id)
    cond = {k: v for k, v in rule.items() if k not in ("id", "module", "severity", "message")}
    row = (await db.execute(text(
        """
        INSERT INTO rules (tenant_id, name, description, module, category, severity, enabled, conditions, source)
        VALUES (:tid, :name, :desc, :m, 'custom', :sev, true, CAST(:cond AS jsonb), 'custom')
        ON CONFLICT (tenant_id, name, module) DO UPDATE SET enabled = true, severity = EXCLUDED.severity,
                                                            updated_at = now()
        RETURNING id, name, module, severity, enabled
        """),
        {"tid": str(tenant.id), "name": f"{rule['id']}: {rule['message']}", "desc": rule["message"],
         "m": body.module, "sev": body.severity, "cond": json.dumps(cond)})).fetchone()
    await db.commit()
    return {**_row_to_dict(row), "id": str(row.id)}


def _dry_run(rule: dict, meta: dict, dictionary) -> dict:
    from checks.runner import rule_columns
    from workers.dataset import load_dataset

    cols = rule_columns(rule)
    frames, _, _, _ = load_dataset(meta["dataset_path"], dictionary, [rule["module"]], extra=set(cols))
    return evaluate_rule(rule, frames)


def evaluate_rule(rule: dict, frames) -> dict:
    """Population, failing count and up to 20 failing keys of one rule over loaded frames."""
    from checks.runner import REGISTRY, rule_columns

    built = frames.frame_for(rule_columns(rule), grain=rule.get("grain"))
    result = REGISTRY[rule["check_class"]](rule).run(built[0], key_cols=built[2], grain=built[1]) if built else None
    if result is None:
        raise HTTPException(status_code=422, detail="This version's extract does not hold every field the rule reads")
    return {"population": result.total_count, "failing": result.affected_count, "pass_rate": result.pass_rate,
            "grain": built[1], "sample_keys": (result.failing_record_keys or [])[:20], "error": result.error}


@router.post("/rules/dry-run", dependencies=[Depends(require_permission("manage_rules"))])
async def dry_run_rule(body: CustomRuleIn, tenant: Tenant = Depends(get_tenant)):
    """Evaluate a draft rule against a version's stored extract. Writes nothing."""
    if not body.version_id:
        raise HTTPException(status_code=422, detail="Choose a version to run against")
    rule, meta, dictionaries = await _validated(body, tenant)
    if not meta.get("dataset_path"):
        raise HTTPException(status_code=409, detail="This version has no stored extract")
    try:
        return await run_in_threadpool(_dry_run, rule, meta, dictionaries[0])
    except (ValueError, OSError) as e:
        raise HTTPException(status_code=409, detail=f"Could not read the extract ({type(e).__name__})")


# ── GET /api/v1/rules/{rule_id}/history ───────────────────────────────────────


@router.get("/rules/{rule_id}/history")
async def rule_history(
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Who changed the rule and how, read from the audit log (every successful write is logged)."""
    try:
        uid = str(uuid.UUID(rule_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid rule ID")
    await _set_rls(db, tenant.id)
    rule = (await db.execute(text("SELECT module, created_at FROM rules WHERE id = :rid AND tenant_id = :tid"),
                             {"rid": uid, "tid": str(tenant.id)})).fetchone()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    # PATCHes carry the id in the path; the create request is the custom/mined POST
    # for the same module logged within seconds of the row's creation
    rows = (await db.execute(text(
        """
        SELECT created_at, actor_email, action, before_json
        FROM audit_log
        WHERE tenant_id = :tid AND entity_type = 'rules'
          AND (entity_id = :rid
               OR (path IN ('/api/v1/rules/custom', '/api/v1/rules/mined')
                   AND before_json->>'module' = :m
                   AND created_at BETWEEN :since AND :since + interval '10 seconds'))
        ORDER BY created_at DESC LIMIT 50
        """),
        {"tid": str(tenant.id), "rid": uid, "m": rule.module, "since": rule.created_at})).fetchall()
    return {"events": [
        {"at": r.created_at.isoformat(), "actor": r.actor_email, "action": r.action,
         "changes": {k: v for k, v in (r.before_json or {}).items() if k != "version_id"}}
        for r in rows]}
