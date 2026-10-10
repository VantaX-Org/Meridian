"""Data contracts API routes."""

import json
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api.services.rbac import current_user_id, require_permission
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

router = APIRouter(prefix="/api/v1", tags=["contracts"])


# ── Pydantic models ──────────────────────────────────────────────────────────


class CreateContractBody(BaseModel):
    name: str
    description: Optional[str] = None
    producer: str
    consumer: str
    schema_contract: Optional[dict] = None
    quality_contract: Optional[dict] = None
    freshness_contract: Optional[dict] = None
    volume_contract: Optional[dict] = None


class UpdateContractBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    producer: Optional[str] = None
    consumer: Optional[str] = None
    schema_contract: Optional[dict] = None
    quality_contract: Optional[dict] = None
    freshness_contract: Optional[dict] = None
    volume_contract: Optional[dict] = None
    # activation only through PUT /contracts/{id}/activate (`approve`, not the author)
    status: Optional[Literal["draft", "pending_approval"]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


# ── 1. GET /api/v1/contracts — list all contracts with latest compliance ─────


@router.get("/contracts")
async def list_contracts(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)
    tid = str(tenant.id)

    conditions = ["c.tenant_id = :tid"]
    params: dict = {"tid": tid}

    if status:
        conditions.append("c.status = :status")
        params["status"] = status

    where = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT c.*,
                   h.overall_compliant AS latest_compliant,
                   h.recorded_at AS last_checked
            FROM contracts c
            LEFT JOIN LATERAL (
                SELECT overall_compliant, recorded_at
                FROM contract_compliance_history
                WHERE contract_id = c.id AND tenant_id = c.tenant_id
                ORDER BY recorded_at DESC
                LIMIT 1
            ) h ON true
            WHERE {where}
            ORDER BY c.created_at DESC
        """),
        params,
    )
    contracts = [_row_to_dict(r) for r in result.fetchall()]
    return {"contracts": contracts, "total": len(contracts)}


# ── 2. POST /api/v1/contracts — create draft contract ────────────────────────


@router.post("/contracts", status_code=201, dependencies=[Depends(require_permission("manage_rules"))])
async def create_contract(
    body: CreateContractBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    new_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO contracts (id, tenant_id, name, description, producer, consumer,
                schema_contract, quality_contract, freshness_contract, volume_contract,
                status, created_by, created_at)
            VALUES (:id, :tid, :name, :desc, :producer, :consumer,
                CAST(:schema_c AS jsonb), CAST(:quality_c AS jsonb),
                CAST(:freshness_c AS jsonb), CAST(:volume_c AS jsonb),
                'draft', CAST(:uid AS uuid), now())
        """),
        {
            "id": new_id,
            "tid": str(tenant.id),
            "name": body.name,
            "desc": body.description,
            "producer": body.producer,
            "consumer": body.consumer,
            "schema_c": json.dumps(body.schema_contract) if body.schema_contract else None,
            "quality_c": json.dumps(body.quality_contract) if body.quality_contract else None,
            "freshness_c": json.dumps(body.freshness_contract) if body.freshness_contract else None,
            "volume_c": json.dumps(body.volume_contract) if body.volume_contract else None,
            "uid": current_user_id(request),
        },
    )
    await db.commit()
    return {"id": new_id, "status": "draft"}


# ── 3. PUT /api/v1/contracts/{id} — update draft contract ────────────────────


@router.put("/contracts/{contract_id}", dependencies=[Depends(require_permission("manage_rules"))])
async def update_contract(
    contract_id: str,
    body: UpdateContractBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)
    tid = str(tenant.id)

    # Verify contract exists and is draft
    check = await db.execute(
        text("SELECT status FROM contracts WHERE id = :cid AND tenant_id = :tid"),
        {"cid": contract_id, "tid": tid},
    )
    row = check.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Contract not found")
    if row[0] not in ("draft", "pending_approval"):
        raise HTTPException(status_code=400, detail="Only draft or pending_approval contracts can be updated")

    updates = []
    params: dict = {"cid": contract_id, "tid": tid}

    for field in ["name", "description", "producer", "consumer", "status"]:
        val = getattr(body, field, None)
        if val is not None:
            updates.append(f"{field} = :{field}")
            params[field] = val

    for json_field in ["schema_contract", "quality_contract", "freshness_contract", "volume_contract"]:
        val = getattr(body, json_field, None)
        if val is not None:
            updates.append(f"{json_field} = CAST(:{json_field} AS jsonb)")
            params[json_field] = json.dumps(val)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(updates)
    result = await db.execute(
        text(f"UPDATE contracts SET {set_clause} WHERE id = :cid AND tenant_id = :tid RETURNING id"),
        params,
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Contract not found")

    await db.commit()

    # Return updated contract
    updated = await db.execute(
        text("SELECT * FROM contracts WHERE id = :cid AND tenant_id = :tid"),
        {"cid": contract_id, "tid": tid},
    )
    return _row_to_dict(updated.fetchone())


# ── 4. PUT /api/v1/contracts/{id}/activate — activate contract ───────────────


@router.put("/contracts/{contract_id}/activate", dependencies=[Depends(require_permission("approve"))])
async def activate_contract(
    contract_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)
    tid = str(tenant.id)

    check = await db.execute(
        text("SELECT status, created_by FROM contracts WHERE id = :cid AND tenant_id = :tid"),
        {"cid": contract_id, "tid": tid},
    )
    row = check.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Contract not found")
    uid = current_user_id(request)
    if row[1] is not None and uid is not None and str(row[1]) == uid:
        raise HTTPException(status_code=403, detail="Four-eyes: the contract author cannot activate it.")
    if row[0] != "pending_approval":
        raise HTTPException(
            status_code=400,
            detail=f"Contract must be in pending_approval status to activate (current: {row[0]})",
        )

    await db.execute(
        text("""
            UPDATE contracts SET status = 'active', activated_at = now(), approved_by = CAST(:uid AS uuid)
            WHERE id = :cid AND tenant_id = :tid
        """),
        {"cid": contract_id, "tid": tid, "uid": uid},
    )
    await db.commit()

    return {"id": contract_id, "status": "active"}


# ── 5. GET /api/v1/contracts/{id}/compliance — compliance history ────────────


@router.get("/contracts/{contract_id}/compliance")
async def get_contract_compliance(
    contract_id: str,
    days: int = Query(90, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)
    tid = str(tenant.id)

    # Verify contract exists
    check = await db.execute(
        text("SELECT id FROM contracts WHERE id = :cid AND tenant_id = :tid"),
        {"cid": contract_id, "tid": tid},
    )
    if not check.fetchone():
        raise HTTPException(status_code=404, detail="Contract not found")

    result = await db.execute(
        text("""
            SELECT * FROM contract_compliance_history
            WHERE contract_id = :cid AND tenant_id = :tid
                AND recorded_at > now() - make_interval(days => :days)
            ORDER BY recorded_at DESC
        """),
        {"cid": contract_id, "tid": tid, "days": days},
    )
    history = [_row_to_dict(r) for r in result.fetchall()]
    return {"contract_id": contract_id, "compliance_history": history}
