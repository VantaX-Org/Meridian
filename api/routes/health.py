import logging
from datetime import datetime, timezone

from fastapi import APIRouter

from api.config import settings
from api.middleware.licence import get_cached_licence

logger = logging.getLogger("meridian.health")

router = APIRouter()


@router.get("/health")
async def health() -> dict:
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

    return {
        "status": "ok",
        "version": "1.0.0",
        "llm_provider": provider,
        "llm_source": llm_source,
        "llm_connected": llm_connected,
        "licence": get_cached_licence(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


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
