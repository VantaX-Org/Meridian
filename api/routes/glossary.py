"""Business glossary API routes.

Endpoints:
  GET   /glossary                  — paginated list with filters
  GET   /glossary/{id}             — full detail with linked rules and change history
  POST  /glossary/{id}/ai-draft    — trigger AI enrichment (draft only, not persisted)
  PUT   /glossary/{id}             — update term (approve permission)
  POST  /glossary/{id}/review      — mark term as reviewed (approve permission)
  POST  /glossary/batch-lookup     — batch field name lookup for integration points
"""

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission, _get_user_role

router = APIRouter(prefix="/api/v1", tags=["glossary"])
logger = logging.getLogger("meridian.glossary")


# ── Request/Response models ──────────────────────────────────────────────────


class GlossaryTermSummary(BaseModel):
    id: str
    sap_table: str
    sap_field: str
    technical_name: str
    business_name: str
    domain: str
    mandatory_for_s4hana: bool
    status: str
    ai_drafted: bool
    last_reviewed_at: Optional[str] = None
    review_cycle_days: int
    linked_rules_count: int


class LinkedRule(BaseModel):
    rule_id: str
    domain: str
    pass_rate: Optional[float] = None
    severity: Optional[str] = None
    affected_count: Optional[int] = None
    total_count: Optional[int] = None


class ChangeLogEntry(BaseModel):
    id: str
    changed_by: str
    changed_at: str
    field_changed: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    change_reason: Optional[str] = None


class GlossaryTermDetail(BaseModel):
    id: str
    sap_table: str
    sap_field: str
    technical_name: str
    business_name: str
    business_definition: Optional[str] = None
    why_it_matters: Optional[str] = None
    sap_impact: Optional[str] = None
    domain: str
    approved_values: Optional[dict | list] = None
    mandatory_for_s4hana: bool
    rule_authority: Optional[str] = None
    data_steward_id: Optional[str] = None
    review_cycle_days: int
    last_reviewed_at: Optional[str] = None
    status: str
    ai_drafted: bool
    created_at: str
    updated_at: str
    linked_rules: list[LinkedRule]
    change_history: list[ChangeLogEntry]


class GlossaryListResponse(BaseModel):
    terms: list[GlossaryTermSummary]
    total: int
    page: int
    per_page: int


class GlossaryTermUpdate(BaseModel):
    business_name: Optional[str] = None
    business_definition: Optional[str] = None
    why_it_matters: Optional[str] = None
    sap_impact: Optional[str] = None
    status: Optional[str] = None
    data_steward_id: Optional[str] = None
    mandatory_for_s4hana: Optional[bool] = None
    approved_values: Optional[dict | list] = None
    review_cycle_days: Optional[int] = None


class AIDraftResponse(BaseModel):
    business_definition: str
    why_it_matters_business: str
    committed: bool = False


class BatchLookupRequest(BaseModel):
    fields: list[str]


class BatchLookupEntry(BaseModel):
    business_name: str
    id: str
    business_definition: Optional[str] = None


class BatchLookupResponse(BaseModel):
    lookup: dict[str, BatchLookupEntry]


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/glossary", response_model=GlossaryListResponse)
async def list_glossary_terms(
    domain: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    mandatory_for_s4hana: Optional[bool] = Query(None),
    ai_drafted: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    role: str = Depends(require_permission("view")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    tenant_id = str(tenant.id)
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

    conditions = ["gt.tenant_id = :tid"]
    params: dict = {"tid": tenant_id}

    if domain:
        conditions.append("gt.domain = :domain")
        params["domain"] = domain
    if status:
        conditions.append("gt.status = :status")
        params["status"] = status
    if mandatory_for_s4hana is not None:
        conditions.append("gt.mandatory_for_s4hana = :mandatory")
        params["mandatory"] = mandatory_for_s4hana
    if ai_drafted is not None:
        conditions.append("gt.ai_drafted = :ai_drafted")
        params["ai_drafted"] = ai_drafted
    if search:
        conditions.append(
            "(gt.business_name ILIKE :search OR gt.sap_table ILIKE :search "
            "OR gt.sap_field ILIKE :search OR gt.technical_name ILIKE :search)"
        )
        params["search"] = f"%{search}%"

    where = " AND ".join(conditions)

    # Count total
    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM glossary_terms gt WHERE {where}"),
        params,
    )
    total = count_result.scalar() or 0

    # Fetch page with linked rules count
    offset = (page - 1) * per_page
    params["limit"] = per_page
    params["offset"] = offset

    result = await db.execute(
        text(f"""
            SELECT gt.id, gt.sap_table, gt.sap_field, gt.technical_name, gt.business_name,
                   gt.domain, gt.mandatory_for_s4hana, gt.status, gt.ai_drafted,
                   gt.last_reviewed_at, gt.review_cycle_days,
                   COALESCE(rc.rule_count, 0) AS linked_rules_count
            FROM glossary_terms gt
            LEFT JOIN (
                SELECT term_id, COUNT(*) AS rule_count
                FROM glossary_term_rules
                WHERE tenant_id = :tid
                GROUP BY term_id
            ) rc ON rc.term_id = gt.id
            WHERE {where}
            ORDER BY gt.domain, gt.sap_table, gt.sap_field
            LIMIT :limit OFFSET :offset
        """),
        params,
    )

    terms = []
    for row in result.fetchall():
        terms.append(GlossaryTermSummary(
            id=str(row[0]),
            sap_table=row[1],
            sap_field=row[2],
            technical_name=row[3],
            business_name=row[4],
            domain=row[5],
            mandatory_for_s4hana=bool(row[6]),
            status=row[7],
            ai_drafted=bool(row[8]),
            last_reviewed_at=row[9].isoformat() if row[9] else None,
            review_cycle_days=row[10],
            linked_rules_count=row[11],
        ))

    return GlossaryListResponse(terms=terms, total=total, page=page, per_page=per_page)


@router.get("/glossary/{term_id}", response_model=GlossaryTermDetail)
async def get_glossary_term(
    term_id: str,
    role: str = Depends(require_permission("view")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    tenant_id = str(tenant.id)
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    tid = uuid.UUID(term_id)

    # Fetch term
    result = await db.execute(
        text("""
            SELECT id, sap_table, sap_field, technical_name, business_name,
                   business_definition, why_it_matters, sap_impact, domain,
                   approved_values, mandatory_for_s4hana, rule_authority,
                   data_steward_id, review_cycle_days, last_reviewed_at,
                   status, ai_drafted, created_at, updated_at
            FROM glossary_terms
            WHERE id = :id AND tenant_id = :tid
        """),
        {"id": str(tid), "tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Glossary term not found")

    # Fetch linked rules with live pass rates from findings
    rules_result = await db.execute(
        text("""
            SELECT gtr.rule_id, gtr.domain,
                   f.pass_rate, f.severity, f.affected_count, f.total_count
            FROM glossary_term_rules gtr
            LEFT JOIN LATERAL (
                SELECT pass_rate, severity, affected_count, total_count
                FROM findings
                WHERE check_id = gtr.rule_id AND tenant_id = :tid
                ORDER BY created_at DESC LIMIT 1
            ) f ON true
            WHERE gtr.term_id = :term_id AND gtr.tenant_id = :tid
        """),
        {"term_id": str(tid), "tid": tenant_id},
    )
    linked_rules = [
        LinkedRule(
            rule_id=r[0],
            domain=r[1],
            pass_rate=float(r[2]) if r[2] is not None else None,
            severity=r[3],
            affected_count=r[4],
            total_count=r[5],
        )
        for r in rules_result.fetchall()
    ]

    # Fetch change history
    history_result = await db.execute(
        text("""
            SELECT id, changed_by, changed_at, field_changed, old_value, new_value, change_reason
            FROM glossary_change_log
            WHERE term_id = :term_id AND tenant_id = :tid
            ORDER BY changed_at DESC
            LIMIT 50
        """),
        {"term_id": str(tid), "tid": tenant_id},
    )
    change_history = [
        ChangeLogEntry(
            id=str(h[0]),
            changed_by=h[1],
            changed_at=h[2].isoformat() if h[2] else "",
            field_changed=h[3],
            old_value=h[4],
            new_value=h[5],
            change_reason=h[6],
        )
        for h in history_result.fetchall()
    ]

    return GlossaryTermDetail(
        id=str(row[0]),
        sap_table=row[1],
        sap_field=row[2],
        technical_name=row[3],
        business_name=row[4],
        business_definition=row[5],
        why_it_matters=row[6],
        sap_impact=row[7],
        domain=row[8],
        approved_values=row[9],
        mandatory_for_s4hana=bool(row[10]),
        rule_authority=row[11],
        data_steward_id=str(row[12]) if row[12] else None,
        review_cycle_days=row[13],
        last_reviewed_at=row[14].isoformat() if row[14] else None,
        status=row[15],
        ai_drafted=bool(row[16]),
        created_at=row[17].isoformat() if row[17] else "",
        updated_at=row[18].isoformat() if row[18] else "",
        linked_rules=linked_rules,
        change_history=change_history,
    )


@router.post("/glossary/{term_id}/ai-draft", response_model=AIDraftResponse)
async def ai_draft(
    term_id: str,
    role: str = Depends(require_permission("trigger_ai")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    tenant_id = str(tenant.id)
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

    # Fetch term fields needed for enrichment
    result = await db.execute(
        text("""
            SELECT technical_name, sap_table, sap_field, why_it_matters, sap_impact
            FROM glossary_terms
            WHERE id = :id AND tenant_id = :tid
        """),
        {"id": term_id, "tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Glossary term not found")

    from api.services.ai_glossary_enricher import enrich_term, RateLimitExceeded, LLMError

    try:
        draft = enrich_term(
            tenant_id=tenant_id,
            technical_name=row[0],
            sap_table=row[1],
            sap_field=row[2],
            why_it_matters=row[3] or "",
            sap_impact=row[4] or "",
            skip_rate_limit=False,
        )
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Rate limit: 20 AI drafts per hour")
    except LLMError as e:
        raise HTTPException(status_code=502, detail=f"AI enrichment failed: {e}")

    return AIDraftResponse(
        business_definition=draft.get("business_definition", ""),
        why_it_matters_business=draft.get("why_it_matters_business", ""),
        committed=False,
    )


@router.put("/glossary/{term_id}")
async def update_glossary_term(
    term_id: str,
    body: GlossaryTermUpdate,
    request: Request,
    role: str = Depends(require_permission("approve")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    tenant_id = str(tenant.id)
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

    # Fetch current values for change detection
    result = await db.execute(
        text("""
            SELECT id, business_name, business_definition, why_it_matters, sap_impact,
                   status, data_steward_id, mandatory_for_s4hana, approved_values,
                   review_cycle_days
            FROM glossary_terms
            WHERE id = :id AND tenant_id = :tid
        """),
        {"id": term_id, "tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Glossary term not found")

    # Resolve user identity for change log
    user_header = request.headers.get("x-user-id", "unknown")
    changed_by = user_header

    # Build SET clauses and track changes
    updates: list[str] = ["updated_at = now()"]
    params: dict = {"id": term_id, "tid": tenant_id}
    changes: list[dict] = []

    field_map = {
        "business_name": (1, body.business_name),
        "business_definition": (2, body.business_definition),
        "why_it_matters": (3, body.why_it_matters),
        "sap_impact": (4, body.sap_impact),
        "status": (5, body.status),
    }

    definition_changed = False

    for field_name, (col_idx, new_val) in field_map.items():
        if new_val is not None:
            old_val = row[col_idx]
            if str(new_val) != str(old_val or ""):
                updates.append(f"{field_name} = :{field_name}")
                params[field_name] = new_val
                changes.append({
                    "field_changed": field_name,
                    "old_value": str(old_val) if old_val else None,
                    "new_value": str(new_val),
                })
                if field_name == "business_definition":
                    definition_changed = True

    if body.data_steward_id is not None:
        old_steward = str(row[6]) if row[6] else None
        if body.data_steward_id != (old_steward or ""):
            updates.append("data_steward_id = :data_steward_id")
            params["data_steward_id"] = body.data_steward_id if body.data_steward_id else None
            changes.append({
                "field_changed": "data_steward_id",
                "old_value": old_steward,
                "new_value": body.data_steward_id,
            })

    if body.mandatory_for_s4hana is not None:
        old_mandatory = bool(row[7])
        if body.mandatory_for_s4hana != old_mandatory:
            updates.append("mandatory_for_s4hana = :mandatory_for_s4hana")
            params["mandatory_for_s4hana"] = body.mandatory_for_s4hana
            changes.append({
                "field_changed": "mandatory_for_s4hana",
                "old_value": str(old_mandatory),
                "new_value": str(body.mandatory_for_s4hana),
            })

    if body.approved_values is not None:
        import json
        updates.append("approved_values = :approved_values::jsonb")
        params["approved_values"] = json.dumps(body.approved_values)
        changes.append({
            "field_changed": "approved_values",
            "old_value": json.dumps(row[8]) if row[8] else None,
            "new_value": json.dumps(body.approved_values),
        })

    if body.review_cycle_days is not None and body.review_cycle_days != row[9]:
        updates.append("review_cycle_days = :review_cycle_days")
        params["review_cycle_days"] = body.review_cycle_days
        changes.append({
            "field_changed": "review_cycle_days",
            "old_value": str(row[9]),
            "new_value": str(body.review_cycle_days),
        })

    # If business_definition was changed by a human, mark ai_drafted=False
    if definition_changed:
        updates.append("ai_drafted = false")

    if len(updates) <= 1:
        # Only updated_at, no real changes
        raise HTTPException(status_code=422, detail="No changes provided")

    set_clause = ", ".join(updates)
    await db.execute(
        text(f"UPDATE glossary_terms SET {set_clause} WHERE id = :id AND tenant_id = :tid"),
        params,
    )

    # Write change log entries
    for change in changes:
        await db.execute(
            text("""
                INSERT INTO glossary_change_log
                  (tenant_id, term_id, changed_by, field_changed, old_value, new_value, change_reason)
                VALUES (:tid, :term_id, :changed_by, :field_changed, :old_value, :new_value, :reason)
            """),
            {
                "tid": tenant_id,
                "term_id": term_id,
                "changed_by": changed_by,
                "field_changed": change["field_changed"],
                "old_value": change["old_value"],
                "new_value": change["new_value"],
                "reason": "Manual update by steward",
            },
        )

    await db.commit()
    return {"status": "updated", "changes": len(changes)}


@router.post("/glossary/{term_id}/review")
async def review_glossary_term(
    term_id: str,
    request: Request,
    role: str = Depends(require_permission("approve")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    tenant_id = str(tenant.id)
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

    # Check term exists
    result = await db.execute(
        text("SELECT id, last_reviewed_at FROM glossary_terms WHERE id = :id AND tenant_id = :tid"),
        {"id": term_id, "tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Glossary term not found")

    user_header = request.headers.get("x-user-id", "unknown")

    # Update last_reviewed_at
    await db.execute(
        text("""
            UPDATE glossary_terms
            SET last_reviewed_at = now(), updated_at = now()
            WHERE id = :id AND tenant_id = :tid
        """),
        {"id": term_id, "tid": tenant_id},
    )

    # Write change log
    await db.execute(
        text("""
            INSERT INTO glossary_change_log
              (tenant_id, term_id, changed_by, field_changed, old_value, new_value, change_reason)
            VALUES (:tid, :term_id, :changed_by, 'last_reviewed_at', :old_val, 'now()', 'Term reviewed')
        """),
        {
            "tid": tenant_id,
            "term_id": term_id,
            "changed_by": user_header,
            "old_val": row[1].isoformat() if row[1] else None,
        },
    )

    await db.commit()
    return {"status": "reviewed", "term_id": term_id}


@router.post("/glossary/batch-lookup", response_model=BatchLookupResponse)
async def batch_lookup(
    body: BatchLookupRequest,
    role: str = Depends(require_permission("view")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Batch lookup glossary terms by TABLE.FIELD strings.

    Used by integration points (golden records, findings) to resolve
    business names for SAP field codes.
    """
    tenant_id = str(tenant.id)
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

    if not body.fields:
        return BatchLookupResponse(lookup={})

    # Fetch all glossary terms for this tenant (glossary is small, hundreds at most)
    result = await db.execute(
        text("""
            SELECT id, technical_name, business_name, business_definition
            FROM glossary_terms
            WHERE tenant_id = :tid
        """),
        {"tid": tenant_id},
    )

    # Build lookup by technical_name
    lookup: dict[str, BatchLookupEntry] = {}
    for row in result.fetchall():
        tech_name = row[1]
        if tech_name in body.fields:
            lookup[tech_name] = BatchLookupEntry(
                id=str(row[0]),
                business_name=row[2],
                business_definition=row[3],
            )

    return BatchLookupResponse(lookup=lookup)
