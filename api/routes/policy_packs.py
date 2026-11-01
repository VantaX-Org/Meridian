"""Policy packs: GxP, SOX and GDPR field classes, their authority and the rules that evidence them.

GET  /api/v1/policy-packs                       the catalogue with this tenant's coverage: applied or not, fields
                                                classified, rules evidencing, rules measured, failing records and
                                                classes breached in the current state
POST /api/v1/policy-packs/{id}/apply            materialise the pack's classes for the tenant (manage_rules, audited)
POST /api/v1/policy-packs/{id}/unapply          remove them (manage_rules, audited)
GET  /api/v1/policy-packs/{id}/evidence?run=    per class: the authority, its rules with pass rate and failing
                                                records, the class pass rate and failing records; one run, else the
                                                current state

See api/services/policy_packs.py for the numbers. Read-only except apply and unapply; deterministic; RLS.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.cache import mark_work_changed
from api.routes.objects import rule_names
from api.routes.record_issues import _rls
from api.services import policy_packs as pp
from api.services.current_state import current_pairs
from api.services.rbac import current_user_id, current_user_label, require_permission, write_audit

router = APIRouter(prefix="/api/v1/policy-packs", tags=["policy-packs"])


class RuleEvidenceOut(BaseModel):
    check_id: str = Field(description="Rule id.")
    name: Optional[str] = Field(None, description="Rule title from the tenant's rules table.")
    measured: bool = Field(description="True when the rule ran in the run read.")
    module: Optional[str] = Field(None, description="Object (module id) of the rule.")
    severity: Optional[str] = Field(None, description="Rule severity.")
    pass_rate: Optional[float] = Field(None, description="Share of records passing, 0 to 100.")
    failing_records: int = Field(description="Records failing.")
    total_records: int = Field(description="Records checked.")


class ClassOut(BaseModel):
    id: str = Field(description="Data class id.")
    label: str = Field(description="Data class name.")
    authority: str = Field(description="Regulation or standard the class comes from.")
    fields: list[str] = Field(description="SAP fields in the class.")
    rules_count: int = Field(description="Rules that evidence the class.")
    rules_measured: int = Field(description="Of those, rules measured.")
    pass_rate: Optional[float] = Field(None, description="Mean pass rate of the measured rules.")
    failing_records: int = Field(description="Failing records across the class's rules.")
    breached: bool = Field(description="True when a critical rule of the class is over tolerance.")


class ClassEvidenceOut(ClassOut):
    rules: list[RuleEvidenceOut]


class CoverageOut(BaseModel):
    fields_classified: int = Field(description="Distinct fields classified by the pack.")
    rules_evidencing: int = Field(description="Distinct rules evidencing the pack.")
    rules_measured: int = Field(description="Of those, rules measured.")
    failing_records: int = Field(description="Failing records across the pack.")
    classes_breached: int = Field(description="Data classes breached.")


class PackOut(BaseModel):
    id: str = Field(description="Policy pack id.")
    name: str = Field(description="Policy pack name.")
    authority: str = Field(description="Regulation or standard.")
    description: str = Field(description="What the pack covers.")
    applied: bool = Field(description="True when applied to this tenant.")
    applied_at: Optional[datetime] = Field(None, description="When it was applied.")
    applied_by: Optional[str] = Field(None, description="Who applied it.")
    unapplied_at: Optional[datetime] = Field(None, description="When it was last removed.")
    coverage: CoverageOut = Field(description="Coverage across the pack.")
    classes: list[ClassOut] = Field(description="Data classes of the pack.")


class PacksOut(BaseModel):
    packs: list[PackOut] = Field(description="Policy packs shipped with Meridian.")
    applied: int = Field(description="Packs applied to this tenant.")


class EvidenceOut(BaseModel):
    pack_id: str = Field(description="Policy pack id.")
    name: str = Field(description="Policy pack name.")
    authority: str = Field(description="Regulation or standard.")
    applied: bool = Field(description="True when applied to this tenant.")
    scope: str = Field(description="Evidence scope: run (one run) or current (the latest run per object).")
    run_id: Optional[str] = Field(None, description="Run read when scope is run.")
    classes: list[ClassEvidenceOut] = Field(description="Evidence per data class.")
    coverage: CoverageOut = Field(description="Coverage across the pack.")


def _coverage(classes: list[dict]) -> dict:
    return {"fields_classified": len({f for c in classes for f in c["fields"]}),
            "rules_evidencing": len({r["check_id"] for c in classes for r in c["rules"]}),
            "rules_measured": len({r["check_id"] for c in classes for r in c["rules"] if r["measured"]}),
            "failing_records": sum(c["failing_records"] for c in classes),
            "classes_breached": sum(1 for c in classes if c["breached"])}


async def _evidence(db: AsyncSession, tenant: Tenant, p: dict, run_id: Optional[str]) -> tuple[list[dict], dict]:
    pairs = None if run_id else await current_pairs(db, tenant.id)
    found = await pp.findings_for(db, str(tenant.id), pp.pack_rules(p), pairs, run_id)
    classes = [pp.class_evidence(c, found) for c in p["classes"]]
    names = await rule_names(db, tenant, sorted({r["check_id"] for c in classes for r in c["rules"]}))
    for c in classes:
        for r in c["rules"]:
            r["name"] = names.get(r["check_id"])
    return classes, _coverage(classes)


def _known(pack_id: str) -> dict:
    p = pp.pack(pack_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Policy pack not found")
    return p


@router.get("", response_model=PacksOut, dependencies=[Depends(require_permission("view"))])
async def list_packs(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Every pack with this tenant's coverage in the current state."""
    await _rls(db, tenant)
    state = await pp.applied_state(db, str(tenant.id))
    pairs = await current_pairs(db, tenant.id)
    out = []
    for p in pp.catalogue():
        found = await pp.findings_for(db, str(tenant.id), pp.pack_rules(p), pairs, None)
        classes = [pp.class_evidence(c, found) for c in p["classes"]]
        s = state.get(p["id"]) or {}
        out.append({"id": p["id"], "name": p["name"], "authority": p["authority"], "description": p["description"],
                    "applied": bool(s.get("applied")), "applied_at": s.get("applied_at"),
                    "applied_by": s.get("applied_by_label"), "unapplied_at": s.get("unapplied_at"),
                    "coverage": _coverage(classes),
                    "classes": [{k: v for k, v in c.items() if k != "rules"} for c in classes]})
    return {"packs": out, "applied": sum(1 for p in out if p["applied"])}


@router.post("/{pack_id}/apply", dependencies=[Depends(require_permission("manage_rules"))])
async def apply_pack(pack_id: str, request: Request, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)) -> dict:
    """Apply the pack: its classes are materialised for the tenant and count as policy breaches from now on."""
    p = _known(pack_id)
    await _rls(db, tenant)
    before = (await pp.applied_state(db, str(tenant.id))).get(pack_id) or {}
    await pp.apply(db, str(tenant.id), p, current_user_id(request), current_user_label())
    await write_audit(db, tenant.id, request, "policy_pack_applied", "policy_pack", pack_id,
                      {"applied": bool(before.get("applied"))},
                      {"applied": True, "classes": [c["id"] for c in p["classes"]]})
    mark_work_changed(db, tenant.id)  # the landscape cells carry policy_breaches
    await db.commit()
    return {"id": pack_id, "applied": True, "classes": len(p["classes"])}


@router.post("/{pack_id}/unapply", dependencies=[Depends(require_permission("manage_rules"))])
async def unapply_pack(pack_id: str, request: Request, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)) -> dict:
    _known(pack_id)
    await _rls(db, tenant)
    was = await pp.unapply(db, str(tenant.id), pack_id, current_user_id(request), current_user_label())
    await write_audit(db, tenant.id, request, "policy_pack_unapplied", "policy_pack", pack_id,
                      {"applied": was}, {"applied": False})
    mark_work_changed(db, tenant.id)
    await db.commit()
    return {"id": pack_id, "applied": False}


@router.get("/{pack_id}/evidence", response_model=EvidenceOut, dependencies=[Depends(require_permission("view"))])
async def pack_evidence(pack_id: str, run: Optional[uuid.UUID] = Query(None, description="a run id; default the "
                                                                                          "current state"),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Per class of the pack: its authority, the rules that evidence it with their pass rate and failing records, and
    the class's pass rate and failing records."""
    p = _known(pack_id)
    await _rls(db, tenant)
    if run is not None and not (await db.execute(text(
            "SELECT 1 FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
            {"v": str(run), "t": str(tenant.id)})).scalar():
        raise HTTPException(status_code=404, detail="Run not found")
    classes, coverage = await _evidence(db, tenant, p, str(run) if run else None)
    state = (await pp.applied_state(db, str(tenant.id))).get(pack_id) or {}
    return {"pack_id": p["id"], "name": p["name"], "authority": p["authority"], "applied": bool(state.get("applied")),
            "scope": "run" if run else "current", "run_id": str(run) if run else None,
            "classes": classes, "coverage": coverage}
