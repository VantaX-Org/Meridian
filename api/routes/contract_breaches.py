"""Data contract breaches (api/services/contract_enforcement.py).

GET /api/v1/contracts/{contract_id}/breaches   the contract's breaches on the current state (each object at its newest
                                                finished run, per system) and the breaches recorded after each run
GET /api/v1/objects/{module}/contracts          the contracts covering one object and their breaches on its run
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import contract_enforcement as ce
from api.services.contract_compliance import scope_modules
from api.services.rbac import require_permission, scope_from_path

router = APIRouter(prefix="/api/v1", tags=["contract-enforcement"])


@router.get("/contracts/{contract_id}/breaches", dependencies=[Depends(require_permission("view"))])
async def contract_breaches(contract_id: uuid.UUID, limit: int = Query(200, ge=1, le=2000),
                            db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    from api.routes.landscape import _CELL_RUNS_SQL

    await _rls(db, tenant)
    t = str(tenant.id)
    c = (await db.execute(text("SELECT * FROM contracts WHERE id = :c AND tenant_id = :t"),
                          {"c": str(contract_id), "t": t})).mappings().first()
    if c is None:
        raise HTTPException(status_code=404, detail="Contract not found")
    contract = dict(c)
    triples = (await db.execute(text(_CELL_RUNS_SQL), {"t": t})).mappings().all()
    summaries: dict[str, dict] = {}
    current = []
    for r in triples:
        if not scope_modules(contract, [r["module"]]):
            continue
        if r["run_id"] not in summaries:
            summaries[r["run_id"]] = await ce.summary_of(db, t, r["run_id"])
        for b in ce.object_breaches(contract, r["module"], summaries[r["run_id"]].get(r["module"])):
            current.append({**b, "run_id": r["run_id"], "system_id": r["sid"]})
    history = (await db.execute(text("""
        SELECT b.version_id::text AS run_id, v.run_at, b.module, b.metric, b.threshold, b.actual, b.enforced, b.created_at
          FROM contract_breaches b JOIN analysis_versions v ON v.id = b.version_id AND v.tenant_id = b.tenant_id
         WHERE b.tenant_id = :t AND b.contract_id = :c ORDER BY v.run_at DESC, b.module, b.metric LIMIT :n"""),
        {"t": t, "c": str(contract_id), "n": limit})).mappings().all()
    return {"contract_id": str(contract_id), "name": contract["name"], "status": contract["status"],
            "enforce": bool(contract.get("enforce")), "thresholds": ce.effective_thresholds(contract),
            "current": current, "history": [dict(h) for h in history]}


@router.get("/objects/{module}/contracts", dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def object_contracts(module: str, run: uuid.UUID | None = Query(None), db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant)) -> dict:
    """The active contracts covering the object and their breaches on run ``run`` (default: the object's latest)."""
    from api.services.run_context import latest_run

    await _rls(db, tenant)
    t = str(tenant.id)
    run_id = str(run) if run else await latest_run(db, tenant.id, module=module)
    summary = await ce.summary_of(db, t, run_id) if run_id else {}
    contracts = [c for c in await ce.active(db, t) if scope_modules(c, [module])]
    out = []
    for c in contracts:
        breaches = ce.object_breaches(c, module, summary.get(module)) if module in summary else []
        out.append({"contract_id": str(c["id"]), "name": c["name"], "producer": c["producer"], "consumer": c["consumer"],
                    "enforce": bool(c.get("enforce")), "thresholds": ce.effective_thresholds(c),
                    "breaches": [{k: b[k] for k in ("metric", "threshold", "actual")} for b in breaches]})
    return {"module": module, "run_id": run_id, "contracts": out,
            "breached": sum(1 for c in out if c["breaches"]),
            "enforced_breached": sum(1 for c in out if c["breaches"] and c["enforce"])}
