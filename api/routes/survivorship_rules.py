"""Survivorship rules: GET/PUT /survivorship-rules.

PUT replaces the full rule set of one domain (idempotent), so the UI can edit
a domain as a table and save once.
"""

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["survivorship-rules"])

RuleType = Literal[
    "most_recent", "most_complete", "most_frequent", "trusted_source", "chain", "manual_override"
]


class SurvivorshipRuleBody(BaseModel):
    field: str = Field(min_length=1)
    rule_type: RuleType = "most_recent"
    trusted_sources: Optional[list[str]] = None
    weight: int = Field(50, ge=0, le=100)
    active: bool = True


class SurvivorshipRuleOut(SurvivorshipRuleBody):
    id: str
    domain: str
    ai_inferred: bool


class SurvivorshipRulesPut(BaseModel):
    domain: str = Field(min_length=1)
    rules: list[SurvivorshipRuleBody]


class SurvivorshipRulesOut(BaseModel):
    rules: list[SurvivorshipRuleOut]
    total: int


async def _list(db: AsyncSession, tenant: Tenant, domain: Optional[str]) -> SurvivorshipRulesOut:
    sql = (
        "SELECT id, domain, field, rule_type, trusted_sources, weight, active, ai_inferred "
        "FROM survivorship_rules WHERE tenant_id = :tid"
    )
    params: dict = {"tid": str(tenant.id)}
    if domain:
        sql += " AND domain = :domain"
        params["domain"] = domain
    rows = (await db.execute(text(sql + " ORDER BY domain, field"), params)).fetchall()
    rules = [
        SurvivorshipRuleOut(
            id=str(r[0]), domain=r[1], field=r[2], rule_type=r[3],
            trusted_sources=r[4], weight=r[5], active=r[6], ai_inferred=r[7],
        )
        for r in rows
    ]
    return SurvivorshipRulesOut(rules=rules, total=len(rules))


@router.get("/survivorship-rules", response_model=SurvivorshipRulesOut)
async def list_survivorship_rules(
    domain: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("mdm.read")),
) -> SurvivorshipRulesOut:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    return await _list(db, tenant, domain)


@router.put("/survivorship-rules", response_model=SurvivorshipRulesOut)
async def replace_survivorship_rules(
    body: SurvivorshipRulesPut,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("mdm.write")),
) -> SurvivorshipRulesOut:
    """Replace the survivorship rules of one domain with the posted set."""
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    seen: set[str] = set()
    await db.execute(
        text("DELETE FROM survivorship_rules WHERE tenant_id = :tid AND domain = :domain"),
        {"tid": str(tenant.id), "domain": body.domain},
    )
    for r in body.rules:
        if r.field in seen:
            continue  # last-write-wins is ambiguous; keep the first row per field
        seen.add(r.field)
        await db.execute(
            text(
                "INSERT INTO survivorship_rules (id, tenant_id, domain, field, rule_type, "
                "trusted_sources, weight, active) VALUES (:id, :tid, :domain, :field, :rt, :ts, :w, :a)"
            ),
            {"id": str(uuid.uuid4()), "tid": str(tenant.id), "domain": body.domain, "field": r.field,
             "rt": r.rule_type, "ts": r.trusted_sources, "w": r.weight, "a": r.active},
        )
    out = await _list(db, tenant, body.domain)
    await db.commit()
    return out
