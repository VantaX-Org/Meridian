"""Database query functions for reports."""

import uuid
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.schema import Report


async def create_report(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    version_id: uuid.UUID,
    report_json: dict,
) -> Report:
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
    report = Report(
        tenant_id=tenant_id,
        version_id=version_id,
        report_json=report_json,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report


async def get_report_by_version(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    version_id: uuid.UUID,
) -> Optional[Report]:
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
    result = await db.execute(
        select(Report).where(
            Report.tenant_id == tenant_id,
            Report.version_id == version_id,
        )
    )
    return result.scalar_one_or_none()


async def update_report_pdf_path(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    version_id: uuid.UUID,
    pdf_path: str,
) -> Optional[Report]:
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
    result = await db.execute(
        select(Report).where(
            Report.tenant_id == tenant_id,
            Report.version_id == version_id,
        )
    )
    report = result.scalar_one_or_none()
    if report:
        report.pdf_path = pdf_path
        await db.commit()
        await db.refresh(report)
    return report
