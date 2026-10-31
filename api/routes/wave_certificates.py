"""Readiness certificates of a migration wave (api/services/readiness_certificate.py).

POST /api/v1/migration/waves/{wave_id}/certificate                    issue the next version (an owner or a lead)
GET  /api/v1/migration/waves/{wave_id}/certificate                    every version, its signatures, who must sign
POST /api/v1/migration/waves/{wave_id}/certificate/{cert_id}/sign     an owner signs (user, time, statement)
GET  /api/v1/migration/waves/{wave_id}/certificate/{cert_id}/pdf      the certificate PDF

Issuing refuses with 409 while any object of the wave has a critical rule over tolerance or was never measured; the
body lists the reasons (``reasons``: object, reason, rules, links). Once issued, the owners who must sign are told.
Every write is audited (audit_log) and runs under the tenant's row-level security.
"""
from __future__ import annotations

import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import readiness_certificate as rc
from api.services import webhooks
from api.services.rbac import (
    current_user_id,
    current_user_label,
    require_permission,
    scope_from_path,
    write_audit,
)

router = APIRouter(prefix="/api/v1/migration", tags=["readiness-certificates"])


class SignBody(BaseModel):
    statement: str | None = Field(None, max_length=2000)


async def _wave(db: AsyncSession, tenant: Tenant, wave_id: uuid.UUID):
    from api.routes.migration import _load_wave

    await _rls(db, tenant)
    return await _load_wave(db, tenant.id, wave_id)


async def _signers(db: AsyncSession, tenant: Tenant, wave) -> dict[str, dict]:
    return await rc.owners_of(db, str(tenant.id), list(wave.modules or []))


@router.post("/waves/{wave_id}/certificate", status_code=201)
async def issue_certificate(wave_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant),
                            role: str = Depends(require_permission("view", scope=scope_from_path))) -> dict:
    """Issue the wave's next readiness certificate: content, SHA-256, PDF in the report history."""
    from api.services import pdf_reports
    from api.services.report_history import store_report_file

    wave = await _wave(db, tenant, wave_id)
    uid = current_user_id(request)
    owners = await _signers(db, tenant, wave)
    if role not in rc.LEAD_ROLES and (uid is None or uid not in owners):
        raise HTTPException(status_code=403, detail="Only an owner of the wave's objects or a programme lead can "
                                                    "issue its certificate.")
    t = str(tenant.id)
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"wave-cert:{wave_id}"})
    version = int((await db.execute(text("SELECT COALESCE(max(version), 0) + 1 FROM wave_certificates "
                                         "WHERE tenant_id = :t AND wave_id = :w"), {"t": t, "w": str(wave_id)})).scalar())
    try:
        content = await rc.build(db, t, wave, tenant.name, version, current_user_label())
    except rc.GateRefused as e:
        raise HTTPException(status_code=409, detail=rc.refusal(e.reasons))
    sha = rc.content_hash(content)
    pdf = await asyncio.to_thread(pdf_reports.render, "readiness_certificate.html", rc.pdf_context(content, sha))
    file_name = f"readiness_certificate_{wave.name.replace(' ', '_')}_v{version}.pdf"
    file_id = await db.run_sync(lambda s: store_report_file(
        s, t, kind=rc.KIND, data=pdf, file_name=file_name, content_type="application/pdf",
        params={"wave_id": str(wave_id), "version": version, "certificate_id": content["certificate_id"]},
        created_by=uid, created_by_email=current_user_label(), name=f"Readiness certificate: {wave.name} v{version}"))
    await db.execute(text("""
        INSERT INTO wave_certificates (id, tenant_id, wave_id, version, content, content_sha256, report_file_id,
                                       created_by, created_by_label)
        VALUES (CAST(:id AS uuid), :t, :w, :v, CAST(:c AS jsonb), :sha, CAST(:f AS uuid), CAST(:u AS uuid), :l)"""),
        {"id": content["certificate_id"], "t": t, "w": str(wave_id), "v": version, "c": json.dumps(content, default=str),
         "sha": sha, "f": file_id, "u": uid, "l": current_user_label()})
    await write_audit(db, tenant.id, request, "certificate_issued", "wave_certificate", content["certificate_id"], None,
                      {"wave_id": str(wave_id), "version": version, "sha256": sha,
                       "runs": [m["run_id"] for m in content["measured_on"]]})
    # the owners who must sign are told it waits for them (inbox and email), once per certificate
    from api.services import app_links, handoff_notices
    mails = await db.run_sync(lambda s: handoff_notices.notify(
        s, t, list(owners), type_="approval", title=f"Readiness certificate of {wave.name} v{version} waits for your "
                                                    "signature",
        body=f"{current_user_label() or 'A programme lead'} issued version {version} of the readiness certificate of "
             f"{wave.name}. Sign it for your objects.",
        link=app_links.opened(app_links.LANDSCAPE + "?view=waves", "certificate", str(wave_id)),
        key=f"certificate:{content['certificate_id']}", skip=[uid], button="Open the certificate"))
    await db.commit()
    handoff_notices.dispatch(mails)
    return {"id": content["certificate_id"], "wave_id": str(wave_id), "version": version, "status": "issued",
            "sha256": sha, "report_file_id": file_id, "measured_on": content["measured_on"],
            "required_signers": [{"user_id": k, **v} for k, v in owners.items()]}


@router.get("/waves/{wave_id}/certificate")
async def list_certificates(wave_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                            _role: str = Depends(require_permission("view", scope=scope_from_path))) -> dict:
    wave = await _wave(db, tenant, wave_id)
    owners = await _signers(db, tenant, wave)
    return {"wave_id": str(wave_id), "required_signers": [{"user_id": k, **v} for k, v in owners.items()],
            "versions": await rc.certificates(db, str(tenant.id), str(wave_id))}


@router.post("/waves/{wave_id}/certificate/{cert_id}/sign")
async def sign_certificate(wave_id: uuid.UUID, cert_id: uuid.UUID, body: SignBody, request: Request,
                           db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                           role: str = Depends(require_permission("view", scope=scope_from_path))) -> dict:
    """An owner of the wave's objects signs one version. A wave without owners is signed by a programme lead."""
    wave = await _wave(db, tenant, wave_id)
    t, uid = str(tenant.id), current_user_id(request)
    cert = (await db.execute(text("SELECT id, version, status, content_sha256 FROM wave_certificates "
                                  "WHERE id = :c AND wave_id = :w AND tenant_id = :t"),
                             {"c": str(cert_id), "w": str(wave_id), "t": t})).fetchone()
    if cert is None:
        raise HTTPException(status_code=404, detail="Certificate not found.")
    owners = await _signers(db, tenant, wave)
    may = (uid in owners) if owners else (role in rc.LEAD_ROLES)
    if uid is None or not may:
        raise HTTPException(status_code=403, detail="Only an owner of the wave's objects can sign its certificate.")
    statement = (body.statement or "").strip() or rc.DEFAULT_STATEMENT
    res = await db.execute(text("""
        INSERT INTO wave_certificate_signatures (tenant_id, certificate_id, user_id, user_label, statement)
        VALUES (:t, :c, CAST(:u AS uuid), :l, :s) ON CONFLICT (certificate_id, user_id) DO NOTHING RETURNING id"""),
        {"t": t, "c": str(cert_id), "u": uid, "l": current_user_label(), "s": statement})
    if res.fetchone() is None:
        raise HTTPException(status_code=409, detail="You have already signed this certificate.")
    signed = {r[0] for r in (await db.execute(text(
        "SELECT user_id::text FROM wave_certificate_signatures WHERE tenant_id = :t AND certificate_id = :c"),
        {"t": t, "c": str(cert_id)})).fetchall()}
    complete = set(owners) <= signed if owners else True
    if complete:
        await db.execute(text("UPDATE wave_certificates SET status = 'signed' WHERE id = :c AND tenant_id = :t"),
                         {"c": str(cert_id), "t": t})
    await db.run_sync(lambda s: webhooks.emit_safe(s, t, "certificate.signed", {
        "certificate_id": str(cert_id), "wave_id": str(wave_id), "wave_name": wave.name, "version": cert[1],
        "sha256": cert[3], "signed_by": current_user_label(), "complete": complete}))
    await write_audit(db, tenant.id, request, "certificate_signed", "wave_certificate", str(cert_id), None,
                      {"wave_id": str(wave_id), "version": cert[1], "sha256": cert[3], "statement": statement,
                       "complete": complete})
    await db.commit()
    return {"id": str(cert_id), "version": cert[1], "status": "signed" if complete else "issued",
            "signed_by": sorted(signed), "waiting_for": sorted(set(owners) - signed)}


@router.get("/waves/{wave_id}/certificate/{cert_id}/pdf")
async def certificate_pdf(wave_id: uuid.UUID, cert_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant),
                          _role: str = Depends(require_permission("export", scope=scope_from_path))):
    from api.services.report_history import read_report_file

    await _wave(db, tenant, wave_id)
    row = (await db.execute(text(
        "SELECT f.file_name, f.storage_key, f.content FROM wave_certificates c JOIN report_files f "
        "ON f.id = c.report_file_id AND f.tenant_id = c.tenant_id WHERE c.id = :c AND c.wave_id = :w AND c.tenant_id = :t"),
        {"c": str(cert_id), "w": str(wave_id), "t": str(tenant.id)})).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Certificate file not found.")
    data = await asyncio.to_thread(read_report_file, row[1], row[2])
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={row[0]}"})
