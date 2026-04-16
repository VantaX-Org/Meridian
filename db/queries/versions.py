import uuid
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.schema import AnalysisVersion


async def create_version(
    db: AsyncSession, tenant_id: uuid.UUID, metadata: dict
) -> AnalysisVersion:
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    version = AnalysisVersion(tenant_id=tenant_id, metadata_=metadata)
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return version


async def get_version(
    db: AsyncSession, tenant_id: uuid.UUID, version_id: uuid.UUID
) -> Optional[AnalysisVersion]:
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
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
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
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
        await db.refresh(version)
    return version
