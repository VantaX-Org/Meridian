"""Lineage API -- SAP field -> object -> config -> step -> process -> feature -> KPI.

Read-only. The graph itself is static (curated model + derived edges); per-version
numbers come from findings / finding_records of the caller's tenant only.
"""

import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.deps import Tenant, get_db, get_tenant
from api.services import lineage as svc
from api.routes.glossary import owner_rows
from api.services.tenant_seed import raw_rules
from checks.frames import _graph, tables_of
from checks.runner import rule_columns, target_columns

router = APIRouter(prefix="/api/v1/lineage", tags=["lineage"])
logger = logging.getLogger("meridian.lineage")

MAX_BLAST_KEYS = 200_000


class _Open(BaseModel):
    model_config = ConfigDict(extra="allow")


class NodeRef(BaseModel):
    id: str
    label: str


class LineageNode(_Open):
    id: str
    type: str
    label: str
    depth: int


class LineageEdge(_Open):
    source: str
    target: str
    rel: str
    origin: str


class ModelSummary(BaseModel):
    model_version: int
    node_counts: dict[str, int]
    edge_count: int
    kpis: list[NodeRef]
    processes: list[NodeRef]
    features: list[NodeRef]
    warnings: list[str]


class LineageResponse(BaseModel):
    start: str
    model_version: int
    nodes: list[LineageNode]
    edges: list[LineageEdge]
    paths_to_kpis: list[list[str]]


class ImpactRow(BaseModel):
    id: str
    type: str
    label: str
    findings: int
    check_ids: list[str]
    records_affected: int
    max_records: int
    worst_severity: str | None
    worst_impact: str | None
    min_hops: int
    cost_at_risk: float | None = None


class ImpactResponse(BaseModel):
    version_id: str
    model_version: int
    cost_available: bool
    kpis: list[ImpactRow]
    processes: list[ImpactRow]
    features: list[ImpactRow]
    unmapped_checks: list[str]


class BlastTarget(BaseModel):
    table: str
    label: str
    step: str | None
    status: Literal["ok", "not_joinable", "not_extracted"]
    source_version_id: str | None = None
    same_version: bool | None = None
    rows: int = 0
    documents: int = 0
    objects_touched: int = 0
    joined_on: list[str] = []


class BlastResponse(BaseModel):
    version_id: str
    check_id: str
    grain: str | None
    object: str | None
    failing_records: int
    keys_truncated: bool
    targets: list[BlastTarget]
    steps_touched: list[str]
    processes_touched: list[str]


class GuardCheck(_Open):
    check_id: str


class GuardField(BaseModel):
    field: str
    checks: list[GuardCheck]


class GuardStep(BaseModel):
    id: str
    label: str
    l2: str | None
    tcode: str | None
    fields: list[GuardField]
    guard_count: int
    min_pass_rate: float | None
    unguarded_fields: list[str]


class GuardsResponse(BaseModel):
    node: str
    model_version: int
    version_id: str | None
    steps: list[GuardStep]
    coverage_gaps: list[str]


async def _tenant(db: AsyncSession, tenant: Tenant) -> str:
    tid = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = '{tid}'"))
    return tid


def _uuid(v: str) -> str:
    try:
        return str(uuid.UUID(v))
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid id")


def _node(g: svc.Graph, ref: str) -> str:
    try:
        return svc.resolve_node(g, ref)
    except KeyError:
        raise HTTPException(status_code=404, detail="node not in lineage model")


@router.get("/model", response_model=ModelSummary)
async def get_model() -> dict:
    return svc.model_summary(svc.graph())


@router.get("/graph", response_model=LineageResponse)
async def get_lineage(
    node: str = Query(..., description="field:T.F, T.F, check id, table, kpi:x ... or finding:<uuid>"),
    direction: Literal["up", "down", "both"] = "both",
    depth: int = Query(6, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    g = svc.graph()
    if node.startswith("finding:"):
        tid = await _tenant(db, tenant)
        row = (await db.execute(
            text("SELECT check_id FROM findings WHERE id = :id AND tenant_id = :tid"),
            {"id": _uuid(node.split(":", 1)[1]), "tid": tid},
        )).first()
        if not row:
            raise HTTPException(status_code=404, detail="finding not found")
        node = f"check:{row[0]}"
    return svc.lineage(g, _node(g, node), direction, depth)


async def _has_cost_column(db: AsyncSession) -> bool:
    return (await db.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'findings' AND column_name = 'cost_at_risk'"))).first() is not None


@router.get("/impact/{version_id}", response_model=ImpactResponse)
async def get_impact(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    vid, tid = _uuid(version_id), await _tenant(db, tenant)
    cost = await _has_cost_column(db)
    rows = (await db.execute(
        text("SELECT check_id, severity, affected_count"
             + (", cost_at_risk" if cost else "")
             + " FROM findings WHERE version_id = :vid AND tenant_id = :tid AND affected_count > 0"),
        {"vid": vid, "tid": tid},
    )).mappings().all()
    out = svc.rollup(svc.graph(), [dict(r) for r in rows])
    return {"version_id": vid, "cost_available": cost, **out}


@router.get("/blast-radius/{version_id}/{check_id}", response_model=BlastResponse)
async def get_blast_radius(
    version_id: str,
    check_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    """Transactional documents and processes touched by the failing records of one check."""
    vid, tid = _uuid(version_id), await _tenant(db, tenant)
    g = svc.graph()
    recs = (await db.execute(
        text("SELECT grain, record_key FROM finding_records "
             "WHERE tenant_id = :tid AND version_id = :vid AND check_id = :cid LIMIT :lim"),
        {"tid": tid, "vid": vid, "cid": check_id, "lim": MAX_BLAST_KEYS + 1},
    )).all()
    truncated = len(recs) > MAX_BLAST_KEYS
    recs = recs[:MAX_BLAST_KEYS]
    grain = next((r[0] for r in recs if r[0]), None)
    obj = g.table_object.get((grain or "").upper())
    keys = [k for k in (svc.parse_record_key(r[1]) for r in recs) if k]
    base = {"version_id": vid, "check_id": check_id, "grain": grain, "object": obj,
            "failing_records": len(recs), "keys_truncated": truncated}
    specs = g.blast.get(obj or "", [])
    if not keys or not specs:
        return {**base, "targets": [], "steps_touched": [], "processes_touched": []}

    # This version's bundle first, then the tenant's newest other bundles: transactional
    # tables are often extracted under a different module run than the master data.
    vers = (await db.execute(
        text("SELECT id::text, metadata->>'dataset_path' FROM analysis_versions "
             "WHERE tenant_id = :tid AND metadata->>'dataset_path' LIKE '%/' "
             "ORDER BY (id = :vid) DESC, run_at DESC LIMIT 50"),
        {"tid": tid, "vid": vid},
    )).all()
    ids, paths = [v[0] for v in vers], [v[1] for v in vers]

    def _run() -> list[dict]:
        out = []
        key_fields = set(keys[0])
        for spec in specs:
            row = {"table": spec["table"], "label": spec["label"], "step": spec.get("step")}
            join = svc.blast_columns(spec, key_fields)
            if not join:
                out.append({**row, "status": "not_joinable"})
                continue
            spec2 = {**spec, "join": join}
            hit = svc.read_bundle_table(paths, spec["table"], svc.blast_needed_columns(spec2))
            if hit is None:
                out.append({**row, "status": "not_extracted"})
                continue
            i, df = hit
            out.append({**row, "status": "ok", "source_version_id": ids[i], "same_version": ids[i] == vid,
                        **svc.count_blast(keys, df, spec2)})
        return out

    targets = await run_in_threadpool(_run)
    steps = sorted({f"step:{t['step']}" for t in targets if t.get("documents") and t.get("step")})
    procs: set[str] = set()
    for s in steps:
        if s in g.nodes:
            hops, _, _ = svc.traverse(g, s, "down", 2)
            procs |= {n for n in hops if g.nodes[n]["type"] == "process"}
    return {**base, "targets": targets, "steps_touched": steps, "processes_touched": sorted(procs)}


@router.get("/guards", response_model=GuardsResponse)
async def get_guards(
    node: str = Query(..., description="kpi:x, feature:x, process:x or step:x"),
    version_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    """Rules guarding a KPI / step with their pass rates; steps with no rule are coverage gaps."""
    g = svc.graph()
    ref = _node(g, node)
    if g.nodes[ref]["type"] not in ("kpi", "feature", "process", "step"):
        raise HTTPException(status_code=422, detail="guards apply to kpi, feature, process or step nodes")
    tid = await _tenant(db, tenant)
    vid = _uuid(version_id) if version_id else None
    sql = ("SELECT DISTINCT ON (check_id) check_id, pass_rate, affected_count, severity "
           "FROM findings WHERE tenant_id = :tid"
           + (" AND version_id = :vid" if vid else "")
           + " ORDER BY check_id, created_at DESC")
    rows = (await db.execute(text(sql), {"tid": tid, **({"vid": vid} if vid else {})})).all()
    results = {r[0]: {"pass_rate": float(r[1]) if r[1] is not None else None,
                      "affected_count": r[2], "severity": r[3]} for r in rows}
    return {**svc.guards(g, ref, results), "version_id": vid}


@router.get("/rule/{check_id}")
async def get_rule_lineage(
    check_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    """What a shipped rule reads (fields, lookup targets, tables, joins.yaml edges between
    them), its glossary terms and the owners of the rule and of its object."""
    hit = next(((m, r) for _, _, m, r in raw_rules() if r["id"] == check_id), None)
    if hit is None:
        raise HTTPException(status_code=404, detail="rule not found")
    module, rule = hit
    fields, targets = rule_columns(rule), target_columns(rule)
    tables = tables_of(fields + targets)
    joins = [{"parent": e.parent, "child": e.child, "on": [list(p) for p in e.on], "cardinality": e.cardinality}
             for e in _graph()[0] if e.parent in tables and e.child in tables]
    tid = await _tenant(db, tenant)
    terms = (await db.execute(text("""
        SELECT gt.id::text AS id, gt.business_name, gt.sap_table, gt.sap_field
          FROM glossary_term_rules gtr JOIN glossary_terms gt ON gt.id = gtr.term_id
         WHERE gtr.tenant_id = :tid AND gtr.rule_id = :cid
         ORDER BY gt.business_name"""), {"tid": tid, "cid": check_id})).mappings().all()
    owners = await owner_rows(db, tid, "(d.kind = 'rule' AND d.ref = :cid) OR (d.kind = 'object' AND d.ref = :module)",
                              {"cid": check_id, "module": module})
    return {"check_id": check_id, "module": module, "fields": fields, "targets": targets, "tables": tables,
            "joins": joins, "glossary_terms": [dict(t) for t in terms], "owners": owners}
