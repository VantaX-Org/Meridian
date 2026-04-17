"""Routes for report download."""

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.report_pdf import (
    ReportNotAssembled,
    build_and_store_pdf,
)
from api.services.storage import download_file
from api.config import settings
from db.schema import Report

router = APIRouter(prefix="/api/v1", tags=["reports"])
logger = logging.getLogger("meridian.reports")


async def _regenerate_pdf(version_id: str, tenant_id: str) -> bytes:
    """Run the sync PDF builder in a worker thread so we don't block the loop."""
    return (
        await asyncio.to_thread(build_and_store_pdf, version_id, str(tenant_id))
    )[0]


@router.get("/reports/{version_id}/download")
async def download_report(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Stream the PDF report from MinIO.

    Self-healing: if the row has no ``pdf_path`` or the MinIO object is
    missing, the PDF is rebuilt on the fly from the stored ``report_json``
    using the same code path as the background worker. This covers the case
    where the Celery ``generate_pdf`` task failed silently after the agent
    pipeline completed.
    """
    await db.execute(text(f"SET app.tenant_id TO '{tenant.id}'"))
    vid = uuid.UUID(version_id)

    result = await db.execute(
        select(Report).where(
            Report.tenant_id == tenant.id,
            Report.version_id == vid,
        )
    )
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(
            status_code=404,
            detail=(
                "No report has been assembled for this version. "
                "The analysis pipeline must complete successfully before a report can be downloaded."
            ),
        )

    pdf_bytes: bytes | None = None

    # Fast path: MinIO already has the PDF produced by the worker
    if report.pdf_path:
        try:
            pdf_bytes = download_file(settings.minio_bucket_reports, report.pdf_path)
        except Exception as e:
            logger.warning(
                f"PDF missing from MinIO for version {version_id} (pdf_path={report.pdf_path}): {e}. "
                "Falling back to on-demand regeneration."
            )
            pdf_bytes = None

    # Self-heal path: the reports row exists but no usable PDF is in storage yet.
    if pdf_bytes is None:
        logger.info(
            f"Regenerating PDF on demand for version {version_id} "
            f"(pdf_path={'set' if report.pdf_path else 'null'})"
        )
        try:
            pdf_bytes = await _regenerate_pdf(version_id, tenant.id)
        except ReportNotAssembled as e:
            logger.error(f"Cannot regenerate PDF for version {version_id}: {e}")
            raise HTTPException(
                status_code=404,
                detail=(
                    "Report data for this version is incomplete — the agent pipeline "
                    "did not persist a report. Please re-run the analysis."
                ),
            ) from e
        except Exception as e:
            logger.exception(
                f"On-demand PDF regeneration failed for version {version_id}: {e}"
            )
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate PDF report: {e.__class__.__name__}",
            ) from e

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="meridian_dq_report_{version_id}.pdf"'
            )
        },
    )


@router.get("/reports/{version_id}/export.json")
async def export_report_json(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Download the assembled report payload as JSON.

    This is the reliable export path: it bypasses template rendering,
    WeasyPrint, and MinIO entirely, so it works whenever the agent pipeline
    has persisted ``report_json`` for the version — even in environments
    where PDF generation is broken.
    """
    await db.execute(text(f"SET app.tenant_id TO '{tenant.id}'"))
    vid = uuid.UUID(version_id)

    result = await db.execute(
        select(Report).where(
            Report.tenant_id == tenant.id,
            Report.version_id == vid,
        )
    )
    report = result.scalar_one_or_none()

    if not report or not report.report_json:
        raise HTTPException(
            status_code=404,
            detail=(
                "No assembled report is available for this version. "
                "Re-run the analysis to regenerate the report."
            ),
        )

    body = json.dumps(report.report_json, indent=2, default=str).encode()
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": (
                f'attachment; filename="meridian_dq_report_{version_id}.json"'
            )
        },
    )
