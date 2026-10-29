"""Owner, approver and programme-lead governance verbs (migration 104, docs/roles-and-features.md).

Escalation chain (the levels after the SLA sweep's first escalation; api/services/escalation.py)
  GET  /api/v1/triage/escalation-chain                view
  PUT  /api/v1/triage/escalation-chain                {steps: [{level, after_minutes, target, user_id?}]}
                                                      manage_triage, manage_settings or manage_rules (as SLA policies)

Data contracts: versions and breaches (the list, create, edit, submit and activate are api/routes/contracts.py)
  GET  /api/v1/contracts/{id}/detail                  the contract, its versions and its breaches; view
  POST /api/v1/contracts/{id}/revise                  {note?}: snapshot the live version and reopen it as a draft of
                                                      the next version; manage_rules

Wave gates (api/services/wave_gate.py)
  GET  /api/v1/migration/waves/gates                  every wave with its gate criteria and status; view
  PUT  /api/v1/migration/waves/{id}/gate              {min_score?, zero_criticals, contracts_met}; analyse (as waves)
  GET  /api/v1/migration/waves/{id}/certificate       the readiness certificate stub (step 9 fills it); view

Every write is audited.
"""
from __future__ import annotations

import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import escalation, wave_gate
from api.services.rbac import (
    current_user_id,
    current_user_label,
    require_any_permission,
    require_permission,
    write_audit,
)

router = APIRouter(prefix="/api/v1", tags=["governance"])


async def _rls(db: AsyncSession, tenant: Tenant) -> str:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
    return str(tenant.id)


# ── escalation chain ──────────────────────────────────────────────────────────


class StepIn(BaseModel):
    level: int = Field(ge=1, le=escalation.MAX_LEVELS)
    after_minutes: int = Field(ge=0, le=60 * 24 * 60)
    target: Literal["team_lead", "fallback", "user"]
    user_id: uuid.UUID | None = None


class ChainIn(BaseModel):
    steps: list[StepIn] = Field(default_factory=list, max_length=escalation.MAX_LEVELS)


async def _chain(db: AsyncSession, t: str) -> list[dict]:
    rows = (await db.execute(text(
        "SELECT s.level, s.after_minutes, s.target, s.user_id::text AS user_id, COALESCE(u.name, u.email) AS user_name "
        "FROM escalation_steps s LEFT JOIN users u ON u.id = s.user_id WHERE s.tenant_id = CAST(:t AS uuid) "
        "ORDER BY s.level"), {"t": t})).mappings().all()
    return [dict(r) for r in rows]


@router.get("/triage/escalation-chain", dependencies=[Depends(require_permission("view"))])
async def get_chain(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    return {"steps": await _chain(db, await _rls(db, tenant))}


@router.put("/triage/escalation-chain",
            dependencies=[Depends(require_any_permission("manage_triage", "manage_settings", "manage_rules"))])
async def put_chain(body: ChainIn, request: Request, db: AsyncSession = Depends(get_db),
                    tenant: Tenant = Depends(get_tenant)):
    steps = [s.model_dump() for s in body.steps]
    errors = escalation.validate_chain(steps)
    if errors:
        raise HTTPException(status_code=422, detail=" ".join(errors))
    t = await _rls(db, tenant)
    users = [str(s["user_id"]) for s in steps if s["user_id"]]
    if users:
        found = (await db.execute(text("SELECT count(*) FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active "
                                       "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": t, "ids": users})).scalar()
        if found != len(set(users)):
            raise HTTPException(status_code=422, detail="Every person in the chain must be an active user.")
    before = await _chain(db, t)
    await db.execute(text("DELETE FROM escalation_steps WHERE tenant_id = CAST(:t AS uuid)"), {"t": t})
    for s in steps:
        await db.execute(text("INSERT INTO escalation_steps (tenant_id, level, after_minutes, target, user_id) "
                              "VALUES (CAST(:t AS uuid), :l, :m, :g, CAST(:u AS uuid))"),
                         {"t": t, "l": s["level"], "m": s["after_minutes"], "g": s["target"],
                          "u": str(s["user_id"]) if s["user_id"] else None})
    after = await _chain(db, t)
    await write_audit(db, tenant.id, request, "escalation_chain.update", "triage", "escalation-chain",
                      {"steps": before}, {"steps": after})
    await db.commit()
    return {"steps": after}


# ── contracts: versions and breaches ──────────────────────────────────────────

_SNAP = ("name", "description", "producer", "consumer", "schema_contract", "quality_contract", "freshness_contract",
         "volume_contract", "status")


def _jsonable(d: dict) -> dict:
    return json.loads(json.dumps(d, default=str))


@router.get("/contracts/{contract_id}/detail", dependencies=[Depends(require_permission("view"))])
async def contract_detail(contract_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)):
    """The contract, its earlier versions (newest first) and the checks it failed (breaches, newest first)."""
    t = await _rls(db, tenant)
    row = (await db.execute(text("""
        SELECT c.*, h.overall_compliant AS latest_compliant, h.recorded_at AS last_checked
          FROM contracts c
          LEFT JOIN LATERAL (SELECT overall_compliant, recorded_at FROM contract_compliance_history
                              WHERE contract_id = c.id AND tenant_id = c.tenant_id ORDER BY recorded_at DESC LIMIT 1) h ON true
         WHERE c.id = :c AND c.tenant_id = CAST(:t AS uuid)"""), {"c": contract_id, "t": t})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contract not found")
    versions = (await db.execute(text(
        "SELECT version, snapshot, note, created_by, created_at FROM contract_versions "
        "WHERE contract_id = :c AND tenant_id = CAST(:t AS uuid) ORDER BY version DESC"),
        {"c": contract_id, "t": t})).mappings().all()
    breaches = (await db.execute(text(
        "SELECT version_id::text AS version_id, violations, recorded_at FROM contract_compliance_history "
        "WHERE contract_id = :c AND tenant_id = CAST(:t AS uuid) AND NOT overall_compliant "
        "ORDER BY recorded_at DESC LIMIT 50"), {"c": contract_id, "t": t})).mappings().all()
    checks = (await db.execute(text(
        "SELECT count(*) FROM contract_compliance_history WHERE contract_id = :c AND tenant_id = CAST(:t AS uuid)"),
        {"c": contract_id, "t": t})).scalar()
    return {"contract": _jsonable(dict(row)), "versions": [_jsonable(dict(v)) for v in versions],
            "breaches": [_jsonable(dict(b)) for b in breaches], "checks": int(checks or 0)}


class ReviseIn(BaseModel):
    note: str | None = Field(None, max_length=1000)


@router.post("/contracts/{contract_id}/revise", dependencies=[Depends(require_permission("manage_rules"))])
async def revise_contract(contract_id: uuid.UUID, body: ReviseIn, request: Request,
                          db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Keep the live version as history and reopen the contract as a draft of the next version. The draft is edited
    with PUT /contracts/{id}, submitted and activated (four eyes) as a new contract is."""
    t = await _rls(db, tenant)
    row = (await db.execute(text(f"SELECT version, {', '.join(_SNAP)} FROM contracts WHERE id = :c "
                                 "AND tenant_id = CAST(:t AS uuid) FOR UPDATE"), {"c": contract_id, "t": t})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contract not found")
    if row["status"] in ("draft", "pending_approval"):
        raise HTTPException(status_code=409, detail="This contract is already a draft; edit it directly.")
    snap = _jsonable({k: row[k] for k in _SNAP})
    await db.execute(text("""
        INSERT INTO contract_versions (tenant_id, contract_id, version, snapshot, note, created_by)
        VALUES (CAST(:t AS uuid), :c, :v, CAST(:s AS jsonb), :n, :by)
        ON CONFLICT (contract_id, version) DO NOTHING"""),
        {"t": t, "c": contract_id, "v": row["version"], "s": json.dumps(snap), "n": body.note,
         "by": current_user_label()})
    await db.execute(text("UPDATE contracts SET version = version + 1, status = 'draft', activated_at = NULL, "
                          "approved_by = NULL WHERE id = :c AND tenant_id = CAST(:t AS uuid)"), {"c": contract_id, "t": t})
    await write_audit(db, tenant.id, request, "contract.revise", "contract", str(contract_id),
                      {"version": row["version"], "status": row["status"]}, {"version": row["version"] + 1, "status": "draft"})
    await db.commit()
    return {"id": str(contract_id), "version": row["version"] + 1, "status": "draft"}


# ── wave gates ────────────────────────────────────────────────────────────────


class GateIn(BaseModel):
    min_score: float | None = Field(None, ge=0, le=100)
    zero_criticals: bool = True
    contracts_met: bool = False


def _gate_out(r: dict | None) -> dict:
    if not r:
        return {"min_score": None, "zero_criticals": True, "contracts_met": False, "configured": False,
                "updated_by": None, "updated_at": None}
    return {"min_score": r["min_score"], "zero_criticals": r["zero_criticals"], "contracts_met": r["contracts_met"],
            "configured": True, "updated_by": r["updated_by"],
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None}


async def _contracts(db: AsyncSession, t: str) -> list[dict]:
    rows = (await db.execute(text("""
        SELECT c.name, c.status, c.producer, c.consumer, c.quality_contract, h.overall_compliant AS latest_compliant
          FROM contracts c
          LEFT JOIN LATERAL (SELECT overall_compliant FROM contract_compliance_history
                              WHERE contract_id = c.id AND tenant_id = c.tenant_id ORDER BY recorded_at DESC LIMIT 1) h ON true
         WHERE c.tenant_id = CAST(:t AS uuid)"""), {"t": t})).mappings().all()
    return [dict(r) for r in rows]


async def _gates(db: AsyncSession, tenant: Tenant, wave_id: uuid.UUID | None = None) -> list[dict]:
    from api.routes.landscape import get_landscape

    t = await _rls(db, tenant)
    waves = (await db.execute(text(
        "SELECT w.id::text AS id, w.name, w.modules, w.source_system_id::text AS source_system_id, w.target_date, "
        "w.signed_off_at, g.min_score, g.zero_criticals, g.contracts_met, g.updated_by, g.updated_at, "
        "g.wave_id IS NOT NULL AS has_gate FROM migration_waves w LEFT JOIN wave_gates g ON g.wave_id = w.id "
        "WHERE w.tenant_id = CAST(:t AS uuid) AND (CAST(:w AS uuid) IS NULL OR w.id = CAST(:w AS uuid)) "
        "ORDER BY w.target_date NULLS LAST, w.name"), {"t": t, "w": str(wave_id) if wave_id else None})).mappings().all()
    if not waves:
        return []
    cells = (await get_landscape(scope="current", run=None, db=db, tenant=tenant))["cells"]
    contracts = await _contracts(db, t)
    out = []
    for w in waves:
        gate = _gate_out(dict(w) if w["has_gate"] else None)
        status = wave_gate.gate_checks(gate, dict(w), cells, contracts)
        out.append({"wave_id": w["id"], "name": w["name"], "modules": list(w["modules"] or []), "gate": gate,
                    "status": status, "signed_off": w["signed_off_at"] is not None,
                    "certificate_href": f"/api/v1/migration/waves/{w['id']}/certificate"})
    return out


@router.get("/migration/waves/gates", dependencies=[Depends(require_permission("view"))])
async def list_gates(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    return {"gates": await _gates(db, tenant)}


@router.put("/migration/waves/{wave_id}/gate", dependencies=[Depends(require_permission("analyse"))])
async def put_gate(wave_id: uuid.UUID, body: GateIn, request: Request, db: AsyncSession = Depends(get_db),
                   tenant: Tenant = Depends(get_tenant)):
    t = await _rls(db, tenant)
    if not (await db.execute(text("SELECT 1 FROM migration_waves WHERE id = :w AND tenant_id = CAST(:t AS uuid)"),
                             {"w": wave_id, "t": t})).scalar():
        raise HTTPException(status_code=404, detail="Wave not found.")
    before = (await db.execute(text("SELECT min_score, zero_criticals, contracts_met FROM wave_gates WHERE wave_id = :w "
                                    "AND tenant_id = CAST(:t AS uuid)"), {"w": wave_id, "t": t})).mappings().first()
    await db.execute(text("""
        INSERT INTO wave_gates (wave_id, tenant_id, min_score, zero_criticals, contracts_met, updated_by, updated_at)
        VALUES (:w, CAST(:t AS uuid), :s, :z, :c, :by, now())
        ON CONFLICT (wave_id) DO UPDATE SET min_score = EXCLUDED.min_score, zero_criticals = EXCLUDED.zero_criticals,
               contracts_met = EXCLUDED.contracts_met, updated_by = EXCLUDED.updated_by, updated_at = now()"""),
        {"w": wave_id, "t": t, "s": body.min_score, "z": body.zero_criticals, "c": body.contracts_met,
         "by": current_user_label()})
    await write_audit(db, tenant.id, request, "wave_gate.update", "migration_wave", str(wave_id),
                      dict(before) if before else None, body.model_dump())
    await db.commit()
    got = await _gates(db, tenant, wave_id)
    return got[0]


@router.get("/migration/waves/{wave_id}/certificate", dependencies=[Depends(require_permission("view"))])
async def certificate(wave_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)):
    """The readiness certificate stub: the gate's verdict and checks as they stand. Step 9 turns this into the signed
    PDF certificate; until then ``final`` is false and nothing is signed."""
    got = await _gates(db, tenant, wave_id)
    if not got:
        raise HTTPException(status_code=404, detail="Wave not found.")
    g = got[0]
    return {"wave_id": g["wave_id"], "wave": g["name"], "final": False, "passed": g["status"]["passed"],
            "checks": g["status"]["checks"], "requested_by": current_user_id(request),
            "note": "A draft: the signed readiness certificate arrives in step 9."}
