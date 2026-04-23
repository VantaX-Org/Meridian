"""Process mining-graph API — activity-level data for the Process workspace.

This exposes L4-step-level nodes, transitions between consecutive steps,
and L3-level variants — giving the Aurora Process workspace real
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
    l3_id: str
    l3_name: str
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
    coverage: float = Field(description="L3 share of module, in [0,1]")
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


def _build_activities_and_transitions(
    processes: list[dict[str, Any]],
) -> tuple[list[MiningActivity], list[MiningTransition]]:
    activities: list[MiningActivity] = []
    transitions: list[MiningTransition] = []
    seen_ids: set[str] = set()

    for l1 in processes:
        for l2 in l1.get("l2_groups", []):
            for l3 in l2.get("l3_processes", []):
                l4_ids_in_order: list[str] = []
                for l4 in l3.get("l4_steps", []):
                    l4_id = l4.get("l4_id") or l4.get("id") or ""
                    if not l4_id or l4_id in seen_ids:
                        # Duplicate L4 across L3s is unusual; skip to keep node set clean.
                        continue
                    seen_ids.add(l4_id)

                    l5_fields = l4.get("l5_fields", [])
                    affected = sum(int(f.get("affected_count", 0) or 0) for f in l5_fields)
                    finding_count = sum(
                        1 for f in l5_fields if (f.get("affected_count") or 0) > 0
                    )
                    pass_rates = [
                        float(f.get("pass_rate"))
                        for f in l5_fields
                        if f.get("pass_rate") is not None
                    ]
                    avg_pass = (
                        sum(pass_rates) / len(pass_rates) if pass_rates else None
                    )

                    activities.append(
                        MiningActivity(
                            id=l4_id,
                            label=l4.get("l4_name") or l4.get("name") or l4_id,
                            l3_id=l3.get("l3_id") or "",
                            l3_name=l3.get("l3_name") or "",
                            tcode=l3.get("tcode") or None,
                            step_status=l4.get("step_status", "green"),
                            affected_records=affected,
                            finding_count=finding_count,
                            avg_pass_rate=avg_pass,
                        )
                    )
                    l4_ids_in_order.append(l4_id)

                # Sequential edges between consecutive L4 steps within the L3.
                for a, b in zip(l4_ids_in_order, l4_ids_in_order[1:]):
                    # Weight = affected records at the source node, floored to 1
                    # so empty-affected edges still render.
                    src_activity = next(act for act in activities if act.id == a)
                    transitions.append(
                        MiningTransition(
                            **{
                                "from": a,
                                "to": b,
                                "weight": max(src_activity.affected_records, 1),
                            }
                        )
                    )

    return activities, transitions


def _build_variants(processes: list[dict[str, Any]]) -> list[MiningVariant]:
    variants: list[MiningVariant] = []
    all_l3: list[dict[str, Any]] = []
    for l1 in processes:
        for l2 in l1.get("l2_groups", []):
            for l3 in l2.get("l3_processes", []):
                all_l3.append(l3)

    total = len(all_l3) or 1

    for l3 in all_l3:
        l4_steps = l3.get("l4_steps", [])
        activity_ids = [
            l4.get("l4_id") or l4.get("id") or ""
            for l4 in l4_steps
            if (l4.get("l4_id") or l4.get("id"))
        ]
        readiness = l3.get("overall_readiness", "green")
        variants.append(
            MiningVariant(
                id=l3.get("l3_id") or "",
                label=l3.get("l3_name") or l3.get("tcode") or "",
                tcode=l3.get("tcode") or None,
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
    each L4 step into a mining activity with aggregated finding counts
    and consecutive-step transitions.
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
            "pass_rate": float(r[1]) if r[1] is not None else 0,
            "affected_count": r[2] or 0,
            "severity": r[3],
            "message": r[4] or "",
        }
        for r in finds_result.fetchall()
    }

    try:
        from api.services.spro_reader import SPROReader

        reader = SPROReader("ecc", None)
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
