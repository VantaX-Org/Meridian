"""Reference data management: code lists from stored check-table extractions, and maker-checker value mappings.

A steward proposes a source to target code mapping; a different user with the approve permission decides it. The
proposer can never approve their own mapping. Every proposal and decision is written to audit_log with before and
after. Only an approved mapping has status ``confirmed``, the value migration already reads, so approval is what
puts a mapping into effect. The target code of a proposal must exist in the target list.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.licence import enforce_licensed_modules
from api.routes.config_pairing import _system
from api.services import config_pairing as cp
from api.services import reference_data as rd
from api.services.rbac import current_user_id, require_permission, scope_from_path, write_audit

router = APIRouter(prefix="/api/v1/reference-data", tags=["reference-data"])

_TENANT = cp._TENANT
_COLS = ("id::text, target_field, source_value, target_value, status, note, proposed_by::text, "
         "decided_by::text, decided_at, updated_at")


class Code(BaseModel):
    code: str
    text: Optional[str] = None


class Coverage(BaseModel):
    same: int
    approved: int
    proposed: int
    rejected: int
    open: int


class Version(BaseModel):
    load_id: str
    origin: str
    finished_at: Optional[str] = None
    codes: int


class ListSummary(BaseModel):
    id: str
    table: str
    module: str
    target_fields: list[str]
    source_codes: int
    target_codes: int
    versions: int
    coverage: Coverage


class ListsOut(BaseModel):
    target_label: str
    lists: list[ListSummary]


class Mapping(BaseModel):
    id: str
    target_field: str
    source_code: str
    source_text: Optional[str] = None
    target_code: str
    target_text: Optional[str] = None
    status: Literal["proposed", "confirmed", "rejected"]
    note: Optional[str] = None
    proposed_by: Optional[str] = None
    decided_by: Optional[str] = None
    decided_at: Optional[str] = None


class ListOut(BaseModel):
    id: str
    table: str
    module: str
    target_fields: list[str]
    target_label: str
    version_id: Optional[str] = None
    versions: list[Version]
    source: list[Code]
    target: list[Code]
    mappings: list[Mapping]
    coverage: Coverage


class ProposeBody(BaseModel):
    system_id: uuid.UUID
    list_id: str
    target_field: str
    source_code: str = Field(min_length=1, max_length=80)
    target_code: str = Field(min_length=1, max_length=80)
    note: Optional[str] = Field(default=None, max_length=500)


class DecisionBody(BaseModel):
    decision: Literal["approve", "reject"]
    note: Optional[str] = Field(default=None, max_length=500)


class SuggestBody(BaseModel):
    system_id: uuid.UUID
    list_id: str
    source_code: str = Field(min_length=1, max_length=80)


class Check(BaseModel):
    code: str
    passed: bool


class Suggestion(BaseModel):
    source_code: str
    target_code: str
    target_text: Optional[str] = None
    confidence: float
    reasoning: str
    checks: list[Check]


class SuggestOut(BaseModel):
    suggestion: Optional[Suggestion] = None


def _list(list_id: str, request: Request) -> rd.CodeList:
    lst = rd.by_id(list_id)
    if lst is None:
        raise HTTPException(status_code=404, detail="Code list not found")
    enforce_licensed_modules(request, [lst.module])
    return lst


def _uid(request: Request) -> Optional[str]:
    u = current_user_id(request)
    try:
        return str(uuid.UUID(u)) if u else None
    except ValueError:
        return None


async def _mappings(db: AsyncSession, tid: str, sid: str, lst: rd.CodeList) -> list[dict[str, Any]]:
    binds = {f"f{i}": f for i, f in enumerate(lst.target_fields)}
    ins = ", ".join(f":{k}" for k in binds)
    rows = (await db.execute(text(
        f"SELECT {_COLS} FROM transfer_value_mappings WHERE tenant_id = CAST(:t AS uuid) AND module = :m "
        f"AND source_system_id = CAST(:sid AS uuid) AND target_field IN ({ins}) ORDER BY target_field, source_value"),
        {"t": tid, "m": lst.module, "sid": sid, **binds})).fetchall()
    return [{"id": r[0], "target_field": r[1], "source_value": r[2], "target_value": r[3], "status": r[4],
             "note": r[5], "proposed_by": r[6], "decided_by": r[7],
             "decided_at": r[8].isoformat() if r[8] else None} for r in rows]


async def _lang(db: AsyncSession, tenant: Tenant, request: Request) -> Optional[str]:
    """SAP logon language from the user's saved locale preference (Preferences page); None means English."""
    from api.routes import preferences
    try:
        return rd.spras((await preferences._load(db, tenant, preferences._user(request))).get("locale"))
    except HTTPException:
        return None


async def _codes(db: AsyncSession, sid: str, lst: rd.CodeList, load_id: Optional[str],
                 lang: Optional[str] = None) -> dict[str, Any]:
    def run(s: Any) -> dict[str, Any]:
        src, used = rd.source_codes(s, sid, lst, load_id, lang)
        tgt, label = rd.target_codes(s, sid, lst, lang)
        return {"source": src, "version_id": used, "target": tgt, "label": label, "versions": rd.versions(s, sid, lst)}
    return await db.run_sync(run)


def _with_text(rows: list[dict[str, Any]], src: list[dict], tgt: list[dict]) -> list[dict[str, Any]]:
    st, tt = {c["code"]: c["text"] for c in src}, {c["code"]: c["text"] for c in tgt}
    return [{**{k: v for k, v in m.items() if k not in ("source_value", "target_value")},
             "source_code": m["source_value"], "source_text": st.get(m["source_value"]),
             "target_code": m["target_value"], "target_text": tt.get(m["target_value"])} for m in rows]


@router.get("/lists", dependencies=[Depends(require_permission("view"))])
async def get_lists(system_id: str, request: Request, db: AsyncSession = Depends(get_db),
                    tenant: Tenant = Depends(get_tenant)) -> ListsOut:
    sid = await _system(db, tenant, system_id)
    allowed = [x for x in rd.LISTS if _licensed(request, x.module)]
    lang = await _lang(db, tenant, request)
    out, label = [], ""
    for lst in allowed:
        c = await _codes(db, sid, lst, None, lang)
        label = c["label"]
        rows = await _mappings(db, str(tenant.id), sid, lst)
        out.append(ListSummary(
            id=lst.id, table=lst.table, module=lst.module, target_fields=list(lst.target_fields),
            source_codes=len(c["source"]), target_codes=len(c["target"]), versions=len(c["versions"]),
            coverage=Coverage(**rd.coverage(c["source"], rows, c["target"]))))
    return ListsOut(target_label=label, lists=out)


def _licensed(request: Request, module: str) -> bool:
    mods = getattr(request.state, "licensed_modules", None)
    return mods is None or "*" in mods or module in mods


@router.get("/lists/{list_id}", dependencies=[Depends(require_permission("view"))])
async def get_list(list_id: str, system_id: str, request: Request, load_id: Optional[str] = Query(default=None),
                   db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> ListOut:
    lst = _list(list_id, request)
    sid = await _system(db, tenant, system_id)
    if load_id is not None:
        try:
            uuid.UUID(load_id)
        except ValueError:
            raise HTTPException(status_code=404, detail="Version not found")
    c = await _codes(db, sid, lst, load_id, await _lang(db, tenant, request))
    if load_id is not None and not any(v["load_id"] == load_id for v in c["versions"]):
        raise HTTPException(status_code=404, detail="Version not found")
    rows = await _mappings(db, str(tenant.id), sid, lst)
    return ListOut(
        id=lst.id, table=lst.table, module=lst.module, target_fields=list(lst.target_fields), target_label=c["label"],
        version_id=c["version_id"], versions=[Version(**v) for v in c["versions"]],
        source=[Code(**x) for x in c["source"]], target=[Code(**x) for x in c["target"]],
        mappings=[Mapping(**m) for m in _with_text(rows, c["source"], c["target"])],
        coverage=Coverage(**rd.coverage(c["source"], rows, c["target"])))


class UsageField(BaseModel):
    field: str
    profiled: bool
    rows: int
    filled: int
    covered: int
    orphan_rows: int
    masked: bool
    mask_reason: Optional[str] = None
    truncated: bool
    sampled: bool


class Orphan(BaseModel):
    value: str
    count: int
    fields: list[str]


class UsageOut(BaseModel):
    id: str
    table: str
    version_id: Optional[str] = None
    run_at: Optional[str] = None
    fields: list[UsageField]
    orphans: list[Orphan]
    orphans_complete: bool
    unused: list[str]
    unused_certain: bool
    codes: int
    used: int
    filled: int
    covered: int
    covered_share: Optional[float] = None
    covered_at_least: bool


@router.get("/lists/{list_id}/usage", response_model=UsageOut)
async def get_usage(list_id: str, system_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                    db: AsyncSession = Depends(get_db),
                    _role: str = Depends(require_permission("view", scope=scope_from_path))) -> UsageOut:
    """Which of the list's codes the records hold, read from the field profiles of the newest analysis run of the
    system that profiled a target field: orphan values (in records, not in the check table), codes never used, and
    the share of filled records whose value is a valid code."""
    from api.routes.record_issues import _rls
    lst = _list(list_id, request)
    sid = await _system(db, tenant, system_id)
    await _rls(db, tenant)
    cols = {f: tuple(f.split(".", 1)) for f in lst.target_fields}
    tables = sorted({t for t, _ in cols.values()})
    t = str(tenant.id)
    ver = (await db.execute(text(
        "SELECT CAST(av.id AS text) AS id, av.run_at FROM analysis_versions av WHERE av.tenant_id = :t "
        "AND av.metadata->>'system_id' = :s AND EXISTS (SELECT 1 FROM field_profiles fp WHERE fp.tenant_id = :t "
        "AND fp.version_id = av.id AND fp.table_name = ANY(:tb)) ORDER BY av.run_at DESC LIMIT 1"),
        {"t": t, "s": sid, "tb": tables})).mappings().all()
    stats: dict[tuple[str, str], dict] = {}
    if ver:
        for r in (await db.execute(text(
                "SELECT table_name, field, stats FROM field_profiles WHERE tenant_id = :t "
                "AND version_id = CAST(:v AS uuid) AND table_name = ANY(:tb)"),
                {"t": t, "v": ver[0]["id"], "tb": tables})).mappings().all():
            st = json.loads(r["stats"]) if isinstance(r["stats"], str) else r["stats"]
            stats[(r["table_name"], r["field"])] = st if isinstance(st, dict) else None
    c = await _codes(db, sid, lst, None, await _lang(db, tenant, request))
    u = rd.usage(c["source"], {f: stats.get(k) for f, k in cols.items()})
    run_at = ver[0]["run_at"] if ver else None
    return UsageOut(id=lst.id, table=lst.table, version_id=ver[0]["id"] if ver else None,
                    run_at=run_at.isoformat() if hasattr(run_at, "isoformat") else run_at, **u)


async def _row(db: AsyncSession, tid: str, mid: str) -> Optional[Any]:
    return (await db.execute(text(f"SELECT {_COLS}, module, source_system_id::text FROM transfer_value_mappings "
                                  "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid) FOR UPDATE"),
                             {"id": mid, "t": tid})).fetchone()


def _snap(r: Any) -> dict[str, Any]:
    return {"target_field": r[1], "source_code": r[2], "target_code": r[3], "status": r[4]}


@router.post("/mappings", dependencies=[Depends(require_permission("analyse"))])
async def propose_mapping(body: ProposeBody, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> Mapping:
    lst = _list(body.list_id, request)
    sid = await _system(db, tenant, str(body.system_id))
    field = body.target_field.strip().upper()
    if field not in lst.target_fields:
        raise HTTPException(status_code=422, detail="Field is not checked by this code list")
    c = await _codes(db, sid, lst, None)
    tt = {x["code"]: x["text"] for x in c["target"]}
    st = {x["code"]: x["text"] for x in c["source"]}
    if body.source_code not in st:
        raise HTTPException(status_code=422, detail="Source code is not in the source list")
    if body.target_code not in tt:
        raise HTTPException(status_code=422, detail="Target code is not in the target list")
    tid, uid = str(tenant.id), _uid(request)
    tgt_sys = (await db.execute(text("SELECT target_system_id::text FROM sap_systems WHERE id = CAST(:s AS uuid) "
                                     "AND tenant_id = CAST(:t AS uuid)"), {"s": sid, "t": tid})).scalar()
    before = (await db.execute(text(
        f"SELECT {_COLS} FROM transfer_value_mappings WHERE tenant_id = CAST(:t AS uuid) AND module = :m "
        "AND target_field = :tf AND source_value = :sv AND source_system_id = CAST(:s AS uuid) "
        "AND target_system_id IS NOT DISTINCT FROM CAST(:g AS uuid)"),
        {"t": tid, "m": lst.module, "tf": field, "sv": body.source_code, "s": sid, "g": tgt_sys})).fetchone()
    r = (await db.execute(text(f"""
        INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value, note,
                                             updated_by, updated_at, source_system_id, target_system_id, status,
                                             proposed_by, decided_by, decided_at)
        VALUES (gen_random_uuid(), CAST(:t AS uuid), :m, :tf, :sv, :tv, :note, CAST(:u AS uuid), now(),
                CAST(:s AS uuid), CAST(:g AS uuid), 'proposed', CAST(:u AS uuid), NULL, NULL)
        ON CONFLICT ON CONSTRAINT uq_transfer_value_mappings_scope
        DO UPDATE SET target_value = EXCLUDED.target_value, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by,
                      updated_at = now(), status = 'proposed', proposed_by = EXCLUDED.proposed_by,
                      decided_by = NULL, decided_at = NULL
        RETURNING {_COLS}"""),
        {"t": tid, "m": lst.module, "tf": field, "sv": body.source_code, "tv": body.target_code, "note": body.note,
         "u": uid, "s": sid, "g": tgt_sys})).fetchone()
    await write_audit(db, tenant.id, request, "reference_mapping.propose", "reference_mapping", r[0],
                      _snap(before) if before else None, _snap(r))
    await db.commit()
    m = {"id": r[0], "target_field": r[1], "status": r[4], "note": r[5], "proposed_by": r[6], "decided_by": None,
         "decided_at": None, "source_code": r[2], "source_text": st.get(r[2]), "target_code": r[3],
         "target_text": tt.get(r[3])}
    return Mapping(**m)


@router.post("/mappings/{mapping_id}/decision", dependencies=[Depends(require_permission("approve"))])
async def decide_mapping(mapping_id: uuid.UUID, body: DecisionBody, request: Request,
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict[str, str]:
    tid = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = '{tid}'"))
    r = await _row(db, tid, str(mapping_id))
    if r is None or r[-2] not in rd.MODULES:
        raise HTTPException(status_code=404, detail="Mapping not found")
    enforce_licensed_modules(request, [r[-2]])
    if r[4] != "proposed":
        raise HTTPException(status_code=409, detail="Mapping is not waiting for a decision")
    me = _uid(request)
    if me is None or me == r[6]:  # four eyes: the maker never checks their own work, and an unknown user cannot check
        raise HTTPException(status_code=403, detail="A different user must approve this mapping")
    new = "confirmed" if body.decision == "approve" else "rejected"
    await db.execute(text("UPDATE transfer_value_mappings SET status = :s, decided_by = CAST(:u AS uuid), "
                          "decided_at = now(), updated_at = now() WHERE id = CAST(:id AS uuid) "
                          "AND tenant_id = CAST(:t AS uuid)"), {"s": new, "u": me, "id": str(mapping_id), "t": tid})
    after = {**_snap(r), "status": new, "note": body.note}
    await write_audit(db, tenant.id, request, f"reference_mapping.{body.decision}", "reference_mapping",
                      str(mapping_id), _snap(r), after)
    await db.commit()
    return {"id": str(mapping_id), "status": new}


@router.post("/suggest", dependencies=[Depends(require_permission("trigger_ai"))])
async def suggest_mapping(body: SuggestBody, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> SuggestOut:
    lst = _list(body.list_id, request)
    sid = await _system(db, tenant, str(body.system_id))
    c = await _codes(db, sid, lst, None)
    out = await db.run_sync(lambda _s: rd.suggest(str(tenant.id), lst.id, c["source"], c["target"], body.source_code))
    return SuggestOut(suggestion=Suggestion(**out) if out else None)
