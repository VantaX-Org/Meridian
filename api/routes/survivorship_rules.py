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
from api.services import survivorship_preview as sp
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


# ── Preview: what-if before saving ──────────────────────────────────────────

PREVIEW_CAP = 500


class SurvivorshipPreviewBody(BaseModel):
    domain: str = Field(min_length=1, max_length=64)
    rules: list[SurvivorshipRuleBody]
    system_type: str = Field("ecc", min_length=1, max_length=32)


class PreviewAttribute(BaseModel):
    field: str
    changed: int
    in_dictionary: bool
    table: Optional[str] = None
    text: str = ""
    length: Optional[int] = None
    check_table: Optional[str] = None
    fixed_values: int = 0
    check_status: Literal["checked", "unknown", "not_checked"]
    invalid: int
    invalid_reasons: dict[str, int]
    invalid_samples: list[str]


class PreviewSample(BaseModel):
    golden_id: Optional[str] = None
    key: Optional[str] = None
    field: str
    before: str
    after: str
    rule: Optional[str] = None
    winner_key: Optional[str] = None
    winner_system: Optional[str] = None


class SurvivorshipPreviewOut(BaseModel):
    domain: str
    clusters_total: int
    clusters_scanned: int
    capped: bool
    cap: int
    records_changed: int
    values_changed: int
    invalid_values: int
    value_set_source: Literal["live", "baseline", "none"]
    attributes: list[PreviewAttribute]
    samples: list[PreviewSample]


@router.post("/survivorship-rules/preview", response_model=SurvivorshipPreviewOut)
async def preview_survivorship_rules(
    body: SurvivorshipPreviewBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("mdm.read")),
) -> SurvivorshipPreviewOut:
    """Re-run survivorship with the posted rules over the stored clusters and diff the golden values.

    Read only: nothing is saved. At most PREVIEW_CAP clusters are scanned (most recently changed first)
    and the response says when the cap was hit.
    """
    from api.routes.record_issues import _rls
    from api.services.golden_record_engine import _system_aliases, resolve_trusted_sources
    from api.services.mdm_merge import _COLS, _own, _systems
    from sap.baseline_config import BASELINE_CONFIG
    from sap.ddic import dictionary_for_system

    await _rls(db, tenant)
    tid = str(tenant.id)
    systems = await _system_aliases(db, tid)
    rules = {r.field: {"rule_type": r.rule_type, "trusted_sources": resolve_trusted_sources(r.trusted_sources, systems),
                       "weight": r.weight} for r in body.rules if r.active}
    has_members = ("EXISTS (SELECT 1 FROM master_records m WHERE m.tenant_id = :tid AND m.merged_into = h.id)")
    params = {"tid": tid, "d": body.domain}
    total = (await db.execute(text(
        f"SELECT count(*) FROM master_records h WHERE h.tenant_id = :tid AND h.domain = :d "
        f"AND h.merged_into IS NULL AND {has_members}"), params)).scalar() or 0
    heads = (await db.execute(text(
        f"SELECT {', '.join('h.' + c.strip() for c in _COLS.split(','))} FROM master_records h "
        f"WHERE h.tenant_id = :tid AND h.domain = :d AND h.merged_into IS NULL AND {has_members} "
        f"ORDER BY h.created_at DESC, h.id LIMIT :cap"), {**params, "cap": PREVIEW_CAP})).fetchall()
    by_head: dict[str, list] = {}
    if heads:
        for m in (await db.execute(text(
                f"SELECT {_COLS} FROM master_records WHERE tenant_id = :tid AND merged_into = ANY(CAST(:ids AS uuid[])) "
                "ORDER BY created_at, sap_object_key"), {"tid": tid, "ids": [str(h.id) for h in heads]})).fetchall():
            by_head.setdefault(str(m.merged_into), []).append(m)

    def member(r) -> dict:
        return {"key": r.sap_object_key, "fields": _own(r), "extracted_at": r.created_at, "systems": _systems(r)}

    clusters = [{"golden_id": str(h.id), "key": h.sap_object_key, "golden": h.golden_fields or {},
                 "overrides": h.steward_overrides or {},
                 "members": [member(h), *(member(m) for m in by_head.get(str(h.id), []))]} for h in heads]

    live = (await db.execute(text("SELECT config_table, config_data FROM config_snapshots "
                                  "WHERE tenant_id = :tid AND source = 'live'"), {"tid": tid})).fetchall()
    baseline = [(t, recs) for mod in (BASELINE_CONFIG.get(body.system_type) or {}).values() for t, recs in mod.items()]
    sets = sp.value_sets(baseline)
    sets.update(sp.value_sets([(r[0], r[1]) for r in live]))  # the tenant's own configuration wins
    source = "live" if live else "baseline" if baseline else "none"

    dictionary = dictionary_for_system(body.system_type)
    out = sp.preview(clusters, rules, dictionary, sp.domain_tables(body.domain, body.system_type), sets)
    return SurvivorshipPreviewOut(domain=body.domain, clusters_total=int(total), capped=int(total) > len(heads),
                                  cap=PREVIEW_CAP, value_set_source=source, **out)
