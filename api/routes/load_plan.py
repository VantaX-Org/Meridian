"""Migration load plan: the DDIC-derived order in which migration objects load, with each object's latest readiness.

The order and every dependency come from ``api.services.migration.load_plan``. This route adds the state from the
tenant's own migration runs: an object whose latest analysed run still has critical or high gap findings is a no-go,
and every object that needs it through a required field is blocked until it is fixed.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.migration import object_label
from api.services.migration import load_plan as lp
from api.services.rbac import require_permission, scope_from_path
from api.services.source_design import dictionary_for
from checks.runner import get_required_columns
from sap.ddic import get_dictionary

router = APIRouter(prefix="/api/v1/migration", tags=["migration"])


class EvidenceOut(BaseModel):
    field: str
    text: str
    check_table: str
    check_table_text: str
    required: bool
    reason: Optional[str] = None


class EdgeOut(BaseModel):
    before: str
    after: str
    kind: str          # required | reference
    deferred: bool     # reference inside a cycle, loaded as a delta after both objects
    evidence: list[EvidenceOut]


class PrerequisiteOut(BaseModel):
    table: str
    text: str
    kind: str          # configuration | master_data | unclassified
    fields: list[str]


class ObjectOut(BaseModel):
    module: str
    label: str
    anchor: str
    anchor_text: str
    step: int
    group: list[str]
    status: str        # go | no_go | not_run
    blocking: int      # critical and high gap findings in the latest analysed run
    run_id: Optional[str] = None
    blocked_by: list[str]
    prerequisites: list[PrerequisiteOut]


class LoadPlanOut(BaseModel):
    release: str
    objects: list[ObjectOut]
    edges: list[EdgeOut]
    unknown: list[str]
    steps: int


def _columns(module: str) -> set[str]:
    try:
        return get_required_columns(module)
    except Exception:  # a module without a rule pack reads nothing
        return set()


_STATUS = text("""
    SELECT DISTINCT ON (m) m AS module, r.id::text AS run_id,
           (SELECT count(*) FROM migration_gap_findings g
             WHERE g.run_id = r.id AND g.tenant_id = :tid AND g.module = m
               AND g.severity IN ('critical', 'high')) AS blocking
      FROM migration_runs r, unnest(r.modules) AS m
     WHERE r.tenant_id = :tid AND r.status IN ('analysed', 'exported') AND m = ANY(:mods)
     ORDER BY m, coalesce(r.completed_at, r.created_at) DESC
""")


@router.get("/load-plan", response_model=LoadPlanOut)
async def load_plan(
    modules: Optional[str] = Query(None, description="Comma-separated modules; default is every licensed object"),
    system_id: Optional[str] = Query(None, description="Resolve fields against this system's live dictionary"),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
) -> LoadPlanOut:
    licensed = tenant.licensed_modules or []
    allowed = list(lp.OWNED_TABLES) if "*" in licensed else [m for m in lp.OWNED_TABLES if m in licensed]
    if modules:
        wanted = [m.strip() for m in modules.split(",") if m.strip()]
        refused = [m for m in wanted if m in lp.OWNED_TABLES and m not in allowed]
        if refused:
            raise HTTPException(status_code=403, detail=f"Not licensed: {', '.join(refused)}")
    else:
        wanted = allowed

    await _rls(db, tenant)
    if system_id:
        dictionary = await db.run_sync(lambda s: dictionary_for(s, system_id))
    else:
        dictionary = get_dictionary("s4hana")
    plan = lp.build_plan(wanted, dictionary, _columns)

    planned = [o.module for o in plan.objects]
    state: dict[str, tuple[str, int]] = {}
    if planned:
        rows = (await db.execute(_STATUS, {"tid": str(tenant.id), "mods": planned})).mappings().all()
        state = {r["module"]: (r["run_id"], int(r["blocking"])) for r in rows}

    def status(m: str) -> str:
        if m not in state:
            return "not_run"
        return "no_go" if state[m][1] else "go"

    def text_of(t: str) -> str:
        tab = dictionary.table(t)
        return (tab.description if tab else "") or ""

    objects = []
    for o in plan.objects:
        blockers = sorted({e.before for e in plan.edges
                           if e.after == o.module and e.kind == "required" and status(e.before) == "no_go"})
        run_id, blocking = state.get(o.module, (None, 0))
        objects.append(ObjectOut(
            module=o.module, label=object_label(o.module), anchor=o.anchor, anchor_text=o.anchor_text,
            step=o.step, group=o.group, status=status(o.module), blocking=blocking, run_id=run_id,
            blocked_by=blockers,
            prerequisites=[PrerequisiteOut(table=p.table, text=p.text, kind=p.kind, fields=p.fields)
                           for p in o.prerequisites]))
    edges = [EdgeOut(before=e.before, after=e.after, kind=e.kind, deferred=e.deferred,
                     evidence=[EvidenceOut(field=x.field, text=x.text, check_table=x.check_table,
                                           check_table_text=text_of(x.check_table), required=x.required,
                                           reason=x.reason) for x in e.evidence])
             for e in plan.edges]
    return LoadPlanOut(release=dictionary.release, objects=objects, edges=edges, unknown=plan.unknown,
                       steps=max((o.step for o in plan.objects), default=0))
