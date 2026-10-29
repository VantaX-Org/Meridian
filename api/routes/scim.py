"""SCIM 2.0 service provider (RFC 7643 / 7644) under /scim/v2, for Entra ID, Okta and other identity providers.

Authentication: ``Authorization: Bearer mscim_...``, the tenant's SCIM token (api/services/scim.py, issued by
POST /api/v1/admin/scim/token). These paths sit outside /api, so neither the session middleware nor the licence
middleware sees them; the token alone names the tenant and every query runs under that tenant's row-level security.
nginx forwards /scim/ to the API (docker/nginx/meridian.conf).

Resources:
* ServiceProviderConfig, ResourceTypes, Schemas (discovery).
* /Users: list (filter ``userName``/``externalId``/``emails.value``/``id`` eq, startIndex, count), get, create,
  replace, PATCH (add / replace / remove on active, userName, externalId, displayName, name, emails, groups; with or
  without a path, the Entra ID and Okta shapes), DELETE (deactivates the user: is_active false, every session
  ended; the record and its audit trail stay).
* /Groups: list (filter ``displayName``/``externalId``/``id`` eq; ``excludedAttributes=members``), get, create,
  replace, PATCH (members add / remove / replace, displayName), DELETE.

A user's unscoped grants follow their groups through the group-to-role map (scim_group_role_map, managed with
GET/PUT /api/v1/admin/scim/group-roles). Every mutation writes an audit row attributed to the token. Errors use the
SCIM error schema. Users created here have no password: they sign in through single sign-on.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db
from api.services.api_keys import NOT_SERVICE_USER_SQL
from api.services.rate_limiter import rate_limit
from api.services.scim import (
    ENTERPRISE_SCHEMA,
    GROUP_SCHEMA,
    LIST_SCHEMA,
    MEDIA_TYPE,
    PATCH_SCHEMA,
    USER_SCHEMA,
    ScimContext,
    ScimError,
    as_bool,
    as_uuid,
    http_to_scim,
    json_body,
    member_ids,
    paging,
    parse_filter,
    path_value_filter,
    resolve_token_sync,
    scim_audit,
    sync_roles,
)
from api.services.tenant_settings import set_rls

router = APIRouter(prefix="/scim/v2", tags=["scim"])
_scim_limit = rate_limit("scim", limit=1200, window_s=60, key_by="ip")


def scim_response(body: Any, status: int = 200, location: Optional[str] = None) -> JSONResponse:
    headers = {"Location": location} if location else None
    return JSONResponse(content=body, status_code=status, media_type=MEDIA_TYPE, headers=headers)


async def scim_context(request: Request) -> ScimContext:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise ScimError(401, "Send the SCIM bearer token in the Authorization header.")
    ctx = await asyncio.to_thread(resolve_token_sync, auth[7:].strip())
    request.state.tenant_id = ctx.tenant_id
    return ctx


async def _session(ctx: ScimContext = Depends(scim_context), db: AsyncSession = Depends(get_db)) -> AsyncSession:
    await set_rls(db, ctx.tenant_id)
    return db


def _base(request: Request) -> str:
    return str(request.base_url).rstrip("/") + "/scim/v2"


def _iso(v: Optional[datetime]) -> Optional[str]:
    return v.isoformat() if v else None


# ── discovery ────────────────────────────────────────────────────────────────


@router.get("/ServiceProviderConfig", dependencies=[Depends(_scim_limit)])
async def service_provider_config(request: Request, ctx: ScimContext = Depends(scim_context)) -> JSONResponse:
    return scim_response({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        "documentationUri": None,
        "patch": {"supported": True},
        "bulk": {"supported": False, "maxOperations": 0, "maxPayloadSize": 0},
        "filter": {"supported": True, "maxResults": 200},
        "changePassword": {"supported": False},
        "sort": {"supported": False},
        "etag": {"supported": False},
        "authenticationSchemes": [{"type": "oauthbearertoken", "name": "OAuth Bearer Token", "primary": True,
                                   "description": "The tenant's SCIM token, issued in Meridian Admin."}],
        "meta": {"resourceType": "ServiceProviderConfig", "location": f"{_base(request)}/ServiceProviderConfig"},
    })


def _resource_types(request: Request) -> list[dict[str, Any]]:
    base = _base(request)
    return [
        {"schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], "id": "User", "name": "User",
         "endpoint": "/Users", "schema": USER_SCHEMA,
         "schemaExtensions": [{"schema": ENTERPRISE_SCHEMA, "required": False}],
         "meta": {"resourceType": "ResourceType", "location": f"{base}/ResourceTypes/User"}},
        {"schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], "id": "Group", "name": "Group",
         "endpoint": "/Groups", "schema": GROUP_SCHEMA,
         "meta": {"resourceType": "ResourceType", "location": f"{base}/ResourceTypes/Group"}},
    ]


@router.get("/ResourceTypes", dependencies=[Depends(_scim_limit)])
async def resource_types(request: Request, ctx: ScimContext = Depends(scim_context)) -> JSONResponse:
    items = _resource_types(request)
    return scim_response({"schemas": [LIST_SCHEMA], "totalResults": len(items), "startIndex": 1,
                          "itemsPerPage": len(items), "Resources": items})


@router.get("/ResourceTypes/{name}", dependencies=[Depends(_scim_limit)])
async def resource_type(name: str, request: Request, ctx: ScimContext = Depends(scim_context)) -> JSONResponse:
    for item in _resource_types(request):
        if item["id"] == name:
            return scim_response(item)
    raise ScimError(404, f"Resource type {name} not found.")


def _attr(name: str, type_: str = "string", *, multi: bool = False, required: bool = False,
          mutability: str = "readWrite", uniqueness: str = "none", sub: Optional[list] = None) -> dict[str, Any]:
    out = {"name": name, "type": type_, "multiValued": multi, "required": required, "caseExact": False,
           "mutability": mutability, "returned": "default", "uniqueness": uniqueness}
    if sub:
        out["subAttributes"] = sub
    return out


def _schemas(request: Request) -> list[dict[str, Any]]:
    base = _base(request)
    user = {"id": USER_SCHEMA, "name": "User", "description": "A Meridian user",
            "attributes": [
                _attr("userName", required=True, uniqueness="server"),
                _attr("externalId"),
                _attr("name", "complex", sub=[_attr("formatted"), _attr("givenName"), _attr("familyName")]),
                _attr("displayName"),
                _attr("active", "boolean"),
                _attr("emails", "complex", multi=True,
                      sub=[_attr("value"), _attr("type"), _attr("primary", "boolean")]),
                _attr("groups", "complex", multi=True, mutability="readOnly",
                      sub=[_attr("value", mutability="readOnly"), _attr("display", mutability="readOnly")]),
                _attr("roles", "complex", multi=True, mutability="readOnly", sub=[_attr("value")]),
            ],
            "meta": {"resourceType": "Schema", "location": f"{base}/Schemas/{USER_SCHEMA}"}}
    group = {"id": GROUP_SCHEMA, "name": "Group", "description": "A group; its displayName maps to a Meridian role",
             "attributes": [
                 _attr("displayName", required=True, uniqueness="server"),
                 _attr("externalId"),
                 _attr("members", "complex", multi=True, sub=[_attr("value"), _attr("display", mutability="readOnly")]),
             ],
             "meta": {"resourceType": "Schema", "location": f"{base}/Schemas/{GROUP_SCHEMA}"}}
    return [{"schemas": ["urn:ietf:params:scim:schemas:core:2.0:Schema"], **s} for s in (user, group)]


@router.get("/Schemas", dependencies=[Depends(_scim_limit)])
async def schemas(request: Request, ctx: ScimContext = Depends(scim_context)) -> JSONResponse:
    items = _schemas(request)
    return scim_response({"schemas": [LIST_SCHEMA], "totalResults": len(items), "startIndex": 1,
                          "itemsPerPage": len(items), "Resources": items})


@router.get("/Schemas/{schema_id}", dependencies=[Depends(_scim_limit)])
async def schema(schema_id: str, request: Request, ctx: ScimContext = Depends(scim_context)) -> JSONResponse:
    for item in _schemas(request):
        if item["id"] == schema_id:
            return scim_response(item)
    raise ScimError(404, f"Schema {schema_id} not found.")


# ── users ────────────────────────────────────────────────────────────────────

_USER_SELECT = f"""
    SELECT u.id, u.email, u.name, u.role, u.is_active, u.created_at, su.external_id,
           COALESCE(su.user_name, u.email) AS user_name, su.given_name, su.family_name, su.display_name,
           COALESCE(su.updated_at, u.created_at) AS updated_at
      FROM users u LEFT JOIN scim_users su ON su.user_id = u.id AND su.tenant_id = u.tenant_id
     WHERE u.tenant_id = :t AND {NOT_SERVICE_USER_SQL.format(col='u.email')}"""
_USER_FILTERS = {"username": "lower(COALESCE(su.user_name, u.email)) = lower(:v)",
                 "externalid": "su.external_id = :v",
                 "emails.value": "lower(u.email) = lower(:v)", "emails": "lower(u.email) = lower(:v)",
                 "id": "u.id = CAST(:v AS uuid)"}


async def _groups_of(db: AsyncSession, tenant_id: uuid.UUID, user_ids: list[str]) -> dict[str, list[dict]]:
    if not user_ids:
        return {}
    rows = await db.execute(text(
        "SELECT gm.user_id, g.id, g.display_name FROM scim_group_members gm JOIN scim_groups g "
        "ON g.id = gm.group_id AND g.tenant_id = gm.tenant_id WHERE gm.tenant_id = :t "
        "AND gm.user_id = ANY(CAST(:u AS uuid[])) ORDER BY g.display_name"), {"t": str(tenant_id), "u": user_ids})
    out: dict[str, list[dict]] = {}
    for uid, gid, name in rows.fetchall():
        out.setdefault(str(uid), []).append({"value": str(gid), "display": name})
    return out


def _user_resource(row: Any, groups: list[dict], base: str) -> dict[str, Any]:
    name = {"formatted": row.name}
    if row.given_name:
        name["givenName"] = row.given_name
    if row.family_name:
        name["familyName"] = row.family_name
    out: dict[str, Any] = {
        "schemas": [USER_SCHEMA], "id": str(row.id), "userName": row.user_name, "name": name,
        "displayName": row.display_name or row.name, "active": bool(row.is_active),
        "emails": [{"value": row.email, "type": "work", "primary": True}],
        "groups": [{**g, "$ref": f"{base}/Groups/{g['value']}"} for g in groups],
        "roles": [{"value": row.role, "primary": True}],
        "meta": {"resourceType": "User", "created": _iso(row.created_at), "lastModified": _iso(row.updated_at),
                 "location": f"{base}/Users/{row.id}"},
    }
    if row.external_id:
        out["externalId"] = row.external_id
    return out


async def _load_user(db: AsyncSession, tenant_id: uuid.UUID, user_id: str) -> Any:
    uid = as_uuid(user_id)
    row = (await db.execute(text(_USER_SELECT + " AND u.id = :u"), {"t": str(tenant_id), "u": str(uid)})).fetchone() \
        if uid else None
    if row is None:
        raise ScimError(404, f"User {user_id} not found.")
    return row


async def _user_out(db: AsyncSession, tenant_id: uuid.UUID, user_id: str, base: str) -> dict[str, Any]:
    row = await _load_user(db, tenant_id, user_id)
    return _user_resource(row, (await _groups_of(db, tenant_id, [str(row.id)])).get(str(row.id), []), base)


@router.get("/Users", dependencies=[Depends(_scim_limit)])
async def list_users(request: Request, filter: Optional[str] = Query(None), startIndex: Optional[int] = Query(None),
                     count: Optional[int] = Query(None), ctx: ScimContext = Depends(scim_context),
                     db: AsyncSession = Depends(_session)) -> JSONResponse:
    f = parse_filter(filter, {k: k for k in _USER_FILTERS})
    where, params = "", {"t": str(ctx.tenant_id)}
    if f:
        if f[0] == "id" and as_uuid(f[1]) is None:
            return scim_response({"schemas": [LIST_SCHEMA], "totalResults": 0, "startIndex": 1, "itemsPerPage": 0,
                                  "Resources": []})
        where, params["v"] = f" AND {_USER_FILTERS[f[0]]}", f[1]
    start, n = paging(startIndex, count)
    total = (await db.execute(text(f"SELECT count(*) FROM ({_USER_SELECT}{where}) x"), params)).scalar_one()
    rows = (await db.execute(text(f"{_USER_SELECT}{where} ORDER BY u.created_at, u.id OFFSET :o LIMIT :n"),
                             {**params, "o": start - 1, "n": n})).fetchall()
    groups = await _groups_of(db, ctx.tenant_id, [str(r.id) for r in rows])
    base = _base(request)
    return scim_response({"schemas": [LIST_SCHEMA], "totalResults": int(total), "startIndex": start,
                          "itemsPerPage": len(rows),
                          "Resources": [_user_resource(r, groups.get(str(r.id), []), base) for r in rows]})


@router.get("/Users/{user_id}", dependencies=[Depends(_scim_limit)])
async def get_user(user_id: str, request: Request, ctx: ScimContext = Depends(scim_context),
                   db: AsyncSession = Depends(_session)) -> JSONResponse:
    return scim_response(await _user_out(db, ctx.tenant_id, user_id, _base(request)))


def _state(row: Any) -> dict[str, Any]:
    # A name built from its parts is rebuilt when a part changes; one given whole (formatted) is kept as is.
    formatted = None if (row.given_name or row.family_name) else row.name
    return {"userName": row.user_name, "externalId": row.external_id, "givenName": row.given_name,
            "familyName": row.family_name, "formatted": formatted, "displayName": row.display_name,
            "email": row.email, "active": bool(row.is_active)}


def _primary_email(emails: Any) -> Optional[str]:
    if emails is None:
        return None
    if not isinstance(emails, list):
        emails = [emails]
    items = [e for e in emails if isinstance(e, dict) and e.get("value")]
    pick = next((e for e in items if e.get("primary") in (True, "true", "True")), None) \
        or next((e for e in items if str(e.get("type", "")).lower() == "work"), None) \
        or (items[0] if items else None)
    return str(pick["value"]).strip() if pick else None


def _apply_name(state: dict[str, Any], name: Any) -> None:
    if name is None:
        state["givenName"] = state["familyName"] = None
        return
    if not isinstance(name, dict):
        raise ScimError(400, "name must be an object.", "invalidValue")
    for key in ("givenName", "familyName", "formatted"):
        if key in name:
            state[key] = name[key]


def _apply_full(state: dict[str, Any], body: dict[str, Any], *, replace: bool) -> Optional[list[str]]:
    """POST/PUT body onto ``state``; returns the group ids when the body names groups (PUT only)."""
    if replace:
        for key in ("externalId", "givenName", "familyName", "displayName", "formatted"):
            state[key] = None
    if "userName" in body:
        state["userName"] = body["userName"]
    if "externalId" in body:
        state["externalId"] = body["externalId"]
    if "name" in body:
        _apply_name(state, body["name"])
    if "displayName" in body:
        state["displayName"] = body["displayName"]
    if "emails" in body:
        state["email"] = _primary_email(body["emails"]) or state.get("email")
    if "active" in body:
        state["active"] = as_bool(body["active"])
    return member_ids(body["groups"]) if isinstance(body.get("groups"), list) else None


def _finish_state(state: dict[str, Any]) -> dict[str, Any]:
    user_name = str(state.get("userName") or "").strip()
    if not user_name:
        raise ScimError(400, "userName is required.", "invalidValue")
    if len(user_name) > 256:
        raise ScimError(400, "userName is too long.", "invalidValue")
    state["userName"] = user_name
    email = (state.get("email") or (user_name if "@" in user_name else None) or "").strip()
    if "@" not in email or len(email) > 320:
        raise ScimError(400, "A work email (emails or an email-shaped userName) is required.", "invalidValue")
    state["email"] = email
    for k in ("externalId", "givenName", "familyName", "displayName", "formatted"):
        v = state.get(k)
        state[k] = str(v).strip()[:256] if v not in (None, "") else None
    parts = " ".join(p for p in (state.get("givenName"), state.get("familyName")) if p)
    state["name"] = state.get("formatted") or parts or state.get("displayName") or user_name
    return state


async def _check_unique(db: AsyncSession, tenant_id: uuid.UUID, state: dict[str, Any], self_id: Optional[str]) -> None:
    p = {"t": str(tenant_id), "s": self_id or "00000000-0000-0000-0000-000000000000"}
    if (await db.execute(text("SELECT 1 FROM users u LEFT JOIN scim_users su ON su.user_id = u.id "
                              "WHERE u.tenant_id = :t AND u.id <> CAST(:s AS uuid) AND (lower(u.email) = lower(:e) "
                              "OR lower(COALESCE(su.user_name, u.email)) = lower(:n))"),
                         {**p, "e": state["email"], "n": state["userName"]})).fetchone():
        raise ScimError(409, "A user with this userName or email already exists.", "uniqueness")
    if state.get("externalId") and (await db.execute(text(
            "SELECT 1 FROM scim_users WHERE tenant_id = :t AND external_id = :x AND user_id <> CAST(:s AS uuid)"),
            {**p, "x": state["externalId"]})).fetchone():
        raise ScimError(409, "A user with this externalId already exists.", "uniqueness")


def _tenant(ctx: ScimContext) -> Tenant:
    return Tenant(ctx.tenant_id, "", [])


async def _save_user(db: AsyncSession, ctx: ScimContext, user_id: str, before: Optional[dict[str, Any]],
                     state: dict[str, Any]) -> None:
    """Write users + scim_users for ``state``: seats on (re)activation, last-admin guard and session end on
    deactivation."""
    from api.routes.users import forbid_last_admin, require_seats

    tid = str(ctx.tenant_id)
    was_active = bool(before and before["active"])
    try:
        if state["active"] and not was_active:
            await require_seats(db, _tenant(ctx))
            await set_rls(db, ctx.tenant_id)
        if before is not None and was_active and not state["active"]:
            await forbid_last_admin(db, ctx.tenant_id, uuid.UUID(user_id))
    except HTTPException as e:
        raise http_to_scim(e)
    if before is None:
        await db.execute(text(
            "INSERT INTO users (id, tenant_id, email, name, role, is_active, must_change_password) "
            "VALUES (:u, :t, :e, :n, 'viewer', :a, false)"),
            {"u": user_id, "t": tid, "e": state["email"], "n": state["name"], "a": state["active"]})
    else:
        sets = "email = :e, name = :n, is_active = :a"
        if was_active and not state["active"]:
            sets += ", token_version = token_version + 1"
        elif state["active"] and not was_active:
            sets += ", failed_login_count = 0, locked_until = NULL"
        await db.execute(text(f"UPDATE users SET {sets} WHERE id = :u AND tenant_id = :t"),
                         {"u": user_id, "t": tid, "e": state["email"], "n": state["name"], "a": state["active"]})
    await db.execute(text(
        "INSERT INTO scim_users (user_id, tenant_id, external_id, user_name, given_name, family_name, display_name) "
        "VALUES (:u, :t, :x, :un, :g, :f, :d) ON CONFLICT (user_id) DO UPDATE SET external_id = EXCLUDED.external_id, "
        "user_name = EXCLUDED.user_name, given_name = EXCLUDED.given_name, family_name = EXCLUDED.family_name, "
        "display_name = EXCLUDED.display_name, updated_at = now()"),
        {"u": user_id, "t": tid, "x": state["externalId"], "un": state["userName"], "g": state["givenName"],
         "f": state["familyName"], "d": state["displayName"]})
    if before is not None and was_active and not state["active"]:
        from api.middleware.local_auth import forget_token_version

        forget_token_version(user_id)


async def _valid_group_ids(db: AsyncSession, tenant_id: uuid.UUID, ids: list[str]) -> list[str]:
    out = []
    for gid in ids:
        g = as_uuid(gid)
        if g is None or not (await db.execute(text("SELECT 1 FROM scim_groups WHERE id = :g AND tenant_id = :t"),
                                              {"g": str(g), "t": str(tenant_id)})).fetchone():
            raise ScimError(400, f"Group {gid} not found.", "invalidValue")
        out.append(str(g))
    return out


async def _set_user_groups(db: AsyncSession, tenant_id: uuid.UUID, user_id: str, add: list[str] = (),
                           remove: list[str] = (), replace: Optional[list[str]] = None) -> None:
    t = str(tenant_id)
    if replace is not None:
        await db.execute(text("DELETE FROM scim_group_members WHERE tenant_id = :t AND user_id = :u"),
                         {"t": t, "u": user_id})
        add = replace
    for gid in await _valid_group_ids(db, tenant_id, list(add)):
        await db.execute(text("INSERT INTO scim_group_members (group_id, user_id, tenant_id) VALUES (:g, :u, :t) "
                              "ON CONFLICT DO NOTHING"), {"g": gid, "u": user_id, "t": t})
    for gid in remove:
        if as_uuid(gid):
            await db.execute(text("DELETE FROM scim_group_members WHERE tenant_id = :t AND user_id = :u "
                                  "AND group_id = :g"), {"t": t, "u": user_id, "g": gid})


async def _sync(db: AsyncSession, ctx: ScimContext, request: Request, user_ids: list[str]) -> None:
    try:
        changes = await sync_roles(db, ctx.tenant_id, user_ids)
    except HTTPException as e:
        raise http_to_scim(e)
    for uid, change in changes.items():
        await scim_audit(db, ctx.actor, ctx.tenant_id, request, "scim.roles", "user", uid, None, change)


@router.post("/Users", dependencies=[Depends(_scim_limit)])
async def create_user(request: Request, ctx: ScimContext = Depends(scim_context),
                      db: AsyncSession = Depends(_session)) -> JSONResponse:
    body = await json_body(request)
    state: dict[str, Any] = {"userName": None, "externalId": None, "givenName": None, "familyName": None,
                             "formatted": None, "displayName": None, "email": None, "active": True}
    groups = _apply_full(state, body, replace=False)
    state = _finish_state(state)
    await _check_unique(db, ctx.tenant_id, state, None)
    user_id = str(uuid.uuid4())
    await _save_user(db, ctx, user_id, None, state)
    if groups:
        await _set_user_groups(db, ctx.tenant_id, user_id, replace=groups)
    await _sync(db, ctx, request, [user_id])
    await scim_audit(db, ctx.actor, ctx.tenant_id, request, "scim.user.create", "user", user_id, None,
                     {k: v for k, v in state.items() if k != "name"}, 201)
    await db.commit()
    await set_rls(db, ctx.tenant_id)
    out = await _user_out(db, ctx.tenant_id, user_id, _base(request))
    return scim_response(out, 201, out["meta"]["location"])


@router.put("/Users/{user_id}", dependencies=[Depends(_scim_limit)])
async def replace_user(user_id: str, request: Request, ctx: ScimContext = Depends(scim_context),
                       db: AsyncSession = Depends(_session)) -> JSONResponse:
    body = await json_body(request)
    row = await _load_user(db, ctx.tenant_id, user_id)
    before = _state(row)
    state = dict(before)
    groups = _apply_full(state, body, replace=True)
    if "active" not in body:
        state["active"] = before["active"]
    state = _finish_state(state)
    await _check_unique(db, ctx.tenant_id, state, str(row.id))
    await _save_user(db, ctx, str(row.id), before, state)
    if groups is not None:
        await _set_user_groups(db, ctx.tenant_id, str(row.id), replace=groups)
    await _sync(db, ctx, request, [str(row.id)])
    await scim_audit(db, ctx.actor, ctx.tenant_id, request, "scim.user.replace", "user", str(row.id), before,
                     {k: v for k, v in state.items() if k != "name"})
    await db.commit()
    await set_rls(db, ctx.tenant_id)
    return scim_response(await _user_out(db, ctx.tenant_id, str(row.id), _base(request)))


_USER_PATHS = {"active", "username", "externalid", "displayname", "name", "name.givenname", "name.familyname",
               "name.formatted", "emails", "groups"}


def _ops(body: dict[str, Any]) -> list[dict[str, Any]]:
    schemas_ = body.get("schemas")
    if isinstance(schemas_, list) and schemas_ and PATCH_SCHEMA not in schemas_:
        raise ScimError(400, "A PATCH body uses the PatchOp schema.", "invalidSyntax")
    ops = body.get("Operations") or body.get("operations")
    if not isinstance(ops, list) or not ops:
        raise ScimError(400, "Operations must be a non-empty list.", "invalidSyntax")
    out = []
    for op in ops:
        if not isinstance(op, dict) or str(op.get("op", "")).lower() not in ("add", "replace", "remove"):
            raise ScimError(400, "Each operation needs op add, replace or remove.", "invalidSyntax")
        out.append({"op": str(op["op"]).lower(), "path": op.get("path"), "value": op.get("value")})
    return out


def _user_path(path: str) -> str:
    p = path.strip()
    if p.lower().startswith(USER_SCHEMA.lower() + ":"):
        p = p[len(USER_SCHEMA) + 1:]
    return p


@router.patch("/Users/{user_id}", dependencies=[Depends(_scim_limit)])
async def patch_user(user_id: str, request: Request, ctx: ScimContext = Depends(scim_context),
                     db: AsyncSession = Depends(_session)) -> JSONResponse:
    body = await json_body(request)
    ops = _ops(body)
    row = await _load_user(db, ctx.tenant_id, user_id)
    uid = str(row.id)
    before = _state(row)
    state = dict(before)
    add_g: list[str] = []
    remove_g: list[str] = []
    replace_g: Optional[list[str]] = None

    def apply(op: str, path: str, value: Any) -> None:
        nonlocal replace_g
        raw = _user_path(path)
        low = raw.lower()
        vf = path_value_filter(raw)
        if vf and vf[0] == "groups":
            if op != "remove":
                raise ScimError(400, "Use add with a groups list to join a group.", "invalidPath")
            remove_g.append(vf[1])
            return
        if low.startswith("emails"):  # emails, emails[type eq "work"].value, emails.value
            if op == "remove":
                return  # a user always keeps one email
            state["email"] = _primary_email(value) if isinstance(value, (list, dict)) else (str(value) if value else
                                                                                             state["email"])
            return
        if low.startswith(ENTERPRISE_SCHEMA.lower()) or low not in _USER_PATHS:
            return  # attributes Meridian does not keep (title, phone numbers, the enterprise extension): ignored
        if low == "groups":
            ids = member_ids(value) if value is not None else []
            if op == "add":
                add_g.extend(ids)
            elif op == "remove" and ids:
                remove_g.extend(ids)
            elif op == "remove":
                replace_g = []
            else:
                replace_g = ids
            return
        if op == "remove":
            if low in ("externalid", "displayname"):
                state["externalId" if low == "externalid" else "displayName"] = None
            elif low in ("name.givenname", "name.familyname", "name.formatted"):
                state[{"name.givenname": "givenName", "name.familyname": "familyName",
                       "name.formatted": "formatted"}[low]] = None
            elif low == "name":
                _apply_name(state, None)
            elif low in ("active", "username"):
                raise ScimError(400, f"{raw} cannot be removed.", "mutability")
            return
        if low == "active":
            state["active"] = as_bool(value)
        elif low == "username":
            state["userName"] = value
        elif low == "externalid":
            state["externalId"] = value
        elif low == "displayname":
            state["displayName"] = value
        elif low == "name":
            _apply_name(state, value)
        else:
            state[{"name.givenname": "givenName", "name.familyname": "familyName",
                   "name.formatted": "formatted"}[low]] = value

    for op in ops:
        if op["path"]:
            apply(op["op"], str(op["path"]), op["value"])
        elif op["op"] == "remove":
            raise ScimError(400, "remove needs a path.", "noTarget")
        elif isinstance(op["value"], dict):
            for key, value in op["value"].items():
                apply(op["op"], key, value)
        else:
            raise ScimError(400, "An operation without a path needs an object value.", "invalidValue")

    state = _finish_state(state)
    await _check_unique(db, ctx.tenant_id, state, uid)
    if any(state[k] != before[k] for k in before) or state["name"] != row.name:
        await _save_user(db, ctx, uid, before, state)
    if add_g or remove_g or replace_g is not None:
        await _set_user_groups(db, ctx.tenant_id, uid, add=add_g, remove=remove_g, replace=replace_g)
    await _sync(db, ctx, request, [uid])
    await scim_audit(db, ctx.actor, ctx.tenant_id, request, "scim.user.patch", "user", uid, before,
                     {**{k: v for k, v in state.items() if k != "name"},
                      "groups": {"add": add_g, "remove": remove_g, "replace": replace_g}})
    await db.commit()
    await set_rls(db, ctx.tenant_id)
    return scim_response(await _user_out(db, ctx.tenant_id, uid, _base(request)))


@router.delete("/Users/{user_id}", dependencies=[Depends(_scim_limit)])
async def delete_user(user_id: str, request: Request, ctx: ScimContext = Depends(scim_context),
                      db: AsyncSession = Depends(_session)) -> Response:
    """Deactivates: the user can no longer sign in and every session ends; history and audit stay."""
    row = await _load_user(db, ctx.tenant_id, user_id)
    before = _state(row)
    if before["active"]:
        await _save_user(db, ctx, str(row.id), before, {**before, "name": row.name, "active": False})
    await scim_audit(db, ctx.actor, ctx.tenant_id, request, "scim.user.deactivate", "user", str(row.id),
                     {"active": before["active"]}, {"active": False}, 204)
    await db.commit()
    return Response(status_code=204)


# ── groups ───────────────────────────────────────────────────────────────────

_GROUP_FILTERS = {"displayname": "lower(g.display_name) = lower(:v)", "externalid": "g.external_id = :v",
                  "id": "g.id = CAST(:v AS uuid)"}


async def _members_of(db: AsyncSession, tenant_id: uuid.UUID, group_ids: list[str]) -> dict[str, list[dict]]:
    if not group_ids:
        return {}
    rows = await db.execute(text(
        "SELECT gm.group_id, u.id, u.name FROM scim_group_members gm JOIN users u ON u.id = gm.user_id "
        "AND u.tenant_id = gm.tenant_id WHERE gm.tenant_id = :t AND gm.group_id = ANY(CAST(:g AS uuid[])) "
        "ORDER BY u.name"), {"t": str(tenant_id), "g": group_ids})
    out: dict[str, list[dict]] = {}
    for gid, uid, name in rows.fetchall():
        out.setdefault(str(gid), []).append({"value": str(uid), "display": name})
    return out


def _group_resource(row: Any, members: Optional[list[dict]], base: str) -> dict[str, Any]:
    out: dict[str, Any] = {"schemas": [GROUP_SCHEMA], "id": str(row.id), "displayName": row.display_name,
                           "meta": {"resourceType": "Group", "created": _iso(row.created_at),
                                    "lastModified": _iso(row.updated_at), "location": f"{base}/Groups/{row.id}"}}
    if row.external_id:
        out["externalId"] = row.external_id
    if members is not None:
        out["members"] = [{**m, "$ref": f"{base}/Users/{m['value']}"} for m in members]
    return out


async def _load_group(db: AsyncSession, tenant_id: uuid.UUID, group_id: str) -> Any:
    gid = as_uuid(group_id)
    row = (await db.execute(text("SELECT id, display_name, external_id, created_at, updated_at FROM scim_groups "
                                 "WHERE id = :g AND tenant_id = :t"), {"g": str(gid), "t": str(tenant_id)})).fetchone() \
        if gid else None
    if row is None:
        raise ScimError(404, f"Group {group_id} not found.")
    return row


async def _group_out(db: AsyncSession, tenant_id: uuid.UUID, group_id: str, base: str,
                     with_members: bool = True) -> dict[str, Any]:
    row = await _load_group(db, tenant_id, group_id)
    members = (await _members_of(db, tenant_id, [str(row.id)])).get(str(row.id), []) if with_members else None
    return _group_resource(row, members, base)


def _excluded(excluded: Optional[str]) -> bool:
    return bool(excluded) and "members" in {a.strip().lower() for a in excluded.split(",")}


@router.get("/Groups", dependencies=[Depends(_scim_limit)])
async def list_groups(request: Request, filter: Optional[str] = Query(None), startIndex: Optional[int] = Query(None),
                      count: Optional[int] = Query(None), excludedAttributes: Optional[str] = Query(None),
                      ctx: ScimContext = Depends(scim_context), db: AsyncSession = Depends(_session)) -> JSONResponse:
    f = parse_filter(filter, {k: k for k in _GROUP_FILTERS})
    where, params = "", {"t": str(ctx.tenant_id)}
    if f:
        if f[0] == "id" and as_uuid(f[1]) is None:
            return scim_response({"schemas": [LIST_SCHEMA], "totalResults": 0, "startIndex": 1, "itemsPerPage": 0,
                                  "Resources": []})
        where, params["v"] = f" AND {_GROUP_FILTERS[f[0]]}", f[1]
    start, n = paging(startIndex, count)
    total = (await db.execute(text(f"SELECT count(*) FROM scim_groups g WHERE g.tenant_id = :t{where}"),
                              params)).scalar_one()
    rows = (await db.execute(text(
        f"SELECT g.id, g.display_name, g.external_id, g.created_at, g.updated_at FROM scim_groups g "
        f"WHERE g.tenant_id = :t{where} ORDER BY g.display_name, g.id OFFSET :o LIMIT :n"),
        {**params, "o": start - 1, "n": n})).fetchall()
    skip = _excluded(excludedAttributes)
    members = {} if skip else await _members_of(db, ctx.tenant_id, [str(r.id) for r in rows])
    base = _base(request)
    return scim_response({"schemas": [LIST_SCHEMA], "totalResults": int(total), "startIndex": start,
                          "itemsPerPage": len(rows),
                          "Resources": [_group_resource(r, None if skip else members.get(str(r.id), []), base)
                                        for r in rows]})


@router.get("/Groups/{group_id}", dependencies=[Depends(_scim_limit)])
async def get_group(group_id: str, request: Request, excludedAttributes: Optional[str] = Query(None),
                    ctx: ScimContext = Depends(scim_context), db: AsyncSession = Depends(_session)) -> JSONResponse:
    return scim_response(await _group_out(db, ctx.tenant_id, group_id, _base(request),
                                          not _excluded(excludedAttributes)))


async def _valid_members(db: AsyncSession, tenant_id: uuid.UUID, ids: list[str]) -> list[str]:
    out = []
    for uid in ids:
        u = as_uuid(uid)
        if u is None or not (await db.execute(text(
                f"SELECT 1 FROM users WHERE id = :u AND tenant_id = :t AND {NOT_SERVICE_USER_SQL.format(col='email')}"),
                {"u": str(u), "t": str(tenant_id)})).fetchone():
            raise ScimError(400, f"User {uid} not found.", "invalidValue")
        out.append(str(u))
    return out


async def _current_members(db: AsyncSession, tenant_id: uuid.UUID, group_id: str) -> set[str]:
    rows = await db.execute(text("SELECT user_id FROM scim_group_members WHERE tenant_id = :t AND group_id = :g"),
                            {"t": str(tenant_id), "g": group_id})
    return {str(r[0]) for r in rows.fetchall()}


async def _set_members(db: AsyncSession, tenant_id: uuid.UUID, group_id: str, add: list[str] = (),
                       remove: list[str] = (), replace: Optional[list[str]] = None) -> set[str]:
    """Apply the change; returns every user whose membership changed."""
    t = str(tenant_id)
    before = await _current_members(db, tenant_id, group_id)
    if replace is not None:
        target = set(await _valid_members(db, tenant_id, replace))
    else:
        target = (before | set(await _valid_members(db, tenant_id, list(add)))) - {str(as_uuid(r)) for r in remove
                                                                                   if as_uuid(r)}
    for uid in target - before:
        await db.execute(text("INSERT INTO scim_group_members (group_id, user_id, tenant_id) VALUES (:g, :u, :t) "
                              "ON CONFLICT DO NOTHING"), {"g": group_id, "u": uid, "t": t})
    for uid in before - target:
        await db.execute(text("DELETE FROM scim_group_members WHERE tenant_id = :t AND group_id = :g AND user_id = :u"),
                         {"t": t, "g": group_id, "u": uid})
    return (target - before) | (before - target)


def _display_name(value: Any) -> str:
    name = " ".join(str(value or "").split())
    if not name:
        raise ScimError(400, "displayName is required.", "invalidValue")
    if len(name) > 256:
        raise ScimError(400, "displayName is too long.", "invalidValue")
    return name


async def _unique_group(db: AsyncSession, tenant_id: uuid.UUID, name: str, self_id: Optional[str]) -> None:
    if (await db.execute(text("SELECT 1 FROM scim_groups WHERE tenant_id = :t AND lower(display_name) = lower(:n) "
                              "AND id <> CAST(:s AS uuid)"),
                         {"t": str(tenant_id), "n": name,
                          "s": self_id or "00000000-0000-0000-0000-000000000000"})).fetchone():
        raise ScimError(409, "A group with this displayName already exists.", "uniqueness")


@router.post("/Groups", dependencies=[Depends(_scim_limit)])
async def create_group(request: Request, ctx: ScimContext = Depends(scim_context),
                       db: AsyncSession = Depends(_session)) -> JSONResponse:
    body = await json_body(request)
    name = _display_name(body.get("displayName"))
    await _unique_group(db, ctx.tenant_id, name, None)
    gid = str(uuid.uuid4())
    ext = str(body["externalId"])[:256] if body.get("externalId") else None
    await db.execute(text("INSERT INTO scim_groups (id, tenant_id, display_name, external_id) VALUES (:g, :t, :n, :x)"),
                     {"g": gid, "t": str(ctx.tenant_id), "n": name, "x": ext})
    changed = await _set_members(db, ctx.tenant_id, gid, replace=member_ids(body.get("members") or []))
    await _sync(db, ctx, request, sorted(changed))
    await scim_audit(db, ctx.actor, ctx.tenant_id, request, "scim.group.create", "scim_group", gid, None,
                     {"displayName": name, "externalId": ext, "members": sorted(changed)}, 201)
    await db.commit()
    await set_rls(db, ctx.tenant_id)
    out = await _group_out(db, ctx.tenant_id, gid, _base(request))
    return scim_response(out, 201, out["meta"]["location"])


@router.put("/Groups/{group_id}", dependencies=[Depends(_scim_limit)])
async def replace_group(group_id: str, request: Request, ctx: ScimContext = Depends(scim_context),
                        db: AsyncSession = Depends(_session)) -> JSONResponse:
    body = await json_body(request)
    row = await _load_group(db, ctx.tenant_id, group_id)
    gid = str(row.id)
    name = _display_name(body.get("displayName"))
    await _unique_group(db, ctx.tenant_id, name, gid)
    ext = str(body["externalId"])[:256] if body.get("externalId") else None
    members_before = await _current_members(db, ctx.tenant_id, gid)
    await db.execute(text("UPDATE scim_groups SET display_name = :n, external_id = :x, updated_at = now() "
                          "WHERE id = :g AND tenant_id = :t"), {"n": name, "x": ext, "g": gid, "t": str(ctx.tenant_id)})
    changed = await _set_members(db, ctx.tenant_id, gid, replace=member_ids(body.get("members") or []))
    renamed = name.lower() != row.display_name.lower()
    after_members = await _current_members(db, ctx.tenant_id, gid)
    await _sync(db, ctx, request, sorted(changed | ((members_before | after_members) if renamed else set())))
    await scim_audit(db, ctx.actor, ctx.tenant_id, request, "scim.group.replace", "scim_group", gid,
                     {"displayName": row.display_name, "externalId": row.external_id,
                      "members": sorted(members_before)},
                     {"displayName": name, "externalId": ext, "members": sorted(after_members)})
    await db.commit()
    await set_rls(db, ctx.tenant_id)
    return scim_response(await _group_out(db, ctx.tenant_id, gid, _base(request)))


@router.patch("/Groups/{group_id}", dependencies=[Depends(_scim_limit)])
async def patch_group(group_id: str, request: Request, ctx: ScimContext = Depends(scim_context),
                      db: AsyncSession = Depends(_session)) -> Response:
    body = await json_body(request)
    ops = _ops(body)
    row = await _load_group(db, ctx.tenant_id, group_id)
    gid = str(row.id)
    name, ext = row.display_name, row.external_id
    members_before = await _current_members(db, ctx.tenant_id, gid)
    changed: set[str] = set()

    async def members_op(op: str, value: Any) -> None:
        ids = member_ids(value) if value is not None else []
        if op == "add":
            changed.update(await _set_members(db, ctx.tenant_id, gid, add=ids))
        elif op == "remove":
            changed.update(await _set_members(db, ctx.tenant_id, gid, remove=ids) if ids else
                           await _set_members(db, ctx.tenant_id, gid, replace=[]))
        else:
            changed.update(await _set_members(db, ctx.tenant_id, gid, replace=ids))

    for op in ops:
        path = str(op["path"]).strip() if op["path"] else None
        if path is None:
            if op["op"] == "remove" or not isinstance(op["value"], dict):
                raise ScimError(400, "An operation without a path needs an object value.", "invalidValue")
            for key, value in op["value"].items():
                k = key.lower()
                if k == "displayname":
                    name = _display_name(value)
                elif k == "externalid":
                    ext = str(value)[:256] if value else None
                elif k == "members":
                    await members_op(op["op"], value)
            continue
        vf = path_value_filter(path)
        if vf and vf[0] == "members":
            if op["op"] != "remove":
                raise ScimError(400, "Use add with a members list to add members.", "invalidPath")
            changed.update(await _set_members(db, ctx.tenant_id, gid, remove=[vf[1]]))
        elif path.lower() == "members":
            await members_op(op["op"], op["value"])
        elif path.lower() == "displayname":
            if op["op"] == "remove":
                raise ScimError(400, "displayName cannot be removed.", "mutability")
            name = _display_name(op["value"])
        elif path.lower() == "externalid":
            ext = None if op["op"] == "remove" else (str(op["value"])[:256] if op["value"] else None)
        else:
            raise ScimError(400, f"Unsupported path {path}.", "invalidPath")

    renamed = name.lower() != row.display_name.lower()
    if renamed:
        await _unique_group(db, ctx.tenant_id, name, gid)
    if name != row.display_name or ext != row.external_id or changed:
        await db.execute(text("UPDATE scim_groups SET display_name = :n, external_id = :x, updated_at = now() "
                              "WHERE id = :g AND tenant_id = :t"),
                         {"n": name, "x": ext, "g": gid, "t": str(ctx.tenant_id)})
    after_members = await _current_members(db, ctx.tenant_id, gid)
    await _sync(db, ctx, request, sorted(changed | (after_members | members_before if renamed else set())))
    await scim_audit(db, ctx.actor, ctx.tenant_id, request, "scim.group.patch", "scim_group", gid,
                     {"displayName": row.display_name, "externalId": row.external_id,
                      "members": sorted(members_before)},
                     {"displayName": name, "externalId": ext, "members": sorted(after_members)})
    await db.commit()
    await set_rls(db, ctx.tenant_id)
    return scim_response(await _group_out(db, ctx.tenant_id, gid, _base(request)))


@router.delete("/Groups/{group_id}", dependencies=[Depends(_scim_limit)])
async def delete_group(group_id: str, request: Request, ctx: ScimContext = Depends(scim_context),
                       db: AsyncSession = Depends(_session)) -> Response:
    row = await _load_group(db, ctx.tenant_id, group_id)
    gid = str(row.id)
    members = await _current_members(db, ctx.tenant_id, gid)
    await db.execute(text("DELETE FROM scim_groups WHERE id = :g AND tenant_id = :t"),
                     {"g": gid, "t": str(ctx.tenant_id)})
    await _sync(db, ctx, request, sorted(members))
    await scim_audit(db, ctx.actor, ctx.tenant_id, request, "scim.group.delete", "scim_group", gid,
                     {"displayName": row.display_name, "members": sorted(members)}, None, 204)
    await db.commit()
    return Response(status_code=204)
