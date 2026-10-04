"""Rules API — read-only list/detail endpoints for the customer-side rules viewer.

Rules are managed centrally in Meridian HQ and pushed via the licence manifest.
Customer admins can view rules but cannot create, edit, or delete them.

One exception: the `enabled` flag is mutable per-tenant so a steward can
silence a noisy rule without waiting for the next HQ push. The toggle
writes to the tenant's own rules row; the next HQ sync may overwrite it.

Second exception: a steward can accept a dependency mined from profiled data
("A determines B", field_dependencies) as a check. It is stored with
source='mined', which HQ sync does not own.
"""

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import current_user_label, has_permission, require_permission
from checks import lifecycle

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
    result = await db.execute(
        text(f"""
            SELECT id, name, description, module, category, severity,
                   enabled, conditions, thresholds, tags, source_yaml, source,
                   created_at, updated_at
            FROM rules
            WHERE {where_clause}
            ORDER BY category, module, name
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rules = [_row_to_dict(r) for r in result.fetchall()]

    # Serialise UUIDs and datetimes for JSON response
    for rule in rules:
        if rule.get("id"):
            rule["id"] = str(rule["id"])
        for dt_field in ("created_at", "updated_at"):
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


# ── Rule lifecycle ────────────────────────────────────────────────────────────
# Keyed by check id (e.g. "BP-001"), not the rules-table uuid above.


class VersionCreate(BaseModel):
    body: dict = Field(description="Partial override for a shipped rule, or a whole rule for a new id")
    note: Optional[str] = Field(None, max_length=2000)


class VersionTransition(BaseModel):
    to: Literal["draft", "in_review", "active", "retired"]
    note: Optional[str] = Field(None, max_length=2000)


_VERSION_COLS = "rule_id, version, body, state, note, created_by, approved_by, approved_at, created_at, updated_at"


@router.get("/rules/{rule_id}/versions", dependencies=[Depends(require_permission("view"))])
async def list_versions(rule_id: str, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Shipped identity (git-versioned YAML: source file, content hash, app version) + tenant versions."""
    await _set_rls(db, tenant.id)
    rows = (await db.execute(text(f"SELECT {_VERSION_COLS} FROM rule_versions WHERE rule_id = :r "
                                  "ORDER BY version DESC"), {"r": rule_id})).mappings().all()
    return {"rule_id": rule_id, "shipped": lifecycle.shipped_info(rule_id), "versions": [dict(r) for r in rows]}


@router.post("/rules/{rule_id}/versions", status_code=201, dependencies=[Depends(require_permission("manage_rules"))])
async def create_version(rule_id: str, body: VersionCreate, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)):
    """New draft. Versions are immutable once submitted; change = a new draft."""
    if err := lifecycle.validate_body(rule_id, body.body):
        raise HTTPException(status_code=400, detail=err)
    await _set_rls(db, tenant.id)
    row = (await db.execute(text(f"""
        INSERT INTO rule_versions (tenant_id, rule_id, version, body, state, note, created_by)
        SELECT :tid, :r, COALESCE(max(version), 0) + 1, CAST(:b AS jsonb), 'draft', :n, :u
          FROM rule_versions WHERE rule_id = :r
        RETURNING {_VERSION_COLS}
    """), {"tid": str(tenant.id), "r": rule_id, "b": json.dumps(body.body), "n": body.note,
           "u": current_user_label()})).mappings().one()
    await db.commit()
    return dict(row)


@router.get("/rules/{rule_id}/versions/{version}/diff", dependencies=[Depends(require_permission("view"))])
async def version_diff(rule_id: str, version: int, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)):
    """Unified diff of the effective rule against the previous version (or the shipped rule)."""
    await _set_rls(db, tenant.id)
    rows = (await db.execute(text("SELECT version, body FROM rule_versions WHERE rule_id = :r AND version <= :v "
                                  "ORDER BY version DESC LIMIT 2"), {"r": rule_id, "v": version})).all()
    if not rows or rows[0][0] != version:
        raise HTTPException(status_code=404, detail="Version not found")
    shipped = lifecycle.shipped_info(rule_id)
    if len(rows) > 1:
        old, label = rows[1][1], f"v{rows[1][0]}"
    else:
        old, label = ({}, f"shipped@{shipped['hash']}") if shipped else (None, "(new rule)")
    return {"rule_id": rule_id, "from": label, "to": f"v{version}",
            "diff": lifecycle.diff(rule_id, old, rows[0][1], label, f"v{version}")}


@router.post("/rules/{rule_id}/versions/{version}/transition")
async def transition_version(rule_id: str, version: int, body: VersionTransition,
                             db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                             role: str = Depends(require_permission("view"))):
    """draft → in_review → active (approver recorded, previous active retired) → retired;
    a reviewer can send in_review back to draft. Applies from the next analysis run."""
    await _set_rls(db, tenant.id)
    row = (await db.execute(text("SELECT state, created_by FROM rule_versions WHERE rule_id = :r AND version = :v "
                                 "FOR UPDATE"), {"r": rule_id, "v": version})).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    need = lifecycle.TRANSITIONS.get((row[0], body.to))
    if need is None:
        raise HTTPException(status_code=409, detail=f"Cannot move a {row[0]} version to {body.to}.")
    if not has_permission(role, need):
        raise HTTPException(status_code=403, detail=f"Role '{role}' does not have '{need}' permission")
    me = current_user_label()
    if body.to == "active" and me == row[1] and me != "system":
        raise HTTPException(status_code=403, detail="The author cannot approve their own version.")
    if body.to == "active":
        await db.execute(text("UPDATE rule_versions SET state = 'retired', updated_at = now() "
                              "WHERE rule_id = :r AND state = 'active'"), {"r": rule_id})
    out = (await db.execute(text(f"""
        UPDATE rule_versions SET state = :s, updated_at = now(), note = COALESCE(:n, note),
               approved_by = CASE WHEN :s = 'active' THEN :u ELSE approved_by END,
               approved_at = CASE WHEN :s = 'active' THEN now() ELSE approved_at END
         WHERE rule_id = :r AND version = :v
        RETURNING {_VERSION_COLS}
    """), {"s": body.to, "n": body.note, "u": me, "r": rule_id, "v": version})).mappings().one()
    await db.commit()
    return dict(out)


@router.get("/rules/{rule_id}/history", dependencies=[Depends(require_permission("view"))])
async def rule_history(rule_id: str, limit: int = Query(50, ge=1, le=500),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Hit rate of one rule per analysis run, newest first."""
    await _set_rls(db, tenant.id)
    rows = (await db.execute(text("""
        SELECT av.id AS version_id, av.run_at, f.module, f.severity, f.affected_count, f.total_count,
               f.pass_rate, COALESCE((f.details->>'suppressed')::boolean, false) AS suppressed
          FROM findings f JOIN analysis_versions av ON av.id = f.version_id
         WHERE f.check_id = :r AND f.details->>'error' IS NULL
         ORDER BY av.run_at DESC LIMIT :n
    """), {"r": rule_id, "n": limit})).mappings().all()
    return {"rule_id": rule_id, "runs": [
        {**r, "hit_rate": round(r["affected_count"] / r["total_count"] * 100, 2) if r["total_count"] else 0.0}
        for r in rows]}


@router.get("/rule-feedback", dependencies=[Depends(require_permission("view"))])
async def rule_feedback(check_id: Optional[str] = Query(None), db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)):
    """Steward verdicts per rule (record_issues.steward_verdict); with check_id, also the stated reasons."""
    await _set_rls(db, tenant.id)
    rows = (await db.execute(text(f"""
        SELECT check_id, count(*) AS flagged,
               count(*) FILTER (WHERE steward_verdict = 'false_positive') AS false_positive,
               count(*) FILTER (WHERE steward_verdict = 'real') AS real
          FROM record_issues {"WHERE check_id = :c" if check_id else ""}
         GROUP BY check_id ORDER BY false_positive DESC, check_id
    """), {"c": check_id})).mappings().all()
    rules = [{**r, "false_positive_rate": round(r["false_positive"] / (r["false_positive"] + r["real"]), 4)
              if r["false_positive"] + r["real"] else None} for r in rows]
    if not check_id:
        return {"rules": rules}
    reasons = (await db.execute(text("""
        SELECT e.note AS reason, count(*) AS records, max(e.created_at) AS last_at
          FROM record_issue_events e JOIN record_issues ri ON ri.id = e.issue_id
         WHERE ri.check_id = :c AND e.action = 'status' AND ri.steward_verdict = 'false_positive'
           AND e.to_value = 'accepted' AND COALESCE(e.note, '') <> ''
         GROUP BY e.note ORDER BY records DESC LIMIT 20
    """), {"c": check_id})).mappings().all()
    return {"rules": rules, "reasons": [dict(r) for r in reasons]}


# ── Suppressions ──────────────────────────────────────────────────────────────

MAX_SUPPRESSION_DAYS = 365


class SuppressionCreate(BaseModel):
    check_id: str = Field(min_length=1, max_length=200)
    record_key: Optional[str] = Field(None, max_length=500, description="Omit to suppress the whole rule")
    reason: str = Field(min_length=3, max_length=2000)
    expires_at: datetime


@router.get("/rule-suppressions", dependencies=[Depends(require_permission("view"))])
async def list_suppressions(include_expired: bool = False, db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)):
    await _set_rls(db, tenant.id)
    rows = (await db.execute(text(
        "SELECT id, check_id, record_key, reason, expires_at, created_by, created_at, expires_at > now() AS active "
        f"FROM rule_suppressions {'' if include_expired else 'WHERE expires_at > now()'} ORDER BY expires_at"
    ))).mappings().all()
    return {"suppressions": [dict(r) for r in rows]}


@router.post("/rule-suppressions", status_code=201, dependencies=[Depends(require_permission("approve"))])
async def create_suppression(body: SuppressionCreate, db: AsyncSession = Depends(get_db),
                             tenant: Tenant = Depends(get_tenant)):
    """Keep a rule (or one record of it) out of the score until expires_at. Takes effect next run."""
    exp = body.expires_at if body.expires_at.tzinfo else body.expires_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if not now < exp <= now + timedelta(days=MAX_SUPPRESSION_DAYS):
        raise HTTPException(status_code=400, detail=f"expires_at must be in the next {MAX_SUPPRESSION_DAYS} days.")
    await _set_rls(db, tenant.id)
    row = (await db.execute(text("""
        INSERT INTO rule_suppressions (tenant_id, check_id, record_key, reason, expires_at, created_by)
        VALUES (:tid, :c, :k, :r, :e, :u)
        RETURNING id, check_id, record_key, reason, expires_at, created_by, created_at
    """), {"tid": str(tenant.id), "c": body.check_id, "k": body.record_key, "r": body.reason.strip(),
           "e": exp, "u": current_user_label()})).mappings().one()
    await db.commit()
    return dict(row)


@router.delete("/rule-suppressions/{suppression_id}", status_code=204,
               dependencies=[Depends(require_permission("approve"))])
async def end_suppression(suppression_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)):
    """End a suppression now (kept for audit with expires_at = now)."""
    await _set_rls(db, tenant.id)
    res = await db.execute(text("UPDATE rule_suppressions SET expires_at = now() "
                                "WHERE id = :id AND expires_at > now()"), {"id": str(suppression_id)})
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="No active suppression with that id")
    await db.commit()


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
