"""Aletheia anomaly-to-rule: propose a deterministic rule for a detected anomaly, dry-run it, show its hits.

Approving is the existing rule-authoring path: POST /api/v1/rule-authoring/drafts with the proposed YAML.
"""

import json
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes import rule_authoring as route
from api.routes.mining import field_text
from api.routes.record_issues import _rls
from api.services import anomaly_rules as ar
from api.services import anomaly_shifts as sh
from api.services import rule_authoring as ra
from api.services.rbac import current_user_label, require_permission

router = APIRouter(prefix="/api/v1/aletheia/anomaly-rules", tags=["aletheia"])


class AnomalyPayload(BaseModel):
    """An anomaly as aggregates: field, statistic, counts. Never a record."""
    kind: Literal["outlier", "null_spike", "unexpected_code"]
    module: str = Field(min_length=1, max_length=64)
    field: str = Field(min_length=3, max_length=128)  # TABLE.FIELD
    severity: Literal["critical", "high", "medium", "low"] = "medium"
    lower: Optional[float] = None
    upper: Optional[float] = None
    known_values: list[str] = Field(default_factory=list, max_length=200)
    method: Optional[str] = Field(None, max_length=32)
    z_score: Optional[float] = None
    count: Optional[int] = Field(None, ge=0)


class ProposeIn(BaseModel):
    anomaly_id: Optional[uuid.UUID] = None  # a data_anomalies row (GET /mining/anomalies)
    payload: Optional[AnomalyPayload] = None
    system_id: Optional[uuid.UUID] = None


async def _from_row(db: AsyncSession, tenant: Tenant, anomaly_id: uuid.UUID) -> dict:
    await _rls(db, tenant)
    r = (await db.execute(text("""
        SELECT module_id, field_name, severity, detection_method, z_score::float,
               (bounds_json->>'lower')::float, (bounds_json->>'upper')::float,
               (SELECT count(*) FROM data_anomalies b WHERE b.tenant_id = a.tenant_id AND b.version_id = a.version_id
                   AND b.module_id = a.module_id AND b.field_name = a.field_name)
          FROM data_anomalies a WHERE a.id = :id AND a.tenant_id = :tid"""),
        {"id": str(anomaly_id), "tid": str(tenant.id)})).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Anomaly not found")
    return {"kind": "outlier", "module": r[0], "field": r[1], "severity": r[2], "method": r[3], "z_score": r[4],
            "lower": r[5], "upper": r[6], "count": int(r[7])}


@router.post("/propose")
async def propose(
    body: ProposeIn,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("manage_rules")),
):
    """Proposed rule YAML, its dry-run hit count against the module's latest extraction, and the grounding."""
    if bool(body.anomaly_id) == bool(body.payload):
        raise HTTPException(status_code=422, detail="Send anomaly_id or payload, not both or neither.")
    a = await _from_row(db, tenant, body.anomaly_id) if body.anomaly_id else body.payload.model_dump()
    module = a["module"]
    latest = await route._latest(db, tenant, module, body.system_id)
    d = await route._dictionary(db, latest[1] if latest else None)

    rule, source = ar.template_rule(a), "template"
    out = ar.to_yaml(rule) if rule else None
    if out is None:  # fallback: the LLM drafts from the aggregate summary through the existing generator
        from llm.provider import is_llm_disabled
        source = "llm"
        if not is_llm_disabled():
            ctx = ra.prompt_context(module, {}, d)
            if a["field"] not in {f["field"] for f in ctx["fields"]}:
                ctx["fields"].append(ra.field_context(a["field"], d, None))
            out = await run_in_threadpool(ra.generate, str(tenant.id), ar.describe(a), ctx)
    if out is None:
        return {"rule_yaml": None, "rule": None, "valid": False, "source": source, "version_id": None,
                "errors": ["No template fits this anomaly and AI drafting is unavailable."],
                "dry_run": {"evaluated": False, "reason": "no rule proposed"},
                "grounding": _grounding(a, source, False, {"evaluated": False}), "confidence": None}

    rule, errors = ra.validate_rule_yaml(out, module, d)
    dry: dict = {"evaluated": False, "reason": "the rule is not valid"}
    if not errors:
        try:  # the existing dry-run route: local evaluation, masked sample
            dry = await route.dry_run(route.RuleIn(module=module, rule_yaml=out, system_id=body.system_id),
                                      db, tenant, _perm)
        except HTTPException as e:
            dry = {"evaluated": False, "reason": e.detail}
    return {"rule_yaml": out, "rule": rule, "valid": not errors, "errors": errors, "source": source,
            "version_id": dry.get("version_id"), "dry_run": dry,
            "grounding": _grounding(a, source, not errors, dry),
            "confidence": ar.confidence(source, not errors, dry)}


def _grounding(a: dict, source: str, valid: bool, dry: dict) -> dict:
    """What the proposal rests on: the anomaly's aggregates, the DDIC text of its field, and the dry run's agreement."""
    return {"kind": a["kind"], "module": a["module"], "field": a["field"],
            "field_description": field_text(a["field"], a["module"]),
            "statistic": {k: a.get(k) for k in ("method", "z_score", "lower", "upper")},
            "anomaly_count": a.get("count"), "rule_hits": dry.get("hits"), "population": dry.get("population"),
            "ai_sent": ["field", "statistic", "counts"] if source == "llm" else []}


class ShiftCounts(BaseModel):
    rows: Optional[int] = None
    blank: Optional[int] = None
    blank_pct: Optional[float] = None
    distinct: Optional[int] = None


class ShiftCode(BaseModel):
    value: str
    count: int


class ShiftOut(BaseModel):
    id: str
    version_id: str
    prev_version_id: Optional[str] = None
    run_number: Optional[int] = None
    prev_run_number: Optional[int] = None
    module: str
    field: str  # TABLE.FIELD
    field_description: Optional[str] = None
    kind: Literal["null_spike", "unexpected_code"]
    severity: Literal["critical", "high", "medium", "low"]
    current: ShiftCounts
    previous: ShiftCounts
    codes: list[ShiftCode]
    detected_at: str


@router.get("/shifts", response_model=list[ShiftOut], dependencies=[Depends(require_permission("view"))])
async def shifts(version_id: Optional[uuid.UUID] = None, limit: int = Query(200, ge=1, le=1000),
                 db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> list[ShiftOut]:
    """Null spikes and unexpected codes found by comparing a run's field profile with earlier runs (aggregates only).

    Without ``version_id``: each object's most recent run that has any."""
    await _rls(db, tenant)
    rows = (await db.execute(text("""
        SELECT s.id::text, s.version_id::text, s.prev_version_id::text, v.run_number, pv.run_number,
               s.module, s.table_name, s.field, s.kind, s.severity, s.current, s.previous, s.codes, s.detected_at::text
          FROM field_shift_anomalies s
          JOIN analysis_versions v ON v.id = s.version_id
          LEFT JOIN analysis_versions pv ON pv.id = s.prev_version_id
         WHERE s.tenant_id = :tid
           AND (CAST(:vid AS uuid) IS NOT NULL AND s.version_id = CAST(:vid AS uuid)
                OR CAST(:vid AS uuid) IS NULL AND s.version_id = (
                    SELECT x.version_id FROM field_shift_anomalies x JOIN analysis_versions xv ON xv.id = x.version_id
                     WHERE x.tenant_id = s.tenant_id AND x.module = s.module ORDER BY xv.run_at DESC LIMIT 1))
         ORDER BY CASE s.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  s.module, s.table_name, s.field
         LIMIT :n"""), {"tid": str(tenant.id), "vid": str(version_id) if version_id else None, "n": limit})).fetchall()
    return [ShiftOut(id=r[0], version_id=r[1], prev_version_id=r[2], run_number=r[3], prev_run_number=r[4],
                     module=r[5], field=f"{r[6]}.{r[7]}", field_description=field_text(f"{r[6]}.{r[7]}", r[5]),
                     kind=r[8], severity=r[9], current=r[10] or {}, previous=r[11] or {}, codes=r[12] or [],
                     detected_at=r[13]) for r in rows]


class ShiftIn(BaseModel):
    table: str = Field(min_length=1, max_length=64)
    field: str = Field(min_length=1, max_length=64)  # the field alone, not TABLE.FIELD
    kind: Literal["null_spike", "unexpected_code"]
    version_id: Optional[uuid.UUID] = None  # default: the shift of the latest run


@router.post("/shifts/propose")
async def propose_from_shift(
    body: ShiftIn,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("manage_rules")),
):
    """Draft rule for a detected shift, saved as a pending draft (ai_proposed_rules, status 'draft': nothing enforces it
    until a human publishes it). Built from profile aggregates only; asking twice returns the same draft."""
    await _rls(db, tenant)
    p = {"tid": str(tenant.id), "t": body.table, "f": body.field, "k": body.kind,
         "vid": str(body.version_id) if body.version_id else None}
    s = (await db.execute(text("""
        SELECT s.module, s.severity, s.prev_version_id::text FROM field_shift_anomalies s
          JOIN analysis_versions v ON v.id = s.version_id
         WHERE s.tenant_id = :tid AND s.table_name = :t AND s.field = :f AND s.kind = :k
           AND (CAST(:vid AS uuid) IS NULL OR s.version_id = CAST(:vid AS uuid))
         ORDER BY v.run_at DESC LIMIT 1"""), p)).fetchone()
    if not s:
        raise HTTPException(status_code=404, detail="Shift not found")
    module, severity, prev_vid = s[0], s[1], s[2]
    prev = None
    if prev_vid:
        r = (await db.execute(text("""
            SELECT stats FROM field_profiles WHERE tenant_id = :tid AND version_id = CAST(:pv AS uuid)
               AND module = :m AND table_name = :t AND field = :f"""),
            {**p, "pv": prev_vid, "m": module})).fetchone()
        prev = r[0] if r else None
    qualified = f"{body.table}.{body.field}"
    rule, why = sh.shift_rule(body.kind, qualified, severity, prev)
    if rule is None:
        raise HTTPException(status_code=422, detail={"errors": [why]})
    latest = await route._latest(db, tenant, module, None)
    d = await route._dictionary(db, latest[1] if latest else None)
    rule, errors = ra.validate_rule_yaml(ar.to_yaml(rule), module, d)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})
    domain = f"dq_rule:{module}"
    old = (await db.execute(text("""
        SELECT id FROM ai_proposed_rules WHERE tenant_id = :tid AND domain = :d AND status = 'draft'
           AND proposed_rule->>'id' = :rid LIMIT 1"""), {"tid": str(tenant.id), "d": domain, "rid": rule["id"]})).fetchone()
    if old:
        return {"id": str(old[0]), "status": "draft", "created": False, "rule": rule, "rule_yaml": ar.to_yaml(rule)}
    row = (await db.execute(text("""
        INSERT INTO ai_proposed_rules (tenant_id, domain, proposed_rule, rationale, status)
        VALUES (:tid, :d, CAST(:rule AS jsonb), :why, 'draft') RETURNING id"""),
        {"tid": str(tenant.id), "d": domain, "rule": json.dumps(rule, default=str),
         "why": f"Proposed from a {body.kind.replace('_', ' ')} in {qualified}, requested by {current_user_label()}"})).fetchone()
    await db.commit()
    return {"id": str(row[0]), "status": "draft", "created": True, "rule": rule, "rule_yaml": ar.to_yaml(rule)}
