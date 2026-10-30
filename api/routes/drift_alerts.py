"""GET /api/v1/config/drift/alerts: config drift alerts, newest first (api/services/drift_alerts.py).

Each alert: the system, the config load or sync it came from, the changed areas with their added / removed / changed
counts, the rules that depend on them (with their names), the objects those rules run on, how many owners were
notified and whether the re-score was queued. Turned on and off with PUT /settings/automation (drift_alerts.enabled).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import drift_alerts
from api.services.rbac import require_permission
from api.services.receipt_math import rule_names

router = APIRouter(prefix="/api/v1/config/drift", tags=["drift-alerts"])


@router.get("/alerts", dependencies=[Depends(require_permission("view"))])
async def list_drift_alerts(limit: int = Query(50, ge=1, le=500), db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    alerts = await db.run_sync(lambda s: drift_alerts.list_alerts(s, str(tenant.id), limit))
    names = await rule_names(db, tenant, sorted({r for a in alerts for r in a["rules"]}))
    for a in alerts:
        a["rules"] = [{"check_id": r, "name": names.get(r)} for r in a["rules"]]
    return {"alerts": alerts}
