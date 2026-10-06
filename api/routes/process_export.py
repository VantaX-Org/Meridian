"""Signavio (BPMN 2.0) export of a process model: GET /api/v1/process-designer/.../export/signavio.

Read-only. GET is not covered by the audit middleware, so each export writes its own audit row.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.audit import _insert_audit_row
from api.models.process_model import ProcessModelDocument
from api.routes.process_designer import _document, _invalid, _model, _rls, _uuid
from api.services.bpmn_export import BpmnExportError, export_zip, slug
from api.services.process_model_validator import validate_document
from api.services.rbac import require_permission
from sap.process_definitions import reference_document

logger = logging.getLogger("meridian.process_export")
router = APIRouter(prefix="/api/v1/process-designer", tags=["process-designer"])


async def _overlay(db: AsyncSession, tenant: Tenant, doc: ProcessModelDocument,
                   overlay: Optional[str]) -> Optional[dict[str, Any]]:
    """Aggregate DQ per activity for an analysed dataset version (same colouring as the designer overlay)."""
    if not overlay or overlay == "none":
        return None
    from api.services.process_writer import activity_statuses

    vid = _uuid(overlay)
    await _rls(db, tenant)
    rows = await db.execute(
        text("SELECT check_id, pass_rate, affected_count, severity, details->>'message' FROM findings "
             "WHERE version_id = :vid AND tenant_id = :tid"), {"vid": vid, "tid": str(tenant.id)})
    findings = {r[0]: {"pass_rate": float(r[1]) if r[1] is not None else None, "affected_count": r[2],
                       "severity": r[3], "message": r[4] or ""} for r in rows.fetchall()}
    acts = activity_statuses(doc, findings, {}, [])
    for l4 in doc.all_l4():
        for a in l4.activities:
            acts[a.id]["check_ids"] = [c for c in a.check_ids if c in findings]
    return {"version_id": str(vid), "activities": acts}


async def _respond(request: Request, tenant: Tenant, doc: ProcessModelDocument, name: str, version_no: int,
                   model_id: Optional[uuid.UUID], overlay: Optional[dict[str, Any]]) -> Response:
    result = validate_document(doc)
    if result.errors:
        return _invalid(result.errors)
    meta = {"model_id": str(model_id) if model_id else None, "name": name, "version_no": version_no,
            "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "app_version": request.app.version}
    try:
        data = export_zip(doc, overlay, meta)
    except BpmnExportError as e:
        logger.error("BPMN export failed validation: %s", e.errors)
        return JSONResponse(status_code=500, content={"detail": "Export failed validation"})
    fname = f"{slug(name)}-v{version_no}-bpmn.zip"
    await asyncio.to_thread(_insert_audit_row, {
        "tenant_id": tenant.id,
        "actor_user_id": getattr(request.state, "local_user_id", None),
        "actor_email": getattr(request.state, "local_user_email", None),
        "action": "export", "entity_type": "process_model", "entity_id": str(model_id) if model_id else None,
        "method": "GET", "path": request.url.path, "status_code": 200,
        "ip": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
        "before_json": {"format": "signavio-bpmn", "version": version_no,
                        "overlay_version_id": (overlay or {}).get("version_id")},
        "after_json": None})
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/reference/export/signavio", dependencies=[Depends(require_permission("view"))])
async def export_reference(request: Request, overlay: Optional[str] = None, db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant)):
    doc = reference_document()
    return await _respond(request, tenant, doc, "reference", 0, None, await _overlay(db, tenant, doc, overlay))


@router.get("/models/{model_id}/export/signavio", dependencies=[Depends(require_permission("view"))])
async def export_model(model_id: uuid.UUID, request: Request, version: Optional[int] = Query(None, ge=1),
                       overlay: Optional[str] = None, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)):
    model = await _model(db, tenant, model_id)  # 404 for another tenant's model
    vno = version or model["current_version"]
    doc = await _document(db, tenant, model_id, vno)  # 404 for an unknown version
    return await _respond(request, tenant, doc, model["name"], vno, model_id, await _overlay(db, tenant, doc, overlay))
