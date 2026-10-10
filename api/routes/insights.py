"""GET endpoints backing the /insights/* pages (spec 8). All computation is
deterministic — no LLM calls anywhere in this module."""
import uuid
from datetime import datetime
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
from api.services.insights_owners import OWNER_ISSUE_SQL, baseline_cutoff, build_owner_card, load_owner_aggregates
from api.services.insights_readiness import build_wave_cells
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
    dqs_threshold = thresholds.get("readiness_dqs_threshold", 70)
    waves = (await db.execute(text(
        "SELECT id, name, modules, min_readiness, min_dqs FROM migration_waves "
        "WHERE tenant_id = :t ORDER BY target_date NULLS LAST, name"), {"t": str(tenant.id)})).fetchall()

    # A wave reads its own latest analysed run; a wave without one falls back to the tenant's
    # latest analysed run (optionally pinned by version_id), so grids built from settings still show.
    run_sql = """
        SELECT gap_summary, source_version_id FROM migration_runs
        WHERE tenant_id = :t AND status = 'analysed'
          AND (CAST(:wid AS uuid) IS NULL OR wave_id = CAST(:wid AS uuid))
          AND (CAST(:vid AS uuid) IS NULL OR source_version_id = CAST(:vid AS uuid))
        ORDER BY completed_at DESC LIMIT 1
    """
    vid = str(version_id) if version_id else None
    fallback = (await db.execute(text(run_sql), {"t": str(tenant.id), "wid": None, "vid": vid})).fetchone()

    async def dqs_for(version: uuid.UUID | None) -> dict[str, float | None]:
        if not version:
            return {}
        row = (await db.execute(
            text("SELECT dqs_summary FROM analysis_versions WHERE id = :vid AND tenant_id = :t"),
            {"vid": str(version), "t": str(tenant.id)},
        )).fetchone()
        return {m: (d or {}).get("composite_score") for m, d in ((row[0] if row else {}) or {}).items()}

    cells = []
    for w in waves:
        run = (await db.execute(text(run_sql), {"t": str(tenant.id), "wid": str(w.id), "vid": vid})).fetchone() or fallback
        cells += build_wave_cells(w.name, list(w.modules or []), (run[0] if run else {}) or {},
                                  await dqs_for(run[1] if run else None), w.min_readiness,
                                  w.min_dqs if w.min_dqs is not None else dqs_threshold)
    resolved = fallback[1] if fallback else version_id
    return {
        "version_id": str(resolved) if resolved else None,
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
    result = await db.execute(text(OWNER_ISSUE_SQL), {"tid": str(tenant.id), "cutoff": baseline_cutoff()})
    issue_rows = [dict(r._mapping) for r in result.fetchall()]
    aggregates = load_owner_aggregates(issue_rows)

    last_sent_by_user = {
        r[0]: r[1]
        for r in (await db.execute(
            text("""
                SELECT user_id, MAX(created_at) FROM notifications
                WHERE tenant_id = :t AND type = 'digest'
                GROUP BY user_id
            """),
            {"t": str(tenant.id)},
        )).fetchall()
    }

    rows = []
    for owner, agg in aggregates.items():
        card = build_owner_card(owner, agg["score"], agg["delta"], agg["open_by_severity"],
                                 agg["fixed_since_baseline"], agg["oldest_item_age_days"])
        last_sent = last_sent_by_user.get(agg["user_id"])
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
    due_at: Optional[datetime] = None


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


@router.get("/exec", dependencies=[Depends(require_permission("view"))])
async def get_exec(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Plan Task 15 Step 2 shape: {version_id, narrative, readiness_cells, waterfall,
    impact_rows, owner_rows} — the shape frontend/lib/api/insights.ts's ExecResponse
    already types. Composed by calling the readiness/impact/owners route functions
    directly (same pattern get_impact already uses for get_config_impact), all scoped
    to the same resolved version_id, so both the JSON page and the PDF export
    (api/routes/reports.py's executive_report_pdf, unchanged) describe the same run.
    narrative is a deterministic string built from these numbers — no LLM call."""
    await _rls(db, tenant)
    if version_id is None:
        version_id = (await db.execute(
            text("SELECT id FROM analysis_versions WHERE tenant_id = :t ORDER BY run_at DESC LIMIT 1"),
            {"t": str(tenant.id)},
        )).scalar()
        if version_id is None:
            raise HTTPException(404, "No analysis run found")

    readiness = await get_readiness(version_id, db, tenant)
    impact = await get_impact(version_id, db, tenant)
    owners = await get_owners(db, tenant)

    cells = readiness["cells"]
    rows = impact["rows"]
    owner_rows = owners["owners"]
    no_go = sum(1 for c in cells if c["verdict"] == "no_go")
    total_value_at_risk = sum(r["value_at_risk"] for r in rows)
    waterfall = [{"x": r["feature"], "y": r["value_at_risk"]} for r in rows]

    narrative = (
        f"{no_go} of {len(cells)} readiness cells are no-go. "
        f"{len(rows)} features carry {total_value_at_risk:,.2f} in value at risk. "
        f"{len(owner_rows)} owners have open digests."
    )

    return {
        "version_id": str(version_id),
        "narrative": narrative,
        "readiness_cells": cells,
        "waterfall": waterfall,
        "impact_rows": rows,
        "owner_rows": owner_rows,
    }
