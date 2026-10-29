"""What else is true about one record: its other failing rules, its siblings, the features it holds up, where it came from.

GET /api/v1/records/{module}/{record_key}/links?run=&check_id=

  failing_rules  every rule the record fails in the run (check id, name, severity, field), worst first;
                 ``check_id`` leaves one out (the rule the inspector is already showing)
  variants       the same entity under other plants, company codes, sales areas or grains that fail something in the
                 run: keys with the same identifying parts (MATNR=1) and different organisational parts (WERKS=3000)
  features       config-impact features blocked or degraded by a rule this record fails
  provenance     the SAP tables behind the failing rules' fields, the run, when its system was last extracted before
                 the run, and the first 8 characters of the record's hash when one is stored
  history        the last 10 events on the record's issues (status changes, assignments, comments, reopenings)

Read-only, tenant-scoped, ``view`` permission. Every value comes from stored rows; one that is not stored is null.
``variants`` is null when the lookup ran out of its 1.5 s budget, never a partial list.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.rbac import require_permission
from api.services.receipt_math import rule_names
from api.services.run_context import latest_run

router = APIRouter(prefix="/api/v1/records", tags=["records"])

# Parts of a record key that say where a record lives, not which record it is.
ORG_PARTS = frozenset({"BUKRS", "WERKS", "VKORG", "VTWEG", "SPART", "EKORG", "LGORT", "LGNUM", "LGTYP", "BWKEY", "KOKRS",
                       "GJAHR", "MANDT", "SPRAS", "LANGU", "VKBUR", "VKGRP"})
_SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
MAX_VARIANTS = 25


class FailingRuleOut(BaseModel):
    check_id: str
    name: Optional[str] = None
    severity: Optional[str] = None
    dimension: Optional[str] = None
    field: Optional[str] = None             # TABLE.FIELD the rule checks


class VariantRuleOut(BaseModel):
    check_id: str
    severity: Optional[str] = None


class VariantOut(BaseModel):
    module: str
    record_key: str
    differs_in: dict[str, Optional[str]]    # the organisational parts that differ, e.g. {"WERKS": "1000"}
    failing: list[VariantRuleOut]


class VariantsOut(BaseModel):
    identity: str                           # the identifying parts shared by the variants, e.g. MATNR=000...101
    total: int                              # keys found; ``items`` holds the first 25
    items: list[VariantOut]


class FeatureOut(BaseModel):
    feature: str
    status: str                             # blocked | degraded
    because: list[str]                      # the record's failing rules behind it


class SourceTableOut(BaseModel):
    table: str
    fields: list[str]


class ProvenanceOut(BaseModel):
    source_tables: list[SourceTableOut]
    run_id: str
    run_at: Optional[datetime] = None
    system_id: Optional[str] = None
    system_name: Optional[str] = None
    extracted_at: Optional[datetime] = None  # newest completed extraction of the run's system at or before the run
    record_hash: Optional[str] = None        # first 8 characters of record_hashes.row_hash; null when not stored


class HistoryOut(BaseModel):
    check_id: str
    action: str
    from_value: Optional[str] = None
    to_value: Optional[str] = None
    note: Optional[str] = None
    user: Optional[str] = None
    at: Optional[datetime] = None


class RecordLinksOut(BaseModel):
    module: str
    record_key: str
    run_id: str
    failing_rules: list[FailingRuleOut]
    variants: Optional[VariantsOut] = None
    features: list[FeatureOut]
    provenance: ProvenanceOut
    history: list[HistoryOut]


def parse_key(record_key: str) -> list[tuple[Optional[str], str]]:
    """'MATNR=1|WERKS=3000' -> [('MATNR', '1'), ('WERKS', '3000')]; a bare part has no name."""
    out: list[tuple[Optional[str], str]] = []
    for part in record_key.split("|"):
        name, eq, value = part.partition("=")
        out.append((name, value) if eq else (None, part))
    return out


def identity_of(record_key: str) -> list[str]:
    """The parts that identify the record (everything that is not a plant, company code or sales area)."""
    return [f"{n}={v}" if n else v for n, v in parse_key(record_key) if n not in ORG_PARTS]


def _like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _table_of(field: Optional[str]) -> Optional[str]:
    return str(field).split(".", 1)[0] if field and "." in str(field) else None


def _touches(blocking: object, ids: set[str]) -> list[str]:
    items = blocking if isinstance(blocking, list) else []
    return sorted({c for c in ((i.get("check_id") if isinstance(i, dict) else i) for i in items) if c in ids})


@router.get("/{module}/{record_key:path}/links", response_model=RecordLinksOut,
            dependencies=[Depends(require_permission("view"))])
async def record_links(module: str, record_key: str,
                       run: Optional[str] = Query(None, description="a run id; default the object's latest finished run"),
                       check_id: Optional[str] = Query(None, max_length=64, description="leave this rule out of failing_rules"),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    t = str(tenant.id)
    if run:
        try:
            uuid.UUID(run)
        except ValueError:
            raise HTTPException(422, "run must be a run id")
    vid = run or await latest_run(db, tenant.id, module=module)
    if vid is None:
        raise HTTPException(404, "No finished run yet.")
    head = (await db.execute(text(
        "SELECT run_at, metadata->>'system_id' AS system_id FROM analysis_versions "
        "WHERE id = CAST(:v AS uuid) AND tenant_id = CAST(:t AS uuid)"), {"v": vid, "t": t})).mappings().first()
    if head is None:
        raise HTTPException(404, "Run not found.")

    rows = (await db.execute(text("""
        SELECT fr.check_id, f.severity, f.dimension, f.details->>'field_checked' AS field, f.details->>'message' AS message
          FROM finding_records fr
          JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id AND f.tenant_id = fr.tenant_id
         WHERE fr.tenant_id = CAST(:t AS uuid) AND fr.version_id = CAST(:v AS uuid) AND fr.module = :m AND fr.record_key = :k"""),
        {"t": t, "v": vid, "m": module, "k": record_key})).mappings().all()
    if not rows:
        raise HTTPException(404, "This record does not fail any check in this run.")

    from api.routes.work import _shipped_rule
    names = await rule_names(db, tenant, [r["check_id"] for r in rows])
    rules = []
    for r in sorted(rows, key=lambda r: (_SEV_RANK.get(r["severity"], 9), r["check_id"])):
        y = _shipped_rule(module, r["check_id"])
        rules.append({"check_id": r["check_id"], "name": names.get(r["check_id"]) or y.get("message") or r["message"],
                      "severity": r["severity"], "dimension": r["dimension"] or y.get("dimension"),
                      "field": r["field"] or y.get("field")})
    failing_ids = {r["check_id"] for r in rules}

    # features: blocked or degraded by a rule this record fails
    features = []
    for f in (await db.execute(text(
            "SELECT feature, status, blocking_findings FROM config_impact_results WHERE tenant_id = CAST(:t AS uuid) "
            "AND version_id = CAST(:v AS uuid) AND status IN ('blocked', 'degraded') ORDER BY status, feature"),
            {"t": t, "v": vid})).mappings().all():
        because = _touches(f["blocking_findings"], failing_ids)
        if because:
            features.append({"feature": f["feature"], "status": f["status"], "because": because})

    # provenance
    tables: dict[str, list[str]] = {}
    for r in rules:
        tb = _table_of(r["field"])
        if tb:
            tables.setdefault(tb, [])
            if r["field"] not in tables[tb]:
                tables[tb].append(r["field"])
    system_name = extracted_at = None
    if head["system_id"]:
        system_name = (await db.execute(text("SELECT name FROM sap_systems WHERE id = CAST(:s AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                                        {"s": head["system_id"], "t": t})).scalar()
        extracted_at = (await db.execute(text(
            "SELECT max(sr.completed_at) FROM sync_runs sr JOIN sync_profiles sp ON sp.id = sr.profile_id "
            "WHERE sp.system_id = CAST(:s AS uuid) AND sp.tenant_id = CAST(:t AS uuid) AND sr.tenant_id = CAST(:t AS uuid) "
            "AND sr.status = 'completed' AND sr.completed_at <= :at"), {"s": head["system_id"], "t": t, "at": head["run_at"]})).scalar()
    row_hash = (await db.execute(text(
        "SELECT row_hash FROM record_hashes WHERE tenant_id = CAST(:t AS uuid) AND module = :m AND record_key = :k"),
        {"t": t, "m": module, "k": record_key})).scalar()

    # history: events on this record's issues
    scope = head["system_id"] or "upload"
    history = [dict(r) for r in (await db.execute(text("""
        SELECT ri.check_id, e.action, e.from_value, e.to_value, e.note, e.user_label AS "user", e.created_at AS at
          FROM record_issue_events e JOIN record_issues ri ON ri.id = e.issue_id
         WHERE e.tenant_id = CAST(:t AS uuid) AND ri.tenant_id = CAST(:t AS uuid) AND ri.scope = :scope
           AND ri.module = :m AND ri.record_key = :k
         ORDER BY e.created_at DESC, e.id DESC LIMIT 10"""), {"t": t, "scope": scope, "m": module, "k": record_key})).mappings().all()]

    return {
        "module": module, "record_key": record_key, "run_id": vid,
        "failing_rules": [r for r in rules if r["check_id"] != check_id],
        "variants": await _variants(db, t, vid, module, record_key),
        "features": features,
        "provenance": {"source_tables": [{"table": k, "fields": v} for k, v in sorted(tables.items())],
                       "run_id": vid, "run_at": head["run_at"], "system_id": head["system_id"], "system_name": system_name,
                       "extracted_at": extracted_at, "record_hash": row_hash[:8] if row_hash else None},
        "history": history,
    }


async def _variants(db: AsyncSession, t: str, vid: str, module: str, record_key: str) -> Optional[dict]:
    """Keys of the run with this record's identifying parts and other organisational parts, each with what it fails.
    Under a short statement timeout: None when it cannot finish, so a slow table never holds the panel up."""
    ident = identity_of(record_key)
    if not ident:
        return {"identity": record_key, "total": 0, "items": []}
    mine = {n: v for n, v in parse_key(record_key) if n in ORG_PARTS}
    try:
        async with db.begin_nested():
            await db.execute(text("SET LOCAL statement_timeout = '1500ms'"))
            rows = (await db.execute(text("""
                SELECT fr.module, fr.record_key, fr.check_id, f.severity
                  FROM finding_records fr
                  JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id AND f.tenant_id = fr.tenant_id
                 WHERE fr.tenant_id = CAST(:t AS uuid) AND fr.version_id = CAST(:v AS uuid)
                   AND fr.record_key LIKE :pat ESCAPE '\\' AND NOT (fr.module = :m AND fr.record_key = :k)
                 LIMIT 20000"""), {"t": t, "v": vid, "pat": f"%{_like(ident[0])}%", "m": module, "k": record_key})).mappings().all()
            await db.execute(text("SET LOCAL statement_timeout = DEFAULT"))
    except SQLAlchemyError as e:
        logging.getLogger(__name__).info("record links: variants skipped for %s: %s", module, type(e).__name__)
        return None
    found: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        if identity_of(r["record_key"]) == ident:
            found.setdefault((r["module"], r["record_key"]), []).append({"check_id": r["check_id"], "severity": r["severity"]})
    items = []
    for (mod, key), failing in found.items():
        theirs = {n: v for n, v in parse_key(key) if n in ORG_PARTS}
        differs = {n: theirs.get(n) for n in sorted(set(mine) | set(theirs)) if mine.get(n) != theirs.get(n)}
        items.append({"module": mod, "record_key": key, "differs_in": differs,
                      "failing": sorted(failing, key=lambda x: (_SEV_RANK.get(x["severity"], 9), x["check_id"]))})
    items.sort(key=lambda i: (-len(i["failing"]), i["module"], i["record_key"]))
    return {"identity": "|".join(ident), "total": len(items), "items": items[:MAX_VARIANTS]}
