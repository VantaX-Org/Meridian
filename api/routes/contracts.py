"""Data contracts, NLP query, and lineage API routes."""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rate_limiter import rate_limit

router = APIRouter(prefix="/api/v1", tags=["contracts"])

# NLP queries hit the LLM for every call — cap at 60/tenant/minute so an
# experimenting analyst can't accidentally burn through cloud credits
# in the time it takes to step away from their laptop.
_nlp_rate_limit = rate_limit("nlp_query", limit=60, window_s=60)


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
    status: Optional[str] = None


class NlpQueryBody(BaseModel):
    question: str


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


@router.post("/contracts", status_code=201)
async def create_contract(
    body: CreateContractBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    new_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO contracts (id, tenant_id, name, description, producer, consumer,
                schema_contract, quality_contract, freshness_contract, volume_contract,
                status, created_at)
            VALUES (:id, :tid, :name, :desc, :producer, :consumer,
                CAST(:schema_c AS jsonb), CAST(:quality_c AS jsonb),
                CAST(:freshness_c AS jsonb), CAST(:volume_c AS jsonb),
                'draft', now())
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
        },
    )
    await db.commit()
    return {"id": new_id, "status": "draft"}


# ── 3. PUT /api/v1/contracts/{id} — update draft contract ────────────────────


@router.put("/contracts/{contract_id}")
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


@router.put("/contracts/{contract_id}/activate")
async def activate_contract(
    contract_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)
    tid = str(tenant.id)

    check = await db.execute(
        text("SELECT status FROM contracts WHERE id = :cid AND tenant_id = :tid"),
        {"cid": contract_id, "tid": tid},
    )
    row = check.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Contract not found")
    if row[0] != "pending_approval":
        raise HTTPException(
            status_code=400,
            detail=f"Contract must be in pending_approval status to activate (current: {row[0]})",
        )

    await db.execute(
        text("""
            UPDATE contracts SET status = 'active', activated_at = now()
            WHERE id = :cid AND tenant_id = :tid
        """),
        {"cid": contract_id, "tid": tid},
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


# ── 6. POST /api/v1/nlp/query — NLP natural language query ──────────────────


@router.post("/nlp/query", dependencies=[Depends(_nlp_rate_limit)])
async def nlp_query(
    body: NlpQueryBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    # Extract user role from request state (set by LicenceMiddleware)
    # Falls back to 'viewer' if not present — the safest default
    user_role = getattr(request.state, 'user_role', 'viewer')

    from api.services.nlp_service import process_query

    result = await process_query(
        question=body.question,
        tenant_context={"tenant_id": tenant.id},
        db=db,
        user_role=user_role,
    )
    return result


# ── 7. GET /api/v1/lineage/{object_type}/{record_key} — data lineage ────────


@router.get("/lineage/{object_type}/{record_key}")
async def get_lineage_graph(
    object_type: str,
    record_key: str,
    depth: int = Query(2, ge=1, le=4),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    from api.services.lineage_service import get_lineage

    result = await get_lineage(
        object_type=object_type,
        record_key=record_key,
        tenant_id=str(tenant.id),
        db=db,
        depth=depth,
    )
    return result


# ── Contract compliance check (call after analysis run completes) ────────────


async def check_contract_compliance(
    tenant_id: str,
    version_id: str,
    dqs_summary: dict,
    db: AsyncSession,
) -> list[dict]:
    """Check all active contracts against actual DQS scores.

    Called after every analysis run completes. Inserts compliance history rows
    and creates exceptions for violations.

    Args:
        tenant_id: The tenant UUID string.
        version_id: The analysis version UUID string.
        dqs_summary: Dict of {module: {dimension_scores: {...}, ...}}.
        db: Active async session with RLS already set.

    Returns:
        List of violation dicts (empty if all contracts are compliant).
    """
    # Fetch all active contracts for this tenant
    result = await db.execute(
        text("SELECT * FROM contracts WHERE tenant_id = :tid AND status = 'active'"),
        {"tid": tenant_id},
    )
    contracts = [_row_to_dict(r) for r in result.fetchall()]

    violations_created = []

    for contract in contracts:
        quality_contract = contract.get("quality_contract") or {}
        if not quality_contract:
            continue

        # Compute average actual scores across all modules in this run
        dimensions = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"]
        actuals: dict[str, float | None] = {}
        module_count = 0

        for module_name, module_data in dqs_summary.items():
            dim_scores = module_data.get("dimension_scores", {})
            if dim_scores:
                module_count += 1
                for dim in dimensions:
                    score = dim_scores.get(dim)
                    if score is not None:
                        actuals[dim] = actuals.get(dim, 0) + float(score)

        # Average across modules
        if module_count > 0:
            for dim in dimensions:
                if dim in actuals:
                    actuals[dim] = round(actuals[dim] / module_count, 2)

        # Check compliance
        violations = []
        overall_compliant = True
        for dim in dimensions:
            threshold = quality_contract.get(dim)
            actual = actuals.get(dim)
            if threshold is not None and actual is not None:
                if actual < float(threshold):
                    overall_compliant = False
                    violations.append({
                        "dimension": dim,
                        "threshold": float(threshold),
                        "actual": actual,
                        "gap": round(float(threshold) - actual, 2),
                    })

        # Insert compliance history
        await db.execute(
            text("""
                INSERT INTO contract_compliance_history
                    (id, tenant_id, contract_id, version_id,
                     completeness_actual, accuracy_actual, consistency_actual,
                     timeliness_actual, uniqueness_actual, validity_actual,
                     overall_compliant, violations, recorded_at)
                VALUES (gen_random_uuid(), :tid, :cid, :vid,
                        :comp, :acc, :cons, :time, :uniq, :val,
                        :compliant, CAST(:violations AS jsonb), now())
            """),
            {
                "tid": tenant_id,
                "cid": str(contract["id"]),
                "vid": version_id,
                "comp": actuals.get("completeness"),
                "acc": actuals.get("accuracy"),
                "cons": actuals.get("consistency"),
                "time": actuals.get("timeliness"),
                "uniq": actuals.get("uniqueness"),
                "val": actuals.get("validity"),
                "compliant": overall_compliant,
                "violations": json.dumps(violations) if violations else None,
            },
        )

        # Create exception for violations
        if violations:
            violation_desc = "; ".join(
                f"{v['dimension']}: {v['actual']}% < {v['threshold']}% (gap: {v['gap']}%)"
                for v in violations
            )
            await db.execute(
                text("""
                    INSERT INTO exceptions
                        (id, tenant_id, type, category, severity, status, title,
                         description, source_reference, escalation_tier,
                         sla_deadline, created_at)
                    VALUES (gen_random_uuid(), :tid, 'contract_violation', 'data_quality',
                            'high', 'open', :title, :desc, :ref, 1,
                            now() + interval '24 hours', now())
                """),
                {
                    "tid": tenant_id,
                    "title": f"Contract violation: {contract['name']}",
                    "desc": f"Contract '{contract['name']}' has SLA violations: {violation_desc}",
                    "ref": str(contract["id"]),
                },
            )
            violations_created.append({
                "contract_id": str(contract["id"]),
                "contract_name": contract["name"],
                "violations": violations,
            })

    # ── Golden record schema_contract validation ────────────────────────────
    for contract in contracts:
        schema = contract.get('schema_contract')
        if not schema:
            continue

        contract_id = str(contract['id'])
        golden_records = await db.execute(text("""
            SELECT id, sap_object_key, golden_fields
            FROM master_records
            WHERE tenant_id = :tid
              AND status = 'golden'
            LIMIT 200
        """), {'tid': tenant_id})

        for gr in golden_records.fetchall():
            fields = gr[2] or {}
            if isinstance(fields, str):
                fields = json.loads(fields)
            gr_violations = []
            for field_name, rules in schema.items():
                if not isinstance(rules, dict):
                    continue
                value = fields.get(field_name)
                if rules.get('mandatory') and not value:
                    gr_violations.append({
                        'field': field_name,
                        'reason': 'mandatory field missing in golden record',
                    })
                if value and rules.get('allowed_values'):
                    if value not in rules['allowed_values']:
                        gr_violations.append({
                            'field': field_name,
                            'reason': f'value not in allowed_values: {value}',
                        })

            if gr_violations:
                await db.execute(text("""
                    INSERT INTO contract_compliance_history
                      (id, tenant_id, contract_id, overall_compliant, violations, recorded_at)
                    VALUES
                      (gen_random_uuid(), :tid, :cid, false, CAST(:v AS jsonb), now())
                """), {
                    'tid': tenant_id,
                    'cid': contract_id,
                    'v':   json.dumps({
                        'type':             'golden_record_field',
                        'object_key':        gr[1],
                        'field_violations':  gr_violations,
                    }),
                })

    await db.commit()
    return violations_created
