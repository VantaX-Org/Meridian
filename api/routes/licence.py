"""
GET /api/v1/licence — Returns the current cached licence manifest for the frontend.

Used by the customer frontend to:
- Show the licence status page (/settings/licence)
- Drive sidebar visibility (enabled_menu_items)
- Gate features (features object)
- Show expiry countdown
"""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from api.deps import Tenant, get_db, get_tenant
from api.middleware.licence import get_cached_manifest

router = APIRouter(prefix="/api/v1", tags=["licence"])


@router.get("/licence")
async def get_licence(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Return the current licence manifest as cached from the last validation.

    Includes: valid, status, tier, expiry, days_remaining, enabled_modules,
    enabled_menu_items, features, llm_config, last_validated, latest_version,
    release_notes.
    Does NOT re-validate — uses the in-memory cache refreshed every 6 hours.
    Platform-update UI should prefer GET /api/v1/system/update-status instead
    (api/routes/system_update.py) — it does the version comparison server-side.
    """
    manifest = dict(get_cached_manifest())
    # Seats in use: active users of this tenant. ``seats`` comes from the manifest when the licence sets one.
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    used = await db.execute(text("SELECT COUNT(*) FROM users WHERE tenant_id = :tid AND is_active"), {"tid": str(tenant.id)})
    manifest["seats_used"] = int(used.scalar() or 0)
    manifest.setdefault("seats", manifest.get("max_users"))
    return manifest
