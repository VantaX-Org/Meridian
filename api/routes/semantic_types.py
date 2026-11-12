"""Semantic types and trust score for an uploaded run or a run from an external database.

GET /api/v1/versions/{version_id}/semantic-types           columns with detected type, confidence, the type in
                                                           force and its conformance; trust score with its parts;
                                                           rules suggested from confirmed types (view)
PUT /api/v1/versions/{version_id}/semantic-types/{column}  confirm or override a column's type, or "none" (upload,
                                                           audited)

The profile was computed at upload from the file itself and holds shares only, never values.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import semantic_types as st
from api.services.rbac import current_user_id, require_permission, write_audit
from api.routes.findings import _scoring_raw

router = APIRouter(prefix="/api/v1", tags=["semantic-types"])
_VERSION = text("SELECT run_at, metadata, dqs_summary FROM analysis_versions WHERE tenant_id = :t AND id = :v")
_OVERRIDES = text("SELECT column_name, semantic_type FROM semantic_type_overrides WHERE tenant_id = :t AND version_id = :v")
_UPSERT = text("""
INSERT INTO semantic_type_overrides (tenant_id, version_id, column_name, semantic_type, confirmed_by)
VALUES (:t, :v, :c, :s, :u)
ON CONFLICT (tenant_id, version_id, column_name)
DO UPDATE SET semantic_type = EXCLUDED.semantic_type, confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now()
""")


async def _load(db: AsyncSession, tenant: Tenant, version_id: uuid.UUID) -> tuple[dict, dict[str, str]]:
    await _rls(db, tenant)
    p = {"t": str(tenant.id), "v": str(version_id)}
    row = (await db.execute(_VERSION, p)).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "detail": "No such run."})
    overrides = {r["column_name"]: r["semantic_type"] for r in (await db.execute(_OVERRIDES, p)).mappings().all()}
    return dict(row), overrides


@router.get("/versions/{version_id}/semantic-types", dependencies=[Depends(require_permission("view"))])
async def get_semantic_types(version_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                             tenant: Tenant = Depends(get_tenant)) -> dict:
    row, overrides = await _load(db, tenant, version_id)
    meta = row["metadata"] or {}
    prof = meta.get("semantic_profile") or {}
    cols = st.resolve(prof.get("columns") or [], overrides)
    parts = {"dqs": st.dqs_of(row["dqs_summary"], await _scoring_raw(db, tenant)), "conformance": st.conformance_of(cols),
             "freshness": st.freshness(row["run_at"]),
             "completeness": round(100 * prof["completeness"], 1) if prof.get("completeness") is not None else None}
    return {"profiled": bool(prof), "source": meta.get("source"), "origin": meta.get("origin") or "file",
            "rows_sampled": prof.get("rows_sampled"), "columns": cols, "types": list(st.TYPES),
            "trust": {"score": st.trust_score(parts), "parts": parts, "weights": st.WEIGHTS},
            "suggested_rules": st.suggested_rules(cols)}


class TypeIn(BaseModel):
    type: str


@router.put("/versions/{version_id}/semantic-types/{column}", dependencies=[Depends(require_permission("upload"))])
async def put_semantic_type(version_id: uuid.UUID, column: str, body: TypeIn, request: Request,
                            db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    if body.type not in (*st.TYPES, "none"):
        raise HTTPException(status_code=422, detail={"error": "unknown_type", "detail": "Unknown semantic type."})
    row, overrides = await _load(db, tenant, version_id)
    known = {c["column"] for c in ((row["metadata"] or {}).get("semantic_profile") or {}).get("columns") or []}
    if column not in known:
        raise HTTPException(status_code=404, detail={"error": "not_found", "detail": "No such column in this run."})
    await db.execute(_UPSERT, {"t": str(tenant.id), "v": str(version_id), "c": column, "s": body.type,
                               "u": current_user_id(request)})
    await write_audit(db, tenant.id, request, "semantic_type_set", "semantic_type_overrides",
                      f"{version_id}:{column}", {"type": overrides.get(column)}, {"type": body.type})
    await db.commit()
    return {"column": column, "type": body.type}
