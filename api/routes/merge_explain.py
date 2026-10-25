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
    dry_run: bool = False


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


Band = Literal["auto_merge", "review", "low"]


class PairListItem(BaseModel):
    id: str
    domain: str
    a: str
    b: str
    total: float
    band: Band
    auto_action: str
    steward_decision: Optional[str] = None
    constraint: Optional[str] = None
    explanation: Optional[dict[str, Any]] = None
    field_scores: dict[str, Any] = {}
    a_record_id: Optional[str] = None
    b_record_id: Optional[str] = None
    same_cluster: bool = False


class PairListResponse(BaseModel):
    pairs: list[PairListItem]
    total: int
    bands: dict[str, int]
    thresholds: dict[str, float]


class PairSide(BaseModel):
    key: str
    record_id: Optional[str] = None
    confidence: Optional[float] = None
    fields: dict[str, Any] = {}


class PairDetail(PairListItem):
    record_a: PairSide
    record_b: PairSide
    default_survivor: str


class PairMergeBody(BaseModel):
    survivor: Optional[str] = Field(default=None, max_length=200)
    overrides: dict[str, Optional[str]] = {}
    reason: Optional[str] = Field(default=None, max_length=2000)
    dry_run: bool = False


class PairMergeResponse(BaseModel):
    match_score_id: str
    survivor_key: str
    merged_key: str
    golden_record_id: str
    golden_fields: dict[str, Any]
    survivorship: dict[str, Any]
    filled_fields: list[str]
    event_id: Optional[str] = None
    dry_run: bool


class BulkMergeBody(BaseModel):
    domain: Optional[str] = None
    min_score: float = Field(ge=0.5, le=1)
    reason: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=200, ge=1, le=500)


class BulkMergeResponse(BaseModel):
    considered: int
    merged: int
    already_together: int
    blocked: int
    missing_record: int


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


async def build_cluster_graph(db: AsyncSession, tid: str, record_id: uuid.UUID) -> tuple[Any, dict]:
    """Shared by this module's own /cluster-graph route and insights.py's
    /duplicates/{object}/{record_id} route — raises 404 via _cluster() when the
    record doesn't resolve for this tenant."""
    head, members = await _cluster(db, tid, record_id)
    keys = [head.sap_object_key, *(m.sap_object_key for m in members)]
    g = cluster_graph(keys, await _pairs(db, tid, head.domain, keys),
                      await _constraints(db, tid, head.domain, keys), AUTO_MERGE)
    return head, g


@router.get("/master-records/{record_id}/cluster-graph", response_model=ClusterGraphResponse)
async def get_cluster_graph(record_id: uuid.UUID, _: str = Depends(require_permission("view")),
                            db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)) -> ClusterGraphResponse:
    tid = await _rls(db, tenant)
    head, g = await build_cluster_graph(db, tid, record_id)
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
    coro = mdm_merge.unmerge(db, tid, str(record_id), body.keys, current_user_id(), body.reason)
    if body.dry_run:  # preview: run the real unmerge, report what it would leave, keep nothing
        try:
            res = await coro
        except (mdm_merge.MergeStateError, mdm_merge.PairConstraintError) as e:
            raise HTTPException(status_code=409, detail=str(e))
        finally:
            await db.rollback()
        return {**res, "event_id": None, "dry_run": True}
    return await _mutate(db, coro)


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


# ── Match review queue ───────────────────────────────────────────────────────

# One row per scored pair (match_scores is unique per pair), with its band, any steward constraint and whether
# both keys already sit in one golden record. Constraint keys are matched in both orders: key_lo/key_hi come
# from Python ordering, which can differ from the database collation's LEAST/GREATEST.
_REVIEW_PAIRS = """
    WITH p AS (
      SELECT ms.id, ms.domain, ms.candidate_a_key AS a, ms.candidate_b_key AS b, ms.total_score AS total,
             ms.auto_action, ms.steward_decision, ms.explanation, ms.field_scores,
             (SELECT pc.kind FROM mdm_pair_constraints pc
               WHERE pc.tenant_id = ms.tenant_id AND pc.domain = ms.domain
                 AND ((pc.key_lo = ms.candidate_a_key AND pc.key_hi = ms.candidate_b_key)
                   OR (pc.key_lo = ms.candidate_b_key AND pc.key_hi = ms.candidate_a_key)) LIMIT 1) AS pc_kind,
             ma.id AS a_id, mb.id AS b_id,
             COALESCE(COALESCE(ma.merged_into, ma.id) = COALESCE(mb.merged_into, mb.id), false) AS same_cluster,
             CASE WHEN ms.total_score >= :am THEN 'auto_merge' WHEN ms.total_score >= :rf THEN 'review'
                  ELSE 'low' END AS band
        FROM match_scores ms
        LEFT JOIN master_records ma ON ma.tenant_id = ms.tenant_id AND ma.domain = ms.domain
                                   AND ma.sap_object_key = ms.candidate_a_key
        LEFT JOIN master_records mb ON mb.tenant_id = ms.tenant_id AND mb.domain = ms.domain
                                   AND mb.sap_object_key = ms.candidate_b_key
       WHERE ms.tenant_id = :tid AND (CAST(:d AS text) IS NULL OR ms.domain = :d) {where}
    )
    SELECT * FROM p
     WHERE (:inc OR (steward_decision IS NULL AND pc_kind IS NULL AND NOT same_cluster))
       AND (CAST(:lo AS float) IS NULL OR total >= :lo) AND (CAST(:hi AS float) IS NULL OR total <= :hi)
"""


def _pair_item(r: Any) -> dict:
    return {"id": str(r.id), "domain": r.domain, "a": r.a, "b": r.b, "total": float(r.total), "band": r.band,
            "auto_action": r.auto_action, "steward_decision": r.steward_decision, "constraint": r.pc_kind,
            "explanation": r.explanation, "field_scores": r.field_scores or {},
            "a_record_id": str(r.a_id) if r.a_id else None, "b_record_id": str(r.b_id) if r.b_id else None,
            "same_cluster": bool(r.same_cluster)}


def _review_params(tid: str, domain: Optional[str], lo: Optional[float], hi: Optional[float], all_: bool) -> dict:
    return {"tid": tid, "d": domain, "lo": lo, "hi": hi, "inc": all_, "am": AUTO_MERGE, "rf": REVIEW_FLOOR}


@router.get("/match-scores", response_model=PairListResponse)
async def list_match_pairs(domain: Optional[str] = None, band: Optional[Band] = None,
                           min_score: Optional[float] = Query(None, ge=0, le=1),
                           max_score: Optional[float] = Query(None, ge=0, le=1),
                           include_decided: bool = False,
                           record: Optional[str] = Query(None, min_length=1, max_length=2000,
                                                         description="Only the pairs that hold this record key"),
                           limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                           _: str = Depends(require_permission("view")), db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant)) -> PairListResponse:
    """Pairs waiting on a steward: no verdict, no constraint, not already in one golden record.

    ``bands`` counts every band under the same filters, so the page can offer "uncertain only" with its size.
    ``record`` keeps one record's pairs: either side's SAP key (master_records.sap_object_key) is the record
    key, whole or as the bare value of its first part (MATNR=1 -> 1).
    """
    from api.routes.work import _key_candidates

    tid = await _rls(db, tenant)
    params = _review_params(tid, domain, min_score, max_score, include_decided)
    where = ""
    if record:
        where = "AND (ms.candidate_a_key = ANY(:keys) OR ms.candidate_b_key = ANY(:keys))"
        params["keys"] = _key_candidates(record)
    base = _REVIEW_PAIRS.format(where=where)
    counts = {r[0]: int(r[1]) for r in await db.execute(text(f"SELECT band, COUNT(*) FROM ({base}) q GROUP BY band"),
                                                        params)}
    banded = f"SELECT * FROM ({base}) q WHERE (CAST(:band AS text) IS NULL OR band = :band)"
    total = sum(counts.values()) if band is None else counts.get(band, 0)
    rows = await db.execute(text(f"{banded} ORDER BY total DESC, id LIMIT :n OFFSET :off"),
                            {**params, "band": band, "n": limit, "off": offset})
    return PairListResponse(pairs=[PairListItem(**_pair_item(r)) for r in rows], total=total,
                            bands={b: counts.get(b, 0) for b in ("auto_merge", "review", "low")},
                            thresholds={"auto_merge": AUTO_MERGE, "review_floor": REVIEW_FLOOR})


async def _pair_row(db: AsyncSession, tid: str, score_id: uuid.UUID) -> Any:
    row = (await db.execute(text(_REVIEW_PAIRS.format(where="AND ms.id = :sid")),
                            {**_review_params(tid, None, None, None, True), "sid": str(score_id)})).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Match score not found")
    return row


async def _side(db: AsyncSession, tid: str, domain: str, key: str) -> dict:
    r = (await db.execute(text("SELECT id, overall_confidence, COALESCE(own_fields, golden_fields) FROM master_records "
                               "WHERE tenant_id = :tid AND domain = :d AND sap_object_key = :k"),
                          {"tid": tid, "d": domain, "k": key})).first()
    if r is None:
        return {"key": key}
    return {"key": key, "record_id": str(r[0]), "confidence": float(r[1] or 0), "fields": r[2] or {}}


def _default_survivor(a: dict, b: dict) -> str:
    """The higher-confidence record survives (the steward merge rule); A on a tie."""
    return b["key"] if (b.get("confidence") or 0) > (a.get("confidence") or 0) else a["key"]


@router.get("/match-scores/{score_id}", response_model=PairDetail)
async def get_match_pair(score_id: uuid.UUID, _: str = Depends(require_permission("view")),
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> PairDetail:
    tid = await _rls(db, tenant)
    row = await _pair_row(db, tid, score_id)
    a, b = await _side(db, tid, row.domain, row.a), await _side(db, tid, row.domain, row.b)
    return PairDetail(**_pair_item(row), record_a=PairSide(**a), record_b=PairSide(**b),
                      default_survivor=_default_survivor(a, b))


async def _merge_pair(db: AsyncSession, tid: str, row: Any, survivor: Optional[str], overrides: dict,
                      reason: Optional[str]) -> Optional[dict]:
    if survivor is None:
        survivor = _default_survivor(await _side(db, tid, row.domain, row.a), await _side(db, tid, row.domain, row.b))
    if survivor not in (row.a, row.b):
        raise HTTPException(status_code=422, detail="survivor must be one of the pair's two keys")
    merged = row.b if survivor == row.a else row.a
    res = await mdm_merge.merge_master_records(db, tid, row.domain, survivor, merged, current_user_id(),
                                               overrides or None, reason=reason)
    if res is None:
        return None
    surv = (await db.execute(text("SELECT survivorship_explanation FROM master_records WHERE tenant_id = :tid "
                                  "AND id = :id"), {"tid": tid, "id": res["survivor_id"]})).scalar()
    return {"survivor_key": survivor, "merged_key": merged, "golden_record_id": res["survivor_id"],
            "golden_fields": res["golden_fields"], "survivorship": surv or {}, "filled_fields": res["filled_fields"],
            "event_id": res["event_id"]}


async def _accept(db: AsyncSession, tid: str, score_id: str, reason: Optional[str]) -> None:
    await mdm_merge.record_pair_decision(db, tid, score_id, "accept", reason, current_user_id())
    await db.execute(text("UPDATE match_scores SET auto_action = 'merged' WHERE tenant_id = :tid AND id = :id"),
                     {"tid": tid, "id": score_id})


@router.post("/match-scores/{score_id}/merge", response_model=PairMergeResponse)
async def merge_match_pair(score_id: uuid.UUID, body: PairMergeBody,
                           _: str = Depends(require_permission("approve")), db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant)) -> PairMergeResponse:
    """Merge one pair into one golden record. Each entry in ``overrides`` is a field the steward picked a value
    for; it is stored as a steward override. ``dry_run`` runs the real merge and rolls it back, so the preview
    is exactly what a commit would store."""
    if not body.dry_run and not (body.reason or "").strip():
        raise HTTPException(status_code=422, detail="reason is required to merge")
    tid = await _rls(db, tenant)
    row = await _pair_row(db, tid, score_id)
    try:
        res = await _merge_pair(db, tid, row, body.survivor, body.overrides, body.reason)
        if res is None:
            raise HTTPException(status_code=409, detail="These records are already in one golden record, "
                                                        "or one of them has no golden record yet")
        if body.dry_run:
            await db.rollback()
            return PairMergeResponse(match_score_id=str(row.id), **{**res, "event_id": None}, dry_run=True)
        await _accept(db, tid, str(row.id), body.reason)
    except mdm_merge.PairConstraintError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e))
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()
    return PairMergeResponse(match_score_id=str(row.id), **res, dry_run=False)


@router.post("/match-scores/bulk-merge", response_model=BulkMergeResponse)
async def bulk_merge_pairs(body: BulkMergeBody, _: str = Depends(require_permission("approve")),
                           db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> BulkMergeResponse:
    """Merge every undecided pair scoring at or above ``min_score`` (highest first), each in its own savepoint:
    a pair blocked by a do-not-match constraint is skipped, the rest still merge."""
    tid = await _rls(db, tenant)
    rows = list(await db.execute(text(f"{_REVIEW_PAIRS.format(where='')} ORDER BY total DESC, id LIMIT :n"),
                                 {**_review_params(tid, body.domain, body.min_score, None, False), "n": body.limit}))
    out = {"considered": len(rows), "merged": 0, "already_together": 0, "blocked": 0, "missing_record": 0}
    for row in rows:
        if row.a_id is None or row.b_id is None:
            out["missing_record"] += 1
            continue
        try:
            async with db.begin_nested():
                res = await _merge_pair(db, tid, row, None, {}, body.reason)
                await _accept(db, tid, str(row.id), body.reason)
        except mdm_merge.PairConstraintError:
            out["blocked"] += 1
            continue
        out["merged" if res else "already_together"] += 1
    await db.commit()
    return BulkMergeResponse(**out)
