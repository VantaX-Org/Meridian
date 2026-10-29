"""Read-only share links to a canvas state (migration 104).

POST   /api/v1/share-links                    {route, state, label?, expires_in_days} -> {id, token, url, expires_at}
                                              the token is shown once; only its sha256 is stored. Needs ``export``.
GET    /api/v1/share-links                    the caller's links; ``?all=true`` every link of the tenant (manage_users)
DELETE /api/v1/share-links/{id}               revoke: the creator or a user administrator
GET    /api/v1/share-links/resolve/{token}    {route, state, role: "viewer", expires_at}: what the link opens. Needs a
                                              signed-in user of the tenant (``view``); 410 once revoked or expired.

A link never widens access: whoever opens it is already a user of the tenant, and the page opens under the viewer
role (the client sends X-View-As-Role: viewer only when its own permissions allow it, and otherwise narrows itself
in the browser). It carries a route under /v2 and its query parameters, nothing else. Opening and revoking are
audited, and the open count and last-opened time are kept for the administrator.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import (
    _get_user_role,
    current_user_id,
    current_user_label,
    has_permission,
    require_permission,
    write_audit,
)

router = APIRouter(prefix="/api/v1/share-links", tags=["share-links"])

_ROUTE = re.compile(r"^/v2(?:/[A-Za-z0-9_\-.:%]+)*$")
_COLS = ("id::text AS id, route, state, role, label, created_by, created_by_label, created_at, expires_at, revoked_at, "
         "last_opened_at, open_count")


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def link_state(row: dict, now: datetime) -> str:
    """active | expired | revoked."""
    if row.get("revoked_at"):
        return "revoked"
    return "expired" if row["expires_at"] <= now else "active"


class ShareIn(BaseModel):
    route: str = Field(min_length=3, max_length=300)
    state: dict[str, str] = Field(default_factory=dict, max_length=20)
    label: str | None = Field(None, max_length=120)
    expires_in_days: int = Field(7, ge=1, le=90)

    @field_validator("route")
    @classmethod
    def _route(cls, v: str) -> str:
        if not _ROUTE.match(v):
            raise ValueError("Only a page of the new interface (/v2...) can be shared.")
        return v

    @field_validator("state")
    @classmethod
    def _state(cls, v: dict[str, str]) -> dict[str, str]:
        if any(len(k) > 40 or len(x) > 400 for k, x in v.items()):
            raise ValueError("A shared view keeps short query parameters only.")
        return {k: x for k, x in v.items() if k not in ("fixture", "persona", "token")}


def _out(r, now: datetime) -> dict:
    d = dict(r)
    return {**d, "state_word": link_state(d, now)}


async def _rls(db: AsyncSession, tenant: Tenant) -> str:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
    return str(tenant.id)


@router.post("", status_code=201, dependencies=[Depends(require_permission("export"))])
async def create_link(body: ShareIn, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)):
    me = current_user_id(request) or "local"
    t = await _rls(db, tenant)
    token = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)
    import json

    row = (await db.execute(text(f"""
        INSERT INTO share_links (tenant_id, token_hash, route, state, label, created_by, created_by_label, expires_at)
        VALUES (CAST(:t AS uuid), :h, :r, CAST(:s AS jsonb), :l, :by, :bl, :e) RETURNING {_COLS}"""),
        {"t": t, "h": token_hash(token), "r": body.route, "s": json.dumps(body.state), "l": body.label, "by": me,
         "bl": current_user_label(), "e": expires})).mappings().one()
    await write_audit(db, tenant.id, request, "share_link.create", "share_link", row["id"], None,
                      {"route": body.route, "expires_at": expires.isoformat()})
    await db.commit()
    return {**_out(row, datetime.now(timezone.utc)), "token": token, "url": f"/v2/share/{token}"}


@router.get("", dependencies=[Depends(require_permission("view"))])
async def list_links(request: Request, all: bool = Query(False), db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)):
    if all and not has_permission(await _get_user_role(tenant, db, request), "manage_users"):
        raise HTTPException(status_code=403, detail={"detail": "forbidden", "resource": "users", "action": "admin",
                                                     "request_access": True})
    t = await _rls(db, tenant)
    me = current_user_id(request) or "local"
    rows = (await db.execute(text(f"SELECT {_COLS} FROM share_links WHERE tenant_id = CAST(:t AS uuid) "
                                  "AND (:all OR created_by = :me) ORDER BY created_at DESC LIMIT 500"),
                             {"t": t, "all": all, "me": me})).mappings().all()
    now = datetime.now(timezone.utc)
    return {"links": [_out(r, now) for r in rows]}


@router.delete("/{link_id}", status_code=204, dependencies=[Depends(require_permission("view"))])
async def revoke_link(link_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)):
    t = await _rls(db, tenant)
    row = (await db.execute(text("SELECT created_by, revoked_at FROM share_links WHERE id = :i AND tenant_id = CAST(:t AS uuid)"),
                            {"i": link_id, "t": t})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Share link not found")
    me = current_user_id(request) or "local"
    if row[0] != me and not has_permission(await _get_user_role(tenant, db, request), "manage_users"):
        raise HTTPException(status_code=403, detail="Only the person who shared it or a user administrator can revoke it.")
    if row[1] is None:
        await db.execute(text("UPDATE share_links SET revoked_at = now() WHERE id = :i AND tenant_id = CAST(:t AS uuid)"),
                         {"i": link_id, "t": t})
        await write_audit(db, tenant.id, request, "share_link.revoke", "share_link", str(link_id), None, None)
        await db.commit()
    return Response(status_code=204)


@router.get("/resolve/{token}", dependencies=[Depends(require_permission("view"))])
async def resolve_link(token: str, request: Request, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)):
    if len(token) > 100:
        raise HTTPException(status_code=404, detail="This link does not exist.")
    t = await _rls(db, tenant)
    row = (await db.execute(text(f"SELECT {_COLS} FROM share_links WHERE tenant_id = CAST(:t AS uuid) AND token_hash = :h"),
                            {"t": t, "h": token_hash(token)})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="This link does not exist.")
    now = datetime.now(timezone.utc)
    word = link_state(dict(row), now)
    if word != "active":
        raise HTTPException(status_code=410, detail=f"This link was {word}. Ask whoever shared it for a new one.")
    await db.execute(text("UPDATE share_links SET open_count = open_count + 1, last_opened_at = now() "
                          "WHERE id = CAST(:i AS uuid) AND tenant_id = CAST(:t AS uuid)"), {"i": row["id"], "t": t})
    await write_audit(db, tenant.id, request, "share_link.open", "share_link", row["id"], None, None)
    await db.commit()
    return {"id": row["id"], "route": row["route"], "state": row["state"], "role": "viewer",
            "label": row["label"], "expires_at": row["expires_at"], "shared_by": row["created_by_label"]}
