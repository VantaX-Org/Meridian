"""Aletheia verified survivorship: where the model picked a golden-record winner and whether the server proved it.

The model sees only the shape of each source's value (api/services/ai_survivorship.py); its pick wins only when
``verify`` passes. This read-only route lists every such pick stored on the master records, with the checks. It
returns no field value: a golden value can be personal data, and the screen needs only the field, the source and the proof.
"""
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.mining import field_text
from api.routes.record_issues import _rls
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/aletheia/survivorship", tags=["aletheia"])


class Check(BaseModel):
    code: str
    passed: bool


class Pick(BaseModel):
    domain: str
    sap_object_key: str
    field: str
    field_text: Optional[str] = None
    recommended_source: str
    confidence: Optional[float] = None
    reasoning: str = ""
    verified: bool
    checks: list[Check]


class DomainCount(BaseModel):
    domain: str
    verified: int
    rejected: int


class Survivorship(BaseModel):
    domains: list[DomainCount]
    picks: list[Pick]


def summarise(rows: list[tuple], limit: int) -> dict:
    """Group stored ``(domain, key, field, contribution)`` rows into per-domain counts and the newest ``limit`` picks."""
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    picks: list[dict] = []
    for domain, key, field, c in rows:
        # entries written before verification existed carry no proof; they count as rejected, never as verified
        v = c.get("ai_verification") or {"verified": False, "checks": []}
        counts[domain][0 if v["verified"] else 1] += 1
        if len(picks) < limit:
            picks.append({"domain": domain, "sap_object_key": key, "field": field, "field_text": field_text(field, domain),
                          "recommended_source": c["ai_recommendation"], "confidence": c.get("ai_confidence"),
                          "reasoning": c.get("ai_reasoning") or "", "verified": bool(v["verified"]), "checks": v["checks"]})
    return {"domains": [{"domain": d, "verified": a, "rejected": b} for d, (a, b) in sorted(counts.items())], "picks": picks}


@router.get("", response_model=Survivorship, dependencies=[Depends(require_permission("view"))])
async def survivorship(limit: int = Query(50, ge=1, le=200), db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    rows = (await db.execute(text("""
        SELECT m.domain, m.sap_object_key, e.key, e.value
        FROM master_records m, jsonb_each(m.source_contributions) e
        WHERE m.tenant_id = :tid AND e.value ? 'ai_recommendation'
        ORDER BY m.updated_at DESC
    """), {"tid": str(tenant.id)})).fetchall()
    return summarise([tuple(r) for r in rows], limit)
