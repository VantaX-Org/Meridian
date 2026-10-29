"""Undo for work decisions.

POST /api/v1/actions/undo  {action_id}  put back what a decision changed (api/services/undo.py)

Every mutating decision route returns an ``action_id``: work decide (accept, edit, not an issue, accept risk,
assign, undo), a group's accept-all and set-value, a remediation batch's approve and send-back. The same user,
or an admin, may undo it within ten minutes (409 with a sentence after that, or when it was already undone).
The undo is written to audit_log.
"""
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import undo
from api.services.rbac import current_user_id, current_user_label, require_permission

router = APIRouter(prefix="/api/v1/actions", tags=["actions"])

ADMIN_ROLES = ("admin", "platform_admin")


class UndoBody(BaseModel):
    action_id: uuid.UUID


class UndoRestoredOut(BaseModel):
    issues: int                # record issues put back to their previous status, value and assignee
    items_restored: int        # fix-batch items put back as they were
    items_removed: int         # fix-batch items the decision had created
    batch: bool                # a batch's approval state was put back


class UndoOut(BaseModel):
    action_id: str
    kind: str                  # decide | accept_all | set_value | approve_batch | send_back_batch | reassign_batch
    undone_at: str
    restored: UndoRestoredOut


@router.post("/undo", response_model=UndoOut)
async def undo_action(
    body: UndoBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
):
    """Invert one decision. 404 for an id that is not this tenant's, 403 for another user (unless admin), 409 when it
    was already undone, is older than ten minutes, or the fix batch it went into has since been approved."""
    await _rls(db, tenant)
    row = await undo.load(db, tenant, body.action_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No such change to undo.")
    if row["user_id"] != undo.owner_key(request) and role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Only the person who made this change, or an admin, can undo it.")
    undo.check_window(row)
    done = await undo.apply_inverse(db, tenant, request, row)
    undone_at = undo.now()
    # the actor is NULL when the id is not a users row (auth off, a service key): audit_log.actor_user_id is a foreign key
    await db.execute(text(
        "INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path, "
        "status_code, before_json, after_json) "
        "VALUES (CAST(:t AS uuid), (SELECT id FROM users WHERE id = CAST(:u AS uuid) AND tenant_id = CAST(:t AS uuid)), "
        ":e, 'undo', 'undo_action', :ei, :m, :p, 200, CAST(:b AS jsonb), CAST(:af AS jsonb))"),
        {"t": str(tenant.id), "u": current_user_id(request), "e": current_user_label(), "ei": row["id"],
         "m": request.method, "p": request.url.path,
         "b": json.dumps({"kind": row["kind"], "payload": row["payload"], "made_by": row["user_id"],
                          "made_at": row["created_at"].isoformat()}, default=str),
         "af": json.dumps({"undone_at": undone_at.isoformat(), "restored": done})})
    await db.commit()
    undo.after_commit(tenant)
    return {"action_id": row["id"], "kind": row["kind"], "undone_at": undone_at.isoformat(), "restored": done}
