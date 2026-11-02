"""Aletheia anomaly-to-rule: propose a deterministic rule for a detected anomaly, dry-run it, show its hits.

Approving is the existing rule-authoring path: POST /api/v1/rule-authoring/drafts with the proposed YAML.
"""

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes import rule_authoring as route
from api.routes.mining import field_text
from api.routes.record_issues import _rls
from api.services import anomaly_rules as ar
from api.services import rule_authoring as ra
from api.services.rbac import require_permission

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
