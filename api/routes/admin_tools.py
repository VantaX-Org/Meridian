"""Administrator tools: the tenant configuration bundle, view as a role, and bulk rule import and export.

Configuration bundle (api/services/config_bundle.py)
  GET  /api/v1/admin/config-bundle                     the tenant's configuration as one JSON file; manage_settings
  POST /api/v1/admin/config-bundle/import?dry_run=     the diff per section (dry run, the default) or the import itself;
                                                       additive: adds and changes, never deletes; manage_settings

View as (support; api/services/rbac.py VIEW_AS_HEADER)
  POST   /api/v1/admin/view-as   {role} -> {role, name, actions}: start; audited. The client then sends
                                 X-View-As-Role on every request; the server narrows to that role and refuses writes.
  DELETE /api/v1/admin/view-as   stop; audited. Both need manage_users.

Bulk rules (through the rule authoring path: every rule is validated as POST /rule-authoring/drafts validates it, and
lands as a draft for the rule lifecycle to review)
  GET  /api/v1/rules/bulk/export?format=yaml|xlsx&module=   the tenant's rules; export
  POST /api/v1/rules/bulk/import   {format: yaml|xlsx, content, module?, dry_run}: yaml is a list of rule mappings
                                   (each with a ``module`` unless ``module`` is given), xlsx is base64 of a workbook whose
                                   first sheet has the columns module, rule_yaml and rationale; manage_rules
"""
from __future__ import annotations

import base64
import binascii
import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Any, Literal

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import config_bundle
from api.services.rbac import (
    BUILTIN_NAMES,
    VALID_ROLES,
    _own_role,
    current_user_label,
    has_permission,
    permissions_for,
    require_permission,
    write_audit,
)

router = APIRouter(prefix="/api/v1", tags=["admin-tools"])


async def _rls(db: AsyncSession, tenant: Tenant) -> str:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
    return str(tenant.id)


def _j(v: Any) -> Any:
    return json.loads(json.dumps(v, default=str))


# ── configuration bundle ──────────────────────────────────────────────────────


async def current_bundle(db: AsyncSession, tenant: Tenant) -> dict[str, Any]:
    t = await _rls(db, tenant)
    s = (await db.execute(text("SELECT dqs_weights, alert_thresholds, cost_model, retention FROM tenants "
                               "WHERE id = CAST(:t AS uuid)"), {"t": t})).mappings().first() or {}
    rules = (await db.execute(text("SELECT module, name, enabled FROM rules WHERE tenant_id = CAST(:t AS uuid) "
                                   "ORDER BY module, name"), {"t": t})).mappings().all()
    maps = (await db.execute(text("SELECT module, standard_field, customer_field, customer_label, is_mapped, notes "
                                  "FROM field_mappings WHERE tenant_id = CAST(:t AS uuid) ORDER BY module, standard_field"),
                             {"t": t})).mappings().all()
    waves = (await db.execute(text(
        "SELECT w.name, w.modules, w.target_date, w.stage, w.min_readiness, w.min_dqs, "
        "CASE WHEN g.wave_id IS NULL THEN NULL ELSE jsonb_build_object('min_score', g.min_score, "
        "'zero_criticals', g.zero_criticals, 'contracts_met', g.contracts_met) END AS gate "
        "FROM migration_waves w LEFT JOIN wave_gates g ON g.wave_id = w.id WHERE w.tenant_id = CAST(:t AS uuid) "
        "ORDER BY w.name"), {"t": t})).mappings().all()
    sla = (await db.execute(text("SELECT severity, module, ack_minutes, resolve_minutes, at_risk_pct, business_hours "
                                 "FROM sla_policies WHERE tenant_id = CAST(:t AS uuid) ORDER BY severity, module"),
                            {"t": t})).mappings().all()
    esc = (await db.execute(text("SELECT level, after_minutes, target, user_id::text AS user_id FROM escalation_steps "
                                 "WHERE tenant_id = CAST(:t AS uuid) ORDER BY level"), {"t": t})).mappings().all()
    return _j({
        "settings": {k: s.get(k) for k in ("dqs_weights", "alert_thresholds", "cost_model", "retention")},
        "rules": [dict(r) for r in rules], "mappings": [dict(r) for r in maps], "waves": [dict(r) for r in waves],
        "sla_policies": [dict(r) for r in sla], "escalation": [dict(r) for r in esc],
    })


@router.get("/admin/config-bundle", dependencies=[Depends(require_permission("manage_settings"))])
async def export_bundle(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    sections = await current_bundle(db, tenant)
    await write_audit(db, tenant.id, request, "config_bundle.export", "tenant", str(tenant.id), None,
                      {k: (len(v) if isinstance(v, list) else 1) for k, v in sections.items()})
    await db.commit()
    body = {"format": config_bundle.FORMAT, "version": config_bundle.VERSION, "tenant": tenant.name,
            "exported_at": datetime.now(timezone.utc).isoformat(), "sections": sections}
    name = f"meridian-config-{datetime.now(timezone.utc).strftime('%Y%m%d')}.json"
    return Response(content=json.dumps(body, indent=2), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


async def _apply(db: AsyncSession, t: str, section: str, items: list[dict]) -> None:
    for it in items:
        a = it["after"]
        if it["change"] == "same":
            continue
        if section == "settings":
            for col in ("dqs_weights", "alert_thresholds", "cost_model", "retention"):
                if col in a:
                    await db.execute(text(f"UPDATE tenants SET {col} = CAST(:v AS jsonb) WHERE id = CAST(:t AS uuid)"),
                                     {"v": json.dumps(a[col]) if a[col] is not None else ("{}" if col == "retention" else None),
                                      "t": t})
        elif section == "rules" and "enabled" in a:
            await db.execute(text("UPDATE rules SET enabled = :e, updated_at = now() WHERE tenant_id = CAST(:t AS uuid) "
                                  "AND module = :m AND name = :n"), {"e": bool(a["enabled"]), "t": t, "m": a.get("module"),
                                                                     "n": a.get("name")})
        elif section == "mappings":
            await db.execute(text("""
                INSERT INTO field_mappings (tenant_id, module, standard_field, customer_field, customer_label, is_mapped, notes)
                VALUES (CAST(:t AS uuid), :m, :sf, :cf, :cl, COALESCE(:im, false), :n)
                ON CONFLICT (tenant_id, module, standard_field) DO UPDATE SET customer_field = EXCLUDED.customer_field,
                       customer_label = EXCLUDED.customer_label, is_mapped = EXCLUDED.is_mapped, notes = EXCLUDED.notes,
                       updated_at = now()"""),
                {"t": t, "m": a.get("module"), "sf": a.get("standard_field"), "cf": a.get("customer_field"),
                 "cl": a.get("customer_label"), "im": a.get("is_mapped"), "n": a.get("notes")})
        elif section == "waves":
            wid = (await db.execute(text("""
                INSERT INTO migration_waves (tenant_id, name, modules, target_date, stage, min_readiness, min_dqs)
                VALUES (CAST(:t AS uuid), :n, CAST(:m AS text[]), CAST(:d AS date), COALESCE(:s, 'plan'),
                        COALESCE(:r, 95), :q)
                ON CONFLICT (tenant_id, name) DO UPDATE SET modules = EXCLUDED.modules, target_date = EXCLUDED.target_date,
                       stage = EXCLUDED.stage, min_readiness = EXCLUDED.min_readiness, min_dqs = EXCLUDED.min_dqs,
                       updated_at = now()
                RETURNING id"""),
                {"t": t, "n": a.get("name"), "m": list(a.get("modules") or []), "d": a.get("target_date"),
                 "s": a.get("stage"), "r": a.get("min_readiness"), "q": a.get("min_dqs")})).scalar()
            g = a.get("gate")
            if isinstance(g, dict):
                await db.execute(text("""
                    INSERT INTO wave_gates (wave_id, tenant_id, min_score, zero_criticals, contracts_met, updated_by)
                    VALUES (:w, CAST(:t AS uuid), :s, COALESCE(:z, true), COALESCE(:c, false), 'import')
                    ON CONFLICT (wave_id) DO UPDATE SET min_score = EXCLUDED.min_score,
                           zero_criticals = EXCLUDED.zero_criticals, contracts_met = EXCLUDED.contracts_met,
                           updated_by = 'import', updated_at = now()"""),
                    {"w": wid, "t": t, "s": g.get("min_score"), "z": g.get("zero_criticals"), "c": g.get("contracts_met")})
        elif section == "sla_policies":
            await db.execute(text("""
                INSERT INTO sla_policies (tenant_id, severity, module, ack_minutes, resolve_minutes, at_risk_pct, business_hours)
                VALUES (CAST(:t AS uuid), :sev, :m, :a, :r, COALESCE(:p, 80), COALESCE(:b, false))
                ON CONFLICT (tenant_id, severity, COALESCE(module, '')) DO UPDATE
                   SET ack_minutes = EXCLUDED.ack_minutes, resolve_minutes = EXCLUDED.resolve_minutes,
                       at_risk_pct = EXCLUDED.at_risk_pct, business_hours = EXCLUDED.business_hours"""),
                {"t": t, "sev": a.get("severity"), "m": a.get("module"), "a": a.get("ack_minutes"),
                 "r": a.get("resolve_minutes"), "p": a.get("at_risk_pct"), "b": a.get("business_hours")})
        elif section == "escalation":
            await db.execute(text("""
                INSERT INTO escalation_steps (tenant_id, level, after_minutes, target, user_id)
                VALUES (CAST(:t AS uuid), :l, :m, :g, (SELECT id FROM users WHERE id = CAST(:u AS uuid)
                                                         AND tenant_id = CAST(:t AS uuid)))
                ON CONFLICT (tenant_id, level) DO UPDATE SET after_minutes = EXCLUDED.after_minutes,
                       target = EXCLUDED.target, user_id = EXCLUDED.user_id, updated_at = now()"""),
                {"t": t, "l": a.get("level"), "m": a.get("after_minutes"), "g": a.get("target"), "u": a.get("user_id")})


@router.post("/admin/config-bundle/import", dependencies=[Depends(require_permission("manage_settings"))])
async def import_bundle(bundle: dict[str, Any], request: Request, dry_run: bool = Query(True),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    errors = config_bundle.validate(bundle)
    if errors:
        raise HTTPException(status_code=422, detail=" ".join(errors))
    current = await current_bundle(db, tenant)
    result = config_bundle.diff(current, bundle["sections"])
    if dry_run:
        return {"dry_run": True, **result}
    t = await _rls(db, tenant)
    try:
        for section, d in result["sections"].items():
            await _apply(db, t, section, d["items"])
    except (SQLAlchemyError, TypeError, ValueError, KeyError):
        await db.rollback()
        raise HTTPException(status_code=422, detail="The bundle could not be applied; nothing was changed. "
                                                    "Check the values against an exported bundle.")
    await write_audit(db, tenant.id, request, "config_bundle.import", "tenant", str(tenant.id), None,
                      {"totals": result["totals"], "from": bundle.get("tenant")})
    await db.commit()
    return {"dry_run": False, **result}


# ── view as ───────────────────────────────────────────────────────────────────


class ViewAsIn(BaseModel):
    role: str = Field(min_length=1, max_length=64)


@router.post("/admin/view-as", dependencies=[Depends(require_permission("manage_users"))])
async def start_view_as(body: ViewAsIn, request: Request, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail="Choose a built-in role.")
    own = await _own_role(tenant, db, request)
    if not has_permission(own, "manage_users"):
        raise HTTPException(status_code=403, detail="View as is only for administrators who manage users.")
    await write_audit(db, tenant.id, request, "view_as.start", "role", body.role, {"role": own}, {"role": body.role})
    await db.commit()
    return {"role": body.role, "name": BUILTIN_NAMES.get(body.role, body.role), "actions": permissions_for(body.role),
            "header": "X-View-As-Role", "read_only": True}


@router.delete("/admin/view-as", dependencies=[Depends(require_permission("view"))])
async def stop_view_as(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    role = request.headers.get("x-view-as-role")
    await write_audit(db, tenant.id, request, "view_as.stop", "role", role or "-", {"role": role}, None)
    await db.commit()
    return Response(status_code=204)


# ── bulk rules ────────────────────────────────────────────────────────────────


@router.get("/rules/bulk/export", dependencies=[Depends(require_permission("export"))])
async def export_rules_bulk(format: Literal["yaml", "xlsx"] = Query("yaml"), module: str | None = Query(None),
                            db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    t = await _rls(db, tenant)
    rows = (await db.execute(text(
        "SELECT module, name, description, category, severity, enabled, source_yaml, source FROM rules "
        "WHERE tenant_id = CAST(:t AS uuid) AND (CAST(:m AS text) IS NULL OR module = :m) ORDER BY module, name LIMIT 5000"),
        {"t": t, "m": module})).mappings().all()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    if format == "yaml":
        docs = []
        for r in rows:
            body = yaml.safe_load(r["source_yaml"]) if r["source_yaml"] else None
            doc = body if isinstance(body, dict) else {"name": r["name"], "description": r["description"],
                                                       "severity": r["severity"], "category": r["category"]}
            docs.append({"module": r["module"], "enabled": r["enabled"], **doc})
        return Response(content=yaml.safe_dump(docs, sort_keys=False, allow_unicode=True), media_type="application/x-yaml",
                        headers={"Content-Disposition": f'attachment; filename="meridian-rules-{stamp}.yaml"'})
    from api.services.branded_xlsx import (
        ColumnSpec,
        SheetSpec,
        build_workbook,
        xlsx_response,
    )

    cols = [ColumnSpec("module", "module"), ColumnSpec("name", "name"), ColumnSpec("severity", "severity"),
            ColumnSpec("enabled", "enabled"), ColumnSpec("rule_yaml", "rule_yaml", width=80),
            ColumnSpec("rationale", "rationale")]
    data = [{"module": r["module"], "name": r["name"], "severity": r["severity"], "enabled": "yes" if r["enabled"] else "no",
             "rule_yaml": r["source_yaml"] or "", "rationale": r["description"] or ""} for r in rows]
    wb = build_workbook(tenant_name=tenant.name, run_label=None, run_id=None, title="Rules for bulk import",
                        sheets=[SheetSpec(title="Rules", columns=cols, rows=data,
                                          note="Edit rule_yaml and import this sheet to create drafts.")])
    return xlsx_response(wb, f"meridian-rules-{stamp}.xlsx")


class BulkIn(BaseModel):
    format: Literal["yaml", "xlsx"]
    content: str = Field(min_length=1, max_length=5_000_000)
    module: str | None = Field(None, max_length=64)
    dry_run: bool = True


def parse_bulk(fmt: str, content: str, module: str | None) -> list[dict[str, Any]]:
    """Rows of {row, module, rule_yaml, rationale} from a YAML list or an xlsx workbook (base64)."""
    out: list[dict[str, Any]] = []
    if fmt == "yaml":
        try:
            docs = yaml.safe_load(content)
        except yaml.YAMLError as e:
            raise HTTPException(status_code=422, detail=f"The file is not valid YAML: {str(e).splitlines()[0]}")
        if isinstance(docs, dict):
            docs = [docs]
        if not isinstance(docs, list):
            raise HTTPException(status_code=422, detail="Expected a list of rules.")
        for n, d in enumerate(docs, start=1):
            if not isinstance(d, dict):
                out.append({"row": n, "module": module, "rule_yaml": "", "rationale": None})
                continue
            d = dict(d)
            m = d.pop("module", None) or module
            d.pop("enabled", None)
            out.append({"row": n, "module": m, "rule_yaml": yaml.safe_dump(d, sort_keys=False), "rationale": None})
        return out
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(base64.b64decode(content)), read_only=True, data_only=True)
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, binascii.Error):
        raise HTTPException(status_code=422, detail="The file is not an Excel workbook.")
    ws = next((s for s in wb.worksheets if s.title != "Cover"), wb.worksheets[0])
    rows = list(ws.iter_rows(values_only=True))
    head_at = next((i for i, r in enumerate(rows) if r and "rule_yaml" in [str(c).strip() if c else "" for c in r]), None)
    if head_at is None:
        raise HTTPException(status_code=422, detail="The sheet needs a rule_yaml column (export one to start from).")
    head = [str(c).strip() if c else "" for c in rows[head_at]]
    for n, r in enumerate(rows[head_at + 1:], start=1):
        rec = dict(zip(head, r))
        if not rec.get("rule_yaml"):
            continue
        out.append({"row": n, "module": rec.get("module") or module, "rule_yaml": str(rec["rule_yaml"]),
                    "rationale": rec.get("rationale")})
    return out


@router.post("/rules/bulk/import", dependencies=[Depends(require_permission("manage_rules"))])
async def import_rules_bulk(body: BulkIn, request: Request, db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)):
    from api.routes.rule_authoring import _dictionary, _latest
    from api.services import rule_authoring as ra

    rows = parse_bulk(body.format, body.content, body.module)
    if not rows:
        raise HTTPException(status_code=422, detail="The file has no rules.")
    if len(rows) > 500:
        raise HTTPException(status_code=422, detail="Import at most 500 rules at a time.")
    dictionaries: dict[str, Any] = {}
    results = []
    for r in rows:
        if not r["module"]:
            results.append({**r, "ok": False, "errors": ["no module"], "id": None})
            continue
        if r["module"] not in dictionaries:
            latest = await _latest(db, tenant, r["module"], None)
            dictionaries[r["module"]] = await _dictionary(db, latest[1] if latest else None)
        rule, errors = ra.validate_rule_yaml(r["rule_yaml"], r["module"], dictionaries[r["module"]])
        results.append({"row": r["row"], "module": r["module"], "id": (rule or {}).get("id"), "ok": not errors,
                        "errors": errors, "rule": rule, "rationale": r["rationale"]})
    ok = [x for x in results if x["ok"]]
    created: list[str] = []
    if not body.dry_run and ok:
        t = await _rls(db, tenant)
        for x in ok:
            rid = (await db.execute(text("""
                INSERT INTO ai_proposed_rules (tenant_id, domain, proposed_rule, rationale, status)
                VALUES (CAST(:t AS uuid), :d, CAST(:r AS jsonb), :w, 'draft') RETURNING id::text"""),
                {"t": t, "d": f"dq_rule:{x['module']}", "r": json.dumps(x["rule"], default=str),
                 "w": x["rationale"] or f"Bulk import by {current_user_label()}"})).scalar()
            created.append(rid)
        await write_audit(db, tenant.id, request, "rules.bulk_import", "rules", body.format, None,
                          {"created": len(created), "rejected": len(results) - len(ok)})
        await db.commit()
    return {"dry_run": body.dry_run, "total": len(results), "valid": len(ok), "invalid": len(results) - len(ok),
            "created": created,
            "rows": [{k: v for k, v in x.items() if k not in ("rule",)} for x in results]}
