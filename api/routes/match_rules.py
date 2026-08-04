"""Match rules CRUD and simulation endpoints.

GET /match-rules — list rules by domain
POST /match-rules — create rule
PUT /match-rules/{id} — update rule
DELETE /match-rules/{id} — delete rule
POST /match-rules/simulate — dry-run match engine against last sync batch
"""

import asyncio
import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["match-rules"])

VALID_MATCH_TYPES = {"exact", "fuzzy", "phonetic", "numeric_range", "semantic"}


# ── Request/Response models ──────────────────────────────────────────────────


class MatchRuleCreate(BaseModel):
    domain: str
    field: str
    match_type: str
    weight: int = 50
    threshold: float = 0.8
    active: bool = True

    @field_validator("match_type")
    @classmethod
    def validate_match_type(cls, v: str) -> str:
        if v not in VALID_MATCH_TYPES:
            raise ValueError(f"match_type must be one of {VALID_MATCH_TYPES}")
        return v

    @field_validator("weight")
    @classmethod
    def validate_weight(cls, v: int) -> int:
        if not 0 <= v <= 100:
            raise ValueError("weight must be 0-100")
        return v

    @field_validator("threshold")
    @classmethod
    def validate_threshold(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("threshold must be 0.0-1.0")
        return v


class MatchRuleUpdate(BaseModel):
    domain: Optional[str] = None
    field: Optional[str] = None
    match_type: Optional[str] = None
    weight: Optional[int] = None
    threshold: Optional[float] = None
    active: Optional[bool] = None

    @field_validator("match_type")
    @classmethod
    def validate_match_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_MATCH_TYPES:
            raise ValueError(f"match_type must be one of {VALID_MATCH_TYPES}")
        return v

    @field_validator("weight")
    @classmethod
    def validate_weight(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not 0 <= v <= 100:
            raise ValueError("weight must be 0-100")
        return v

    @field_validator("threshold")
    @classmethod
    def validate_threshold(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not 0.0 <= v <= 1.0:
            raise ValueError("threshold must be 0.0-1.0")
        return v


class MatchRuleOut(BaseModel):
    id: str
    tenant_id: str
    domain: str
    field: str
    match_type: str
    weight: int
    threshold: float
    active: bool


class MatchRulesListResponse(BaseModel):
    rules: list[MatchRuleOut]
    total: int


class SimulateBody(BaseModel):
    domain: str


class SimulateResponse(BaseModel):
    total_pairs: int
    auto_merge_count: int
    auto_dismiss_count: int
    queue_count: int


# ── GET /match-rules ─────────────────────────────────────────────────────────


@router.get("/match-rules", response_model=MatchRulesListResponse)
async def list_match_rules(
    domain: Optional[str] = None,
    active: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_rules")),
):
    """List match rules for the tenant, optionally filtered by domain and active status."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    query = (
        "SELECT id, tenant_id, domain, field, match_type, weight, threshold, active "
        "FROM match_rules WHERE tenant_id = :tid"
    )
    params: dict = {"tid": str(tenant.id)}

    if domain:
        query += " AND domain = :domain"
        params["domain"] = domain
    if active is not None:
        query += " AND active = :active"
        params["active"] = active

    query += " ORDER BY domain, weight DESC"

    result = await db.execute(text(query), params)
    rows = result.fetchall()

    rules = [
        MatchRuleOut(
            id=str(r[0]), tenant_id=str(r[1]), domain=r[2], field=r[3],
            match_type=r[4], weight=r[5], threshold=r[6], active=r[7],
        )
        for r in rows
    ]

    return MatchRulesListResponse(rules=rules, total=len(rules))


# ── POST /match-rules ────────────────────────────────────────────────────────


@router.post("/match-rules", response_model=MatchRuleOut, status_code=201)
async def create_match_rule(
    body: MatchRuleCreate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_rules")),
):
    """Create a new match rule."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    rule_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO match_rules (id, tenant_id, domain, field, match_type, weight, threshold, active) "
            "VALUES (:id, :tid, :domain, :field, :match_type, :weight, :threshold, :active)"
        ),
        {
            "id": rule_id,
            "tid": str(tenant.id),
            "domain": body.domain,
            "field": body.field,
            "match_type": body.match_type,
            "weight": body.weight,
            "threshold": body.threshold,
            "active": body.active,
        },
    )
    await db.commit()

    return MatchRuleOut(
        id=rule_id, tenant_id=str(tenant.id), domain=body.domain, field=body.field,
        match_type=body.match_type, weight=body.weight, threshold=body.threshold,
        active=body.active,
    )


# ── PUT /match-rules/{id} ───────────────────────────────────────────────────


@router.put("/match-rules/{rule_id}", response_model=MatchRuleOut)
async def update_match_rule(
    rule_id: str,
    body: MatchRuleUpdate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_rules")),
):
    """Update an existing match rule."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    # Verify rule exists
    result = await db.execute(
        text("SELECT id FROM match_rules WHERE id = :id AND tenant_id = :tid"),
        {"id": rule_id, "tid": str(tenant.id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Match rule not found")

    # Explicit whitelist: body field name → SQL column name
    _ALLOWED_MATCH_RULE_FIELDS: dict[str, str] = {
        "domain": "domain",
        "field": "field",
        "match_type": "match_type",
        "weight": "weight",
        "threshold": "threshold",
        "active": "active",
    }

    updates = []
    params: dict = {"id": rule_id, "tid": str(tenant.id)}
    for body_field, col_name in _ALLOWED_MATCH_RULE_FIELDS.items():
        value = getattr(body, body_field, None)
        if value is not None:
            updates.append(f"{col_name} = :{body_field}")
            params[body_field] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    await db.execute(
        text(f"UPDATE match_rules SET {', '.join(updates)} WHERE id = :id AND tenant_id = :tid"),
        params,
    )
    await db.commit()

    # Fetch updated row
    result = await db.execute(
        text(
            "SELECT id, tenant_id, domain, field, match_type, weight, threshold, active "
            "FROM match_rules WHERE id = :id"
        ),
        {"id": rule_id},
    )
    r = result.fetchone()
    return MatchRuleOut(
        id=str(r[0]), tenant_id=str(r[1]), domain=r[2], field=r[3],
        match_type=r[4], weight=r[5], threshold=r[6], active=r[7],
    )


# ── DELETE /match-rules/{id} ─────────────────────────────────────────────────


@router.delete("/match-rules/{rule_id}")
async def delete_match_rule(
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_rules")),
):
    """Delete a match rule."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    result = await db.execute(
        text("DELETE FROM match_rules WHERE id = :id AND tenant_id = :tid RETURNING id"),
        {"id": rule_id, "tid": str(tenant.id)},
    )

    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Match rule not found")

    await db.commit()
    return {"deleted": True}


# ── POST /match-rules/simulate ───────────────────────────────────────────────


@router.post("/match-rules/simulate", response_model=SimulateResponse)
async def simulate_match_rules(
    body: SimulateBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_rules")),
):
    """Dry-run the match engine against recent dedup candidates.

    Returns projected auto-merge/dismiss/queue split without writing to DB.
    """
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    # Load recent dedup candidates for this domain (limit 100)
    candidates = await db.execute(
        text(
            "SELECT record_key_a, record_key_b, match_fields "
            "FROM dedup_candidates "
            "WHERE tenant_id = :tid AND object_type = :domain "
            "AND status = 'pending' "
            "ORDER BY created_at DESC LIMIT 100"
        ),
        {"tid": str(tenant.id), "domain": body.domain},
    )
    rows = candidates.fetchall()

    if not rows:
        return SimulateResponse(
            total_pairs=0, auto_merge_count=0,
            auto_dismiss_count=0, queue_count=0,
        )

    # Run match engine in dry_run mode using a sync session
    import os
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session as SyncSession
    from api.services.match_engine import score_candidate_pair

    def _simulate_sync() -> tuple[int, int, int]:
        """Scores up to 100 candidate pairs synchronously — any field with
        match_type "semantic" can call the LLM (bounded by safe_invoke's own
        timeout, but still a blocking call). Runs on a worker thread via
        asyncio.to_thread; this handler is `async def`, so calling this
        directly would block FastAPI's entire event loop for the whole
        loop's duration — every request, not just this one. Owns its own
        engine end-to-end and disposes it here rather than leaking one per
        request (create_engine was previously never disposed)."""
        sync_url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
        sync_url = sync_url.replace("postgresql+asyncpg://", "postgresql://")
        sync_engine = create_engine(sync_url)

        _auto_merge = 0
        _auto_dismiss = 0
        _queue = 0
        try:
            with SyncSession(sync_engine) as sync_session:
                for key_a, key_b, match_fields in rows:
                    candidate_a = match_fields.get("a", {}) if isinstance(match_fields, dict) else {}
                    candidate_b = match_fields.get("b", {}) if isinstance(match_fields, dict) else {}

                    result = score_candidate_pair(
                        tenant_id=str(tenant.id),
                        domain=body.domain,
                        candidate_a=candidate_a,
                        candidate_b=candidate_b,
                        candidate_a_key=key_a,
                        candidate_b_key=key_b,
                        session=sync_session,
                        dry_run=True,
                    )

                    action = result["auto_action"]
                    if action == "merged":
                        _auto_merge += 1
                    elif action == "dismissed":
                        _auto_dismiss += 1
                    else:
                        _queue += 1
        finally:
            sync_engine.dispose()
        return _auto_merge, _auto_dismiss, _queue

    auto_merge, auto_dismiss, queue = await asyncio.to_thread(_simulate_sync)

    return SimulateResponse(
        total_pairs=len(rows),
        auto_merge_count=auto_merge,
        auto_dismiss_count=auto_dismiss,
        queue_count=queue,
    )
