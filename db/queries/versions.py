import uuid
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.queries import set_tenant_context
from db.schema import AnalysisVersion


async def create_version(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    metadata: dict,
    label: Optional[str] = None,
) -> AnalysisVersion:
    await set_tenant_context(db, tenant_id)
    version = AnalysisVersion(
        tenant_id=tenant_id, metadata_=metadata, label=label,
    )
    db.add(version)
    await db.commit()
    # The commit released the connection; the refresh may run on another one.
    await set_tenant_context(db, tenant_id)
    await db.refresh(version)
    return version


async def mark_version_failed(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    version_id: uuid.UUID,
    reason: str,
) -> None:
    """Set a version to ``failed`` and record why in ``metadata.error``, so it never
    lingers as ``pending`` with no job behind it."""
    await set_tenant_context(db, tenant_id)
    await db.execute(
        text("""
            UPDATE analysis_versions
               SET status = 'failed',
                   metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('error', CAST(:reason AS text))
             WHERE id = :vid AND tenant_id = :tid
        """),
        {"reason": reason[:500], "vid": version_id, "tid": tenant_id},
    )
    await db.commit()


async def get_version(
    db: AsyncSession, tenant_id: uuid.UUID, version_id: uuid.UUID
) -> Optional[AnalysisVersion]:
    await set_tenant_context(db, tenant_id)
    result = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == version_id,
            AnalysisVersion.tenant_id == tenant_id,
        )
    )
    return result.scalar_one_or_none()


async def update_version_status(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    version_id: uuid.UUID,
    status: str,
) -> Optional[AnalysisVersion]:
    await set_tenant_context(db, tenant_id)
    result = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == version_id,
            AnalysisVersion.tenant_id == tenant_id,
        )
    )
    version = result.scalar_one_or_none()
    if version:
        version.status = status
        await db.commit()
        await set_tenant_context(db, tenant_id)
        await db.refresh(version)
    return version
