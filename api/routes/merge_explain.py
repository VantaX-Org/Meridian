"""Merge explainability, cluster graph, unmerge and steward pair decisions.

Endpoints (prefix /api/v1):
  GET    /master-records/{id}/explain          — survivorship per attribute + pair match explanations
  GET    /master-records/{id}/cluster-graph    — members, pair-score edges, weak transitive chains
  GET    /master-records/{id}/merge-events     — immutable merge history with before/after snapshots
  POST   /master-records/{id}/unmerge          — split records out; adds do_not_match pairs
  POST   /master-records/{id}/undo-last-merge  — reverse the latest merge into this record
  POST   /master-records/{id}/overrides        — steward override per attribute
  POST   /merge-events/{id}/revert             — re-merge what an unmerge / undo split out
  POST   /match-scores/{id}/decision           — steward accept / reject a pair (always / do_not_match)
  GET    /pair-constraints                     — do_not_match / always_match list
  DELETE /pair-constraints/{id}                — clear a pair constraint
  POST   /match-tuning/dry-run                 — clusters that would merge / split under new weights

A member id resolves to its cluster head. Nothing here talks to SAP.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import mdm_merge
from api.services.merge_explain import (
    AUTO_MERGE,
    REVIEW_FLOOR,
    cluster_graph,
    dry_run_tuning,
    pair_key,
    survive_cluster,
)
from api.services.rbac import current_user_id, require_permission

router = APIRouter(prefix="/api/v1", tags=["merge-explain"])


# ── Models ───────────────────────────────────────────────────────────────────


class PairExplanation(BaseModel):
    id: str
    a: str
    b: str
    total: float
    auto_action: str
    steward_decision: Optional[str] = None
    steward_reason: Optional[str] = None
    constraint: Optional[str] = None
    explanation: Optional[dict[str, Any]] = None
    field_scores: dict[str, Any] = {}


class ExplainResponse(BaseModel):
    golden_record_id: str
    key: str
    domain: str
    members: list[str]
    golden_fields: dict[str, Any]
    steward_overrides: dict[str, Any]
    survivorship: dict[str, Any]
    pairs: list[PairExplanation]
    thresholds: dict[str, float]


class GraphNode(BaseModel):
    key: str
    degree: int
    is_survivor: bool


class GraphEdge(BaseModel):
    id: Optional[str] = None
    source: str
    target: str
    total: Optional[float] = None
    linked: bool
    constraint: Optional[str] = None
    steward_decision: Optional[str] = None
    explanation: Optional[dict[str, Any]] = None


class WeakChain(BaseModel):
    a: str
    via: str
    b: str
    reason: str


class ClusterGraphResponse(BaseModel):
    golden_record_id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    weak_chains: list[WeakChain]
    auto_merge: float


class MergeEventOut(BaseModel):
    id: str
    event_type: str
    member_keys: list[str]
    actor: Optional[str] = None
    reason: Optional[str] = None
    before: Optional[dict[str, Any]] = None
    after: Optional[dict[str, Any]] = None
    reverses_event_id: Optional[str] = None
    reversed: bool
    created_at: str


class UnmergeBody(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=500)
    reason: str = Field(min_length=1, max_length=2000)


class ReasonBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=2000)


class OverridesBody(BaseModel):
    overrides: dict[str, Optional[str]] = Field(min_length=1)
    reason: Optional[str] = Field(default=None, max_length=2000)


class DecisionBody(BaseModel):
    decision: Literal["accept", "reject"]
    reason: str = Field(min_length=1, max_length=2000)


class PairConstraintOut(BaseModel):
    id: str
    domain: str
    key_lo: str
    key_hi: str
    kind: str
    reason: Optional[str] = None
    created_by: Optional[str] = None
    created_at: str


class DryRunBody(BaseModel):
    domain: str = Field(min_length=1)
    weights: dict[str, float] = {}
    auto_merge: float = Field(default=AUTO_MERGE, gt=0, le=1)
    review_floor: float = Field(default=REVIEW_FLOOR, ge=0, le=1)


class DryRunResponse(BaseModel):
    domain: str
    pairs: int
    pairs_newly_linked: int
    pairs_unlinked: int
    band_moves: dict[str, int]
    clusters_before: int
    clusters_after: int
    clusters_that_would_merge: int
    clusters_that_would_split: int
    applied: bool


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _rls(db: AsyncSession, tenant: Tenant) -> str:
    tid = str(tenant.id)
    await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
    return tid


async def _cluster(db: AsyncSession, tid: str, record_id: uuid.UUID) -> tuple[Any, list[Any]]:
    head = await mdm_merge.resolve_head(db, tid, str(record_id))
    if head is None:
        raise HTTPException(status_code=404, detail="Master record not found")
    return head, await mdm_merge._members(db, tid, head.id)


async def _constraints(db: AsyncSession, tid: str, domain: str, keys: list[str]) -> dict[tuple[str, str], str]:
    rows = await db.execute(text("""
        SELECT key_lo, key_hi, kind FROM mdm_pair_constraints
         WHERE tenant_id = :tid AND domain = :d AND key_lo = ANY(:k) AND key_hi = ANY(:k)
    """), {"tid": tid, "d": domain, "k": keys})
    return {(r[0], r[1]): r[2] for r in rows}


_LATEST_PAIRS = """
    SELECT DISTINCT ON (LEAST(candidate_a_key, candidate_b_key), GREATEST(candidate_a_key, candidate_b_key))
           id, candidate_a_key, candidate_b_key, total_score, auto_action, steward_decision, steward_reason,
           explanation, field_scores
      FROM match_scores
     WHERE tenant_id = :tid AND domain = :d {where}
     ORDER BY LEAST(candidate_a_key, candidate_b_key), GREATEST(candidate_a_key, candidate_b_key), created_at DESC
"""


async def _pairs(db: AsyncSession, tid: str, domain: str, keys: Optional[list[str]] = None,
                 limit: Optional[int] = None) -> list[dict]:
    where = "AND candidate_a_key = ANY(:k) AND candidate_b_key = ANY(:k)" if keys is not None else ""
    sql = _LATEST_PAIRS.format(where=where) + (f" LIMIT {int(limit)}" if limit else "")
    rows = await db.execute(text(sql), {"tid": tid, "d": domain, "k": keys or []})
    return [{"id": str(r[0]), "a": r[1], "b": r[2], "total": float(r[3]), "auto_action": r[4],
             "steward_decision": r[5], "steward_reason": r[6], "explanation": r[7], "field_scores": r[8] or {}}
            for r in rows]


def _not_found(res: Optional[dict], what: str) -> dict:
    if res is None:
        raise HTTPException(status_code=404, detail=f"{what} not found")
    return res


async def _mutate(db: AsyncSession, coro: Any) -> Any:
    try:
        res = await coro
    except (mdm_merge.MergeStateError, mdm_merge.PairConstraintError) as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    return res


# ── Read ─────────────────────────────────────────────────────────────────────


@router.get("/master-records/{record_id}/explain", response_model=ExplainResponse)
async def explain_record(record_id: uuid.UUID, _: str = Depends(require_permission("view")),
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> ExplainResponse:
    tid = await _rls(db, tenant)
    head, members = await _cluster(db, tid, record_id)
    keys = [head.sap_object_key, *(m.sap_object_key for m in members)]
    surv = (await db.execute(text("SELECT survivorship_explanation FROM master_records WHERE tenant_id = :tid "
                                  "AND id = :id"), {"tid": tid, "id": str(head.id)})).scalar()
    if surv is None:  # never merged: explain the record against itself
        surv = survive_cluster([{"key": head.sap_object_key, "fields": head.golden_fields or {}}],
                               overrides=head.steward_overrides or {})["explanation"]
    cons = await _constraints(db, tid, head.domain, keys)
    pairs = [PairExplanation(**p, constraint=cons.get(pair_key(p["a"], p["b"])))
             for p in await _pairs(db, tid, head.domain, keys)]
    return ExplainResponse(golden_record_id=str(head.id), key=head.sap_object_key, domain=head.domain,
                           members=keys[1:], golden_fields=head.golden_fields or {},
                           steward_overrides=head.steward_overrides or {}, survivorship=surv, pairs=pairs,
                           thresholds={"auto_merge": AUTO_MERGE, "review_floor": REVIEW_FLOOR})


@router.get("/master-records/{record_id}/cluster-graph", response_model=ClusterGraphResponse)
async def get_cluster_graph(record_id: uuid.UUID, _: str = Depends(require_permission("view")),
                            db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)) -> ClusterGraphResponse:
    tid = await _rls(db, tenant)
    head, members = await _cluster(db, tid, record_id)
    keys = [head.sap_object_key, *(m.sap_object_key for m in members)]
    g = cluster_graph(keys, await _pairs(db, tid, head.domain, keys),
                      await _constraints(db, tid, head.domain, keys), AUTO_MERGE)
    return ClusterGraphResponse(
        golden_record_id=str(head.id),
        nodes=[GraphNode(**n, is_survivor=n["key"] == head.sap_object_key) for n in g["nodes"]],
        edges=[GraphEdge(**e) for e in g["edges"]], weak_chains=[WeakChain(**w) for w in g["weak_chains"]],
        auto_merge=AUTO_MERGE)


@router.get("/master-records/{record_id}/merge-events", response_model=list[MergeEventOut])
async def list_merge_events(record_id: uuid.UUID, limit: int = Query(200, ge=1, le=1000),
                            _: str = Depends(require_permission("view")), db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)) -> list[MergeEventOut]:
    tid = await _rls(db, tenant)
    head, _m = await _cluster(db, tid, record_id)
    rows = await db.execute(text("""
        SELECT e.id, e.event_type, e.member_keys, e.actor, e.reason, e.before, e.after, e.reverses_event_id,
               EXISTS (SELECT 1 FROM mdm_merge_events r WHERE r.tenant_id = e.tenant_id
                        AND r.reverses_event_id = e.id) AS reversed, e.created_at
          FROM mdm_merge_events e
         WHERE e.tenant_id = :tid AND e.golden_record_id = :g
         ORDER BY e.created_at DESC LIMIT :n
    """), {"tid": tid, "g": str(head.id), "n": limit})
    return [MergeEventOut(id=str(r[0]), event_type=r[1], member_keys=list(r[2] or []),
                          actor=str(r[3]) if r[3] else None, reason=r[4], before=r[5], after=r[6],
                          reverses_event_id=str(r[7]) if r[7] else None, reversed=bool(r[8]),
                          created_at=r[9].isoformat()) for r in rows]


@router.get("/pair-constraints", response_model=list[PairConstraintOut])
async def list_pair_constraints(domain: Optional[str] = None,
                                kind: Optional[Literal["do_not_match", "always_match"]] = None,
                                key: Optional[str] = None, limit: int = Query(500, ge=1, le=5000),
                                _: str = Depends(require_permission("view")), db: AsyncSession = Depends(get_db),
                                tenant: Tenant = Depends(get_tenant)) -> list[PairConstraintOut]:
    tid = await _rls(db, tenant)
    rows = await db.execute(text("""
        SELECT id, domain, key_lo, key_hi, kind, reason, created_by, created_at FROM mdm_pair_constraints
         WHERE tenant_id = :tid AND (CAST(:d AS text) IS NULL OR domain = :d)
           AND (CAST(:kind AS text) IS NULL OR kind = :kind)
           AND (CAST(:key AS text) IS NULL OR key_lo = :key OR key_hi = :key)
         ORDER BY created_at DESC LIMIT :n
    """), {"tid": tid, "d": domain, "kind": kind, "key": key, "n": limit})
    return [PairConstraintOut(id=str(r[0]), domain=r[1], key_lo=r[2], key_hi=r[3], kind=r[4], reason=r[5],
                              created_by=str(r[6]) if r[6] else None, created_at=r[7].isoformat()) for r in rows]


@router.post("/match-tuning/dry-run", response_model=DryRunResponse)
async def match_tuning_dry_run(body: DryRunBody, _: str = Depends(require_permission("view")),
                               db: AsyncSession = Depends(get_db),
                               tenant: Tenant = Depends(get_tenant)) -> DryRunResponse:
    if body.review_floor >= body.auto_merge:
        raise HTTPException(status_code=422, detail="review_floor must be below auto_merge")
    tid = await _rls(db, tenant)
    # ponytail: newest 50k pairs per domain in memory; page by key range if a domain outgrows it.
    pairs = await _pairs(db, tid, body.domain, limit=50_000)
    cons = {(r[0], r[1]): r[2] for r in await db.execute(text(
        "SELECT key_lo, key_hi, kind FROM mdm_pair_constraints WHERE tenant_id = :tid AND domain = :d"),
        {"tid": tid, "d": body.domain})}
    res = dry_run_tuning(pairs, body.weights, auto_merge=body.auto_merge, review_floor=body.review_floor,
                         constraints=cons)
    return DryRunResponse(domain=body.domain, **res)


# ── Mutations ────────────────────────────────────────────────────────────────


@router.post("/master-records/{record_id}/unmerge")
async def unmerge_records(record_id: uuid.UUID, body: UnmergeBody, _: str = Depends(require_permission("approve")),
                          db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    tid = await _rls(db, tenant)
    return await _mutate(db, mdm_merge.unmerge(db, tid, str(record_id), body.keys, current_user_id(), body.reason))


@router.post("/master-records/{record_id}/undo-last-merge")
async def undo_last_merge(record_id: uuid.UUID, body: ReasonBody, _: str = Depends(require_permission("approve")),
                          db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    tid = await _rls(db, tenant)
    return await _mutate(db, mdm_merge.undo_last_merge(db, tid, str(record_id), current_user_id(), body.reason))


@router.post("/master-records/{record_id}/overrides")
async def set_overrides(record_id: uuid.UUID, body: OverridesBody, _: str = Depends(require_permission("approve")),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    tid = await _rls(db, tenant)
    return await _mutate(db, mdm_merge.set_overrides(db, tid, str(record_id), body.overrides, current_user_id(),
                                                     body.reason))


@router.post("/merge-events/{event_id}/revert")
async def revert_merge_event(event_id: uuid.UUID, body: ReasonBody, _: str = Depends(require_permission("approve")),
                             db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    tid = await _rls(db, tenant)
    return await _mutate(db, mdm_merge.revert_event(db, tid, str(event_id), current_user_id(), body.reason))


@router.post("/match-scores/{score_id}/decision")
async def pair_decision(score_id: uuid.UUID, body: DecisionBody, _: str = Depends(require_permission("approve")),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    tid = await _rls(db, tenant)
    res = await _mutate(db, mdm_merge.record_pair_decision(db, tid, str(score_id), body.decision, body.reason,
                                                           current_user_id()))
    return _not_found(res, "Match score")


@router.delete("/pair-constraints/{constraint_id}")
async def delete_pair_constraint(constraint_id: uuid.UUID, reason: Optional[str] = Query(None, max_length=2000),
                                 _: str = Depends(require_permission("approve")), db: AsyncSession = Depends(get_db),
                                 tenant: Tenant = Depends(get_tenant)) -> dict:
    tid = await _rls(db, tenant)
    res = await _mutate(db, mdm_merge.clear_constraint(db, tid, str(constraint_id), current_user_id(), reason))
    return _not_found(res, "Pair constraint")
