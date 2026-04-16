"""Run Sync API — trigger per-module re-analysis and report status."""

import logging
import os
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_session, get_tenant_id

logger = logging.getLogger("meridian.sync_trigger")

router = APIRouter(prefix="/api/v1/sync-trigger", tags=["sync_trigger"])

# All 29 modules grouped by category
MODULE_REGISTRY: dict[str, dict[str, str]] = {
    # ECC
    "business_partner": {"category": "ECC", "label": "Business Partner"},
    "material_master": {"category": "ECC", "label": "Material Master"},
    "fi_gl": {"category": "ECC", "label": "FI / General Ledger"},
    "accounts_payable": {"category": "ECC", "label": "Accounts Payable"},
    "accounts_receivable": {"category": "ECC", "label": "Accounts Receivable"},
    "asset_accounting": {"category": "ECC", "label": "Asset Accounting"},
    "mm_purchasing": {"category": "ECC", "label": "MM Purchasing"},
    "plant_maintenance": {"category": "ECC", "label": "Plant Maintenance"},
    "production_planning": {"category": "ECC", "label": "Production Planning"},
    "sd_customer_master": {"category": "ECC", "label": "SD Customer Master"},
    "sd_sales_orders": {"category": "ECC", "label": "SD Sales Orders"},
    # SuccessFactors
    "employee_central": {"category": "SuccessFactors", "label": "Employee Central"},
    "compensation": {"category": "SuccessFactors", "label": "Compensation"},
    "benefits": {"category": "SuccessFactors", "label": "Benefits"},
    "payroll_integration": {"category": "SuccessFactors", "label": "Payroll Integration"},
    "performance_goals": {"category": "SuccessFactors", "label": "Performance & Goals"},
    "succession_planning": {"category": "SuccessFactors", "label": "Succession Planning"},
    "recruiting_onboarding": {"category": "SuccessFactors", "label": "Recruiting & Onboarding"},
    "learning_management": {"category": "SuccessFactors", "label": "Learning Management"},
    "time_attendance": {"category": "SuccessFactors", "label": "Time & Attendance"},
    # Warehouse / MDG
    "ewms_stock": {"category": "Warehouse", "label": "eWMS Stock"},
    "ewms_transfer_orders": {"category": "Warehouse", "label": "eWMS Transfer Orders"},
    "batch_management": {"category": "Warehouse", "label": "Batch Management"},
    "mdg_master_data": {"category": "Warehouse", "label": "MDG Master Data"},
    "grc_compliance": {"category": "Warehouse", "label": "GRC Compliance"},
    "fleet_management": {"category": "Warehouse", "label": "Fleet Management"},
    "transport_management": {"category": "Warehouse", "label": "Transport Management"},
    "wm_interface": {"category": "Warehouse", "label": "WM Interface"},
    "cross_system_integration": {"category": "Warehouse", "label": "Cross-System Integration"},
}


class TriggerRequest(BaseModel):
    module_ids: list[str]


class ModuleStatus(BaseModel):
    module_id: str
    label: str
    category: str
    status: str  # idle | running | completed | failed
    last_run_at: Optional[str] = None
    last_version_id: Optional[str] = None


class TriggerResponse(BaseModel):
    queued: list[str]
    skipped: list[str]


@router.get("/modules", response_model=list[ModuleStatus])
async def list_modules(
    tenant_id: UUID = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_session),
) -> list[ModuleStatus]:
    """Return all 29 modules with their latest analysis status."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

    # Fetch the latest version per module from analysis_versions
    result = await db.execute(
        text(
            """
            SELECT DISTINCT ON (metadata->>'module')
                metadata->>'module' AS module_id,
                status,
                run_at
            FROM analysis_versions
            WHERE tenant_id = :tid
              AND metadata->>'module' IS NOT NULL
            ORDER BY metadata->>'module', run_at DESC
            """
        ),
        {"tid": str(tenant_id)},
    )
    rows = result.fetchall()
    latest: dict[str, dict[str, Any]] = {
        row.module_id: {"status": row.status, "run_at": str(row.run_at)}
        for row in rows
        if row.module_id
    }

    statuses: list[ModuleStatus] = []
    for module_id, meta in MODULE_REGISTRY.items():
        info = latest.get(module_id, {})
        raw_status = info.get("status", "idle")
        # Map DB statuses to UI statuses
        ui_status = {
            "completed": "completed",
            "failed": "failed",
            "pending": "running",
            "running": "running",
        }.get(raw_status, "idle")
        statuses.append(
            ModuleStatus(
                module_id=module_id,
                label=meta["label"],
                category=meta["category"],
                status=ui_status,
                last_run_at=info.get("run_at"),
            )
        )
    return statuses


@router.post("/trigger", response_model=TriggerResponse)
async def trigger_modules(
    body: TriggerRequest,
    tenant_id: UUID = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_session),
) -> TriggerResponse:
    """Enqueue re-analysis Celery tasks for the selected modules."""
    from workers.tasks.run_checks import run_checks

    queued: list[str] = []
    skipped: list[str] = []

    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

    for module_id in body.module_ids:
        if module_id not in MODULE_REGISTRY:
            skipped.append(module_id)
            continue

        # Find the most recent analysis version with a staging parquet for this module
        result = await db.execute(
            text(
                """
                SELECT id, metadata->>'parquet_path' AS parquet_path
                FROM analysis_versions
                WHERE tenant_id = :tid
                  AND metadata->>'module' = :module
                  AND metadata->>'parquet_path' IS NOT NULL
                ORDER BY run_at DESC
                LIMIT 1
                """
            ),
            {"tid": str(tenant_id), "module": module_id},
        )
        row = result.fetchone()

        if not row:
            logger.warning("No prior analysis data for module %s (tenant %s) — skipping", module_id, tenant_id)
            skipped.append(module_id)
            continue

        try:
            run_checks.delay(
                str(row.id),
                str(tenant_id),
                row.parquet_path,
            )
            queued.append(module_id)
            logger.info("Queued re-sync for module %s (tenant %s)", module_id, tenant_id)
        except Exception as exc:
            logger.error("Failed to queue module %s: %s", module_id, exc)
            skipped.append(module_id)

    return TriggerResponse(queued=queued, skipped=skipped)
