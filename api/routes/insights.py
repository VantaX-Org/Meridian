"""GET endpoints backing the /insights/* pages (spec 8). All computation is
deterministic — no LLM calls anywhere in this module."""
import asyncio
import uuid
from types import SimpleNamespace
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.config_impact import get_config_impact
from api.routes.merge_explain import AUTO_MERGE, REVIEW_FLOOR, build_cluster_graph
from api.routes.record_issues import _rls
from api.services.insights_impact import value_at_risk
from api.services.insights_owners import OWNER_ISSUE_SQL, build_owner_card, load_owner_aggregates
from api.services.insights_readiness import build_readiness_grid
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/insights", tags=["insights"])


@router.get("/readiness", dependencies=[Depends(require_permission("view"))])
async def get_readiness(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)
    thresholds = (await db.execute(
        text("SELECT alert_thresholds FROM tenants WHERE id = :t"),
        {"t": str(tenant.id)},
    )).scalar() or {}
    waves = thresholds.get("readiness_waves") or {}
    dqs_threshold = thresholds.get("readiness_dqs_threshold", 70)
    if not waves:
        raise HTTPException(409, "No readiness_waves configured — set them under Settings > Alert Thresholds")

    # module_results: migration_runs.gap_summary, JSONB keyed by module (ModuleResult-shaped,
    # see workers/tasks/run_migration.py's _finish()). Explicit version_id picks the run whose
    # source_version_id matches it; otherwise take this tenant's latest analysed run.
    run_row = (await db.execute(
        text("""
            SELECT gap_summary, source_version_id FROM migration_runs
            WHERE tenant_id = :t AND status = 'analysed'
              AND (CAST(:vid AS uuid) IS NULL OR source_version_id = :vid)
            ORDER BY completed_at DESC LIMIT 1
        """),
        {"t": str(tenant.id), "vid": str(version_id) if version_id else None},
    )).fetchone()
    gap_summary = (run_row[0] if run_row else {}) or {}
    resolved_version_id = run_row[1] if run_row else version_id
    module_results = {
        module: SimpleNamespace(verdict=data.get("verdict"), blocked_records=data.get("blocked_records", 0))
        for module, data in gap_summary.items()
    }

    # dqs_by_module: analysis_versions.dqs_summary, JSONB keyed by module, scoped to the same
    # resolved_version_id so both lookups agree on "which run" (same pattern as
    # api/routes/system_objects.py's system_versions/trends handlers).
    dqs_summary = {}
    if resolved_version_id:
        dqs_row = (await db.execute(
            text("SELECT dqs_summary FROM analysis_versions WHERE id = :vid AND tenant_id = :t"),
            {"vid": str(resolved_version_id), "t": str(tenant.id)},
        )).fetchone()
        dqs_summary = (dqs_row[0] if dqs_row else {}) or {}
    dqs_by_module = {m: (d or {}).get("composite_score") for m, d in dqs_summary.items()}

    cells = build_readiness_grid(module_results, dqs_by_module, waves, dqs_threshold)
    return {
        "version_id": str(resolved_version_id) if resolved_version_id else None,
        "threshold": dqs_threshold,
        "cells": [c.__dict__ for c in cells],
    }


@router.get("/impact", dependencies=[Depends(require_permission("view"))])
async def get_impact(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)

    # No explicit version — use this tenant's most recent analysis version that
    # actually has config_impact_results rows (same "latest" idea as readiness).
    if version_id is None:
        resolved = (await db.execute(
            text("""
                SELECT av.id FROM analysis_versions av
                WHERE av.tenant_id = :t AND EXISTS (
                    SELECT 1 FROM config_impact_results cir
                    WHERE cir.version_id = av.id AND cir.tenant_id = :t
                )
                ORDER BY av.run_at DESC LIMIT 1
            """),
            {"t": str(tenant.id)},
        )).scalar()
        if resolved is None:
            return {"version_id": None, "rows": []}
        version_id = resolved

    # features_value: tenant's own CostModel.features (api/routes/settings.py), ZAR per
    # blocked record. No numeric default exists in db/seeds/config_impact_rules.yaml, so a
    # feature the tenant hasn't priced is skipped rather than guessing a cost (deviation
    # from the brief's Step 3 "seeded default" — that field does not exist in the YAML).
    cost_model = (await db.execute(
        text("SELECT cost_model FROM tenants WHERE id = :t"),
        {"t": str(tenant.id)},
    )).scalar() or {}
    features_value = cost_model.get("features") or {}

    # Reuse the real config-impact handler instead of re-querying config_impact_results —
    # it is a plain async function, not special FastAPI-only wrapping, so it's callable directly.
    impact = await get_config_impact(str(version_id), db, tenant)

    rows = []
    for r in impact["results"]:
        v = features_value.get(r["feature"])
        if v is None:
            continue
        rows.append({
            "feature": r["feature"],
            "status": r["status"],
            "record_count": r["total_affected_records"],
            "value_per_record": v,
            "value_at_risk": value_at_risk(r["total_affected_records"], v),
            "causing_rules": r["blocking_findings"],
        })
    return {"version_id": str(version_id), "rows": rows}


@router.get("/owners", dependencies=[Depends(require_permission("view"))])
async def get_owners(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    result = await db.execute(text(OWNER_ISSUE_SQL), {"tid": str(tenant.id)})
    issue_rows = [dict(r._mapping) for r in result.fetchall()]
    aggregates = load_owner_aggregates(issue_rows)

    rows = []
    for owner, agg in aggregates.items():
        card = build_owner_card(owner, agg["score"], agg["delta"], agg["open_by_severity"],
                                 agg["fixed_since_baseline"], agg["oldest_item_age_days"])
        last_sent = (await db.execute(
            text("SELECT MAX(created_at) FROM notifications WHERE tenant_id = :t AND user_id = :u AND type = 'digest'"),
            {"t": str(tenant.id), "u": agg["user_id"]},
        )).scalar()
        rows.append({**card.__dict__, "schedule": "weekly", "last_sent": last_sent.isoformat() if last_sent else None})
    return {"owners": rows}


@router.get("/duplicates/{object}/{record_id}", dependencies=[Depends(require_permission("view"))])
async def get_duplicate_cluster(
    object: str, record_id: uuid.UUID,
    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
):
    """Reuses merge_explain.py's existing cluster_graph builder verbatim, reshaped
    to the nodes/edges/thresholds graph-widget contract for the duplicates page."""
    await _rls(db, tenant)
    head, g = await build_cluster_graph(db, str(tenant.id), record_id)
    # ponytail: node size = 1 for every object. A real BOM-usage count (material_360's
    # bom_usage over STPO/MAST) needs a version_id and dataset_path this route doesn't
    # have, so it's left as a known gap rather than invented here.
    nodes = [{"id": n["key"], "size": 1, "label": n["key"]} for n in g["nodes"]]
    edges = [{"source": e["source"], "target": e["target"], "label": f"{e['total']:.2f}" if e["total"] is not None else ""}
              for e in g["edges"]]
    return {"nodes": nodes, "edges": edges, "thresholds": {"auto_merge": AUTO_MERGE, "review_floor": REVIEW_FLOOR}}


class MergeProposalPair(BaseModel):
    match_score_id: uuid.UUID
    priority: int = 3
    due_at: Optional[str] = None


class MergeProposalsBody(BaseModel):
    pairs: list[MergeProposalPair]


@router.post("/duplicates/merge-proposals", dependencies=[Depends(require_permission("approve"))])
async def create_merge_proposals(
    body: MergeProposalsBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Queues steward review for picked match_scores pairs, same shape as the
    automated populate_stewardship_queue.py._populate_merge_decisions() insert
    (sla_hours=48 — confirmed from that job, not the brief's draft 72)."""
    await _rls(db, tenant)
    created = []
    for pair in body.pairs:
        row = (await db.execute(
            text("SELECT domain FROM match_scores WHERE id = :id AND tenant_id = :t"),
            {"id": str(pair.match_score_id), "t": str(tenant.id)},
        )).fetchone()
        if not row:
            raise HTTPException(404, f"match_scores {pair.match_score_id} not found")
        new_id = uuid.uuid4()
        await db.execute(text("""
            INSERT INTO stewardship_queue
              (id, tenant_id, item_type, source_id, domain, priority, due_at, status, sla_hours)
            VALUES (:id, :t, 'merge_decision', :source_id, :domain, :priority, :due_at, 'open', :sla_hours)
        """), {
            "id": str(new_id), "t": str(tenant.id), "source_id": str(pair.match_score_id),
            "domain": row[0], "priority": pair.priority, "due_at": pair.due_at,
            "sla_hours": 48,
        })
        created.append(str(new_id))
    await db.commit()
    return {"created": created}


def _gather_exec_sync(tenant_id: str, tenant_name: str, version_id: str) -> Optional[dict]:
    from api.services.pdf_reports import executive_context, gather_executive_data
    from workers.db import get_sync_engine, tenant_session

    with tenant_session(get_sync_engine(), tenant_id) as s:
        d = gather_executive_data(s, tenant_id, version_id)
        if not d:
            return None
        return executive_context(d["report_json"], d["supplementary"], d["version"], d["findings"],
                                  tenant_name=tenant_name, system=d["system"])


@router.get("/exec", dependencies=[Depends(require_permission("view"))])
async def get_exec(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Same report_json/supplementary data as the executive PDF (api/routes/reports.py's
    executive_report_pdf) — reuses gather_executive_data/executive_context rather than
    inventing a parallel readiness/waterfall/owner JSON shape that doesn't exist in the
    backend (deviation from the brief, same reasoning as Task 14's PDF wiring)."""
    await _rls(db, tenant)
    if version_id is None:
        version_id = (await db.execute(
            text("SELECT id FROM analysis_versions WHERE tenant_id = :t ORDER BY run_at DESC LIMIT 1"),
            {"t": str(tenant.id)},
        )).scalar()
        if version_id is None:
            raise HTTPException(404, "No analysis run found")
    ctx = await asyncio.to_thread(_gather_exec_sync, str(tenant.id), tenant.name, str(version_id))
    if ctx is None:
        raise HTTPException(404, "Run not found.")
    return ctx
