"""Source and target system comparison API: pairs, runs, differences, record pairs, trend and export.

A pair names any two connected systems for one module. A run (workers.tasks.run_system_compare) reconciles their
latest extractions table by table and scores both sides. Deterministic, no LLM; every query filters on tenant_id
under RLS. Key overrides are checked against the systems' dictionaries, so no SAP field name is ever invented.
"""

import json
import uuid
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.migration import _set_rls, _stream
from api.services.branded_xlsx import ColumnSpec, SheetSpec, build_workbook, csv_response
from api.services.rbac import current_user_id, current_user_label, require_permission
from api.services.system_compare import KINDS

router = APIRouter(prefix="/api/v1/compare", tags=["compare"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_PAIR_SQL = """
    SELECT p.id, p.module, p.source_system_id, p.target_system_id, p.key_map, p.created_at, p.updated_at,
           s.name AS source_name, s.system_type AS source_type, g.name AS target_name, g.system_type AS target_type,
           c.id AS last_id, c.status AS last_status, c.created_at AS last_at, c.summary AS last_summary,
           c.scores AS last_scores
    FROM system_pairs p
    JOIN sap_systems s ON s.id = p.source_system_id AND s.tenant_id = p.tenant_id
    JOIN sap_systems g ON g.id = p.target_system_id AND g.tenant_id = p.tenant_id
    LEFT JOIN LATERAL (SELECT id, status, created_at, summary, scores FROM system_comparisons
                       WHERE pair_id = p.id AND tenant_id = p.tenant_id ORDER BY created_at DESC LIMIT 1) c ON true
    WHERE p.tenant_id = :t"""


class KeySide(BaseModel):
    source: list[str]
    target: list[str]


class PairIn(BaseModel):
    module: str
    source_system_id: uuid.UUID
    target_system_id: uuid.UUID
    key_map: dict[str, KeySide] = {}


class PairPatch(BaseModel):
    key_map: dict[str, KeySide]


def _pair(r) -> dict:
    return {"id": str(r.id), "module": r.module, "key_map": r.key_map or {},
            "source": {"id": str(r.source_system_id), "name": r.source_name, "type": r.source_type},
            "target": {"id": str(r.target_system_id), "name": r.target_name, "type": r.target_type},
            "created_at": r.created_at, "updated_at": r.updated_at,
            "last": None if not r.last_id else {"id": str(r.last_id), "status": r.last_status, "at": r.last_at,
                                                "summary": r.last_summary, "scores": r.last_scores}}


async def _load_pair(db: AsyncSession, tenant: Tenant, pair_id: uuid.UUID):
    await _set_rls(db, tenant.id)
    r = (await db.execute(text(_PAIR_SQL + " AND p.id = :id"), {"t": str(tenant.id), "id": pair_id})).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Pair not found.")
    return r


async def _audit(db, tenant, request, action, entity_id, after: dict) -> None:
    await db.execute(text("""
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path,
                               status_code, before_json, after_json)
        VALUES (:t, :u, :e, :a, 'system_pair', :r, :m, :p, 200, NULL, CAST(:j AS jsonb))"""),
        {"t": str(tenant.id), "u": current_user_id(request), "e": current_user_label(), "a": action,
         "r": str(entity_id), "m": request.method, "p": request.url.path, "j": json.dumps(after, default=str)})


async def _check_key_map(db: AsyncSession, key_map: dict[str, KeySide], source_id, target_id) -> dict:
    """Every key field must exist in its system's dictionary; returns the plain dict to store."""
    if not key_map:
        return {}
    from api.services.source_design import dictionary_for

    def check(session):
        sd, td = dictionary_for(session, str(source_id)), dictionary_for(session, str(target_id))
        bad = []
        for table, k in key_map.items():
            if not k.source or len(k.source) != len(k.target):
                bad.append(f"{table}: source and target need the same number of key fields")
            bad += [f"source {table}.{f}" for f in k.source if not sd.field(table, f)]
            bad += [f"target {table}.{f}" for f in k.target if not td.field(table, f)]
        return bad

    bad = await db.run_sync(check)
    if bad:
        raise HTTPException(status_code=422, detail="Not in the system's dictionary: " + ", ".join(bad))
    return {t: k.model_dump() for t, k in key_map.items()}


@router.get("/pairs")
async def list_pairs(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                     _r: str = Depends(require_permission("view"))) -> dict[str, Any]:
    """Pairs with their latest comparison, and suggested pairs from each system's default target."""
    await _set_rls(db, tenant.id)
    pairs = [_pair(r) for r in (await db.execute(text(_PAIR_SQL + " ORDER BY p.module, s.name, g.name"),
                                                 {"t": str(tenant.id)})).fetchall()]
    sugg = (await db.execute(text("""
        SELECT s.id AS source_id, s.name AS source_name, g.id AS target_id, g.name AS target_name
        FROM sap_systems s JOIN sap_systems g ON g.id = s.target_system_id AND g.tenant_id = s.tenant_id
        WHERE s.tenant_id = :t AND s.is_active AND g.is_active ORDER BY s.name"""), {"t": str(tenant.id)})).fetchall()
    systems = (await db.execute(text("SELECT id, name, system_type FROM sap_systems WHERE tenant_id = :t "
                                     "AND is_active ORDER BY name"), {"t": str(tenant.id)})).fetchall()
    return {"pairs": pairs,
            "suggestions": [{"source": {"id": str(r.source_id), "name": r.source_name},
                             "target": {"id": str(r.target_id), "name": r.target_name}} for r in sugg],
            "systems": [{"id": str(r.id), "name": r.name, "type": r.system_type} for r in systems],
            "modules": sorted(tenant.licensed_modules or [])}


@router.post("/pairs")
async def create_pair(body: PairIn, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("analyse"))) -> dict[str, Any]:
    """Pair two of the tenant's systems for one module."""
    await _set_rls(db, tenant.id)
    if body.source_system_id == body.target_system_id:
        raise HTTPException(status_code=422, detail="Source and target must be different systems.")
    n = (await db.execute(text("SELECT count(*) FROM sap_systems WHERE tenant_id = :t AND id IN (:s, :g)"),
                          {"t": str(tenant.id), "s": body.source_system_id, "g": body.target_system_id})).scalar()
    if n != 2:
        raise HTTPException(status_code=404, detail="System not found.")
    km = await _check_key_map(db, body.key_map, body.source_system_id, body.target_system_id)
    pid = (await db.execute(text("""
        INSERT INTO system_pairs (tenant_id, module, source_system_id, target_system_id, key_map, created_by)
        VALUES (:t, :m, :s, :g, CAST(:k AS jsonb), :u)
        ON CONFLICT (tenant_id, module, source_system_id, target_system_id) DO NOTHING RETURNING id"""),
        {"t": str(tenant.id), "m": body.module, "s": body.source_system_id, "g": body.target_system_id,
         "k": json.dumps(km), "u": current_user_id(request)})).scalar()
    if not pid:
        raise HTTPException(status_code=409, detail="This pair already exists.")
    await _audit(db, tenant, request, "create", pid, body.model_dump(mode="json"))
    await db.commit()
    return _pair(await _load_pair(db, tenant, pid))


@router.patch("/pairs/{pair_id}")
async def update_pair(pair_id: uuid.UUID, body: PairPatch, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("analyse"))) -> dict[str, Any]:
    """Replace the pair's key overrides."""
    p = await _load_pair(db, tenant, pair_id)
    km = await _check_key_map(db, body.key_map, p.source_system_id, p.target_system_id)
    await db.execute(text("UPDATE system_pairs SET key_map = CAST(:k AS jsonb), updated_at = now() "
                          "WHERE id = :id AND tenant_id = :t"), {"k": json.dumps(km), "id": pair_id, "t": str(tenant.id)})
    await _audit(db, tenant, request, "update", pair_id, {"key_map": km})
    await db.commit()
    return _pair(await _load_pair(db, tenant, pair_id))


@router.delete("/pairs/{pair_id}")
async def delete_pair(pair_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("analyse"))) -> dict[str, Any]:
    """Delete the pair and its comparisons."""
    await _load_pair(db, tenant, pair_id)
    await db.execute(text("DELETE FROM system_pairs WHERE id = :id AND tenant_id = :t"),
                     {"id": pair_id, "t": str(tenant.id)})
    await _audit(db, tenant, request, "delete", pair_id, {})
    await db.commit()
    return {"deleted": str(pair_id)}


@router.post("/pairs/{pair_id}/run")
async def run_pair(pair_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                   tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("analyse"))) -> dict[str, Any]:
    """Queue a comparison. One at a time per pair."""
    await _load_pair(db, tenant, pair_id)
    busy = (await db.execute(text("SELECT id FROM system_comparisons WHERE pair_id = :p AND tenant_id = :t "
                                  "AND status IN ('queued','running') AND created_at > now() - interval '2 hours'"),
                             {"p": pair_id, "t": str(tenant.id)})).fetchone()
    if busy:
        raise HTTPException(status_code=409, detail="A comparison of this pair is already running.")
    cid = uuid.uuid4()
    await db.execute(text("INSERT INTO system_comparisons (id, tenant_id, pair_id, status, created_by) "
                          "VALUES (:id, :t, :p, 'queued', :u)"),
                     {"id": cid, "t": str(tenant.id), "p": pair_id, "u": current_user_id(request)})
    await db.commit()
    from workers.tasks.run_system_compare import run_system_compare
    try:
        task = run_system_compare.delay(str(tenant.id), str(cid))
    except Exception:
        await db.execute(text("UPDATE system_comparisons SET status = 'failed', completed_at = now(), "
                              "error_detail = 'The task queue could not be reached.' WHERE id = :id AND tenant_id = :t"),
                         {"id": cid, "t": str(tenant.id)})
        await db.commit()
        raise HTTPException(status_code=503, detail="The task queue could not be reached. Try again shortly.")
    await db.execute(text("UPDATE system_comparisons SET task_id = :k WHERE id = :id AND tenant_id = :t"),
                     {"k": task.id, "id": cid, "t": str(tenant.id)})
    await _audit(db, tenant, request, "compare", pair_id, {"comparison_id": str(cid)})
    await db.commit()
    return {"comparison_id": str(cid), "task_id": task.id, "status": "queued"}


async def _comparison(db: AsyncSession, tenant: Tenant, cid: uuid.UUID, cols: str = "*"):
    await _set_rls(db, tenant.id)
    r = (await db.execute(text(f"SELECT {cols} FROM system_comparisons WHERE id = :id AND tenant_id = :t"),
                          {"id": cid, "t": str(tenant.id)})).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Comparison not found.")
    return r


def _detail(r) -> dict:
    from api.services.task_progress import get_task_progress

    live = get_task_progress(f"compare:{r.id}") if r.status in ("queued", "running") else None
    return {"id": str(r.id), "pair_id": str(r.pair_id), "status": r.status, "progress": live or r.progress,
            "error": r.error_detail, "created_at": r.created_at, "completed_at": r.completed_at,
            "source_version_id": r.source_version_id and str(r.source_version_id),
            "target_version_id": r.target_version_id and str(r.target_version_id),
            "summary": r.summary, "tables": r.tables or [], "config": r.config, "scores": r.scores,
            "record_counts": {t: len(v) for t, v in (r.records or {}).items()}}


@router.get("/pairs/{pair_id}/latest")
async def latest(pair_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                 _r: str = Depends(require_permission("view"))) -> dict[str, Any]:
    """The pair and its latest comparison (null before the first run)."""
    p = await _load_pair(db, tenant, pair_id)
    r = (await db.execute(text("SELECT id, pair_id, status, progress, error_detail, created_at, completed_at, "
                               "source_version_id, target_version_id, summary, tables, config, scores, records "
                               "FROM system_comparisons WHERE pair_id = :p AND tenant_id = :t "
                               "ORDER BY created_at DESC LIMIT 1"), {"p": pair_id, "t": str(tenant.id)})).fetchone()
    return {"pair": _pair(p), "comparison": _detail(r) if r else None}


class ComparisonOut(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    pair_id: str
    status: str
    progress: Any = None
    error: Optional[str] = None
    created_at: Any = None
    completed_at: Any = None
    source_version_id: Optional[str] = None
    target_version_id: Optional[str] = None
    summary: Any = None
    tables: Any = None
    config: Any = None
    scores: Any = None
    record_counts: dict[str, int] = {}


@router.get("/comparisons/{cid}", response_model=ComparisonOut)
async def comparison(cid: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                     _r: str = Depends(require_permission("view"))):
    return _detail(await _comparison(db, tenant, cid))


def _field_text(tables: list[dict]) -> tuple[dict, dict]:
    return ({t["table"]: t.get("description", "") for t in tables},
            {(t["table"], f["field"]): f.get("description", "") for t in tables for f in t.get("fields", [])})


def _rows(r, table, field, kind, q) -> list[dict]:
    tdesc, fdesc = _field_text(r.tables or [])
    out = []
    for t in sorted(r.records or {}):
        if table and t != table:
            continue
        for x in r.records[t]:
            if (field and x.get("field") != field) or (kind and x["kind"] != kind):
                continue
            if q and q.lower() not in " ".join(str(v) for v in (x["key"], x.get("source"), x.get("target"))).lower():
                continue
            out.append({"table": t, "table_text": tdesc.get(t, ""), "kind": x["kind"], "key": x["key"],
                        "field": x.get("field"), "field_text": fdesc.get((t, x.get("field")), ""),
                        "source": "Withheld" if x.get("withheld") else x.get("source"),
                        "target": "Withheld" if x.get("withheld") else x.get("target")})
    return out


@router.get("/comparisons/{cid}/differences")
async def differences(cid: uuid.UUID, table: Optional[str] = None, field: Optional[str] = None,
                      kind: Optional[Literal["missing", "extra", "differing"]] = None, q: Optional[str] = None,
                      offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=1000),
                      db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                      _r: str = Depends(require_permission("view"))) -> dict[str, Any]:
    """Missing, extra and differing records, filtered. Records are capped per table and kind at run time."""
    rows = _rows(await _comparison(db, tenant, cid, "id, tables, records"), table, field, kind, q)
    return {"total": len(rows), "offset": offset, "rows": rows[offset:offset + limit], "kinds": list(KINDS)}


@router.get("/comparisons/{cid}/pair")
async def record_pair(cid: uuid.UUID, table: str, key: str, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("view"))) -> dict[str, Any]:
    """One record side by side: every field with its description, source value, target value and verdict."""
    from api.services.system_compare import explain

    r = await _comparison(db, tenant, cid, "id, tables, pairs")
    p = ((r.pairs or {}).get(table) or {}).get(key)
    if not p:
        raise HTTPException(status_code=404, detail="Record pair not kept for this comparison.")
    _, fdesc = _field_text(r.tables or [])
    s, g = p.get("source") or {}, p.get("target") or {}
    fields = []
    for f in sorted(set(s) | set(g)):
        a, b = s.get(f), g.get(f)
        withheld = (f in s and a is None) or (f in g and b is None and f in s)
        verdict = "withheld" if withheld else "source_only" if f not in g else "target_only" if f not in s \
            else explain(a or "", b or "") or "different"
        fields.append({"field": f, "description": fdesc.get((table, f), ""), "source": a, "target": b,
                       "verdict": verdict})
    return {"table": table, "key": key, "in_source": bool(p.get("source")), "in_target": bool(p.get("target")),
            "fields": fields}


@router.get("/pairs/{pair_id}/trend")
async def trend(pair_id: uuid.UUID, limit: int = Query(24, ge=1, le=200), db: AsyncSession = Depends(get_db),
                tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("view"))) -> dict[str, Any]:
    """Source, projected and actual target DQS per completed comparison, oldest first."""
    await _load_pair(db, tenant, pair_id)
    rows = (await db.execute(text("SELECT id, completed_at, scores, summary FROM system_comparisons "
                                  "WHERE pair_id = :p AND tenant_id = :t AND status = 'done' "
                                  "ORDER BY completed_at DESC LIMIT :n"),
                             {"p": pair_id, "t": str(tenant.id), "n": limit})).fetchall()
    return {"points": [{"comparison_id": str(r.id), "at": r.completed_at,
                        **{k: (r.scores or {}).get(k) for k in ("source", "projected", "actual")},
                        "missing_in_target": (r.summary or {}).get("missing_in_target"),
                        "differing_fields": (r.summary or {}).get("differing_fields")} for r in reversed(rows)]}


@router.get("/comparisons/{cid}/export", response_class=Response)
async def export(cid: uuid.UUID, format: Literal["xlsx", "csv"] = "xlsx", table: Optional[str] = None,
                 field: Optional[str] = None, kind: Optional[Literal["missing", "extra", "differing"]] = None,
                 q: Optional[str] = None, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                 _r: str = Depends(require_permission("export"))):
    """The difference grid as xlsx (tables, fields, records, config) or csv (records), with descriptions."""
    r = await _comparison(db, tenant, cid, "id, tables, records, config")
    rows = _rows(r, table, field, kind, q)
    rec_cols = [ColumnSpec("table", "Table", kind="mono"), ColumnSpec("table_text", "Table description"),
                ColumnSpec("kind", "Kind"), ColumnSpec("key", "Key", kind="mono"),
                ColumnSpec("field", "Field", kind="mono"), ColumnSpec("field_text", "Field description"),
                ColumnSpec("source", "Source value", kind="mono"), ColumnSpec("target", "Target value", kind="mono")]
    if format == "csv":
        return csv_response(rows, rec_cols, "system-compare", str(cid))
    tables = r.tables or []
    counts = ("in_source", "in_target", "matched", "missing_in_target", "extra_in_target", "key_mapped")
    fields = [{"table": t["table"], **{k: v for k, v in f.items() if k != "transformed"},
               "transformed": sum(f["transformed"].values())} for t in tables for f in t["fields"]]
    cfg = (r.config or {}).get("objects") or []
    data = build_workbook(
        tenant_name=tenant.name, run_label=None, run_id=str(cid), title="Source and target comparison",
        sheets=[
            SheetSpec(title="Tables", columns=[ColumnSpec("table", "Table", kind="mono"),
                                               ColumnSpec("description", "Description"),
                                               ColumnSpec("reason", "Not comparable because")]
                      + [ColumnSpec(k, k.replace("_", " ").capitalize(), kind="int") for k in counts],
                      rows=tables),
            SheetSpec(title="Fields", columns=[
                ColumnSpec("table", "Table", kind="mono"), ColumnSpec("field", "Field", kind="mono"),
                ColumnSpec("description", "Description"), ColumnSpec("compared", "Compared", kind="int"),
                ColumnSpec("equal", "Equal", kind="int"),
                ColumnSpec("transformed", "Equal after transformation", kind="int"),
                ColumnSpec("differing", "Differing", kind="int")], rows=fields),
            SheetSpec(title="Records", columns=rec_cols, rows=rows,
                      note="Record rows are capped per table and kind at comparison time."),
            SheetSpec(title="Config", columns=[ColumnSpec("object", "Object", kind="mono")] + [
                ColumnSpec(k, k.replace("_", " ").capitalize(), kind="int")
                for k in ("in_source", "in_target", "exists", "key_match", "desc_match", "missing", "only_in_target")],
                rows=cfg),
        ])
    return _stream(data, XLSX, f"system-compare-{cid}.xlsx")
