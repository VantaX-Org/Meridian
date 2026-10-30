"""Steward assignment template and related objects (migration 105, api/services/stewardship.py).

GET  /api/v1/objects/{module}/related                 related objects (relation kind, fixing-order tier, open critical
                                                      failures in the current state) and the fix-order hint; view
GET  /api/v1/admin/assignment-template                the tenant's template (or the default) with the active slices; view
PUT  /api/v1/admin/assignment-template                save the template; manage_settings
POST /api/v1/admin/assignment-template/apply          {modules?, dry_run (default true)}: the diff, or the owner and
                                                      steward assignments written. manage_settings for any object; an
                                                      object's owner (approve) for the objects they own
GET  /api/v1/admin/assignment-template/gaps           "every object has one owner and at least one steward per active
                                                      slice": the gaps; view
GET  /api/v1/admin/steward-assignments                every slice assignment (for People and workload balancing); view

Active slices are the company codes, plants, sales and purchasing organisations that the tenant's record issues carry
in their record keys (BUKRS, WERKS, VKORG, EKORG): the organisation the data actually has. Writes are audited.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.cache import cached_json
from api.services import stewardship
from api.services.rbac import (
    _get_user_role,
    current_user_id,
    current_user_label,
    has_permission,
    require_permission,
    write_audit,
)

router = APIRouter(prefix="/api/v1", tags=["stewardship-template"])


async def _rls(db: AsyncSession, tenant: Tenant) -> str:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
    return str(tenant.id)


def _label(m: str) -> str:
    from api.routes.objects import _label as lbl

    return lbl(m)


async def _open_criticals(db: AsyncSession, tenant: Tenant, modules: list[str]) -> dict[str, int]:
    """Open critical work records per module in the current state."""
    from api.services.current_state import current_pairs, pairs_clause

    pairs = [p for p in await current_pairs(db, tenant.id) if p["module"] in set(modules)]
    if not pairs:
        return {}
    params: dict[str, Any] = {"t": str(tenant.id)}
    clause = pairs_clause("c", pairs, params)
    rows = (await db.execute(text(  # work_counts, migration 108
        f"SELECT c.module, sum(c.count)::bigint FROM work_counts c WHERE c.tenant_id = CAST(:t AS uuid) AND {clause} "
        "AND c.severity = 'critical' AND c.status IN ('to_fix', 'proposed', 'approved', 'sent') GROUP BY c.module "
        "HAVING sum(c.count) <> 0"),
        params)).fetchall()
    return {r[0]: int(r[1]) for r in rows}


@router.get("/objects/{module}/related", dependencies=[Depends(require_permission("view"))])
async def related_objects(module: str, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    from api.services.not_found import require_object

    await require_object(db, tenant.id, module)
    rel = stewardship.related(module)
    crit = await _open_criticals(db, tenant, [r["module"] for r in rel])
    rows = [{**r, "label": _label(r["module"]), "open_criticals": crit.get(r["module"], 0)} for r in rel]
    return {"module": module, "tier": stewardship.tier(module), "related": rows,
            "fix_hint": stewardship.fix_hint(module, crit, _label)}


async def _template(db: AsyncSession, t: str) -> tuple[dict, bool, str | None, Any]:
    row = (await db.execute(text("SELECT template, updated_by, updated_at FROM assignment_templates "
                                 "WHERE tenant_id = CAST(:t AS uuid)"), {"t": t})).fetchone()
    if row:
        return row[0], True, row[1], row[2]
    return stewardship.default_template(), False, None, None


async def _active(db: AsyncSession, t: str) -> dict[str, list[str]]:
    # Each slice scans every issue's record key (seconds apiece at millions); org values change rarely.
    return await cached_json("stewardship", "active_slices", t, {}, 600, lambda: _scan_active(db, t),
                             memo_fallback=True)


async def _scan_active(db: AsyncSession, t: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for kind, field in stewardship.SLICES.items():
        if not field:
            continue
        rows = (await db.execute(text(
            "SELECT DISTINCT substring(record_key FROM :re) AS v FROM record_issues WHERE tenant_id = CAST(:t AS uuid) "
            "AND record_key LIKE :like ORDER BY 1 LIMIT 200"),
            {"t": t, "re": f"(?:^|\\|){field}=([^|]+)", "like": f"%{field}=%"})).fetchall()
        out[kind] = [r[0] for r in rows if r[0]]
    return out


async def _current(db: AsyncSession, t: str) -> tuple[dict, dict]:
    owners = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT ref, owner_user_id::text FROM data_owners WHERE tenant_id = CAST(:t AS uuid) AND kind = 'object'"),
        {"t": t})).fetchall()}
    stewards = {(r[0], r[1], r[2]): r[3] for r in (await db.execute(text(
        "SELECT module, slice_kind, slice_value, steward_user_id::text FROM steward_assignments "
        "WHERE tenant_id = CAST(:t AS uuid)"), {"t": t})).fetchall()}
    return owners, stewards


@router.get("/admin/assignment-template", dependencies=[Depends(require_permission("view"))])
async def get_template(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    t = await _rls(db, tenant)
    tmpl, saved, by, at = await _template(db, t)
    return {"template": tmpl, "saved": saved, "updated_by": by, "updated_at": at.isoformat() if at else None,
            "active_slices": await _active(db, t), "labels": {m: _label(m) for m in (tmpl.get("objects") or {})}}


class TemplateIn(BaseModel):
    template: dict[str, Any]


@router.put("/admin/assignment-template", dependencies=[Depends(require_permission("manage_settings"))])
async def put_template(body: TemplateIn, request: Request, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)):
    errors = stewardship.validate_template(body.template)
    if errors:
        raise HTTPException(status_code=422, detail=" ".join(errors[:5]))
    import json

    t = await _rls(db, tenant)
    await db.execute(text("""
        INSERT INTO assignment_templates (tenant_id, template, updated_by, updated_at)
        VALUES (CAST(:t AS uuid), CAST(:j AS jsonb), :by, now())
        ON CONFLICT (tenant_id) DO UPDATE SET template = EXCLUDED.template, updated_by = EXCLUDED.updated_by,
               updated_at = now()"""), {"t": t, "j": json.dumps(body.template), "by": current_user_label()})
    await write_audit(db, tenant.id, request, "assignment_template.update", "tenant", t, None,
                      {"objects": len(body.template.get("objects") or {})})
    await db.commit()
    return await get_template(db, tenant)


class ApplyIn(BaseModel):
    modules: list[str] | None = Field(None, max_length=60)
    dry_run: bool = True


@router.post("/admin/assignment-template/apply", dependencies=[Depends(require_permission("view"))])
async def apply_template(body: ApplyIn, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)):
    role = await _get_user_role(tenant, db, request)
    t = await _rls(db, tenant)
    owners, stewards = await _current(db, t)
    modules = body.modules
    if not has_permission(role, "manage_settings"):
        me = current_user_id(request)
        mine = sorted(m for m, o in owners.items() if me and o == me)
        if not has_permission(role, "approve") or not mine:
            raise HTTPException(status_code=403, detail={"detail": "forbidden", "resource": "stewardship",
                                                         "action": "admin", "request_access": True})
        if modules is None:
            modules = mine
        elif set(modules) - set(mine):
            raise HTTPException(status_code=403, detail="You can apply the template only to the objects you own.")
    tmpl, _saved, _by, _at = await _template(db, t)
    plan = stewardship.plan_apply(tmpl, await _active(db, t), owners, stewards, modules)
    if body.dry_run:
        return {"dry_run": True, **plan}
    for r in plan["owners"]:
        if r["change"] == "same":
            continue
        await db.execute(text("""
            INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id) VALUES (CAST(:t AS uuid), 'object', :m, CAST(:u AS uuid))
            ON CONFLICT (tenant_id, kind, ref) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, updated_at = now()"""),
            {"t": t, "m": r["module"], "u": r["after"]})
    for r in plan["stewards"]:
        if r["change"] == "same":
            continue
        await db.execute(text("""
            INSERT INTO steward_assignments (tenant_id, module, slice_kind, slice_value, steward_user_id, source)
            VALUES (CAST(:t AS uuid), :m, :k, :v, CAST(:u AS uuid), 'template')
            ON CONFLICT (tenant_id, module, slice_kind, slice_value) DO UPDATE SET steward_user_id = EXCLUDED.steward_user_id,
                   source = 'template', updated_at = now()"""),
            {"t": t, "m": r["module"], "k": r["slice_kind"], "v": r["slice_value"], "u": r["after"]})
    await write_audit(db, tenant.id, request, "assignment_template.apply", "tenant", t, None,
                      {"totals": plan["totals"], "modules": modules})
    await db.commit()
    return {"dry_run": False, **plan}


@router.get("/admin/assignment-template/gaps", dependencies=[Depends(require_permission("view"))])
async def template_gaps(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    from api.services.current_state import current_pairs

    t = await _rls(db, tenant)
    tmpl, _s, _b, _a = await _template(db, t)
    measured = sorted({p["module"] for p in await current_pairs(db, tenant.id)})
    objects = measured or sorted(tmpl.get("objects") or {})
    owners, stewards = await _current(db, t)
    rows = stewardship.gaps(objects, tmpl, await _active(db, t), owners, stewards)
    return {"objects": len(objects), "gaps": [{**g, "label": _label(g["module"])} for g in rows],
            "based_on": "measured objects" if measured else "template objects"}


@router.get("/admin/steward-assignments", dependencies=[Depends(require_permission("view"))])
async def list_assignments(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    t = await _rls(db, tenant)
    rows = (await db.execute(text(
        "SELECT a.module, a.slice_kind, a.slice_value, a.steward_user_id::text AS steward_user_id, "
        "COALESCE(u.name, u.email) AS steward_name, a.source FROM steward_assignments a "
        "LEFT JOIN users u ON u.id = a.steward_user_id WHERE a.tenant_id = CAST(:t AS uuid) "
        "ORDER BY a.module, a.slice_kind, a.slice_value"), {"t": t})).mappings().all()
    return {"assignments": [dict(r) for r in rows]}
