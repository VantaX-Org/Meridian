"""
Celery task: revalidate the Meridian licence every 6 hours.

Refreshes the in-memory licence cache so the next request uses an up-to-date manifest.
Also syncs rules and field mappings from the manifest into the local DB.

This task is idempotent — running it multiple times has no harmful side effects.
"""

import logging

from workers.celery_app import celery_app

logger = logging.getLogger("meridian.licence")


@celery_app.task(name="revalidate_licence", bind=True, max_retries=3,
                 soft_time_limit=60, time_limit=90)
def revalidate_licence(self):
    """Force a licence revalidation by clearing the cache and re-validating."""
    import asyncio

    try:
        from api.middleware.licence import (
            _cache,
            _validate_licence,
            _update_manifest_cache,
            _sync_manifest_to_db,
        )

        # Clear cache to force fresh validation
        _cache["response"] = None
        _cache["expires_at"] = 0.0

        # Run the async validation in a new event loop
        result = asyncio.run(_validate_licence())

        if result is None:
            logger.warning("Licence revalidation: server unreachable — keeping degraded mode")
            return {"status": "unreachable"}

        if result.get("valid"):
            _update_manifest_cache(result)
            _sync_manifest_to_db(result)
            _cache["response"] = result
            import time
            from api.middleware.licence import CACHE_TTL_SECONDS
            _cache["expires_at"] = time.time() + CACHE_TTL_SECONDS
            logger.info(
                f"Licence revalidated: tenant={result.get('tenant_id')} "
                f"tier={result.get('tier')} expiry={result.get('expiry_date')}"
            )
            return {"status": "valid", "tenant_id": result.get("tenant_id")}
        else:
            reason = result.get("reason", "unknown")
            logger.warning(f"Licence revalidation failed: {reason}")
            return {"status": "invalid", "reason": reason}

    except Exception as exc:
        logger.error(f"Licence revalidation error: {exc}")
        raise self.retry(exc=exc, countdown=300)  # retry after 5 minutes
