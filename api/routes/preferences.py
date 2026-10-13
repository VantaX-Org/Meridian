"""Per-user preferences: GET/PATCH /api/v1/me/preferences (current user only).

Stored as one JSONB document on users.preferences. PATCH is a JSON merge patch
(RFC 7386): objects merge key by key, an explicit null removes a key, arrays and
scalars replace. The patch is validated against Preferences first, so no unknown key
or out-of-range value reaches the column.
"""

import json
import uuid
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import current_user_id

router = APIRouter(prefix="/api/v1", tags=["preferences"])


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NotificationPrefs(_Strict):
    digest: Optional[Literal["daily", "weekly", "off"]] = None
    immediate_critical: Optional[bool] = None
    channels: Optional[dict[str, Optional[bool]]] = Field(default=None, max_length=20)


class SavedView(BaseModel):
    """A saved table view; extra keys are kept so the client can evolve the shape."""

    model_config = ConfigDict(extra="allow")
    name: str = Field(min_length=1, max_length=80)


class Preferences(_Strict):
    theme: Optional[Literal["light", "dark", "system"]] = None
    density: Optional[Literal["compact", "default", "comfortable"]] = None
    locale: Optional[str] = Field(default=None, min_length=2, max_length=35, pattern=r"^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$")
    timezone: Optional[str] = Field(default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_+\-/]+$")
    saved_views: Optional[dict[str, Optional[list[SavedView]]]] = Field(default=None, max_length=200)
    tours_done: Optional[list[str]] = Field(default=None, max_length=50)
    seen_version: Optional[str] = Field(default=None, max_length=40)
    notifications: Optional[NotificationPrefs] = None


def _merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in patch.items():
        if value is None:
            out.pop(key, None)
        elif isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        elif isinstance(value, dict):
            out[key] = _merge({}, value)
        else:
            out[key] = value
    return out


def _user(request: Request) -> uuid.UUID:
    uid = current_user_id(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        return uuid.UUID(uid)
    except ValueError:
        raise HTTPException(status_code=401, detail="Authentication required")


async def _load(db: AsyncSession, tenant: Tenant, uid: uuid.UUID, *, for_update: bool = False) -> dict[str, Any]:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    row = (await db.execute(
        text("SELECT preferences FROM users WHERE id = :uid AND tenant_id = :tid" + (" FOR UPDATE" if for_update else "")),
        {"uid": str(uid), "tid": str(tenant.id)},
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    prefs = row[0]
    if isinstance(prefs, str):
        prefs = json.loads(prefs)
    return prefs if isinstance(prefs, dict) else {}


@router.get("/me/preferences")
async def get_preferences(
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict[str, Any]:
    return await _load(db, tenant, _user(request))


@router.patch("/me/preferences")
async def patch_preferences(
    body: Preferences,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict[str, Any]:
    uid = _user(request)
    current = await _load(db, tenant, uid, for_update=True)  # lock the row: concurrent PATCHes merge in turn
    merged = _merge(current, body.model_dump(exclude_unset=True, mode="json"))
    try:  # the stored document must stay valid after the merge (no nulls are ever kept)
        Preferences.model_validate(merged)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Preferences are not valid")
    await db.execute(
        text("UPDATE users SET preferences = CAST(:p AS JSONB) WHERE id = :uid AND tenant_id = :tid"),
        {"p": json.dumps(merged), "uid": str(uid), "tid": str(tenant.id)},
    )
    await db.commit()
    return merged
