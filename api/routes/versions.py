import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.services.rbac import require_permission
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
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
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
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

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


async def _scope_of(db: AsyncSession, vid: uuid.UUID) -> Optional[str]:
    row = (await db.execute(text("SELECT COALESCE(metadata->>'system_id', 'upload') FROM analysis_versions "
                                 "WHERE id = :v"), {"v": vid})).fetchone()
    return row[0] if row else None


async def _resolve_pair(db: AsyncSession, v1: Optional[str], v2: str) -> tuple[uuid.UUID, uuid.UUID]:
    """v1 defaults to the pinned baseline of v2's lineage, else the previous complete run."""
    vid2 = uuid.UUID(v2)
    scope = await _scope_of(db, vid2)
    if scope is None:
        raise HTTPException(status_code=404, detail="Version not found")
    if v1:
        vid1 = uuid.UUID(v1)
        if await _scope_of(db, vid1) is None:
            raise HTTPException(status_code=404, detail="Version not found")
        return vid1, vid2
    row = (await db.execute(text("""
        SELECT id FROM analysis_versions
         WHERE COALESCE(metadata->>'system_id', 'upload') = :scope AND id <> :v2 AND status = 'complete'
           AND run_at <= (SELECT run_at FROM analysis_versions WHERE id = :v2)
         ORDER BY (metadata->>'baseline') = 'true' DESC NULLS LAST, run_at DESC LIMIT 1
    """), {"scope": scope, "v2": vid2})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No earlier run of this system to compare with.")
    return row[0], vid2


@router.get("/versions/compare/records")
async def compare_records(
    v2: str = Query(...),
    v1: Optional[str] = Query(None, description="Default: pinned baseline, else the previous run"),
    module: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Per check: records newly failing, no longer failing, and still failing between two runs.

    ``comparable`` is false when the check did not run cleanly in both runs
    (skipped / errored) or a key list was truncated — those deltas are not
    conclusions about the data.
    """
    from api.services.record_issues import DIFF_SQL

    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid1, vid2 = await _resolve_pair(db, v1, v2)
    rows = (await db.execute(text(DIFF_SQL), {"v1": vid1, "v2": vid2})).fetchall()
    checks = []
    for r in rows:
        if module and r.module != module:
            continue
        checks.append({
            "check_id": r.check_id, "module": r.module, "severity": r.severity,
            "new": r.new, "resolved": r.resolved, "persisting": r.persisting,
            "comparable": bool(r.ran_v1 and r.ran_v2 and not r.truncated),
        })
    checks.sort(key=lambda c: (-c["new"], -c["persisting"], c["check_id"]))
    comparable = [c for c in checks if c["comparable"]]
    return {
        "v1": str(vid1), "v2": str(vid2),
        "totals": {k: sum(c[k] for c in comparable) for k in ("new", "resolved", "persisting")},
        "checks": checks,
    }


@router.get("/versions/compare/records/{check_id}")
async def compare_records_list(
    check_id: str,
    v2: str = Query(...),
    v1: Optional[str] = Query(None),
    change: str = Query("new", pattern="^(new|resolved|persisting)$"),
    search: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    from api.services.record_issues import diff_records_sql

    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid1, vid2 = await _resolve_pair(db, v1, v2)
    rows = await db.execute(text(diff_records_sql(change)), {
        "v1": vid1, "v2": vid2, "cid": check_id, "q": f"%{search}%" if search else None,
        "limit": limit, "offset": offset})
    return {"v1": str(vid1), "v2": str(vid2), "change": change, "record_keys": [r[0] for r in rows]}


@router.post("/versions/{version_id}/baseline", dependencies=[Depends(require_permission("analyse"))])
async def pin_baseline(
    version_id: str,
    pinned: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Pin (or unpin) a run as the comparison baseline for its system; one baseline per system."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid = uuid.UUID(version_id)
    scope = await _scope_of(db, vid)
    if scope is None:
        raise HTTPException(status_code=404, detail="Version not found")
    await db.execute(text("""
        UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) - 'baseline'
         WHERE COALESCE(metadata->>'system_id', 'upload') = :scope AND metadata ? 'baseline'
    """), {"scope": scope})
    if pinned:
        await db.execute(text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                              "|| '{\"baseline\": true}'::jsonb WHERE id = :v"), {"v": vid})
    await db.commit()
    return {"version_id": version_id, "baseline": pinned, "scope": scope}


@router.get("/versions/{version_id}")
async def get_version(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
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


@router.patch("/versions/{version_id}", dependencies=[Depends(require_permission("analyse"))])
async def patch_version(
    version_id: str,
    body: PatchVersionRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
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
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
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
