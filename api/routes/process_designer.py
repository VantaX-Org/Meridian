"""Process designer API: versioned process models (L1-L5 + BPMN diagrams) and discovered variants.

Writes are audited by api.middleware.audit (POST/PUT/PATCH/DELETE under /api/v1). Every query
carries tenant_id and the tables have RLS.
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.models.process_model import ProcessModelDocument, VariantRef
from api.services.process_model_validator import Issue, validate_document
from api.services.rbac import current_user_label, require_permission
from sap.process_definitions import reference_document

router = APIRouter(prefix="/api/v1/process-designer", tags=["process-designer"])

_VARIANT_COLS = ("id::text AS id, version_id::text AS version_id, process_id, l4_id, sap_table, sap_field, value, "
                 "doc_count, first_seen::text AS first_seen, last_seen::text AS last_seen, classification, "
                 "config_table, evidence")


class ModelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    from_: str = Field("reference", alias="from")  # "reference" or a model id


class ModelSave(BaseModel):
    document: ProcessModelDocument
    note: Optional[str] = Field(None, max_length=500)
    base_version: int


class ModelPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    status: Optional[Literal["draft", "published"]] = None


class AdoptVariant(BaseModel):
    variant_id: uuid.UUID
    l4_id: str


async def _rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})


def _model_row(r: Any) -> dict[str, Any]:
    d = dict(r._mapping)
    d["id"] = str(d["id"])
    for k in ("created_at", "updated_at"):
        if d.get(k):
            d[k] = d[k].isoformat()
    return d


async def _model(db: AsyncSession, tenant: Tenant, model_id: uuid.UUID, lock: bool = False) -> dict[str, Any]:
    await _rls(db, tenant)
    row = (await db.execute(
        text("SELECT id, name, status, current_version, created_by, created_at, updated_at FROM process_models "
             "WHERE id = :id AND tenant_id = :tid" + (" FOR UPDATE" if lock else "")),
        {"id": model_id, "tid": str(tenant.id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    return _model_row(row)


async def _add_version(db: AsyncSession, tenant: Tenant, model_id: uuid.UUID, version_no: int,
                       doc: ProcessModelDocument, note: Optional[str]) -> None:
    await db.execute(
        text("INSERT INTO process_model_versions (tenant_id, model_id, version_no, document, note, created_by) "
             "VALUES (:tid, :mid, :v, CAST(:doc AS jsonb), :note, :by)"),
        {"tid": str(tenant.id), "mid": model_id, "v": version_no, "doc": doc.model_dump_json(),
         "note": note, "by": current_user_label()})
    await db.execute(
        text("UPDATE process_models SET current_version = :v, updated_at = now() "
             "WHERE id = :mid AND tenant_id = :tid"),
        {"v": version_no, "mid": model_id, "tid": str(tenant.id)})


async def _document(db: AsyncSession, tenant: Tenant, model_id: uuid.UUID, version_no: int) -> ProcessModelDocument:
    row = (await db.execute(
        text("SELECT document FROM process_model_versions WHERE model_id = :mid AND tenant_id = :tid "
             "AND version_no = :v"), {"mid": model_id, "tid": str(tenant.id), "v": version_no})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    doc = row[0]
    return ProcessModelDocument.model_validate(json.loads(doc) if isinstance(doc, str) else doc)


def _invalid(errors: list[Issue]) -> JSONResponse:
    return JSONResponse(status_code=422, content={"errors": [e.model_dump() for e in errors]})


async def _reference(db: AsyncSession, tenant: Tenant, version_id: Optional[str] = None) -> ProcessModelDocument:
    """The model derived from the tenant's extracted configuration (latest, or the given dataset version);
    the shipped template when nothing was derived."""
    await _rls(db, tenant)
    sql = "SELECT document FROM process_derivations WHERE tenant_id = :tid"
    args: dict[str, Any] = {"tid": str(tenant.id)}
    if version_id:
        sql += " AND version_id = :vid"
        args["vid"] = _uuid(version_id)
    row = (await db.execute(text(sql + " ORDER BY created_at DESC LIMIT 1"), args)).fetchone()
    if row is None:
        return reference_document()
    return ProcessModelDocument.model_validate(row[0])


@router.get("/reference", response_model=ProcessModelDocument, dependencies=[Depends(require_permission("view"))])
async def get_reference(version_id: Optional[str] = None, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)) -> ProcessModelDocument:
    """Derived model (source "config", per-node evidence) when config was extracted, else the template."""
    return await _reference(db, tenant, version_id)


@router.get("/models", dependencies=[Depends(require_permission("view"))])
async def list_models(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    rows = await db.execute(
        text("SELECT id, name, status, current_version, updated_at FROM process_models "
             "WHERE tenant_id = :tid ORDER BY updated_at DESC, name"), {"tid": str(tenant.id)})
    return [_model_row(r) for r in rows.fetchall()]


@router.post("/models", status_code=201, dependencies=[Depends(require_permission("analyse"))])
async def create_model(body: ModelCreate, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required")
    await _rls(db, tenant)
    if body.from_ == "reference":
        doc = await _reference(db, tenant)
    else:
        try:
            src = uuid.UUID(body.from_)
        except ValueError:
            raise HTTPException(status_code=422, detail="from must be 'reference' or a model id")
        src_model = await _model(db, tenant, src)
        doc = await _document(db, tenant, src, src_model["current_version"])
    taken = (await db.execute(text("SELECT 1 FROM process_models WHERE tenant_id = :tid AND name = :n"),
                              {"tid": str(tenant.id), "n": name})).fetchone()
    if taken:
        raise HTTPException(status_code=409, detail="A model with this name exists")
    mid = uuid.uuid4()
    await db.execute(text("INSERT INTO process_models (id, tenant_id, name, created_by) VALUES (:id, :tid, :n, :by)"),
                     {"id": mid, "tid": str(tenant.id), "n": name, "by": current_user_label()})
    await _add_version(db, tenant, mid, 1, doc, "Created from " + ("reference" if body.from_ == "reference"
                                                                    else "model " + body.from_))
    await db.commit()
    return {"model": await _model(db, tenant, mid), "version_no": 1}


@router.get("/models/{model_id}", dependencies=[Depends(require_permission("view"))])
async def get_model(model_id: uuid.UUID, version: Optional[int] = Query(None, ge=1),
                    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    model = await _model(db, tenant, model_id)
    vno = version or model["current_version"]
    return {"model": model, "version_no": vno, "document": await _document(db, tenant, model_id, vno)}


@router.put("/models/{model_id}", dependencies=[Depends(require_permission("analyse"))])
async def save_model(model_id: uuid.UUID, body: ModelSave, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)):
    """New version. 409 when ``base_version`` is stale, 422 with ``errors[{path,message}]`` when invalid."""
    model = await _model(db, tenant, model_id, lock=True)
    if body.base_version != model["current_version"]:
        raise HTTPException(status_code=409, detail={"message": "The model changed since you loaded it",
                                                     "current_version": model["current_version"]})
    result = validate_document(body.document)
    if result.errors:
        return _invalid(result.errors)
    vno = model["current_version"] + 1
    await _add_version(db, tenant, model_id, vno, body.document, body.note)
    await db.commit()
    return {"model": await _model(db, tenant, model_id), "version_no": vno,
            "warnings": [w.model_dump() for w in result.warnings]}


@router.patch("/models/{model_id}", dependencies=[Depends(require_permission("analyse"))])
async def patch_model(model_id: uuid.UUID, body: ModelPatch, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)):
    await _model(db, tenant, model_id)
    name = body.name.strip() if body.name else None
    if name:
        clash = (await db.execute(
            text("SELECT 1 FROM process_models WHERE tenant_id = :tid AND name = :n AND id <> :id"),
            {"tid": str(tenant.id), "n": name, "id": model_id})).fetchone()
        if clash:
            raise HTTPException(status_code=409, detail="A model with this name exists")
    await db.execute(
        text("UPDATE process_models SET name = COALESCE(:n, name), status = COALESCE(:s, status), "
             "updated_at = now() WHERE id = :id AND tenant_id = :tid"),
        {"n": name, "s": body.status, "id": model_id, "tid": str(tenant.id)})
    await db.commit()
    return await _model(db, tenant, model_id)


@router.delete("/models/{model_id}", status_code=204, dependencies=[Depends(require_permission("analyse"))])
async def delete_model(model_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _model(db, tenant, model_id)
    await db.execute(text("DELETE FROM process_models WHERE id = :id AND tenant_id = :tid"),
                     {"id": model_id, "tid": str(tenant.id)})
    await db.commit()
    return Response(status_code=204)


@router.get("/models/{model_id}/versions", dependencies=[Depends(require_permission("view"))])
async def list_versions(model_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)):
    await _model(db, tenant, model_id)
    rows = await db.execute(
        text("SELECT version_no, note, created_by, created_at FROM process_model_versions "
             "WHERE model_id = :id AND tenant_id = :tid ORDER BY version_no DESC"),
        {"id": model_id, "tid": str(tenant.id)})
    return [{**dict(r._mapping), "created_at": r.created_at.isoformat() if r.created_at else None}
            for r in rows.fetchall()]


async def _variants(db: AsyncSession, tenant: Tenant, version_id: str, process_id: Optional[str] = None) -> list[dict]:
    q = f"SELECT {_VARIANT_COLS} FROM process_variants WHERE tenant_id = :tid AND version_id = :vid"
    p: dict[str, Any] = {"tid": str(tenant.id), "vid": version_id}
    if process_id:
        q += " AND process_id = :pid"
        p["pid"] = process_id
    rows = await db.execute(text(q + " ORDER BY process_id, sap_table, sap_field, (value = '*') DESC, value"), p)
    return [dict(r._mapping) for r in rows.fetchall()]


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid version id")


@router.get("/variants/{version_id}", dependencies=[Depends(require_permission("view"))])
async def list_variants(version_id: str, process_id: Optional[str] = None, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)):
    _uuid(version_id)
    await _rls(db, tenant)
    return await _variants(db, tenant, version_id, process_id)


@router.get("/models/{model_id}/overlay/{version_id}", dependencies=[Depends(require_permission("view"))])
async def overlay(model_id: uuid.UUID, version_id: str, db: AsyncSession = Depends(get_db),
                  tenant: Tenant = Depends(get_tenant)):
    """DQ colouring per L5 and per L4 for an analysed dataset version, plus its discovered variants."""
    from api.services.process_writer import _worst_status, activity_statuses

    vid = _uuid(version_id)
    model = await _model(db, tenant, model_id)
    doc = await _document(db, tenant, model_id, model["current_version"])
    rows = await db.execute(
        text("SELECT check_id, pass_rate, affected_count, severity, details->>'message' FROM findings "
             "WHERE version_id = :vid AND tenant_id = :tid"), {"vid": vid, "tid": str(tenant.id)})
    findings = {r[0]: {"pass_rate": float(r[1]) if r[1] is not None else None, "affected_count": r[2],
                       "severity": r[3], "message": r[4] or ""} for r in rows.fetchall()}
    activities = activity_statuses(doc, findings, {}, [])
    variants = await _variants(db, tenant, version_id)
    per_l4: dict[str, int] = {}
    for v in variants:
        if v["l4_id"] and v["value"] != "*":
            per_l4[v["l4_id"]] = per_l4.get(v["l4_id"], 0) + 1
    l4: dict[str, dict[str, Any]] = {}
    for node in doc.all_l4():
        status = "green"
        for a in node.activities:
            status = _worst_status(status, activities.get(a.id, {}).get("dq_status", "green"))
        l4[node.id] = {"step_status": status, "variants": per_l4.get(node.id, 0)}
    return {"activities": activities, "l4": l4, "variants": variants}


@router.post("/models/{model_id}/adopt-variant", dependencies=[Depends(require_permission("analyse"))])
async def adopt_variant(model_id: uuid.UUID, body: AdoptVariant, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)):
    """Attach a discovered variant to an L4 as a new model version and record the mapping on the variant."""
    model = await _model(db, tenant, model_id, lock=True)
    doc = await _document(db, tenant, model_id, model["current_version"])
    target = next((n for n in doc.all_l4() if n.id == body.l4_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="L4 not found in this model")
    row = (await db.execute(
        text(f"SELECT {_VARIANT_COLS} FROM process_variants WHERE id = :id AND tenant_id = :tid"),
        {"id": body.variant_id, "tid": str(tenant.id)})).fetchone()
    if not row or row.value == "*":
        raise HTTPException(status_code=404, detail="Variant not found")
    ref = VariantRef(sap_table=row.sap_table, sap_field=row.sap_field, value=row.value,
                     classification=row.classification)
    target.variants = [v for v in target.variants
                       if (v.sap_table, v.sap_field, v.value) != (ref.sap_table, ref.sap_field, ref.value)] + [ref]
    await db.execute(text("UPDATE process_variants SET l4_id = :l4 WHERE id = :id AND tenant_id = :tid"),
                     {"l4": body.l4_id, "id": body.variant_id, "tid": str(tenant.id)})
    vno = model["current_version"] + 1
    await _add_version(db, tenant, model_id, vno, doc,
                       f"Adopted {ref.sap_table}.{ref.sap_field}={ref.value} into {body.l4_id}")
    await db.commit()
    return {"model": await _model(db, tenant, model_id), "version_no": vno}
