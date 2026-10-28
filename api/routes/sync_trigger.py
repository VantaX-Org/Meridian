"""Run Sync API — trigger per-module re-analysis and report status."""

import logging
import os
import re
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_session, get_tenant_id
from api.services.rbac import current_user_label, require_permission

logger = logging.getLogger("meridian.sync_trigger")

router = APIRouter(prefix="/api/v1/sync-trigger", tags=["sync_trigger"])

# Display name of every module id: the one Python copy of frontend/lib/format.ts MODULE_LABELS, cased by
# frontend/DESIGN.md "Object names" (sentence case, SAP acronyms upper case, eWMS with a lower-case e).
# tests/test_module_labels.py fails when the two maps differ.
MODULE_LABELS: dict[str, str] = {
    # ECC and S/4HANA
    "business_partner": "Business partner",
    "material_master": "Material master",
    "fi_gl": "FI general ledger",
    "accounts_payable": "Accounts payable",
    "accounts_receivable": "Accounts receivable",
    "asset_accounting": "Asset accounting",
    "controlling": "Controlling",
    "hcm": "HCM personnel administration",
    "mm_purchasing": "MM purchasing",
    "plant_maintenance": "Plant maintenance",
    "production_planning": "Production planning",
    "project_system": "Project system",
    "quality_management": "Quality management",
    "sd_customer_master": "SD customer master",
    "sd_sales_orders": "SD sales orders",
    "interface_health": "Interface health (IDoc)",
    "s4_readiness": "S/4HANA readiness",
    "banking_tax": "Banking and tax master data",
    "s4hc_master_data": "BP roles, CVI and product valuation",
    # SuccessFactors
    "employee_central": "Employee central",
    "compensation": "Compensation",
    "benefits": "Benefits",
    "payroll_integration": "Payroll integration",
    "performance_goals": "Performance and goals",
    "succession_planning": "Succession planning",
    "recruiting_onboarding": "Recruiting and onboarding",
    "learning_management": "Learning management",
    "time_attendance": "Time and attendance",
    # Warehouse
    "ewms_stock": "eWMS stock",
    "ewms_transfer_orders": "eWMS transfer orders",
    "batch_management": "Batch management",
    "mdg_master_data": "MDG master data",
    "grc_compliance": "GRC compliance",
    "fleet_management": "Fleet management",
    "transport_management": "Transport management",
    "wm_interface": "WM interface",
    "cross_system_integration": "Cross-system integration",
    # Concur and Ariba
    "concur_expense": "Concur expense reports",
    "concur_travel": "Concur travel",
    "concur_users": "Concur users and cost objects",
    "ariba_supplier": "Ariba suppliers",
    "ariba_contracts": "Ariba contracts",
    "ariba_procurement": "Ariba purchase orders and invoices",
    "ariba_spend": "Ariba spend",
    # Extraction-only and cross-cutting
    "process_discovery": "Process discovery",
    "process_events_sfx": "SuccessFactors process events",
    "process_events_arb": "Ariba process events",
    "process_events_cnq": "Concur process events",
    "s4_load_sim": "S/4HANA load simulation",
    "proven_cost": "Proven cost",
    "pii": "PII",
}


def module_label(module: str) -> str:
    """Name a module id as frontend/lib/format.ts formatModuleName does: "fi_gl" -> "FI general ledger".

    An id missing from MODULE_LABELS is sentence-cased ("new_module" -> "New module").
    """
    if module in MODULE_LABELS:
        return MODULE_LABELS[module]
    s = re.sub(r"_+", " ", module).strip()
    return s[:1].upper() + s[1:]


# The modules a sync can be triggered for, grouped by category
_MODULE_CATEGORIES: dict[str, str] = {
    # ECC
    "business_partner": "ECC",
    "material_master": "ECC",
    "fi_gl": "ECC",
    "accounts_payable": "ECC",
    "accounts_receivable": "ECC",
    "asset_accounting": "ECC",
    "hcm": "ECC",
    "mm_purchasing": "ECC",
    "plant_maintenance": "ECC",
    "production_planning": "ECC",
    "quality_management": "ECC",
    "project_system": "ECC",
    "sd_customer_master": "ECC",
    "sd_sales_orders": "ECC",
    "controlling": "ECC",
    "interface_health": "ECC",
    "s4_readiness": "ECC",
    "banking_tax": "ECC",
    # SuccessFactors
    "employee_central": "SuccessFactors",
    "compensation": "SuccessFactors",
    "benefits": "SuccessFactors",
    "payroll_integration": "SuccessFactors",
    "performance_goals": "SuccessFactors",
    "succession_planning": "SuccessFactors",
    "recruiting_onboarding": "SuccessFactors",
    "learning_management": "SuccessFactors",
    "time_attendance": "SuccessFactors",
    # Warehouse
    "ewms_stock": "Warehouse",
    "ewms_transfer_orders": "Warehouse",
    "batch_management": "Warehouse",
    "mdg_master_data": "Warehouse",
    "grc_compliance": "Warehouse",
    "fleet_management": "Warehouse",
    "transport_management": "Warehouse",
    "wm_interface": "Warehouse",
    "cross_system_integration": "Warehouse",
    # S/4HANA Cloud
    "s4hc_master_data": "S/4HANA Cloud",
    # Concur
    "concur_expense": "Concur",
    "concur_users": "Concur",
    # Ariba
    "ariba_supplier": "Ariba",
    "ariba_contracts": "Ariba",
    "ariba_procurement": "Ariba",
}

MODULE_REGISTRY: dict[str, dict[str, str]] = {
    module_id: {"category": category, "label": MODULE_LABELS[module_id]}
    for module_id, category in _MODULE_CATEGORIES.items()
}


class TriggerRequest(BaseModel):
    module_ids: list[str]
    # "recheck" is the object page's Re-check now; both are a person's request, unlike a scheduled run.
    trigger: Literal["manual", "recheck"] = "manual"


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
    """Return every triggerable module with its latest analysis status."""
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


@router.post(
    "/trigger",
    response_model=TriggerResponse,
    dependencies=[Depends(require_permission("trigger_sync"))],
)
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
            await db.execute(
                text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                     "|| jsonb_build_object('trigger', CAST(:trig AS text), 'requested_by_label', CAST(:who AS text)) "
                     "WHERE id = :vid AND tenant_id = :tid"),
                {"trig": body.trigger, "who": current_user_label(), "vid": row.id, "tid": str(tenant_id)},
            )
            await db.commit()
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
