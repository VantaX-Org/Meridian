"""Learned house rules (checks/house_rules.py): review queue. The miner is the maker;
a person with ``approve`` is the checker. Approval writes an active rule_versions row
under a new append-only LR- id, run from the next analysis (checks/lifecycle.authored_rules)."""
from __future__ import annotations

import json
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _row, _rls
from api.services.rbac import current_user_label, require_permission
from checks import lifecycle

router = APIRouter(prefix="/api/v1", tags=["learned-rules"])
MINER = "house-rule-miner"


class Approve(BaseModel):
    severity: Literal["critical", "high", "medium", "low"] = "medium"
    note: Optional[str] = Field(None, max_length=2000)


class Reject(BaseModel):
    note: Optional[str] = Field(None, max_length=2000)


class Mine(BaseModel):
    version_id: uuid.UUID


def next_rule_id(s: Session, tenant_id: str) -> str:
    """Next LR- id for the tenant. Serialised by an advisory lock; ids are never reused —
    they are taken as max + 1 over every id ever handed out, shipped or proposed."""
    s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"{tenant_id}:learned-rule-id"})
    n = s.execute(text("""
        SELECT COALESCE(max(substring(rule_id FROM 4)::int), 0) FROM (
            SELECT rule_id FROM rule_versions WHERE rule_id ~ '^LR-[0-9]{6}$'
            UNION ALL SELECT rule_id FROM learned_rule_proposals WHERE rule_id ~ '^LR-[0-9]{6}$') ids
    """)).scalar()
    return f"LR-{int(n) + 1:06d}"


def _pending_proposal(s: Session, pid: str) -> tuple:
    """(module, body) of a pending proposal, locked for the rest of the transaction."""
    p = s.execute(text("SELECT module, body, status FROM learned_rule_proposals WHERE id = :id FOR UPDATE"),
                 {"id": pid}).one_or_none()
    if p is None or p.status != "pending":
        raise LookupError("not pending")
    return p.module, p.body


def approve_sync(s: Session, tenant_id: str, pid: str, severity: str, note: Optional[str], me: str) -> dict:
    """Approve a proposal: insert its body as an active v1 rule under a fresh LR- id, and mark
    the proposal decided. Raises LookupError if the proposal is missing or already decided.

    Tenant RLS is set by the caller (via ``_rls``) before this runs inside ``db.run_sync`` —
    ``SET ... = :t`` cannot be parametrised over asyncpg's server-side binding, so it must not
    be issued here. See ``_rls`` in api/routes/record_issues.py.
    """
    module, proposal_body = _pending_proposal(s, pid)
    rid = next_rule_id(s, tenant_id)
    body = {**proposal_body, "module": module, "severity": severity}
    if err := lifecycle.validate_body(rid, body):
        raise ValueError(err)
    s.execute(text("""
        INSERT INTO rule_versions (tenant_id, rule_id, version, body, state, note, created_by, approved_by, approved_at)
        VALUES (:t, :r, 1, CAST(:b AS jsonb), 'active', :n, :maker, :me, now())
    """), {"t": tenant_id, "r": rid, "b": json.dumps(body), "n": note or f"Learned from data (proposal {pid})",
           "maker": MINER, "me": me})
    s.execute(text("UPDATE learned_rule_proposals SET status = 'approved', rule_id = :r, decided_by = :me, "
                   "decided_at = now(), updated_at = now() WHERE id = :id"), {"r": rid, "me": me, "id": pid})
    return {"id": pid, "status": "approved", "rule_id": rid}


def reject_sync(s: Session, tenant_id: str, pid: str, note: Optional[str], me: str) -> str:
    """Reject a pending proposal. Raises LookupError if missing or already decided.

    Tenant RLS is set by the caller (via ``_rls``) before this runs inside ``db.run_sync``.
    """
    _pending_proposal(s, pid)
    s.execute(text("UPDATE learned_rule_proposals SET status = 'rejected', decided_by = :me, decided_at = now(), "
                   "updated_at = now() WHERE id = :id"), {"me": me, "id": pid})
    return "rejected"


@router.get("/learned-rules", dependencies=[Depends(require_permission("view"))])
async def list_learned(status: Literal["pending", "approved", "rejected"] = Query("pending"),
                       module: Optional[str] = None, kind: Optional[str] = None,
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    rows = (await db.execute(text("""
        SELECT id, version_id, module, kind, table_name, determinant, field, body, confidence, support_rows,
               violations, sample_keys, status, rule_id, decided_by, decided_at, updated_at
          FROM learned_rule_proposals
         WHERE status = :s AND (CAST(:m AS text) IS NULL OR module = :m) AND (CAST(:k AS text) IS NULL OR kind = :k)
         ORDER BY support_rows DESC, confidence DESC, field LIMIT 1000
    """), {"s": status, "m": module, "k": kind})).fetchall()
    return {"items": [_row(r) for r in rows]}


@router.post("/learned-rules/mine", status_code=202, dependencies=[Depends(require_permission("manage_rules"))])
async def mine(body: Mine, tenant: Tenant = Depends(get_tenant)) -> dict:
    from workers.tasks.mining.orchestrator import run_mining_for_version
    run_mining_for_version.delay(str(tenant.id), str(body.version_id), include=["house_rules"])
    return {"queued": True}


@router.post("/learned-rules/{pid}/approve", dependencies=[Depends(require_permission("approve"))])
async def approve(pid: uuid.UUID, body: Approve, db: AsyncSession = Depends(get_db),
                  tenant: Tenant = Depends(get_tenant)) -> dict:
    me = current_user_label()
    await _rls(db, tenant)
    try:
        out = await db.run_sync(lambda s: approve_sync(s, str(tenant.id), str(pid), body.severity, body.note, me))
    except LookupError:
        raise HTTPException(status_code=409, detail="This proposal was already decided or does not exist.")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    await db.commit()
    return out


@router.post("/learned-rules/{pid}/reject", dependencies=[Depends(require_permission("manage_rules"))])
async def reject(pid: uuid.UUID, body: Reject, db: AsyncSession = Depends(get_db),
                 tenant: Tenant = Depends(get_tenant)) -> dict:
    me = current_user_label()
    await _rls(db, tenant)
    try:
        status = await db.run_sync(lambda s: reject_sync(s, str(tenant.id), str(pid), body.note, me))
    except LookupError:
        raise HTTPException(status_code=409, detail="This proposal was already decided or does not exist.")
    await db.commit()
    return {"id": str(pid), "status": status}
