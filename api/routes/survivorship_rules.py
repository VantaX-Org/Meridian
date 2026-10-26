"""Survivorship rules: GET/PUT /survivorship-rules.

PUT replaces the full rule set of one domain (idempotent), so the UI can edit
a domain as a table and save once.
"""

import logging
import uuid
from typing import Literal, Optional, get_args

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

logger = logging.getLogger(__name__)

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

    @model_validator(mode="after")
    def _unique_fields(self) -> "SurvivorshipRulesPut":
        fields = [r.field for r in self.rules]
        dupes = sorted({f for f in fields if fields.count(f) > 1})
        if dupes:
            raise ValueError(f"duplicate rule for field(s): {', '.join(dupes)}")
        return self


class SurvivorshipRulesOut(BaseModel):
    rules: list[SurvivorshipRuleOut]
    total: int


_RULE_TYPES = get_args(RuleType)
_DEFAULT_RULE_TYPE: RuleType = "most_recent"


def _rule_type(value: str, rule_id: object) -> RuleType:
    """rule_type is free text in the table; a legacy value must not 500 the whole listing."""
    if value in _RULE_TYPES:
        return value  # type: ignore[return-value]
    logger.warning("survivorship rule %s has unknown rule_type %r; reporting %s", rule_id, value, _DEFAULT_RULE_TYPE)
    return _DEFAULT_RULE_TYPE


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
            id=str(r[0]), domain=r[1], field=r[2], rule_type=_rule_type(r[3], r[0]),
            trusted_sources=r[4], weight=r[5], active=r[6], ai_inferred=r[7],
        )
        for r in rows
    ]
    return SurvivorshipRulesOut(rules=rules, total=len(rules))


def _keeps_ai_flag(stored: Optional[tuple], posted: SurvivorshipRuleBody) -> bool:
    """``ai_inferred`` of a stored rule ``(rule_type, trusted_sources, weight, active, ai_inferred)``
    survives a save only when the posted rule is that same rule."""
    if stored is None:
        return False
    rule_type, trusted, weight, active, ai = stored
    same = (rule_type == posted.rule_type and list(trusted or []) == list(posted.trusted_sources or [])
            and weight == posted.weight and bool(active) == posted.active)
    return bool(ai) and same


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
    """Replace the survivorship rules of one domain with the posted set.

    A rule posted unchanged (same field, rule type, trusted systems, weight and active flag) keeps its
    ``ai_inferred`` flag; a rule the user changed or added is the user's own (``ai_inferred`` false).
    """
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    stored = {
        r[0]: r[1:]
        for r in (await db.execute(
            text("SELECT field, rule_type, trusted_sources, weight, active, ai_inferred "
                 "FROM survivorship_rules WHERE tenant_id = :tid AND domain = :domain"),
            {"tid": str(tenant.id), "domain": body.domain},
        )).fetchall()
    }
    await db.execute(
        text("DELETE FROM survivorship_rules WHERE tenant_id = :tid AND domain = :domain"),
        {"tid": str(tenant.id), "domain": body.domain},
    )
    for r in body.rules:
        await db.execute(
            text(
                "INSERT INTO survivorship_rules (id, tenant_id, domain, field, rule_type, "
                "trusted_sources, weight, active, ai_inferred) "
                "VALUES (:id, :tid, :domain, :field, :rt, :ts, :w, :a, :ai)"
            ),
            {"id": str(uuid.uuid4()), "tid": str(tenant.id), "domain": body.domain, "field": r.field,
             "rt": r.rule_type, "ts": r.trusted_sources, "w": r.weight, "a": r.active,
             "ai": _keeps_ai_flag(stored.get(r.field), r)},
        )
    out = await _list(db, tenant, body.domain)
    await db.commit()
    return out
