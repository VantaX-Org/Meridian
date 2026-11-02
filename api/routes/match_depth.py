"""Match profile, weight calibration and the SAP consolidation action pack.

Endpoints (prefix /api/v1):
  GET  /match-calibration?domain=          — profile passes, Fellegi-Sunter m/u per rule,
                                             current vs recommended weights, dry-run preview
  POST /match-calibration/apply            — write recommended weights (and missing profile rules)
  GET  /consolidation-pack?domain=&format= — merged-away records mapped to survivors with the
                                             SAP deletion / block flags; json, csv or xlsx

Nothing here talks to SAP; the pack is export only.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.merge_explain import _pairs, _rls
from api.services.consolidation_pack import ACTIONS, pack_rows
from api.services.match_calibration import calibrate, recommended_weights
from api.services.merge_explain import dry_run_tuning
from api.services.rbac import current_user_id, require_permission
from workers.tasks.run_match import PROFILES, pass_columns

router = APIRouter(prefix="/api/v1", tags=["match-depth"])

_RULES = text("""
    SELECT field, match_type, weight, threshold FROM match_rules
     WHERE tenant_id = :tid AND domain = :d AND active ORDER BY weight DESC, field
""")
_AUDIT = text(
    "INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path, "
    "status_code, after_json) VALUES (:t, (SELECT id FROM users WHERE CAST(id AS text) = :u AND tenant_id = :t), "
    "NULLIF(:u, ''), :a, 'match_rules', :ei, 'POST', :p, 200, CAST(:af AS jsonb))")


class ApplyBody(BaseModel):
    domain: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=1, max_length=2000)
    add_profile_rules: bool = False


def _profile(domain: str) -> dict:
    p = PROFILES.get(domain)
    if p is None:
        raise HTTPException(status_code=404, detail=f"No match profile for {domain}")
    return p


async def _state(db: AsyncSession, tid: str, domain: str) -> tuple[list[dict], bool, dict, list[dict]]:
    """Active rules (profile defaults when none are stored yet), whether they are stored,
    the calibration and the decided pairs."""
    rows = [dict(r._mapping) for r in await db.execute(_RULES, {"tid": tid, "d": domain})]
    stored = bool(rows)
    rules = rows or [{"field": f, "match_type": m, "weight": w, "threshold": t}
                     for f, m, w, t in _profile(domain)["rules"]]
    # ponytail: newest 50k pairs per domain in memory, as the tuning dry run does.
    pairs = await _pairs(db, tid, domain, limit=50_000)
    return rules, stored, calibrate(rules, pairs), pairs


@router.get("/match-calibration")
async def get_match_calibration(domain: str = Query(..., min_length=1, max_length=100),
                                _: str = Depends(require_permission("view")),
                                db: AsyncSession = Depends(get_db),
                                tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    profile = _profile(domain)
    tid = await _rls(db, tenant)
    rules, stored, cal, pairs = await _state(db, tid, domain)
    weights = recommended_weights(cal)
    have = {r["field"] for r in rules}
    return {
        "domain": domain,
        "id_field": profile["id"],
        "passes": [{"name": p["name"], "kind": p["kind"], "fields": pass_columns(p)} for p in profile["passes"]],
        "rules_stored": stored,
        "missing_profile_rules": [{"field": f, "match_type": m, "weight": w, "threshold": t}
                                  for f, m, w, t in profile["rules"] if f not in have],
        **cal,
        "preview": dry_run_tuning(pairs, weights) if weights else None,
    }


@router.post("/match-calibration/apply")
async def apply_match_calibration(body: ApplyBody, _: str = Depends(require_permission("approve")),
                                  db: AsyncSession = Depends(get_db),
                                  tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    profile = _profile(body.domain)
    tid = await _rls(db, tenant)
    rules, stored, cal, _pairs_unused = await _state(db, tid, body.domain)
    weights = recommended_weights(cal)
    if weights is None and not body.add_profile_rules:
        raise HTTPException(status_code=409, detail=(
            f"Need {cal['min_decisions']} accepted and {cal['min_decisions']} rejected steward decisions; "
            f"have {cal['accepted']} and {cal['rejected']}"))
    have = {r["field"] for r in rules} if stored else set()
    added = [r for r in profile["rules"] if r[0] not in have] if (body.add_profile_rules or not stored) else []
    for f, m, w, t in added:
        await db.execute(text("""
            INSERT INTO match_rules (id, tenant_id, domain, field, match_type, weight, threshold, active)
            VALUES (gen_random_uuid(), :tid, :d, :f, :m, :w, :t, true)
        """), {"tid": tid, "d": body.domain, "f": f, "m": m, "w": int((weights or {}).get(f, w)), "t": t})
    changed = []
    for f, w in (weights or {}).items():
        before = next(r["weight"] for r in rules if r["field"] == f)
        if f in have and int(before) != int(w):
            await db.execute(text("""
                UPDATE match_rules SET weight = :w
                 WHERE tenant_id = :tid AND domain = :d AND field = :f AND active
            """), {"tid": tid, "d": body.domain, "f": f, "w": int(w)})
            changed.append({"field": f, "before": before, "after": int(w)})
    after = {"reason": body.reason, "changed": changed, "added": [r[0] for r in added],
             "accepted": cal["accepted"], "rejected": cal["rejected"]}
    await db.execute(_AUDIT, {"t": tid, "u": current_user_id() or "", "a": "match_calibration_applied",
                              "ei": body.domain, "p": "/api/v1/match-calibration/apply",
                              "af": json.dumps(after, default=str)})
    await db.commit()
    return {"domain": body.domain, **after}


_MERGED = text("""
    SELECT l.sap_object_key AS loser, s.sap_object_key AS survivor, l.updated_at AS merged_at
      FROM master_records l JOIN master_records s ON s.id = l.merged_into AND s.tenant_id = l.tenant_id
     WHERE l.tenant_id = :tid AND l.domain = :d AND l.merged_into IS NOT NULL
     ORDER BY s.sap_object_key, l.sap_object_key
""")

_PACK_COLUMNS = [("loser_key", "Merged-away record", "mono"), ("survivor_key", "Survivor", "mono"),
                 ("table", "SAP table", "mono"), ("field", "SAP field", "mono"), ("value", "New value", "mono"),
                 ("action", "Action", "text"), ("merged_at", "Merged at", "datetime")]


@router.get("/consolidation-pack", response_model=None)
async def get_consolidation_pack(domain: str = Query(..., min_length=1, max_length=100),
                                 format: Literal["json", "csv", "xlsx"] = "json",
                                 limit: int = Query(500, ge=1, le=5000),
                                 _: str = Depends(require_permission("view")),
                                 db: AsyncSession = Depends(get_db),
                                 tenant: Tenant = Depends(get_tenant)) -> Any:
    if domain not in ACTIONS:
        raise HTTPException(status_code=404, detail=f"No consolidation actions for {domain}")
    tid = await _rls(db, tenant)
    merged = [dict(r._mapping) for r in await db.execute(_MERGED, {"tid": tid, "d": domain})]
    rows = pack_rows(domain, merged)
    if format == "json":
        return {"domain": domain, "merged": len(merged), "survivors": len({m["survivor"] for m in merged}),
                "actions": [{"table": t, "field": f, "value": v, "action": a} for t, f, v, a in ACTIONS[domain]],
                "total_rows": len(rows), "rows": rows[:limit]}
    from api.services.branded_xlsx import ColumnSpec, SheetSpec, build_workbook, csv_response, xlsx_filename, \
        xlsx_response

    cols = [ColumnSpec(k, h, kind=kind) for k, h, kind in _PACK_COLUMNS]  # type: ignore[arg-type]
    if format == "csv":
        return csv_response(rows, cols, "consolidation-pack", domain)
    data = build_workbook(tenant_name=tenant.name, run_label=domain, run_id=domain,
                          title=f"{domain} consolidation pack", sheets=[SheetSpec("Consolidation", cols, rows)])
    return xlsx_response(data, xlsx_filename("consolidation-pack", domain))
