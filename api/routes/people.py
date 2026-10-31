"""People: the owners and stewards of the data, with their work.

GET  /api/v1/people               everyone who owns an object, steward-assigned work or a work record, the caller's own row first
GET  /api/v1/people/next          the caller's next steps, one ordered list (see next_steps)
POST /api/v1/people/{id}/remind   remind a person of their overdue work (``assign``)

A person is listed when they are an object/rule/system owner or steward (data_owners), hold an open stewardship item,
have a work record assigned to them in the current state, or are the caller. Counts are read from what is stored:

  open_work           work records assigned to them, open (to fix, proposed, approved, awaiting the SAP load, sent), in the current state
  overdue             of those, the ones past their SLA due date
  approvals_waiting   draft fix batches that await a second person, for a user who may approve (not their own batches)
  sla_hours           the strictest resolve time of the tenant's SLA policies (triage) for the severities of their open
                      work; null when they have none open or the tenant has no policy
  breaches_this_month record issues assigned to them whose SLA state is breached and was due this calendar month
  last_action_at      their latest audit_log row; null when they have none
  sla_met_pct         of the record issues assigned to them that were closed in the last 90 days with an SLA due date, the
                      share closed on or before it (api/routes/triage.py /metrics counts the same way), one decimal; null
                      when none closed

Read-only, tenant-scoped, ``view`` permission.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.objects import _label
from api.routes.record_issues import _rls
from api.services.current_state import current_pairs, pairs_clause
from api.services.work_counts import SEV_RANK_OF_NAME_SQL
from api.services.rbac import actions_for, current_user_id, has_permission, require_permission

router = APIRouter(prefix="/api/v1/people", tags=["people"], dependencies=[Depends(require_permission("view"))])

_OPEN = ("to_fix", "proposed", "approved", "awaiting_load", "sent")
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
    sla_met_pct: Optional[float] = None


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
        # counts and severities from work_counts (migration 108); overdue is time-dependent, so counted live on
        # the partial index of records with a due date
        cwhere = pairs_clause("c", pairs, p)
        for r in (await db.execute(text(f"""
            SELECT c.assigned_to::text AS u, sum(c.count)::bigint AS n,
                   array_agg(DISTINCT {SEV_RANK_OF_NAME_SQL.format(c="c.severity")}) AS ranks
              FROM work_counts c WHERE c.tenant_id = CAST(:t AS uuid) AND c.status = ANY(:open)
               AND c.count > 0 AND c.assigned_to IS NOT NULL AND {cwhere} GROUP BY c.assigned_to"""),
                p)).mappings().all():
            open_by[r["u"]] = {"n": int(r["n"]), "late": 0, "ranks": list(r["ranks"] or [])}
        where = pairs_clause("w", pairs, p, key="w")
        for u, late in (await db.execute(text(f"""
            SELECT w.assigned_to::text, count(*) FROM work_records w WHERE w.tenant_id = CAST(:t AS uuid)
               AND w.status = ANY(:open) AND w.assigned_to IS NOT NULL AND w.due_at < now() AND {where}
             GROUP BY w.assigned_to"""), p)).fetchall():
            if u in open_by:
                open_by[u]["late"] = int(late)

    policies: dict[str, float] = {}
    for sev, minutes in (await db.execute(text(
            "SELECT severity, min(resolve_minutes) FROM sla_policies WHERE tenant_id = CAST(:t AS uuid) GROUP BY severity"),
            {"t": t})).fetchall():
        policies[sev] = float(minutes) / 60.0

    breaches = {r[0]: int(r[1]) for r in (await db.execute(text(
        "SELECT assigned_to::text, count(*) FROM record_issues WHERE tenant_id = CAST(:t AS uuid) AND assigned_to IS NOT NULL "
        "AND sla_state = 'breached' AND due_at >= date_trunc('month', now()) AND due_at < date_trunc('month', now()) + interval '1 month' "
        "GROUP BY assigned_to"), {"t": t})).fetchall()}
    sla_met = {r[0]: round(100.0 * int(r[1]) / int(r[2]), 1) for r in (await db.execute(text(
        "SELECT assigned_to::text, count(*) FILTER (WHERE resolved_at <= due_at), count(*) FROM record_issues "
        "WHERE tenant_id = CAST(:t AS uuid) AND assigned_to IS NOT NULL AND resolved_at >= now() - interval '90 days' "
        "AND due_at IS NOT NULL GROUP BY assigned_to"), {"t": t})).fetchall()}
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
            "sla_met_pct": sla_met.get(uid),
        })
    people.sort(key=lambda x: (not x["is_me"], -x["open_work"], -x["approvals_waiting"], x["name"].lower(), x["id"]))
    return {"people": people}


# The next-step inbox: what waits for the caller, one list, each with its one action (GET /people/next).
# kind (in this order): task (an approval step they may decide), approve_batch (a draft fix batch of someone else, for
# one who may approve), sent_back (their batch sent back to them), load (a batch file they load into SAP and confirm),
# overdue (their open work past its due date), job_failed (a failed job, for Basis and admins).
_NEXT_ORDER = ("task", "approve_batch", "sent_back", "load", "overdue", "job_failed")


class NextItem(BaseModel):
    kind: str
    id: str
    title: str
    count: int = 1
    due_at: Optional[datetime] = None
    href: str


class NextOut(BaseModel):
    items: list[NextItem]


@router.get("/next", response_model=NextOut)
async def next_steps(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                     role: str = Depends(require_permission("view"))) -> NextOut:
    from api.routes.attention import _viewer_items
    from api.routes.workflows import list_tasks
    from api.services.handoff_notices import batch_link
    from api.services.workflow import link_of

    await _rls(db, tenant)
    t, me = str(tenant.id), current_user_id(request)
    items: list[dict] = []
    tasks = (await list_tasks(request, "mine", None, db, tenant, role)).items
    for k in tasks:
        items.append({"kind": "task", "id": k.id, "title": k.title or k.step_name, "due_at": k.due_at,
                      "href": link_of(k.object_kind, k.object_id)})
    in_flow = {k.object_id for k in tasks if k.object_kind == "fix_batch"}
    if me:
        may_approve = has_permission(role, "approve") or "approve" in await actions_for(role, tenant.id, db)
        rows = (await db.execute(text(
            "SELECT b.id::text AS id, b.name, b.status, b.filter ? 'returned' AS returned, "
            "b.created_by::text = :u AS mine, b.filter->>'loader_id' AS loader FROM remediation_batches b "
            "WHERE b.tenant_id = CAST(:t AS uuid) AND b.status IN ('draft', 'awaiting_load') "
            "AND EXISTS (SELECT 1 FROM remediation_items i WHERE i.batch_id = b.id) ORDER BY b.created_at"),
            {"t": t, "u": me})).mappings().all()
        for b in rows:
            kind = None
            if b["status"] == "draft" and b["mine"] and b["returned"]:
                kind = "sent_back"
            elif b["status"] == "draft" and not b["mine"] and may_approve and b["id"] not in in_flow:
                kind = "approve_batch"
            elif b["status"] == "awaiting_load" and (b["loader"] == me or (not b["loader"] and role == "sap_basis")):
                kind = "load"
            if kind:
                items.append({"kind": kind, "id": b["id"], "title": b["name"], "href": batch_link(b["id"])})
        pairs = await current_pairs(db, tenant.id)
        if pairs:
            p: dict = {"t": t, "u": me, "open": list(_OPEN)}
            n, due = (await db.execute(text(
                f"SELECT count(*), min(w.due_at) FROM work_records w WHERE w.tenant_id = CAST(:t AS uuid) "
                f"AND w.status = ANY(:open) AND w.assigned_to = CAST(:u AS uuid) AND w.due_at < now() "
                f"AND {pairs_clause('w', pairs, p, key='w')}"), p)).one()
            if n:
                items.append({"kind": "overdue", "id": me, "title": "", "count": int(n), "due_at": due,
                              "href": "/work?assigned=me&due=overdue"})
    if role in ("sap_basis", "admin", "platform_admin"):
        _, attn = await _viewer_items(request, db, tenant, role)
        for a in attn:
            if a["kind"] == "job_failed":
                items.append({"kind": "job_failed", "id": str(a.get("system_id") or a.get("id")),
                              "title": a.get("system_name") or "", "count": int(a.get("count") or 1),
                              "href": a.get("href") or "/run"})
    items.sort(key=lambda i: _NEXT_ORDER.index(i["kind"]))
    return NextOut(items=[NextItem(**i) for i in items])


@router.post("/{user_id}/remind", dependencies=[Depends(require_permission("assign"))])
async def remind(user_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                 tenant: Tenant = Depends(get_tenant)) -> dict:
    """Remind a person of their overdue work: one inbox notice (and email), at most once a day per person."""
    from api.services import handoff_notices

    await _rls(db, tenant)
    t, me, uid = str(tenant.id), current_user_id(request), str(user_id)
    if not (await db.execute(text("SELECT 1 FROM users WHERE id = CAST(:u AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                             {"u": uid, "t": t})).first():
        raise HTTPException(status_code=404, detail="No such person.")
    link = f"/work?assigned={uid}&due=overdue"
    mails = await db.run_sync(lambda s: handoff_notices.notify(
        s, t, [uid], type_="reminder", title="Your overdue work", key=f"remind:{uid}:{date.today().isoformat()}",
        body="Some of the work assigned to you is past its due date.", link=link, skip=[me]))
    await db.commit()
    handoff_notices.dispatch(mails)
    return {"user_id": uid, "status": "sent"}
