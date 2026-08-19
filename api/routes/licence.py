"""
GET /api/v1/licence — Returns the current cached licence manifest for the frontend.

Used by the customer frontend to:
- Show the licence status page (/settings/licence)
- Drive sidebar visibility (enabled_menu_items)
- Gate features (features object)
- Show expiry countdown
"""

from fastapi import APIRouter
from starlette.requests import Request

from api.middleware.licence import get_cached_licence, get_cached_manifest

router = APIRouter(prefix="/api/v1", tags=["licence"])


@router.get("/licence")
async def get_licence(request: Request):
    """Return the current licence manifest as cached from the last validation.

    Includes: valid, status, tier, expiry, days_remaining, enabled_modules,
    enabled_menu_items, features, llm_config, last_validated, latest_version,
    release_notes.
    Does NOT re-validate — uses the in-memory cache refreshed every 6 hours.
    Platform-update UI should prefer GET /api/v1/system/update-status instead
    (api/routes/system_update.py) — it does the version comparison server-side.
    """
    return get_cached_manifest()
