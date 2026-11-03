"""Real-time data-quality firewall (api/services/dq_firewall.py).

  POST /api/v1/dq-firewall/validate   {module, records: [{"TABLE.FIELD": value}, ...]} (1 to 100): synchronous verdict
                                      with every failing enabled rule per record; nothing stored but one audit row
  GET  /api/v1/dq-firewall/summary    the modules, the limits and the recent-call counts from the audit

Callers are people or API keys (service accounts, api/routes/api_keys.py) holding mdm.write; the tenant comes from the
credential and RLS is set before the audit row is written. The audit row holds the module, counts and failing rule ids,
never a record value. The language model is never involved.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import change_requests as crs
from api.services import dq_firewall as fw
from api.services.rbac import require_permission, write_audit

logger = logging.getLogger("meridian.dq_firewall")
router = APIRouter(prefix="/api/v1/dq-firewall", tags=["dq-firewall"])
ACTION = "dq_firewall.validate"


class ValidateBody(BaseModel):
    module: str = Field(min_length=1, max_length=60)
    records: list[dict[str, Any]] = Field(min_length=1, max_length=fw.MAX_RECORDS)


class Failure(BaseModel):
    rule_id: str
    description: str
    field: str
    severity: str
    dimension: str
    reason: str


class RecordOut(BaseModel):
    index: int
    verdict: str
    failures: list[Failure]


class ValidateOut(BaseModel):
    verdict: str
    block_severity: str
    module: str
    rules_run: int
    records: list[RecordOut]


class SummaryOut(BaseModel):
    modules: list[str]
    max_records: int
    block_severity: str
    calls_24h: int
    calls_7d: int
    last_call_at: Optional[str] = None


async def _rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})


@router.post("/validate", response_model=ValidateOut, dependencies=[Depends(require_permission("mdm.write"))])
async def validate(body: ValidateBody, request: Request, db: AsyncSession = Depends(get_db),
                   tenant: Tenant = Depends(get_tenant)) -> ValidateOut:
    """Which enabled rules the candidate records fail, and whether to block them (any critical failure blocks)."""
    await _rls(db, tenant)
    overrides, authored = await db.run_sync(lambda s: crs.governance(s))
    try:
        res = await asyncio.to_thread(fw.validate, str(tenant.id), body.module, body.records, overrides, authored)
    except fw.FirewallError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except Exception as e:  # noqa: BLE001 - no trace to the caller; the type is logged
        logger.error("dq firewall failed for module %s: %s", body.module, type(e).__name__)
        raise HTTPException(status_code=500, detail="The check engine could not judge these records.") from None
    fails = [f for r in res["records"] for f in r["failures"]]
    await write_audit(db, tenant.id, request, ACTION, "dq_firewall", body.module, None, {
        "records": len(res["records"]), "blocked_records": sum(r["verdict"] == "block" for r in res["records"]),
        "failures": len(fails), "verdict": res["verdict"],
        "blocking_rules": sorted({f["rule_id"] for f in fails if f["severity"] == fw.BLOCK_SEVERITY})[:50]})
    await db.commit()
    return ValidateOut(**res)


@router.get("/summary", response_model=SummaryOut, dependencies=[Depends(require_permission("mdm.read"))])
async def summary(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> SummaryOut:
    """The modules the firewall judges, its limits and how many calls the audit holds for 24 hours and 7 days."""
    await _rls(db, tenant)
    row = (await db.execute(text(
        "SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours'), count(*), max(created_at) "
        "FROM audit_log WHERE tenant_id = CAST(:t AS uuid) AND action = :a AND created_at > now() - interval '7 days'"),
        {"t": str(tenant.id), "a": ACTION})).fetchone()
    return SummaryOut(modules=list(fw.modules()), max_records=fw.MAX_RECORDS, block_severity=fw.BLOCK_SEVERITY,
                      calls_24h=int(row[0] or 0), calls_7d=int(row[1] or 0),
                      last_call_at=row[2].isoformat() if row[2] else None)
