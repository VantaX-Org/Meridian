"""Tenant theming.

* ``GET  /api/v1/settings/theme``       (manage_settings) the stored theme with its contrast figures.
* ``PUT  /api/v1/settings/theme``       (manage_settings) product_name_override, accent, accent_dark; ``logo_url:
  null`` removes the logo. Every value is checked deterministically (api/services/theme.py).
* ``POST /api/v1/settings/theme/logo``  (manage_settings) multipart PNG or SVG, size and magic-byte checked,
  stored in object storage under ``branding/<tenant>/``.
* ``GET  /api/v1/theme``                public: what the sign-in page needs before anyone signs in.
* ``GET  /api/v1/theme/logo``           public: the logo bytes, with a sandboxing Content-Security-Policy.

Every change writes an audit row. The theme lives in tenant_settings under the key ``theme``.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.deps import Tenant, get_db, get_tenant
from api.services.rate_limiter import rate_limit
from api.services.rbac import current_user_id, require_permission, write_audit
from api.services.tenant_settings import (
    get_setting,
    put_setting,
    resolve_public_tenant,
    set_rls,
)
from api.services.theme import (
    CONTENT_TYPES,
    DARK_GROUND,
    LOGO_MAX_BYTES,
    WHITE,
    ThemeError,
    check_accent,
    check_product_name,
    contrast,
    sniff_logo,
)

logger = logging.getLogger("meridian.theme")
router = APIRouter(prefix="/api/v1", tags=["theme"])

KEY = "theme"
DEFAULT_PRODUCT_NAME = "Meridian"
DEFAULT_ACCENT, DEFAULT_ACCENT_DARK = "#2563EB", "#7FA8FF"  # frontend/design/tokens.css --m-accent
_public_limit = rate_limit("public_theme", limit=120, window_s=60, key_by="ip")


class ThemeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_name_override: Optional[str] = None
    accent: Optional[str] = None
    accent_dark: Optional[str] = None
    # Only null (remove the logo) or the current value; a logo is set by uploading it.
    logo_url: Optional[str] = None


class Contrast(BaseModel):
    on_white: Optional[float] = None
    on_dark: Optional[float] = None


class ThemeOut(BaseModel):
    product_name_override: Optional[str] = None
    accent: Optional[str] = None
    accent_dark: Optional[str] = None
    logo_url: Optional[str] = None
    logo_content_type: Optional[str] = None
    contrast: Contrast
    updated_at: Optional[str] = None


class PublicThemeOut(BaseModel):
    product_name: str
    accent: str
    accent_dark: str
    logo_url: Optional[str] = None
    customised: bool


def _logo_url(theme: dict[str, Any]) -> Optional[str]:
    logo = theme.get("logo")
    return f"/api/v1/theme/logo?v={logo['sha256'][:12]}" if isinstance(logo, dict) and logo.get("sha256") else None


def _view(theme: Optional[dict[str, Any]]) -> ThemeOut:
    t = theme or {}
    accent, dark = t.get("accent"), t.get("accent_dark")
    logo = t.get("logo") if isinstance(t.get("logo"), dict) else None
    return ThemeOut(
        product_name_override=t.get("product_name_override"), accent=accent, accent_dark=dark,
        logo_url=_logo_url(t), logo_content_type=logo.get("content_type") if logo else None,
        contrast=Contrast(on_white=round(contrast(accent, WHITE), 2) if accent else None,
                          on_dark=round(contrast(dark, DARK_GROUND), 2) if dark else None),
        updated_at=t.get("updated_at"))


def _audit_view(theme: Optional[dict[str, Any]]) -> dict[str, Any]:
    return _view(theme).model_dump(exclude={"contrast"})


@router.get("/settings/theme", dependencies=[Depends(require_permission("manage_settings"))])
async def get_theme(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> ThemeOut:
    await set_rls(db, tenant.id)
    return _view(await get_setting(db, tenant.id, KEY))


@router.put("/settings/theme", dependencies=[Depends(require_permission("manage_settings"))])
async def put_theme(body: ThemeIn, request: Request, db: AsyncSession = Depends(get_db),
                    tenant: Tenant = Depends(get_tenant)) -> ThemeOut:
    """Replace the theme's name and colours. An absent or null accent goes back to the product default."""
    await set_rls(db, tenant.id)
    before = await get_setting(db, tenant.id, KEY) or {}
    try:
        name = check_product_name(body.product_name_override)
        colours = check_accent(body.accent, body.accent_dark) if body.accent else None
        if body.accent_dark and not body.accent:
            raise ThemeError("Set the accent before a dark-mode accent")
    except ThemeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    logo = before.get("logo")
    if body.logo_url is None:
        logo = None
    elif body.logo_url != _logo_url(before):
        raise HTTPException(status_code=422, detail="Upload the logo with POST /api/v1/settings/theme/logo")
    after = {"product_name_override": name, "accent": colours["accent"] if colours else None,
             "accent_dark": colours["accent_dark"] if colours else None, "logo": logo,
             "updated_at": datetime.now(timezone.utc).isoformat()}
    await put_setting(db, tenant.id, KEY, after, current_user_id(request))
    await write_audit(db, tenant.id, request, "theme.update", "tenant_settings", KEY, _audit_view(before),
                      _audit_view(after))
    await db.commit()
    return _view(after)


@router.post("/settings/theme/logo", dependencies=[Depends(require_permission("manage_settings"))])
async def upload_logo(request: Request, file: UploadFile = File(...), db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> ThemeOut:
    """Store a PNG or SVG logo (at most 512 KB). The type comes from the bytes, never the file name."""
    content = await file.read(LOGO_MAX_BYTES + 1)
    try:
        kind = sniff_logo(content)
    except ThemeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    digest = hashlib.sha256(content).hexdigest()
    object_name = f"branding/{tenant.id}/logo.{kind}"
    from api.services import storage

    try:
        await asyncio.to_thread(storage.upload_file, settings.minio_bucket_uploads, object_name, content,
                                CONTENT_TYPES[kind])
    except Exception as e:  # noqa: BLE001 - storage down: the server's fault, said plainly
        logger.warning("logo upload failed: %s", type(e).__name__)
        raise HTTPException(status_code=503, detail="Object storage is unavailable. Try again shortly.")
    await set_rls(db, tenant.id)
    before = await get_setting(db, tenant.id, KEY) or {}
    after = {**before, "logo": {"key": object_name, "content_type": CONTENT_TYPES[kind], "sha256": digest,
                                "size": len(content)},
             "updated_at": datetime.now(timezone.utc).isoformat()}
    await put_setting(db, tenant.id, KEY, after, current_user_id(request))
    await write_audit(db, tenant.id, request, "theme.logo", "tenant_settings", KEY, _audit_view(before),
                      {**_audit_view(after), "logo_size": len(content)})
    await db.commit()
    return _view(after)


@router.get("/theme", dependencies=[Depends(_public_limit)])
async def public_theme(tenant: Optional[str] = Query(None, max_length=64),
                       db: AsyncSession = Depends(get_db)) -> PublicThemeOut:
    """No sign-in needed: product name, accents and the logo URL, or the product defaults."""
    tid = await resolve_public_tenant(db, tenant)
    await set_rls(db, tid)
    t = await get_setting(db, tid, KEY) or {}
    customised = bool(t.get("product_name_override") or t.get("accent") or t.get("logo"))
    url = _logo_url(t)
    if url and tenant:
        url += f"&tenant={tid}"
    return PublicThemeOut(product_name=t.get("product_name_override") or DEFAULT_PRODUCT_NAME,
                          accent=t.get("accent") or DEFAULT_ACCENT,
                          accent_dark=t.get("accent_dark") or DEFAULT_ACCENT_DARK, logo_url=url,
                          customised=customised)


@router.get("/theme/logo", dependencies=[Depends(_public_limit)])
async def public_logo(tenant: Optional[str] = Query(None, max_length=64),
                      db: AsyncSession = Depends(get_db)) -> Response:
    tid = await resolve_public_tenant(db, tenant)
    await set_rls(db, tid)
    t = await get_setting(db, tid, KEY) or {}
    logo = t.get("logo")
    await db.close()
    if not isinstance(logo, dict) or not logo.get("key"):
        raise HTTPException(status_code=404, detail="No logo")
    from api.services import storage

    try:
        content = await asyncio.to_thread(storage.download_file, settings.minio_bucket_uploads, logo["key"])
    except Exception as e:  # noqa: BLE001 - storage down: the server's fault, said plainly
        logger.warning("logo download failed: %s", type(e).__name__)
        raise HTTPException(status_code=404, detail="No logo")
    return Response(content=content, media_type=logo.get("content_type") or "application/octet-stream",
                    headers={"Cache-Control": "public, max-age=300",
                             "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
                             "X-Content-Type-Options": "nosniff"})
