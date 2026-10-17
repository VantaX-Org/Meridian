"""GET endpoints backing the /insights/* pages (spec 8). All computation is
deterministic — no LLM calls anywhere in this module."""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.config_impact import get_config_impact
from api.routes.merge_explain import AUTO_MERGE, REVIEW_FLOOR, build_cluster_graph
from api.routes.record_issues import _rls
from api.services import insights_aggregate as agg
from api.services.insights_impact import by_l1, feature_l1, tenant_currency, value_at_risk, worst_l1
from api.services.insights_owners import OWNER_ISSUE_SQL, baseline_cutoff, build_owner_card, load_owner_aggregates
from api.services.insights_readiness import build_wave_cells
from api.services.rbac import require_permission
from api.services.scoring import scoring_config

router = APIRouter(prefix="/api/v1/insights", tags=["insights"])

_METRIC_LABEL = {
    "late_po": "Late POs (lead-time / info-record defects)",
    "grir_uom_variance": "GR/IR variance (UoM defects)",
    "blocked_sales": "Sales orders blocked (customer master)",
    "duplicate_payment": "Duplicate vendor payments",
}


# L1 process each proven-cost metric belongs to. Metrics are only ever grouped within one L1.
_METRIC_L1 = {
    "late_po": "procure_to_pay",
    "grir_uom_variance": "procure_to_pay",
    "duplicate_payment": "procure_to_pay",
    "blocked_sales": "order_to_cash",
}


@router.get("/readiness", dependencies=[Depends(require_permission("view"))])
async def get_readiness(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)
    alerts, scoring = (await db.execute(
        text("SELECT alert_thresholds, dqs_weights FROM tenants WHERE id = :t"),
        {"t": str(tenant.id)},
    )).one_or_none() or (None, None)
    # unset: the warning band of the one DQS band set
    dqs_threshold = (alerts or {}).get("readiness_dqs_threshold", scoring_config(scoring)["thresholds"]["warning"])
    waves = (await db.execute(text(
        "SELECT id, name, modules, min_readiness, min_dqs FROM migration_waves "
        "WHERE tenant_id = :t ORDER BY target_date NULLS LAST, name"), {"t": str(tenant.id)})).fetchall()
    if not waves:
        return {"version_id": None, "threshold": dqs_threshold, "waves": [], "cells": [], "configured": False}

    # A wave reads its own latest analysed run; a wave without one falls back to the tenant's
    # latest analysed run (optionally pinned by version_id), so grids built from settings still show.
    # A dry run outranks a newer regular run only on the same source version as the newest
    # run; a dry run of older data never beats a run of newer data.
    run_sql = """
        WITH c AS (
            SELECT gap_summary, source_version_id, mode, completed_at,
                   first_value(source_version_id) OVER (ORDER BY completed_at DESC NULLS LAST) AS latest_v
            FROM migration_runs
            WHERE tenant_id = :t AND status = 'analysed'
              AND (CAST(:wid AS uuid) IS NULL OR wave_id = CAST(:wid AS uuid))
              AND (CAST(:vid AS uuid) IS NULL OR source_version_id = CAST(:vid AS uuid)))
        SELECT gap_summary, source_version_id FROM c
        ORDER BY (mode = 's4_dry_run' AND source_version_id IS NOT DISTINCT FROM latest_v) DESC,
                 completed_at DESC NULLS LAST LIMIT 1
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
        # Not a single source-of-truth version: each cell may read its own wave's latest run.
        # This is the tenant's latest analysed version (or the requested one), for drill links only.
        "version_id": str(resolved) if resolved else None,
        "threshold": dqs_threshold,
        "cells": [c.__dict__ for c in cells],
        "configured": True,
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
            "l1": feature_l1().get(r["feature"]),
            "status": r["status"],
            "record_count": r["total_affected_records"],
            "value_per_record": v,
            "value_at_risk": value_at_risk(r["total_affected_records"], v),
            "causing_rules": r["blocking_findings"],
        })
    return {"version_id": str(version_id), "rows": rows}


@router.get("/proven-cost", dependencies=[Depends(require_permission("view"))])
async def get_proven_cost(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)

    # Resolved before the version lookup so the empty ("no rows yet") response still
    # carries the tenant's real currency instead of None.
    cost_model = (await db.execute(
        text("SELECT cost_model FROM tenants WHERE id = :t"),
        {"t": str(tenant.id)},
    )).scalar() or {}
    currency = tenant_currency(cost_model)

    # No explicit version — same "latest with rows" idea as get_impact/get_readiness.
    if version_id is None:
        version_id = (await db.execute(
            text("""
                SELECT av.id FROM analysis_versions av
                WHERE av.tenant_id = :t AND EXISTS (
                    SELECT 1 FROM proven_cost_results p
                    WHERE p.version_id = av.id AND p.tenant_id = :t
                )
                ORDER BY av.run_at DESC LIMIT 1
            """),
            {"t": str(tenant.id)},
        )).scalar()
        if version_id is None:
            return {"version_id": None, "currency": currency, "rows": [], "cost_by_l1": [],
                    "value_at_risk_by_l1": []}

    res = await db.execute(text("""
        SELECT metric, amount, currency, by_currency, documents, check_ids, items
        FROM proven_cost_results WHERE version_id = :v AND tenant_id = :t"""),
        {"v": str(version_id), "t": str(tenant.id)})
    by_metric = {r.metric: r for r in res.fetchall()}
    rows = [{"metric": m, "label": label, "amount": float(r.amount), "currency": r.currency,
             "by_currency": r.by_currency, "documents": r.documents, "check_ids": list(r.check_ids),
             "items": r.items}
            for m, label in _METRIC_LABEL.items() if (r := by_metric.get(m))]
    # A metric spanning more than one currency (api/services/proven_cost.py's
    # _result) carries currency=None with a by_currency breakdown instead; take each
    # row's by_currency share of the tenant's chosen currency, never converting the
    # rest. Costs are grouped per L1 only: there is deliberately no total across L1s.
    cost_by_l1: dict[str, float] = {}
    for r in rows:
        r["l1"] = _METRIC_L1[r["metric"]]
        cost_by_l1[r["l1"]] = round(
            cost_by_l1.get(r["l1"], 0.0) + float((r["by_currency"] or {}).get(currency, 0.0)), 2)

    impact = await get_impact(version_id, db, tenant)
    # Per-L1 only: value at risk is never summed across L1s.
    var_by_l1 = [{"l1": k, "value_at_risk": v} for k, v in sorted(by_l1(impact["rows"]).items())]

    return {"version_id": str(version_id), "currency": currency, "rows": rows,
            "cost_by_l1": [{"l1": k, "amount": v} for k, v in sorted(cost_by_l1.items())],
            "value_at_risk_by_l1": var_by_l1}


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


def exec_narrative(no_go: int, cells: int, priced: int, worst_name: Optional[str], worst_amount: float,
                   owners: int, top_cost: Optional[dict], currency: Optional[str]) -> str:
    """The exec Situation text: one sentence per fact that has something to say and none for a
    zero, so a quiet run reads "" and the page shows its own fallback. Deterministic, no LLM."""
    out: list[str] = []
    if no_go:
        out.append(f"{no_go} of {cells} readiness cells {'is' if no_go == 1 else 'are'} no-go.")
    if priced:
        noun = "feature is" if priced == 1 else "features are"
        where = f" in {worst_name.replace('_', ' ')}" if worst_name else ""
        tail = f"; the largest exposure is {worst_amount:,.2f}{where}." if worst_amount else "."
        out.append(f"{priced} priced {noun} affected{tail}")
    if owners:
        out.append(f"{owners} {'owner has' if owners == 1 else 'owners have'} open digests.")
    if top_cost and (top_cost.get("amount") or 0) > 0:
        unit = f" {currency}" if currency else ""
        l1 = str(top_cost.get("l1") or "").replace("_", " ")
        out.append(f"The largest proven cost is {top_cost['amount']:,.2f}{unit} lost or held in transactions in {l1}.")
    return " ".join(out)


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
            text("SELECT id FROM analysis_versions WHERE tenant_id = :t "
                 "AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery' ORDER BY run_at DESC LIMIT 1"),
            {"t": str(tenant.id)},
        )).scalar()
        if version_id is None:
            # No analysis run at all for this tenant — not an error, just a day-one
            # tenant. 200 with empty fields so the page renders its empty state.
            return {
                "version_id": None,
                "narrative": "",
                "readiness_cells": [],
                "waterfall": [],
                "impact_rows": [],
                "owner_rows": [],
            }

    # get_readiness no longer raises 409 for unconfigured waves (it returns
    # {"cells": [], "configured": False} instead), so no HTTPException catch
    # is needed here any more.
    readiness = await get_readiness(version_id, db, tenant)
    impact = await get_impact(version_id, db, tenant)
    owners = await get_owners(db, tenant)
    proven_cost = await get_proven_cost(version_id, db, tenant)

    cells = readiness["cells"]
    rows = impact["rows"]
    owner_rows = owners["owners"]
    no_go = sum(1 for c in cells if c["verdict"] == "no_go")
    worst_name, worst_amount = worst_l1(rows)
    waterfall = [{"x": r["feature"], "y": r["value_at_risk"], "l1": r["l1"]} for r in rows]
    top_cost = max(proven_cost["cost_by_l1"], key=lambda c: c["amount"], default=None)

    narrative = exec_narrative(no_go, len(cells), len(rows), worst_name, worst_amount, len(owner_rows),
                               top_cost, proven_cost["currency"])

    return {
        "version_id": str(version_id),
        "narrative": narrative,
        "readiness_cells": cells,
        "waterfall": waterfall,
        "impact_rows": rows,
        "owner_rows": owner_rows,
        "proven_cost_by_l1": proven_cost["cost_by_l1"],
    }


# -- aggregate endpoints (insights redesign); all view-gated, deterministic ----------------

async def _agg(db: AsyncSession, tenant: Tenant, fn, *args, **kw) -> dict:
    await _rls(db, tenant)
    out = await db.run_sync(lambda s: fn(s, str(tenant.id), *args, **kw))
    if out is None:
        raise HTTPException(404, "No completed run found")
    return out


@router.get("/overview", dependencies=[Depends(require_permission("view"))])
async def get_overview(version_id: Optional[uuid.UUID] = None, module: Optional[str] = None,
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Board overview for one run. A blocker is a failing rule that is critical, or that the
    S/4 readiness pack counts as blocking. Blockers are never summed across L1s."""
    return await _agg(db, tenant, agg.overview, version_id and str(version_id), module)


@router.get("/rules", dependencies=[Depends(require_permission("view"))])
async def get_rule_ranking(version_id: Optional[uuid.UUID] = None, module: Optional[str] = None,
                           severity: Optional[str] = None, dimension: Optional[str] = None,
                           auto_fixable: bool = False, s4_only: bool = False,
                           limit: int = Query(50, ge=1, le=500),
                           db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    return await _agg(db, tenant, agg.rules, version_id and str(version_id), module, severity=severity,
                      dimension=dimension, auto_fixable=auto_fixable, s4_only=s4_only, limit=limit)


@router.get("/root-causes", dependencies=[Depends(require_permission("view"))])
async def get_root_causes(version_id: Optional[uuid.UUID] = None, module: Optional[str] = None,
                          db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    return await _agg(db, tenant, agg.root_causes, version_id and str(version_id), module)


@router.get("/heatmap", dependencies=[Depends(require_permission("view"))])
async def get_heatmap(version_id: Optional[uuid.UUID] = None, module: Optional[str] = None,
                      db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    return await _agg(db, tenant, agg.heatmap, version_id and str(version_id), module)


@router.get("/trends", dependencies=[Depends(require_permission("view"))])
async def get_trends(version_id: Optional[uuid.UUID] = None, system_id: Optional[str] = None,
                     limit: int = Query(12, ge=1, le=50),
                     db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    return await _agg(db, tenant, agg.trends, version_id and str(version_id), system_id, limit)


@router.get("/cleansing", dependencies=[Depends(require_permission("view"))])
async def get_cleansing(version_id: Optional[uuid.UUID] = None, module: Optional[str] = None,
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    return await _agg(db, tenant, agg.cleansing, version_id and str(version_id), module)
