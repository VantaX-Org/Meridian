"""People: the owners and stewards of the data, with their work.

GET /api/v1/people   everyone who owns an object, steward-assigned work or a work record, the caller's own row first

A person is listed when they are an object/rule/system owner or steward (data_owners), hold an open stewardship item,
have a work record assigned to them in the current state, or are the caller. Counts are read from what is stored:

  open_work           work records assigned to them, open (to fix, proposed, approved, sent), in the current state
  overdue             of those, the ones past their SLA due date
  approvals_waiting   draft fix batches that await a second person, for a user who may approve (not their own batches)
  sla_hours           the strictest resolve time of the tenant's SLA policies (triage) for the severities of their open
                      work; null when they have none open or the tenant has no policy
  breaches_this_month record issues assigned to them whose SLA state is breached and was due this calendar month
  last_action_at      their latest audit_log row; null when they have none

Read-only, tenant-scoped, ``view`` permission.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.objects import _label
from api.routes.record_issues import _rls
from api.services.current_state import current_pairs, pairs_clause
from api.services.rbac import actions_for, current_user_id, has_permission, require_permission

router = APIRouter(prefix="/api/v1/people", tags=["people"], dependencies=[Depends(require_permission("view"))])

_OPEN = ("to_fix", "proposed", "approved", "sent")
_SEVERITY = {0: "critical", 1: "high", 2: "medium", 3: "low"}  # work_records.sev_rank


class PersonOut(BaseModel):
    id: str
    name: str
    email: Optional[str] = None
    role: str
    is_me: bool = False
    objects_owned: list[dict]                  # [{module, label, as: owner|steward}]
    open_work: int
    approvals_waiting: int
    overdue: int
    sla_hours: Optional[float] = None
    breaches_this_month: int
    last_action_at: Optional[datetime] = None


class PeopleOut(BaseModel):
    people: list[PersonOut]


@router.get("", response_model=PeopleOut)
async def list_people(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    t = str(tenant.id)
    me = current_user_id(request)

    owned: dict[str, list[dict]] = {}
    for r in (await db.execute(text(
            "SELECT ref, owner_user_id::text AS o, steward_user_id::text AS s FROM data_owners "
            "WHERE tenant_id = CAST(:t AS uuid) AND kind = 'object' ORDER BY ref"), {"t": t})).mappings().all():
        for uid, role in ((r["o"], "owner"), (r["s"], "steward")):
            if uid:
                owned.setdefault(uid, []).append({"module": r["ref"], "label": _label(r["ref"]), "as": role})
    any_owner = {r[0] for r in (await db.execute(text(
        "SELECT owner_user_id::text FROM data_owners WHERE tenant_id = CAST(:t AS uuid) AND owner_user_id IS NOT NULL "
        "UNION SELECT steward_user_id::text FROM data_owners WHERE tenant_id = CAST(:t AS uuid) AND steward_user_id IS NOT NULL "
        "UNION SELECT assigned_to::text FROM stewardship_queue WHERE tenant_id = CAST(:t AS uuid) AND assigned_to IS NOT NULL "
        "AND status IN ('open', 'in_progress')"), {"t": t})).fetchall()}

    pairs = await current_pairs(db, tenant.id)
    open_by: dict[str, dict] = {}
    if pairs:
        p: dict = {"t": t, "open": list(_OPEN)}
        where = pairs_clause("w", pairs, p)
        for r in (await db.execute(text(f"""
            SELECT w.assigned_to::text AS u, count(*) AS n, count(*) FILTER (WHERE w.due_at < now()) AS late,
                   array_agg(DISTINCT w.sev_rank) AS ranks
              FROM work_records w WHERE w.tenant_id = CAST(:t AS uuid) AND w.status = ANY(:open)
               AND w.assigned_to IS NOT NULL AND {where} GROUP BY w.assigned_to"""), p)).mappings().all():
            open_by[r["u"]] = {"n": int(r["n"]), "late": int(r["late"]), "ranks": list(r["ranks"] or [])}

    policies: dict[str, float] = {}
    for sev, minutes in (await db.execute(text(
            "SELECT severity, min(resolve_minutes) FROM sla_policies WHERE tenant_id = CAST(:t AS uuid) GROUP BY severity"),
            {"t": t})).fetchall():
        policies[sev] = float(minutes) / 60.0

    breaches = {r[0]: int(r[1]) for r in (await db.execute(text(
        "SELECT assigned_to::text, count(*) FROM record_issues WHERE tenant_id = CAST(:t AS uuid) AND assigned_to IS NOT NULL "
        "AND sla_state = 'breached' AND due_at >= date_trunc('month', now()) AND due_at < date_trunc('month', now()) + interval '1 month' "
        "GROUP BY assigned_to"), {"t": t})).fetchall()}
    last_action = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT actor_user_id::text, max(created_at) FROM audit_log WHERE tenant_id = CAST(:t AS uuid) "
        "AND actor_user_id IS NOT NULL GROUP BY actor_user_id"), {"t": t})).fetchall()}
    drafts = (await db.execute(text(
        "SELECT created_by::text, count(*) FROM remediation_batches b WHERE b.tenant_id = CAST(:t AS uuid) AND b.status = 'draft' "
        "AND EXISTS (SELECT 1 FROM remediation_items i WHERE i.batch_id = b.id) GROUP BY created_by"), {"t": t})).fetchall()
    drafts_by = {r[0]: int(r[1]) for r in drafts if r[0]}
    drafts_total = sum(int(r[1]) for r in drafts)  # includes batches with no human creator

    wanted = set(owned) | any_owner | set(open_by) | ({me} if me else set())
    users = (await db.execute(text(
        "SELECT id::text AS id, name, email, role FROM users WHERE tenant_id = CAST(:t AS uuid) AND id = ANY(CAST(:ids AS uuid[]))"),
        {"t": t, "ids": sorted(wanted)})).mappings().all() if wanted else []

    people = []
    for u in users:
        uid, role = u["id"], u["role"]
        may_approve = has_permission(role, "approve") or "approve" in await actions_for(role, tenant.id, db)
        mine = open_by.get(uid, {"n": 0, "late": 0, "ranks": []})
        hours = [policies[_SEVERITY[k]] for k in mine["ranks"] if _SEVERITY.get(k) in policies]
        people.append({
            "id": uid, "name": u["name"], "email": u["email"], "role": role, "is_me": uid == me,
            "objects_owned": owned.get(uid, []),
            "open_work": mine["n"], "overdue": mine["late"],
            "approvals_waiting": (drafts_total - drafts_by.get(uid, 0)) if may_approve else 0,
            "sla_hours": round(min(hours), 2) if hours else None,
            "breaches_this_month": breaches.get(uid, 0),
            "last_action_at": last_action.get(uid),
        })
    people.sort(key=lambda x: (not x["is_me"], -x["open_work"], -x["approvals_waiting"], x["name"].lower(), x["id"]))
    return {"people": people}
