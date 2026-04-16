import logging
import os
from typing import Any, Optional

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama

logger = logging.getLogger("meridian.llm")

# Cached LLM instance — cleared when admin saves new config
_cached_llm: Optional[Any] = None
_cached_provider_key: Optional[str] = None


def clear_llm_cache() -> None:
    """Clear the cached LLM instance. Called when admin saves new provider config."""
    global _cached_llm, _cached_provider_key
    _cached_llm = None
    _cached_provider_key = None
    logger.info("LLM cache cleared — next call will reload config")


def _load_db_config() -> Optional[dict]:
    """Load LLM config from the database (tenants.llm_config).

    Returns None if no DB config exists or on any error.
    Uses a sync connection since this is called from Celery workers too.
    """
    try:
        from sqlalchemy import create_engine, text as sa_text
        db_url = os.getenv("DATABASE_URL_SYNC", "")
        if not db_url:
            db_url = os.getenv("DATABASE_URL", "").replace("+asyncpg", "")
        if not db_url:
            return None

        engine = create_engine(db_url, echo=False)
        try:
            with engine.connect() as conn:
                tenant_id = os.getenv("MERIDIAN_TENANT_ID", "00000000-0000-0000-0000-000000000001")
                result = conn.execute(
                    sa_text("SELECT llm_config, jwt_secret FROM tenants WHERE id = :tid"),
                    {"tid": tenant_id},
                )
                row = result.fetchone()
                if row and row[0] and row[0].get("provider"):
                    config = dict(row[0])
                    if config.get("api_key_encrypted") and row[1]:
                        from api.services.crypto import decrypt_api_key
                        config["api_key"] = decrypt_api_key(config["api_key_encrypted"], row[1])
                    else:
                        config["api_key"] = ""
                    return config
        finally:
            engine.dispose()
    except Exception as e:
        logger.debug(f"DB LLM config not available (using env vars): {e}")
    return None


def build_llm_from_config(
    *,
    provider: str,
    model: str = "",
    base_url: str = "",
    api_key: str = "",
    temperature: float = 0.1,
    max_tokens: int = 8192,
    request_timeout: int = 120,
    azure_deployment: str = "",
    azure_api_version: str = "2024-08-01-preview",
) -> Any:
    """Build a LangChain chat model from explicit config values.

    Used by both get_llm() (runtime) and the test endpoint (pre-save validation).
    """
    if provider == "ollama":
        return ChatOllama(
            base_url=base_url or "http://ollama:11434",
            model=model or "llama3.2:3b",
            temperature=temperature,
            num_predict=max_tokens or 4096,
            format="json",
            request_timeout=request_timeout or 90,
        )

    if provider == "ollama_cloud":
        client_kwargs = {}
        if api_key:
            client_kwargs["headers"] = {"Authorization": f"Bearer {api_key}"}
        return ChatOllama(
            base_url=base_url or "https://ollama.com",
            model=model or "deepseek-v3.1:671b-cloud",
            client_kwargs=client_kwargs,
            temperature=temperature,
            num_predict=max_tokens or 8192,
            format="json",
            request_timeout=request_timeout or 120,
        )

    if provider == "anthropic":
        return ChatAnthropic(
            model=model or "claude-sonnet-4-6",
            api_key=api_key or os.getenv("ANTHROPIC_API_KEY"),
            temperature=temperature,
            timeout=float(request_timeout or 120),
            max_retries=2,
        )

    if provider == "openai":
        return ChatOpenAI(
            model=model or "gpt-4o",
            api_key=api_key or os.getenv("OPENAI_API_KEY", ""),
            temperature=temperature,
            timeout=float(request_timeout or 120),
            max_retries=2,
        )

    if provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model or "gemini-2.5-flash",
            google_api_key=api_key or os.getenv("GOOGLE_API_KEY", ""),
            temperature=temperature,
            timeout=float(request_timeout or 120),
            max_retries=2,
        )

    if provider == "azure_openai":
        from langchain_openai import AzureChatOpenAI
        return AzureChatOpenAI(
            azure_endpoint=base_url or os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            api_key=api_key or os.getenv("AZURE_OPENAI_API_KEY", ""),
            azure_deployment=azure_deployment or os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
            api_version=azure_api_version or os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
            temperature=temperature,
            timeout=float(request_timeout or 120),
            max_retries=2,
        )

    if provider == "custom":
        return ChatOpenAI(
            base_url=base_url or os.getenv("CUSTOM_LLM_BASE_URL", ""),
            api_key=api_key or os.getenv("CUSTOM_LLM_API_KEY", "not-required"),
            model=model or os.getenv("CUSTOM_LLM_MODEL", "default"),
            temperature=temperature,
            timeout=float(request_timeout or 120),
            max_retries=2,
        )

    raise ValueError(f"Unknown LLM provider: {provider!r}")


def get_llm() -> Any:
    """Return a LangChain chat model.

    Resolution order:
    1. Cached instance (if still valid)
    2. Database config (tenants.llm_config) — set via admin UI
    3. Environment variables — legacy / fallback
    """
    global _cached_llm, _cached_provider_key

    db_config = _load_db_config()

    if db_config:
        cache_key = f"{db_config['provider']}:{db_config.get('model', '')}:{db_config.get('base_url', '')}"
        if _cached_llm is not None and _cached_provider_key == cache_key:
            return _cached_llm

        llm = build_llm_from_config(
            provider=db_config["provider"],
            model=db_config.get("model", ""),
            base_url=db_config.get("base_url", ""),
            api_key=db_config.get("api_key", ""),
            temperature=db_config.get("temperature", 0.1),
            max_tokens=db_config.get("max_tokens", 8192),
            request_timeout=db_config.get("request_timeout", 120),
            azure_deployment=db_config.get("azure_deployment", ""),
            azure_api_version=db_config.get("azure_api_version", ""),
        )
        _cached_llm = llm
        _cached_provider_key = cache_key
        logger.info(f"LLM loaded from DB config: provider={db_config['provider']}, model={db_config.get('model')}")
        return llm

    provider = os.getenv("LLM_PROVIDER", "ollama")
    cache_key = f"env:{provider}"
    if _cached_llm is not None and _cached_provider_key == cache_key:
        return _cached_llm

    llm = build_llm_from_config(
        provider=provider,
        model=os.getenv("OLLAMA_MODEL", ""),
        base_url=os.getenv("OLLAMA_BASE_URL", ""),
        api_key=os.getenv("OLLAMA_API_KEY", "") or os.getenv("ANTHROPIC_API_KEY", "") or os.getenv("OPENAI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", ""),
        temperature=0.1,
        max_tokens=int(os.getenv("OLLAMA_NUM_PREDICT", "8192")),
        request_timeout=int(os.getenv("OLLAMA_REQUEST_TIMEOUT", "120")),
        azure_deployment=os.getenv("AZURE_OPENAI_DEPLOYMENT", ""),
        azure_api_version=os.getenv("AZURE_OPENAI_API_VERSION", ""),
    )
    _cached_llm = llm
    _cached_provider_key = cache_key
    logger.info(f"LLM loaded from env vars: provider={provider}")
    return llm


def test_llm_connection() -> bool:
    """Verify the configured LLM is reachable. Returns True if healthy."""
    try:
        llm = get_llm()
        response = llm.invoke("Reply with only the word READY.")
        return "READY" in response.content.upper()
    except Exception as e:
        logger.warning("LLM connection test failed: %s", e)
        return False


def get_llm_safe() -> Any | None:
    """Like get_llm() but returns None instead of raising on config errors."""
    try:
        return get_llm()
    except Exception as e:
        logger.error("LLM provider unavailable: %s", e)
        return None


AI_UNAVAILABLE_MSG = (
    "AI features are temporarily unavailable. "
    "All other Meridian features continue to work normally."
)


def safe_invoke(llm, messages, *, timeout_seconds: int = 90) -> str | None:
    """Invoke the LLM with a hard timeout. Returns content string or None."""
    import concurrent.futures

    def _call():
        response = llm.invoke(messages)
        return response.content

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_call)
            return future.result(timeout=timeout_seconds)
    except concurrent.futures.TimeoutError:
        logger.warning(f"LLM call timed out after {timeout_seconds}s")
        return None
    except Exception as e:
        logger.warning(f"LLM call failed: {e}")
        return None
