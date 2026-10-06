"""Process mining-graph API — activity-level data for the Process workspace.

This exposes L5-activity-level nodes, transitions that follow each L4
diagram's flows, and L4-level variants — giving the Aurora Process workspace real
activity-level data to render instead of synthesising a tree from the
L1 hierarchy on the frontend.

Cases remain an empty list for now — true case-level event traces need a
change-log / event-log pipeline that hasn't shipped. We return
`cases_supported=false` so the UI can render an honest empty state.

Endpoint: GET /api/v1/process/mining/graph/{version_id}/{module}
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

router = APIRouter(prefix="/api/v1/process", tags=["process_mining"])
logger = logging.getLogger("meridian.process_mining")


class MiningActivity(BaseModel):
    id: str
    label: str
    l4_id: str
    l4_name: str
    tcode: str | None = None
    step_status: str = Field(description="green | amber | red")
    affected_records: int = 0
    finding_count: int = 0
    avg_pass_rate: float | None = None


class MiningTransition(BaseModel):
    from_: str = Field(alias="from")
    to: str
    weight: int = 1

    class Config:
        populate_by_name = True


class MiningVariant(BaseModel):
    id: str
    label: str
    tcode: str | None = None
    activity_count: int
    coverage: float = Field(description="L4 share of module, in [0,1]")
    readiness: str = Field(description="green | amber | red")
    quality: int = Field(description="0-100 score derived from readiness")
    activity_ids: list[str]


class MiningGraphResponse(BaseModel):
    version_id: str
    module: str
    activities: list[MiningActivity]
    transitions: list[MiningTransition]
    variants: list[MiningVariant]
    cases: list[dict[str, Any]] = []
    cases_supported: bool = False


def _quality_from_readiness(readiness: str) -> int:
    if readiness == "green":
        return 100
    if readiness == "amber":
        return 60
    return 25


def _collapse(l4_id: str) -> list[tuple[str, str]]:
    from sap.process_definitions import PROCESS_DEFINITIONS

    diagram = next((l4["diagram"] for l1 in PROCESS_DEFINITIONS for l2 in l1["l2"] for l3 in l2["l3"]
                    for l4 in l3["l4"] if l4["id"] == l4_id), None)
    if not diagram:
        return []
    nodes = {n["id"]: n for n in diagram["nodes"]}
    out: dict[str, list[str]] = {}
    for f in diagram["flows"]:
        out.setdefault(f["source"], []).append(f["target"])

    def next_tasks(node_id: str, seen: frozenset[str]) -> list[str]:
        found: list[str] = []
        for t in out.get(node_id, []):
            n = nodes.get(t)
            if n is None or t in seen:
                continue
            if n["type"] == "task":
                found.append(n["activity_id"])
            elif n["type"] != "endEvent":
                found.extend(next_tasks(t, seen | {t}))
        return found

    edges: list[tuple[str, str]] = []
    for n in diagram["nodes"]:
        if n["type"] == "task":
            for dst in next_tasks(n["id"], frozenset({n["id"]})):
                if (n["activity_id"], dst) not in edges:
                    edges.append((n["activity_id"], dst))
    return edges


def _build_activities_and_transitions(
    processes: list[dict[str, Any]],
) -> tuple[list[MiningActivity], list[MiningTransition]]:
    activities: list[MiningActivity] = []
    transitions: list[MiningTransition] = []
    seen_ids: set[str] = set()

    for l1 in processes:
        for l2 in l1.get("l2_groups", []):
            for l3 in l2.get("l3_processes", []):
                for l4 in l3.get("l4_subprocesses", []):
                    l4_id = l4.get("l4_id") or ""
                    by_id: dict[str, MiningActivity] = {}
                    for act in l4.get("activities", []):
                        l5_id = act.get("l5_id") or ""
                        if not l5_id or l5_id in seen_ids:
                            continue
                        seen_ids.add(l5_id)
                        fields = act.get("fields", [])
                        pass_rates = [float(f["pass_rate"]) for f in fields if f.get("pass_rate") is not None]
                        item = MiningActivity(
                            id=l5_id,
                            label=act.get("l5_name") or l5_id,
                            l4_id=l4_id,
                            l4_name=l4.get("l4_name") or "",
                            tcode=act.get("tcode") or l4.get("tcode") or None,
                            step_status=act.get("activity_status", "green"),
                            affected_records=sum(int(f.get("affected_count", 0) or 0) for f in fields),
                            finding_count=sum(1 for f in fields if (f.get("affected_count") or 0) > 0),
                            avg_pass_rate=sum(pass_rates) / len(pass_rates) if pass_rates else None,
                        )
                        activities.append(item)
                        by_id[l5_id] = item
                    for src, dst in _collapse(l4_id):
                        if src in by_id and dst in by_id:
                            # weight = affected records at the source node, floored to 1 so empty edges still render
                            transitions.append(MiningTransition(
                                **{"from": src, "to": dst, "weight": max(by_id[src].affected_records, 1)}))

    return activities, transitions


def _build_variants(processes: list[dict[str, Any]]) -> list[MiningVariant]:
    """One variant per L4 sub-process (a t-code path through its activities)."""
    all_l4: list[dict[str, Any]] = [
        l4 for l1 in processes for l2 in l1.get("l2_groups", []) for l3 in l2.get("l3_processes", [])
        for l4 in l3.get("l4_subprocesses", [])
    ]
    total = len(all_l4) or 1
    variants: list[MiningVariant] = []
    for l4 in all_l4:
        activity_ids = [a["l5_id"] for a in l4.get("activities", []) if a.get("l5_id")]
        readiness = l4.get("step_status", "green")
        variants.append(
            MiningVariant(
                id=l4.get("l4_id") or "",
                label=l4.get("l4_name") or l4.get("tcode") or "",
                tcode=l4.get("tcode") or None,
                activity_count=len(activity_ids),
                coverage=round(1.0 / total, 4),
                readiness=readiness,
                quality=_quality_from_readiness(readiness),
                activity_ids=activity_ids,
            )
        )
    return variants


@router.get("/mining/graph/{version_id}/{module}", response_model=MiningGraphResponse)
async def get_mining_graph(
    version_id: str,
    module: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> MiningGraphResponse:
    """Build the activity-level process graph for a version + module.

    Uses the existing L1–L5 business-process generator, then projects
    each L5 activity into a mining node with aggregated finding counts
    and flow-following transitions.
    """
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))

    # Reuse the existing enrichment pipeline so we stay consistent with
    # /api/v1/business-process/{version}/{module}.
    finds_result = await db.execute(
        text(
            """
            SELECT check_id, pass_rate, affected_count, severity,
                   details->>'message' as message, module
            FROM findings
            WHERE version_id = :vid AND tenant_id = :tid
            """
        ),
        {"vid": version_id, "tid": str(tenant.id)},
    )
    findings_by_check = {
        r[0]: {
            "pass_rate": float(r[1]) if r[1] is not None else None,
            "affected_count": r[2] or 0,
            "severity": r[3],
            "message": r[4] or "",
        }
        for r in finds_result.fetchall()
    }

    try:
        from api.services.spro_reader import SPROReader

        from api.services.source_design import live_config_for_version
        system_type, live_cfg = await live_config_for_version(db, version_id)
        reader = SPROReader(system_type, None, snapshot_loader=live_cfg.get)
        spro_config_dfs = reader.read_config(module)
        spro_config = {
            t: df.to_dict(orient="records") if not df.empty else []
            for t, df in spro_config_dfs.items()
        }
    except Exception as e:
        logger.warning(f"SPRO fallback failed for module={module}: {e}")
        spro_config = {}

    impact_result = await db.execute(
        text(
            "SELECT feature, system, status, blocking_findings, "
            "total_affected_records, opportunity_cost_summary "
            "FROM config_impact_results "
            "WHERE version_id = :vid AND tenant_id = :tid"
        ),
        {"vid": version_id, "tid": str(tenant.id)},
    )
    config_impact = [
        {
            "feature": r[0],
            "system": r[1],
            "status": r[2],
            "blocking_findings": r[3],
            "total_affected_records": r[4],
            "opportunity_cost_summary": r[5],
        }
        for r in impact_result.fetchall()
    ]

    from api.services.process_writer import generate_process_document

    try:
        processes = generate_process_document(
            module, findings_by_check, spro_config, config_impact
        )
    except Exception as e:
        logger.exception("process_document build failed")
        raise HTTPException(
            status_code=500,
            detail=f"Process document build failed: {type(e).__name__}",
        )

    if not processes:
        return MiningGraphResponse(
            version_id=version_id,
            module=module,
            activities=[],
            transitions=[],
            variants=[],
            cases=[],
            cases_supported=False,
        )

    activities, transitions = _build_activities_and_transitions(processes)
    variants = _build_variants(processes)

    return MiningGraphResponse(
        version_id=version_id,
        module=module,
        activities=activities,
        transitions=transitions,
        variants=variants,
        cases=[],
        cases_supported=False,
    )
