"""Saved views for the v2 screens: a name, the filters, the columns and the density of one page.

GET    /api/v1/views?route=<route>  the three built-in views of the route, then the user's own by name
PUT    /api/v1/views                create or replace the user's view named ``name`` on ``route`` (upsert on route + name)
DELETE /api/v1/views/{id}           delete one of the user's views (a built-in or another user's view is not deletable)

The same ``saved_views`` table as /findings/saved-views (migration 054), extended with ``columns`` and ``density``
(migration 101). ``columns`` is the list of column keys in display order and ``density`` the row density; null in
both means the page's defaults. Built-in views are code, not rows: they carry ``builtin: true`` and an id of the form
``builtin:<route>:<slug>``. Their ``columns`` are null (the page's defaults) because the column keys belong to the page.
"""
import json
import re
import uuid
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.rbac import current_user_id, require_permission

router = APIRouter(prefix="/api/v1/views", tags=["views"])

Density = Literal["compact", "comfortable"]

# (name, filters, density) per route. Filter keys are the query parameters of the route's list endpoint
# (work: /work/records), so a view is applied by sending its filters.
BUILTIN_VIEWS: dict[str, list[tuple[str, dict[str, str], Density]]] = {
    "work": [("My open work", {"assigned": "me", "status": "open"}, "comfortable"),
             ("Critical and unassigned", {"severity": "critical", "assigned": "unassigned", "status": "open"}, "comfortable"),
             ("Overdue", {"due": "overdue", "status": "open"}, "compact")],
    "objects": [("Held under 85", {"capped": "true"}, "comfortable"),
                ("No-go", {"verdict": "no-go"}, "comfortable"),
                ("Mine", {"owner": "me"}, "compact")],
    "rules": [("Critical rules", {"severity": "critical"}, "comfortable"),
              ("Failing now", {"failing": "true"}, "compact"),
              ("Customer rules", {"authority": "customer_configured"}, "comfortable")],
    "runs": [("Baseline runs", {"baseline": "true"}, "comfortable"),
             ("This month", {"since": "month"}, "comfortable"),
             ("Failed runs", {"status": "failed"}, "compact")],
    "people": [("Approvers", {"role": "approver"}, "comfortable"),
               ("With overdue work", {"overdue": "true"}, "comfortable"),
               ("Unassigned work", {"owner": "none"}, "compact")],
}
DEFAULT_VIEWS: list[tuple[str, dict[str, str], Density]] = [
    ("Everything", {}, "comfortable"), ("Everything, compact", {}, "compact"), ("Needs attention", {"status": "open"}, "comfortable")]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


class ViewIn(BaseModel):
    route: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    filters: dict[str, str] = Field(default_factory=dict)
    columns: Optional[list[str]] = Field(None, max_length=80, description="column keys in display order; null: the page's columns")
    density: Optional[Density] = Field(None, description="null: the page's density")


class ViewOut(BaseModel):
    id: str
    route: str
    name: str
    filters: dict[str, str]
    columns: Optional[list[str]] = None
    density: Optional[str] = None
    builtin: bool = False
    created_at: Optional[datetime] = None      # null for a built-in view


class ViewsOut(BaseModel):
    route: str
    views: list[ViewOut]


def builtin_views(route: str) -> list[dict]:
    return [{"id": f"builtin:{route}:{_slug(n)}", "route": route, "name": n, "filters": f, "columns": None,
             "density": d, "builtin": True, "created_at": None}
            for n, f, d in BUILTIN_VIEWS.get(route, DEFAULT_VIEWS)]


def _owner(request: Request) -> str:
    return current_user_id(request) or "local"  # AUTH_MODE=local without a login: one shared owner per tenant


def _out(r) -> dict:
    return {"id": str(r["id"]), "route": r["route"], "name": r["name"], "filters": r["filters"] or {},
            "columns": r["columns"], "density": r["density"], "builtin": False, "created_at": r["created_at"]}


_COLS = "id, route, name, filters, columns, density, created_at"


@router.get("", response_model=ViewsOut, dependencies=[Depends(require_permission("view"))])
async def list_views(request: Request, route: str = Query(..., min_length=1, max_length=64),
                     db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The route's built-in views first, then the current user's own, by name."""
    await _rls(db, tenant)
    rows = (await db.execute(text(f"SELECT {_COLS} FROM saved_views WHERE tenant_id = CAST(:t AS uuid) AND user_id = :u "
                                  "AND route = :r ORDER BY lower(name), id"),
                             {"t": str(tenant.id), "u": _owner(request), "r": route})).mappings().all()
    return {"route": route, "views": builtin_views(route) + [_out(r) for r in rows]}


@router.put("", response_model=ViewOut, dependencies=[Depends(require_permission("view"))])
async def put_view(body: ViewIn, request: Request, db: AsyncSession = Depends(get_db),
                   tenant: Tenant = Depends(get_tenant)):
    """Create the view, or replace the one with the same route and name (filters, columns and density together)."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required")
    if any(name.lower() == b["name"].lower() for b in builtin_views(body.route)):
        raise HTTPException(status_code=409, detail=f"'{name}' is a built-in view of this page; save yours under another name.")
    await _rls(db, tenant)
    row = (await db.execute(text(f"""
        INSERT INTO saved_views (tenant_id, user_id, route, name, filters, columns, density)
        VALUES (CAST(:t AS uuid), :u, :r, :n, CAST(:f AS jsonb), CAST(:c AS jsonb), :d)
        ON CONFLICT (tenant_id, user_id, route, name)
        DO UPDATE SET filters = EXCLUDED.filters, columns = EXCLUDED.columns, density = EXCLUDED.density
        RETURNING {_COLS}"""),
        {"t": str(tenant.id), "u": _owner(request), "r": body.route, "n": name, "f": json.dumps(body.filters),
         "c": json.dumps(body.columns) if body.columns is not None else None, "d": body.density})).mappings().one()
    await db.commit()
    return _out(row)


@router.delete("/{view_id}", status_code=204, dependencies=[Depends(require_permission("view"))])
async def delete_view(view_id: str, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)):
    """Delete one of the user's views. A built-in view is 409; another user's (or an unknown) view is 404."""
    if view_id.startswith("builtin:"):
        raise HTTPException(status_code=409, detail="A built-in view cannot be deleted.")
    try:
        vid = uuid.UUID(view_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="View not found")
    await _rls(db, tenant)
    gone = (await db.execute(text("DELETE FROM saved_views WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid) "
                                  "AND user_id = :u"), {"id": str(vid), "t": str(tenant.id), "u": _owner(request)})).rowcount
    if not gone:
        raise HTTPException(status_code=404, detail="View not found")
    await db.commit()
    return Response(status_code=204)
