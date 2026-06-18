import logging
import os
from typing import Any, Optional

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama

logger = logging.getLogger("meridian.llm")

# ── Circuit breaker state ────────────────────────────────────────────
import time as _time

_cb_failure_count: int = 0
_cb_opened_at: float | None = None
_CB_FAILURE_THRESHOLD = 5
_CB_OPEN_DURATION = 60.0  # seconds


def _circuit_is_open() -> bool:
    """Return True if the circuit breaker is open (LLM calls should be skipped)."""
    global _cb_opened_at, _cb_failure_count
    if _cb_opened_at is None:
        return False
    if _time.time() - _cb_opened_at > _CB_OPEN_DURATION:
        # Reset — give it another chance
        _cb_opened_at = None
        _cb_failure_count = 0
        logger.info("LLM circuit breaker RESET — accepting calls again")
        return False
    return True


def _record_llm_failure() -> None:
    global _cb_failure_count, _cb_opened_at
    _cb_failure_count += 1
    if _cb_failure_count >= _CB_FAILURE_THRESHOLD and _cb_opened_at is None:
        _cb_opened_at = _time.time()
        logger.warning(
            f"LLM circuit breaker OPEN — {_cb_failure_count} consecutive failures; "
            f"skipping calls for {_CB_OPEN_DURATION}s"
        )


def _record_llm_success() -> None:
    global _cb_failure_count
    _cb_failure_count = 0


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
                    if config.get("api_key_encrypted"):
                        # Task 11: Use LLM_KEK for decryption instead of jwt_secret
                        try:
                            from api.utils.crypto import decrypt_llm_key
                            config["api_key"] = decrypt_llm_key(config["api_key_encrypted"])
                        except Exception as e:
                            logger.warning(f"Failed to decrypt LLM API key: {e}. Falling back to empty key.")
                            config["api_key"] = ""
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
    if provider in ("none", "off", ""):
        return _NoopLLM()

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


class _NoopLLM:
    """Sentinel LLM used when ``LLM_PROVIDER=none`` — every ``invoke`` returns
    ``None`` so callers immediately fall back to their deterministic path.

    Deployments that never need an LLM (pure deterministic 400k bulk runs, air-
    gapped sites without GPU, proof-of-concept with no cloud LLM budget) can
    set ``LLM_PROVIDER=none`` and skip the bundled Ollama container entirely.
    """

    def invoke(self, messages):  # noqa: D401 — match LangChain interface
        raise RuntimeError("LLM disabled (LLM_PROVIDER=none)")


def is_llm_disabled() -> bool:
    """Return True if the configured provider is 'none' (LLM-less deploy mode)."""
    return os.getenv("LLM_PROVIDER", "ollama").strip().lower() in ("none", "off", "")


def _bind_max_tokens(llm, max_tokens: int):
    """Bind a per-call output cap onto an arbitrary chat model.

    Providers name the parameter differently — ChatOllama uses ``num_predict``
    while OpenAI/Anthropic/Azure use ``max_tokens`` — so we pick the key by the
    model's own attributes. ``.bind()`` returns a Runnable that forwards the
    kwarg on every ``invoke`` without mutating the shared cached instance. Any
    binding error is swallowed so a cap that a given provider can't honour never
    breaks the call.
    """
    try:
        if hasattr(llm, "num_predict"):
            return llm.bind(num_predict=max_tokens)
        return llm.bind(max_tokens=max_tokens)
    except Exception:
        return llm


def safe_invoke(llm, messages, *, timeout_seconds: int = 90, max_tokens: int | None = None) -> str | None:
    """Invoke the LLM with a hard timeout. Returns content string or None.

    ``max_tokens`` caps the response length for this call only (see
    ``_bind_max_tokens``); pass it when a caller has a tighter budget than the
    model's configured default.
    """
    import concurrent.futures

    if is_llm_disabled() or isinstance(llm, _NoopLLM):
        # No LLM configured — caller must fall back to deterministic logic.
        return None

    if _circuit_is_open():
        logger.debug("LLM circuit breaker is open; short-circuiting call")
        return None

    if max_tokens is not None:
        llm = _bind_max_tokens(llm, max_tokens)

    def _call():
        response = llm.invoke(messages)
        return response.content

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_call)
            result = future.result(timeout=timeout_seconds)
            _record_llm_success()
            return result
    except concurrent.futures.TimeoutError:
        logger.warning(f"LLM call timed out after {timeout_seconds}s")
        _record_llm_failure()
        return None
    except Exception as e:
        logger.warning(f"LLM call failed: {e}")
        _record_llm_failure()
        return None


def safe_invoke_batch(
    llm,
    prompts: list,
    *,
    timeout_seconds: int = 90,
    max_workers: int = 4,
) -> list[str | None]:
    """Run many prompts through a single LLM with bounded concurrency.

    Preserves order, returns ``None`` for any prompt that times out / fails so
    the caller can fall back deterministically per-item. Honours the circuit
    breaker: once it opens mid-batch, remaining prompts short-circuit to None.
    """
    import concurrent.futures

    if not prompts:
        return []

    results: list[str | None] = [None] * len(prompts)

    if is_llm_disabled() or isinstance(llm, _NoopLLM):
        # No LLM configured — every item falls back to None so callers use
        # deterministic logic per-item.
        return results

    if _circuit_is_open():
        logger.debug("LLM circuit breaker is open; short-circuiting batch")
        return results

    def _call_one(idx_prompt):
        idx, prompt = idx_prompt
        if _circuit_is_open():
            return idx, None
        try:
            response = llm.invoke(prompt)
            content = response.content if hasattr(response, "content") else str(response)
            _record_llm_success()
            return idx, content
        except Exception as e:
            logger.warning(f"LLM batch item {idx} failed: {type(e).__name__}: {e}")
            _record_llm_failure()
            return idx, None

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_call_one, (i, p)): i for i, p in enumerate(prompts)
        }
        try:
            for fut in concurrent.futures.as_completed(futures, timeout=timeout_seconds):
                idx, content = fut.result()
                results[idx] = content
        except concurrent.futures.TimeoutError:
            logger.warning(
                f"LLM batch hit wall-clock timeout after {timeout_seconds}s; "
                "remaining items return None"
            )
            for fut in futures:
                fut.cancel()

    return results


async def safe_ainvoke(llm, messages, *, timeout_seconds: int = 60) -> str | None:
    """Async-friendly LLM invocation with hard timeout.

    Use in FastAPI async route handlers and async service methods. The
    underlying llm.invoke() is blocking, so we dispatch to a thread pool
    to keep the event loop responsive, then race against asyncio.wait_for.

    Returns the response content string or None on timeout/failure.
    """
    import asyncio

    if _circuit_is_open():
        logger.debug("LLM circuit breaker is open; short-circuiting async call")
        return None

    def _call() -> str:
        response = llm.invoke(messages)
        return response.content if hasattr(response, "content") else str(response)

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_call),
            timeout=timeout_seconds,
        )
        _record_llm_success()
        return result
    except asyncio.TimeoutError:
        logger.warning(f"LLM async call timed out after {timeout_seconds}s")
        _record_llm_failure()
        return None
    except Exception as e:
        logger.warning(f"LLM async call failed: {type(e).__name__}: {e}")
        _record_llm_failure()
        return None
