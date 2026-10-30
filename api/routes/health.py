import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from api.config import settings
from api.middleware.licence import get_cached_licence
from api.services.user_notifications import email_backend_name
from api.services.version import APP_VERSION

logger = logging.getLogger("meridian.health")

router = APIRouter(tags=["health"])


def _probe_db() -> dict[str, Any]:
    from api.services import health_probe
    from workers.db import get_sync_engine

    try:
        engine = get_sync_engine()
    except Exception as e:  # noqa: BLE001 - class name only, never a DSN
        return {"status": "down", "latency_ms": None, "detail": type(e).__name__}
    c = health_probe.probe_db(engine)
    return {"status": c.status, "latency_ms": c.latency_ms, "detail": c.detail}


def _probe_redis() -> dict[str, Any]:
    from api.services import health_probe

    c, _depths = health_probe.probe_redis()
    return {"status": c.status, "latency_ms": c.latency_ms, "detail": c.detail}


async def readiness() -> dict[str, dict[str, Any]]:
    """Postgres (SELECT 1) and Redis (PING), probed in parallel; each bounded by health_probe.PROBE_TIMEOUT_S and
    never raising (a failure is ``down`` with the exception's class name, never its message)."""
    db, redis = await asyncio.gather(asyncio.to_thread(_probe_db), asyncio.to_thread(_probe_redis))
    return {"db": db, "redis": redis}


@router.get("/health/live")
async def live() -> dict:
    """Liveness: the process answers. No dependency is touched, so a load balancer or restart policy never
    cycles the API because Postgres or Redis is briefly away."""
    return {"status": "ok", "version": APP_VERSION}


@router.get("/health")
async def health() -> Any:
    """Readiness: 200 with ``status: ok`` only when Postgres and Redis answer; otherwise 503 with
    ``status: degraded`` and the per-component status. The update canary (scripts/update.sh) and the
    container healthcheck rely on this, so a release that cannot reach its database fails them."""
    components = await readiness()
    ready = all(c["status"] == "up" for c in components.values())
    llm_connected = False
    llm_source = "environment"
    provider = settings.llm_provider
    try:
        from llm.provider import _load_db_config
        db_config = _load_db_config()
        if db_config:
            llm_source = "database"
            provider = db_config.get("provider", "ollama")
        else:
            provider = settings.llm_provider

        if provider == "ollama":
            import httpx
            base_url = (db_config or {}).get("base_url") or settings.ollama_base_url
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{base_url}/api/tags")
                llm_connected = resp.status_code == 200
        else:
            if db_config and db_config.get("api_key"):
                llm_connected = True
            else:
                llm_connected = bool(
                    settings.ollama_api_key or settings.anthropic_api_key
                )
    except Exception:
        llm_connected = False

    body = {
        "status": "ok" if ready else "degraded",
        "components": components,
        "version": APP_VERSION,
        "llm_provider": provider,
        "llm_source": llm_source,
        "llm_connected": llm_connected,
        "licence": get_cached_licence(),
        # graph | smtp | resend, or null when per-user email cannot be sent on this deployment
        "email_backend": email_backend_name(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return body if ready else JSONResponse(status_code=503, content=body)


@router.get("/health/llm")
async def llm_health():
    """Check LLM connectivity on demand.

    The frontend uses this to decide whether to show AI features prominently,
    or to show a 'degraded mode' indicator. Bounded at 10 seconds so the
    endpoint itself never hangs.
    """
    import asyncio
    from llm.provider import test_llm_connection

    try:
        ok = await asyncio.wait_for(
            asyncio.to_thread(test_llm_connection),
            timeout=10.0,
        )
        return {"llm_available": bool(ok)}
    except asyncio.TimeoutError:
        return {"llm_available": False, "reason": "timeout"}
    except Exception as e:
        # Never return str(e) — provider errors can embed the endpoint URL/key.
        logger.warning("LLM availability probe failed: %s", e)
        return {"llm_available": False, "reason": "error"}
