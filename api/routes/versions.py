import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from db.schema import AnalysisVersion

router = APIRouter(prefix="/api/v1", tags=["versions"])
logger = logging.getLogger("meridian.versions")


class VersionResponse(BaseModel):
    id: str
    run_at: str
    label: Optional[str]
    status: str
    dqs_summary: Optional[dict]
    metadata: Optional[dict]


class PatchVersionRequest(BaseModel):
    label: str


def _version_to_response(v: AnalysisVersion) -> VersionResponse:
    return VersionResponse(
        id=str(v.id),
        run_at=v.run_at.isoformat() if v.run_at else "",
        label=v.label,
        status=v.status,
        dqs_summary=v.dqs_summary,
        metadata=v.metadata_,
    )


@router.get("/versions")
async def list_versions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    module: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})
    stmt = (
        select(AnalysisVersion)
        .where(AnalysisVersion.tenant_id == tenant.id)
        .order_by(AnalysisVersion.run_at.desc())
    )
    if module:
        # Filter by module in metadata JSON
        stmt = stmt.where(
            AnalysisVersion.metadata_.op("->>")("modules").contains(module)
        )
    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    versions = result.scalars().all()
    return {"versions": [_version_to_response(v) for v in versions]}


@router.get("/versions/compare")
async def compare_versions(
    v1: str = Query(...),
    v2: str = Query(...),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})

    vid1 = uuid.UUID(v1)
    vid2 = uuid.UUID(v2)

    r1 = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == vid1, AnalysisVersion.tenant_id == tenant.id
        )
    )
    r2 = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == vid2, AnalysisVersion.tenant_id == tenant.id
        )
    )

    ver1 = r1.scalar_one_or_none()
    ver2 = r2.scalar_one_or_none()

    if not ver1 or not ver2:
        raise HTTPException(status_code=404, detail="One or both versions not found")

    summary1 = ver1.dqs_summary or {}
    summary2 = ver2.dqs_summary or {}

    all_modules = set(list(summary1.keys()) + list(summary2.keys()))
    delta = {}
    for mod in all_modules:
        s1 = summary1.get(mod, {})
        s2 = summary2.get(mod, {})
        score1 = s1.get("composite_score", 0) if s1 else 0
        score2 = s2.get("composite_score", 0) if s2 else 0
        delta[mod] = {
            "dqs_change": round(score2 - score1, 2),
            "v1_score": score1,
            "v2_score": score2,
        }

    return {
        "v1": _version_to_response(ver1),
        "v2": _version_to_response(ver2),
        "delta": delta,
    }


@router.get("/versions/{version_id}")
async def get_version(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})
    vid = uuid.UUID(version_id)
    result = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == vid, AnalysisVersion.tenant_id == tenant.id
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    return _version_to_response(version)


@router.patch("/versions/{version_id}")
async def patch_version(
    version_id: str,
    body: PatchVersionRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})
    vid = uuid.UUID(version_id)
    result = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == vid, AnalysisVersion.tenant_id == tenant.id
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    version.label = body.label
    await db.commit()
    await db.refresh(version)
    return _version_to_response(version)


@router.get("/versions/{version_id}/status")
async def get_version_status(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})
    vid = uuid.UUID(version_id)
    result = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == vid, AnalysisVersion.tenant_id == tenant.id
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    return {
        "version_id": str(version.id),
        "status": version.status,
        "run_at": version.run_at.isoformat() if version.run_at else "",
        "metadata": version.metadata_,
    }
