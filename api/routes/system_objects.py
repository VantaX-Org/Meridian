"""Business objects of a connected system → downloads as versions → trends per object.

  GET  /systems/{id}/objects     what can be downloaded, its tables and scope filters
  POST /systems/{id}/downloads   download chosen objects into a NEW version
                                 (analysed now, or later via POST /versions/{id}/analyse)
  GET  /systems/{id}/versions    this system's versions: objects, scope, records, status
  GET  /systems/{id}/trends      per object across versions: DQS, failing records,
                                 issues opened/resolved — with comparability flags
"""

import json
import uuid
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.deps import Tenant, get_db, get_tenant
from api.services import jobs
from api.services.rbac import require_permission, write_audit

router = APIRouter(prefix="/api/v1/systems", tags=["system-objects"])

# statuses that carry a finished analysis
_ANALYSED = ("complete", "agents_enqueued", "agents_running", "agents_complete", "agents_failed",
             "ai_enriching", "ai_enriched")
VOLUME_SHIFT = 0.2  # >20 % change in an object's record count flags the trend point


class DownloadBody(BaseModel):
    objects: list[str] = Field(min_length=1)
    scope: dict = {}
    label: Optional[str] = Field(default=None, max_length=120)
    analyse: bool = False


async def _rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})


async def _system_type(db: AsyncSession, system_id: uuid.UUID) -> str:
    st = (await db.execute(text("SELECT system_type FROM sap_systems WHERE id = :s"), {"s": system_id})).scalar()
    if st is None:
        raise HTTPException(status_code=404, detail="System not found")
    return st


def _catalogue(system_id: str, system_type: str, tenant_id: str) -> list[dict]:
    from sqlalchemy.orm import Session

    from api.services.source_design import latest_snapshot_id
    from workers.db import get_sync_engine

    with Session(get_sync_engine()) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tenant_id})
        snap = latest_snapshot_id(s, system_id)
    return [dict(o) for o in _catalogue_for(system_id, system_type, tenant_id, str(snap) if snap else None)]


_CATALOGUE_KEY = "object_catalogue"
_REBUILD_LOCK = __import__("threading").Lock()
_REBUILDING: set = set()


def get_sync_engine_for_background():
    """The sync engine, imported here so this module does not need workers at import time."""
    from workers.db import get_sync_engine

    return get_sync_engine()


@lru_cache(maxsize=1)
def _catalogue_fingerprint() -> str:
    """What the catalogue depends on besides the snapshot: the app version, the rule pack and
    dictionaries (YAML under checks/ and sap/dictionaries/) and the planning code. A stored
    catalogue built with other inputs (an update shipped new rules or tables) is rebuilt.
    """
    import hashlib
    from pathlib import Path

    import checks.frames
    import checks.runner
    import sap.extraction_plan
    from api.services.version import APP_VERSION

    root = Path(__file__).resolve().parents[2]
    h = hashlib.sha256(APP_VERSION.encode())
    files = sorted({*(root / "checks").rglob("*.yaml"), *(root / "sap" / "dictionaries").rglob("*.yaml"),
                    *(Path(m.__file__) for m in (sap.extraction_plan, checks.runner, checks.frames))})
    for f in files:
        try:
            h.update(str(f.relative_to(root)).encode() + b"\0" + f.read_bytes())
        except (OSError, ValueError):
            continue
    return h.hexdigest()[:16]


def _stored_catalogue(session, tenant_id: str, snapshot: Optional[str],
                      *, allow_stale: bool = False) -> Optional[tuple]:
    """The catalogue saved against this discovery snapshot, if built from the current inputs.

    ``allow_stale`` returns the last catalogue even when the inputs changed. The fingerprint covers
    APP_VERSION, so every update invalidates it - and rebuilding takes minutes, which meant the
    Objects screen timed out after each deploy until somebody warmed it. Serving the previous
    catalogue while the new one is built in the background keeps the screen usable; only the very
    first request on a fresh snapshot has nothing to serve.
    """
    if not snapshot:
        return None
    row = session.execute(text(
        "SELECT system_info -> :k FROM ddic_snapshots WHERE id = CAST(:s AS uuid) AND tenant_id = CAST(:t AS uuid)"),
        {"k": _CATALOGUE_KEY, "s": snapshot, "t": tenant_id}).scalar()
    if not isinstance(row, dict):
        return None  # a bare list is the pre-fingerprint format: not usable
    objects = tuple(row.get("objects") or ())
    if row.get("fingerprint") != _catalogue_fingerprint():
        return objects if (allow_stale and objects) else None
    return objects or None


def _store_catalogue(session, tenant_id: str, snapshot: Optional[str], payload: tuple) -> None:
    if not snapshot:
        return
    session.execute(text(
        "UPDATE ddic_snapshots SET system_info = COALESCE(system_info, '{}'::jsonb) "
        "|| jsonb_build_object(:k, CAST(:p AS jsonb)) WHERE id = CAST(:s AS uuid) AND tenant_id = CAST(:t AS uuid)"),
        {"k": _CATALOGUE_KEY, "s": snapshot, "t": tenant_id,
         "p": json.dumps({"fingerprint": _catalogue_fingerprint(), "objects": list(payload)})})
    session.commit()


def _rebuild_in_background(system_id: str, system_type: str, tenant_id: str,
                           snapshot: Optional[str]) -> None:
    """Rebuild the catalogue without blocking the caller (one at a time per process)."""
    import threading

    with _REBUILD_LOCK:
        if _REBUILDING:
            return
        _REBUILDING.add(snapshot)

    def work() -> None:
        try:
            _catalogue_for.cache_clear()
            with Session(get_sync_engine_for_background()) as s:
                s.execute(text("SET app.tenant_id = :t"), {"t": tenant_id})
                from api.services.source_design import dictionary_for
                from sap.extraction_plan import MODULES_BY_SYSTEM, SCOPE_FIELDS, _windows, plan_modules

                dictionary = dictionary_for(s, system_id, system_type)
                windows = _windows()
                out = []
                for m in MODULES_BY_SYSTEM.get(system_type, []):
                    plans = plan_modules([m], dictionary)
                    data = sorted(t for t, p in plans.items() if p.purpose == "data")
                    out.append({
                        "object": m,
                        "tables": data,
                        "config_tables": sorted(t for t, p in plans.items() if p.purpose == "config"),
                        "scope_filters": [k for k, f in SCOPE_FIELDS.items()
                                          if any(dictionary.field(t, f) is not None for t in data)],
                        "date_window": sorted(t for t in data if (windows.get(t) or {}).get("where")),
                    })
                _store_catalogue(s, tenant_id, snapshot, tuple(out))
        except Exception:  # never let the warm-up break a request
            import logging
            logging.getLogger("meridian.system_objects").exception(
                "catalogue rebuild failed for %s", system_id)
        finally:
            with _REBUILD_LOCK:
                _REBUILDING.discard(snapshot)

    threading.Thread(target=work, name=f"catalogue-{system_id[:8]}", daemon=True).start()


@lru_cache(maxsize=64)
def _catalogue_for(system_id: str, system_type: str, tenant_id: str, snapshot: Optional[str]) -> tuple:
    """Every object with the tables it reads.

    Planning all 29 modules is minutes - material_master alone is ~17 s here, and the endpoint used
    to exceed any client timeout, so the screen rendered empty and objects looked like they had no
    tables. The result depends only on the system's discovery snapshot, so it is built once and
    stored against that snapshot in ddic_snapshots.system_info; later requests read it back.
    """
    from sqlalchemy.orm import Session

    from api.services.source_design import dictionary_for
    from sap.extraction_plan import MODULES_BY_SYSTEM, SCOPE_FIELDS, _windows, plan_modules
    from workers.db import get_sync_engine

    with Session(get_sync_engine()) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tenant_id})
        cached = _stored_catalogue(s, tenant_id, snapshot)
        if cached:
            return cached
        # Stale but usable: answer now and rebuild off the request path.
        stale = _stored_catalogue(s, tenant_id, snapshot, allow_stale=True)
        dictionary = dictionary_for(s, system_id, system_type)
    if stale:
        _rebuild_in_background(system_id, system_type, tenant_id, snapshot)
        return stale
    windows = _windows()
    out = []
    for m in MODULES_BY_SYSTEM.get(system_type, []):
        plans = plan_modules([m], dictionary)
        data = sorted(t for t, p in plans.items() if p.purpose == "data")
        out.append({
            "object": m,
            "tables": data,
            "config_tables": sorted(t for t, p in plans.items() if p.purpose == "config"),
            "scope_filters": [k for k, f in SCOPE_FIELDS.items()
                              if any(dictionary.field(t, f) is not None for t in data)],
            "date_window": sorted(t for t in data if (windows.get(t) or {}).get("where")),
        })
    built = tuple(out)
    with Session(get_sync_engine()) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tenant_id})
        _store_catalogue(s, tenant_id, snapshot, built)
    return built


@router.get("/{system_id}/objects", dependencies=[Depends(require_permission("view"))])
async def list_objects(system_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    st = await _system_type(db, system_id)
    objects = await run_in_threadpool(_catalogue, str(system_id), st, str(tenant.id))
    last = {r.module: r for r in (await db.execute(text("""
        SELECT DISTINCT ON (m.module) m.module, v.id, v.run_at, v.status,
               (v.metadata->'object_rows'->>m.module)::int AS records
          FROM analysis_versions v, jsonb_array_elements_text(v.metadata->'modules') AS m(module)
         WHERE v.metadata->>'system_id' = :sid
         ORDER BY m.module, v.run_at DESC
    """), {"sid": str(system_id)})).fetchall()}
    from sap.extraction_registry import preview_sources
    preview: dict[str, list[dict]] = {}
    for p in preview_sources(st):
        preview.setdefault(p["module"], []).append({"source": p["source"], "reason": p["reason"]})
    for o in objects:
        # registry sources whose names are not yet verified against SAP (Preview badge)
        o["preview_sources"] = preview.get(o["object"], [])
        r = last.get(o["object"])
        o["last_download"] = None if not r else {"version_id": str(r.id), "at": r.run_at.isoformat(),
                                                 "status": r.status, "records": r.records}
    return {"system_type": st, "objects": objects}


@router.post("/{system_id}/downloads", status_code=202, dependencies=[Depends(require_permission("trigger_sync"))])
async def start_download(system_id: uuid.UUID, body: DownloadBody, request: Request,
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Download the chosen objects into a new version. Every download is a new version."""
    from api.middleware.licence import enforce_licensed_modules
    from sap.extraction_plan import MODULES_BY_SYSTEM, normalise_scope
    from workers.tasks.run_extraction import run_extraction

    await _rls(db, tenant)
    st = await _system_type(db, system_id)
    unknown = sorted(set(body.objects) - set(MODULES_BY_SYSTEM.get(st, [])))
    if unknown:
        raise HTTPException(status_code=400, detail=f"Not available for a {st} system: {', '.join(unknown)}")
    try:
        scope = normalise_scope(body.scope)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    enforce_licensed_modules(request, body.objects)
    version_id = str(uuid.uuid4())
    jobs.start_job(str(tenant.id), f"dl-{version_id}", "extraction", body.label or ", ".join(body.objects),
                   status="queued", system_id=str(system_id), modules=body.objects, version_id=version_id,
                   retry={"via": "downloads", "body": body.model_dump(mode="json")})
    task = run_extraction.delay(str(tenant.id), str(system_id), body.objects, True, "both",
                                scope, body.analyse, body.label, version_id)
    jobs.set_task_ids(str(tenant.id), f"dl-{version_id}", [getattr(task, "id", None)])
    return {"job_id": f"dl-{version_id}", "version_id": version_id, "status": "queued", "objects": body.objects,
            "scope": scope, "analyse": body.analyse}


@router.get("/{system_id}/versions", dependencies=[Depends(require_permission("view"))])
async def system_versions(system_id: uuid.UUID, limit: int = Query(50, le=200),
                          db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    rows = (await db.execute(text("""
        SELECT id, run_at, label, status, metadata, dqs_summary FROM analysis_versions
         WHERE metadata->>'system_id' = :sid AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
         ORDER BY run_at DESC LIMIT :limit
    """), {"sid": str(system_id), "limit": limit})).fetchall()
    out = []
    for r in rows:
        meta, dqs = r.metadata or {}, r.dqs_summary or {}
        out.append({
            "id": str(r.id), "run_at": r.run_at.isoformat(), "label": r.label, "status": r.status,
            "objects": meta.get("modules", []), "scope": meta.get("scope", {}),
            "records": meta.get("object_rows") or meta.get("module_rows") or {},
            "analysed_at": meta.get("analysed_at"), "rule_set": meta.get("rule_set"),
            "baseline": meta.get("baseline") is True,
            "extraction_complete": meta.get("extraction_complete"),
            # per-table read status; anything not read completely is listed with its reason
            "coverage": {"read": sum(1 for c in meta.get("coverage") or [] if c.get("status") == "live"),
                         "issues": [{"table": c.get("table"), "status": c.get("status"), "rows": c.get("rows"),
                                     "source_rows": c.get("source_rows"), "detail": c.get("detail")}
                                    for c in meta.get("coverage") or []
                                    if c.get("status") != "live" or c.get("complete") is False]},
            "outliers": {k: {"label": v.get("label"), "outliers": v.get("outliers", 0), "checked": v.get("checked", 0)}
                         for k, v in (meta.get("outliers") or {}).items()},
            "analysable": bool(meta.get("dataset_path")) and r.status not in ("pending", "running"),
            "dqs": {m: (d or {}).get("composite_score") for m, d in dqs.items()},
            # rules generated from the system's field-status customizing, per segment
            "field_status": [{"segment": f.get("segment"), "definition": f.get("definition"),
                              "reason": f.get("reason"), "rules": f.get("rules", 0)}
                             for f in meta.get("field_status") or [] if isinstance(f, dict)],
        })
    from api.services.task_progress import get_task_progress
    from workers.tasks.run_extraction import progress_key
    # the download in flight (or just finished/failed) — drives the progress bar
    return {"versions": out, "download": get_task_progress(progress_key(system_id))}


@router.get("/{system_id}/trends", dependencies=[Depends(require_permission("view"))])
async def trends(system_id: uuid.UUID, object: Optional[str] = None, all_series: bool = False,
                 db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Each analysed version is a point. A point is `comparable` with the one
    before it only when scope, rule set and (±20 %) record volume are unchanged.
    ``all_series`` returns every object's points (the object × version heatmap)."""
    await _rls(db, tenant)
    versions = (await db.execute(text(f"""
        SELECT id, run_at, label, metadata, dqs_summary FROM analysis_versions
         WHERE metadata->>'system_id' = :sid AND status IN {_ANALYSED} AND dqs_summary IS NOT NULL
           AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
         ORDER BY run_at
    """), {"sid": str(system_id)})).fetchall()
    ids = [v.id for v in versions]
    stats: dict[tuple[str, str], dict] = {}
    if ids:
        for q, key in (
            ("SELECT version_id, module, COUNT(DISTINCT record_key) FROM finding_records "
             "WHERE version_id = ANY(:ids) GROUP BY 1, 2", "failing_records"),
            ("SELECT version_id, module, COUNT(*) FILTER (WHERE affected_count > 0) FROM findings "
             "WHERE version_id = ANY(:ids) GROUP BY 1, 2", "failing_checks"),
            ("SELECT first_seen_version, module, COUNT(*) FROM record_issues "
             "WHERE first_seen_version = ANY(:ids) GROUP BY 1, 2", "issues_opened"),
            ("SELECT resolved_version, module, COUNT(*) FROM record_issues "
             "WHERE resolved_version = ANY(:ids) AND resolution = 'verified_fixed' GROUP BY 1, 2", "issues_resolved"),
        ):
            for vid, mod, n in (await db.execute(text(q), {"ids": ids})).fetchall():
                stats.setdefault((str(vid), mod), {})[key] = n

    series: dict[str, list[dict]] = {}
    for v in versions:
        meta, dqs = v.metadata or {}, v.dqs_summary or {}
        rows = meta.get("object_rows") or meta.get("module_rows") or {}
        for m, d in dqs.items():
            if object and m != object:
                continue
            s = stats.get((str(v.id), m), {})
            pts = series.setdefault(m, [])
            point = {
                "version_id": str(v.id), "run_at": v.run_at.isoformat(), "label": v.label,
                "baseline": meta.get("baseline") is True,
                "dqs": (d or {}).get("composite_score"), "dimensions": (d or {}).get("dimension_scores") or {},
                "records": rows.get(m), "failing_records": s.get("failing_records", 0),
                "failing_checks": s.get("failing_checks", 0), "issues_opened": s.get("issues_opened", 0),
                "issues_resolved": s.get("issues_resolved", 0),
                "scope": meta.get("scope", {}), "rule_set": meta.get("rule_set"),
            }
            flags = []
            point["incomplete"] = meta.get("extraction_complete") is False
            if point["incomplete"] or (pts and pts[-1].get("incomplete")):
                flags.append("incomplete_extract")
            if pts:
                prev = pts[-1]
                if prev["scope"] != point["scope"]:
                    flags.append("scope_changed")
                if prev["rule_set"] and point["rule_set"] and prev["rule_set"] != point["rule_set"]:
                    flags.append("rules_changed")
                if prev["records"] and point["records"] is not None and \
                        abs(point["records"] - prev["records"]) / prev["records"] > VOLUME_SHIFT:
                    flags.append("volume_shift")
                if prev["dqs"] is not None and point["dqs"] is not None:
                    point["dqs_delta"] = round(point["dqs"] - prev["dqs"], 2)
                point["failing_records_delta"] = point["failing_records"] - prev["failing_records"]
            point["comparable"] = not flags
            point["flags"] = flags
            pts.append(point)

    summary = []
    for m, pts in sorted(series.items()):
        last, base = pts[-1], next((p for p in reversed(pts[:-1]) if p["baseline"]), pts[0] if len(pts) > 1 else None)
        summary.append({
            "object": m, "points": len(pts), "dqs": last["dqs"], "dqs_delta": last.get("dqs_delta"),
            "failing_records": last["failing_records"], "failing_records_delta": last.get("failing_records_delta"),
            "comparable": last["comparable"], "flags": last["flags"],
            "vs_baseline": None if not base or base["dqs"] is None or last["dqs"] is None else {
                "version_id": base["version_id"], "pinned": base["baseline"],
                "dqs_delta": round(last["dqs"] - base["dqs"], 2),
                "failing_records_delta": last["failing_records"] - base["failing_records"]},
        })
    return {"summary": summary, "series": series if object or all_series else {}}


# ── Customer reference lists (licensed data that never comes from SAP) ─────────
_REF_COUNTRY = r"^[A-Z0-9]{2,3}$"
_REF_POSTCODE = r"^[A-Z0-9][A-Z0-9 \-]{0,9}$"
_REF_MAX_ROWS = 2_000_000


class ReferenceSummary(BaseModel):
    kind: str
    records: int
    countries: list[str]


@router.post("/{system_id}/reference/postal-codes", response_model=ReferenceSummary,
             dependencies=[Depends(require_permission("manage_systems"))])
async def upload_postal_codes(system_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                              tenant: Tenant = Depends(get_tenant)):
    """Official postal codes as CSV (country,postcode — SAP country key). Every partner
    address in a listed country is then checked against the list (PX- rules)."""
    import csv
    import io
    import re

    raw = (await request.body())[: 64 * 1024 * 1024]
    try:
        text_body = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "The file must be UTF-8 text (CSV: country,postcode).")
    rows, bad = set(), 0
    for i, rec in enumerate(csv.reader(io.StringIO(text_body))):
        if len(rec) < 2:
            continue
        country, postcode = rec[0].strip().upper(), rec[1].strip().upper()
        if i == 0 and country in ("COUNTRY", "LAND1"):
            continue  # header
        if re.fullmatch(_REF_COUNTRY, country) and re.fullmatch(_REF_POSTCODE, postcode):
            rows.add((country, postcode))
        else:
            bad += 1
        if len(rows) > _REF_MAX_ROWS:
            raise HTTPException(413, f"More than {_REF_MAX_ROWS:,} postal codes.")
    if not rows:
        raise HTTPException(400, "No valid rows (expected CSV columns: country,postcode).")
    if bad > len(rows):
        raise HTTPException(400, f"{bad} rows are not 'country,postcode' — check the file layout.")
    await _store_reference(db, tenant, system_id, "REF_POSTAL", [{"COUNTRY": c, "POSTCODE": p} for c, p in sorted(rows)])
    return ReferenceSummary(kind="postal-codes", records=len(rows), countries=sorted({c for c, _ in rows}))


_BIC_RE = r"^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$"


@router.post("/{system_id}/reference/bic", response_model=ReferenceSummary,
             dependencies=[Depends(require_permission("manage_systems"))])
async def upload_bic_directory(system_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                               tenant: Tenant = Depends(get_tenant)):
    """The customer's licensed SWIFT BIC directory as CSV (first column: BIC; BIC8 is read as
    the head office, BIC8 + 'XXX'). Every bank's BIC in a covered country is then checked
    against it (BX-BNKA)."""
    import csv
    import io
    import re

    raw = (await request.body())[: 64 * 1024 * 1024]
    try:
        text_body = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "The file must be UTF-8 text (CSV, first column: BIC).")
    bics, bad = set(), 0
    for i, rec in enumerate(csv.reader(io.StringIO(text_body))):
        if not rec or not rec[0].strip():
            continue
        bic = rec[0].strip().upper()
        if i == 0 and bic in ("BIC", "SWIFT", "BIC11", "BICCODE"):
            continue  # header
        if re.fullmatch(_BIC_RE, bic):
            bics.add(bic + "XXX" if len(bic) == 8 else bic)
        else:
            bad += 1
        if len(bics) > _REF_MAX_ROWS:
            raise HTTPException(413, f"More than {_REF_MAX_ROWS:,} BICs.")
    if not bics:
        raise HTTPException(400, "No valid BICs (expected CSV, first column: BIC).")
    if bad > len(bics):
        raise HTTPException(400, f"{bad} rows are not a BIC — check the file layout.")
    await _store_reference(db, tenant, system_id, "REF_BIC", [{"BIC": b, "COUNTRY": b[4:6]} for b in sorted(bics)])
    return ReferenceSummary(kind="bic", records=len(bics), countries=sorted({b[4:6] for b in bics}))


async def _store_reference(db: AsyncSession, tenant: Tenant, system_id: uuid.UUID, table: str,
                           data: list[dict]) -> None:
    import json

    await _rls(db, tenant)
    exists = (await db.execute(text("SELECT 1 FROM sap_systems WHERE id = :sid"), {"sid": str(system_id)})).scalar()
    if not exists:
        raise HTTPException(404, "System not found")
    await db.execute(text("""
        INSERT INTO config_snapshots (id, tenant_id, system_id, module, config_table, config_data,
                                      record_count, source, synced_at)
        VALUES (gen_random_uuid(), :tid, :sid, 'reference', :tbl, CAST(:data AS jsonb), :cnt,
                'reference', now())
        ON CONFLICT (tenant_id, system_id, module, config_table)
        DO UPDATE SET config_data = CAST(:data AS jsonb), record_count = :cnt, source = 'reference', synced_at = now()
    """), {"tid": str(tenant.id), "sid": str(system_id), "tbl": table, "data": json.dumps(data), "cnt": len(data)})
    await db.commit()


@router.get("/{system_id}/reference", response_model=list[ReferenceSummary],
            dependencies=[Depends(require_permission("view"))])
async def reference_lists(system_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    rows = (await db.execute(text("""
        SELECT config_table, record_count,
               (SELECT array_agg(DISTINCT e->>'COUNTRY') FROM jsonb_array_elements(config_data) e) AS countries
          FROM config_snapshots WHERE system_id = :sid AND source = 'reference' ORDER BY config_table
    """), {"sid": str(system_id)})).fetchall()
    kinds = {"REF_POSTAL": "postal-codes", "REF_BIC": "bic"}
    return [ReferenceSummary(kind=kinds.get(r[0], r[0]), records=r[1] or 0, countries=sorted(r[2] or []))
            for r in rows]


_REFERENCE_TABLES = {"postal-codes": "REF_POSTAL", "bic": "REF_BIC", "REF_POSTAL": "REF_POSTAL", "REF_BIC": "REF_BIC"}


@router.delete("/{system_id}/reference/{name}", dependencies=[Depends(require_permission("manage_systems"))])
async def delete_reference_list(system_id: uuid.UUID, name: str, request: Request, db: AsyncSession = Depends(get_db),
                                tenant: Tenant = Depends(get_tenant)):
    """Remove an uploaded reference list (``postal-codes`` or ``bic``, as GET lists them). 404 when the system has no such
    list; 409 while an enabled rule of the tenant (one a steward authored or mined) names it. The checks generated from
    the list (PX-, BX-BNKA) stop with it from the next analysis."""
    table = _REFERENCE_TABLES.get(name)
    if table is None:
        raise HTTPException(404, "Reference list not found")
    await _rls(db, tenant)
    row = (await db.execute(text(
        "SELECT id, record_count FROM config_snapshots WHERE tenant_id = :t AND system_id = :s "
        "AND source = 'reference' AND config_table = :tbl FOR UPDATE"),
        {"t": str(tenant.id), "s": str(system_id), "tbl": table})).fetchone()
    if row is None:
        raise HTTPException(404, "Reference list not found")
    kind = "postal-codes" if table == "REF_POSTAL" else "bic"
    users = [r[0] for r in (await db.execute(text(
        "SELECT name FROM rules WHERE tenant_id = :t AND enabled AND (conditions::text ILIKE :a OR conditions::text ILIKE :b) "
        "UNION SELECT rule_id FROM rule_versions WHERE tenant_id = :t AND state = 'active' "
        "AND (body::text ILIKE :a OR body::text ILIKE :b) ORDER BY 1 LIMIT 10"),
        {"t": str(tenant.id), "a": f"%{table}%", "b": f"%{kind}%"})).fetchall()]
    if users:
        raise HTTPException(409, f"Rules still use this list: {', '.join(users)}. Disable or change them first.")
    await db.execute(text("DELETE FROM config_snapshots WHERE id = :i AND tenant_id = :t"),
                     {"i": str(row[0]), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "reference_list.delete", "reference_list", f"{system_id}:{kind}",
                      {"kind": kind, "system_id": str(system_id), "records": row[1] or 0}, None)
    await db.commit()
    return {"kind": kind, "system_id": str(system_id), "status": "deleted", "records": row[1] or 0}
