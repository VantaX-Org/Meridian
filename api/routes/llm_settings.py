"""LLM Provider configuration endpoints — admin only.

Allows the super admin to configure which LLM provider Meridian uses,
without restarting containers. Config is stored encrypted in the
tenants.llm_config JSONB column and takes precedence over env vars.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])
logger = logging.getLogger("meridian.llm_settings")


# ── Provider definitions ──────────────────────────────────────────────────

SUPPORTED_PROVIDERS = {
    "ollama": {
        "label": "Local Ollama",
        "description": "Fully local — no data leaves your server",
        "requires_api_key": False,
        "requires_base_url": True,
        "default_base_url": "http://ollama:11434",
        "default_model": "llama3.2:3b",
    },
    "ollama_cloud": {
        "label": "Ollama Cloud",
        "description": "Cloud-hosted models via Ollama API — no local GPU needed",
        "requires_api_key": True,
        "requires_base_url": False,
        "default_base_url": "https://ollama.com",
        "default_model": "deepseek-v3.1:671b-cloud",
    },
    "anthropic": {
        "label": "Anthropic (Claude)",
        "description": "Claude models — highest quality reasoning",
        "requires_api_key": True,
        "requires_base_url": False,
        "default_base_url": "",
        "default_model": "claude-sonnet-4-6",
    },
    "openai": {
        "label": "OpenAI",
        "description": "GPT models via OpenAI API",
        "requires_api_key": True,
        "requires_base_url": False,
        "default_base_url": "",
        "default_model": "gpt-4o",
    },
    "google": {
        "label": "Google Gemini",
        "description": "Gemini models via Google AI API",
        "requires_api_key": True,
        "requires_base_url": False,
        "default_base_url": "",
        "default_model": "gemini-2.5-flash",
    },
    "azure_openai": {
        "label": "Azure OpenAI",
        "description": "OpenAI models via Azure — enterprise compliance",
        "requires_api_key": True,
        "requires_base_url": True,
        "default_base_url": "",
        "default_model": "gpt-4o",
    },
    "custom": {
        "label": "Custom (BYOLLM)",
        "description": "Any OpenAI-compatible endpoint",
        "requires_api_key": False,
        "requires_base_url": True,
        "default_base_url": "",
        "default_model": "default",
    },
}


# ── Request / response models ─────────────────────────────────────────────

class LLMConfigResponse(BaseModel):
    """Returned to the frontend — API key is masked, never sent in full."""
    provider: str
    model: str
    base_url: str
    has_api_key: bool
    api_key_preview: str
    temperature: float
    max_tokens: int
    request_timeout: int
    azure_deployment: str
    azure_api_version: str
    source: str  # "database" or "environment"
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None


class LLMConfigUpdate(BaseModel):
    """Received from the frontend when saving config."""
    provider: str
    model: str = ""
    base_url: str = ""
    api_key: str = ""
    temperature: float = 0.1
    max_tokens: int = 8192
    request_timeout: int = 120
    azure_deployment: str = ""
    azure_api_version: str = "2024-08-01-preview"


class LLMTestRequest(BaseModel):
    provider: str
    model: str = ""
    base_url: str = ""
    api_key: str = ""
    temperature: float = 0.1
    max_tokens: int = 8192
    request_timeout: int = 120
    azure_deployment: str = ""
    azure_api_version: str = "2024-08-01-preview"


class LLMTestResponse(BaseModel):
    success: bool
    message: str
    response_preview: str = ""


class LLMProvidersResponse(BaseModel):
    providers: dict


# ── Helpers ───────────────────────────────────────────────────────────────

def _mask_key(key: str) -> str:
    """Return masked preview of API key: ••••last4."""
    if not key or len(key) < 5:
        return ""
    return f"\u2022\u2022\u2022\u2022{key[-4:]}"


def _get_env_config() -> dict:
    """Build LLM config dict from environment variables (fallback source)."""
    import os
    provider = os.getenv("LLM_PROVIDER", "ollama")
    prov_info = SUPPORTED_PROVIDERS.get(provider, SUPPORTED_PROVIDERS["ollama"])
    return {
        "provider": provider,
        "model": os.getenv("OLLAMA_MODEL", os.getenv("ANTHROPIC_MODEL", prov_info["default_model"])),
        "base_url": os.getenv("OLLAMA_BASE_URL", os.getenv("AZURE_OPENAI_ENDPOINT", prov_info.get("default_base_url", ""))),
        "api_key": os.getenv("OLLAMA_API_KEY", "") or os.getenv("ANTHROPIC_API_KEY", "") or os.getenv("OPENAI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "") or os.getenv("AZURE_OPENAI_API_KEY", "") or os.getenv("CUSTOM_LLM_API_KEY", ""),
        "temperature": 0.1,
        "max_tokens": int(os.getenv("OLLAMA_NUM_PREDICT", "8192")),
        "request_timeout": int(os.getenv("OLLAMA_REQUEST_TIMEOUT", "120")),
        "azure_deployment": os.getenv("AZURE_OPENAI_DEPLOYMENT", ""),
        "azure_api_version": os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
    }


async def _get_jwt_secret(db: AsyncSession, tenant_id: str) -> str:
    """Fetch the tenant's jwt_secret for encryption."""
    result = await db.execute(
        text("SELECT jwt_secret FROM tenants WHERE id = :tid"),
        {"tid": tenant_id},
    )
    row = result.fetchone()
    if not row or not row[0]:
        raise HTTPException(status_code=500, detail="Tenant jwt_secret not configured")
    return row[0]


# ── GET /settings/llm/providers — list available providers ────────────────

@router.get("/llm/providers", response_model=LLMProvidersResponse)
async def list_providers(
    _role: str = Depends(require_permission("manage_llm")),
):
    """Return the list of supported LLM providers and their metadata."""
    return LLMProvidersResponse(providers=SUPPORTED_PROVIDERS)


# ── GET /settings/llm — current config (masked) ──────────────────────────

@router.get("/llm", response_model=LLMConfigResponse)
async def get_llm_config(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_llm")),
):
    """Return current LLM config. API key is masked. Admin only."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    result = await db.execute(
        text("SELECT llm_config, jwt_secret FROM tenants WHERE id = :tid"),
        {"tid": str(tenant.id)},
    )
    row = result.fetchone()

    if row and row[0]:
        config = row[0]
        jwt_secret = row[1] or ""
        decrypted_key = ""
        if config.get("api_key_encrypted") and jwt_secret:
            from api.services.crypto import decrypt_api_key
            decrypted_key = decrypt_api_key(config["api_key_encrypted"], jwt_secret)

        return LLMConfigResponse(
            provider=config.get("provider", "ollama"),
            model=config.get("model", ""),
            base_url=config.get("base_url", ""),
            has_api_key=bool(decrypted_key),
            api_key_preview=_mask_key(decrypted_key),
            temperature=config.get("temperature", 0.1),
            max_tokens=config.get("max_tokens", 8192),
            request_timeout=config.get("request_timeout", 120),
            azure_deployment=config.get("azure_deployment", ""),
            azure_api_version=config.get("azure_api_version", ""),
            source="database",
            updated_at=config.get("updated_at"),
            updated_by=config.get("updated_by"),
        )
    else:
        env = _get_env_config()
        return LLMConfigResponse(
            provider=env["provider"],
            model=env["model"],
            base_url=env["base_url"],
            has_api_key=bool(env["api_key"]),
            api_key_preview=_mask_key(env["api_key"]),
            temperature=env["temperature"],
            max_tokens=env["max_tokens"],
            request_timeout=env["request_timeout"],
            azure_deployment=env["azure_deployment"],
            azure_api_version=env["azure_api_version"],
            source="environment",
        )


# ── PUT /settings/llm — save config ──────────────────────────────────────

@router.put("/llm")
async def update_llm_config(
    body: LLMConfigUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_llm")),
):
    """Save LLM provider config. Admin only.

    If api_key is empty string, the existing encrypted key is preserved.
    """
    if body.provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {body.provider}")

    prov_info = SUPPORTED_PROVIDERS[body.provider]

    if prov_info["requires_api_key"] and not body.api_key:
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
        existing = await db.execute(
            text("SELECT llm_config->'api_key_encrypted' FROM tenants WHERE id = :tid"),
            {"tid": str(tenant.id)},
        )
        existing_key = existing.scalar()
        if not existing_key:
            raise HTTPException(
                status_code=422,
                detail=f"API key is required for {prov_info['label']}",
            )

    if prov_info["requires_base_url"] and not body.base_url:
        if prov_info["default_base_url"]:
            body.base_url = prov_info["default_base_url"]
        else:
            raise HTTPException(
                status_code=422,
                detail=f"Base URL is required for {prov_info['label']}",
            )

    if not body.model:
        body.model = prov_info["default_model"]

    jwt_secret = await _get_jwt_secret(db, str(tenant.id))

    config: dict = {
        "provider": body.provider,
        "model": body.model,
        "base_url": body.base_url,
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
        "request_timeout": body.request_timeout,
        "azure_deployment": body.azure_deployment,
        "azure_api_version": body.azure_api_version,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": getattr(request.state, "local_user_id", None),
    }

    if body.api_key:
        from api.services.crypto import encrypt_api_key
        config["api_key_encrypted"] = encrypt_api_key(body.api_key, jwt_secret)
    else:
        existing = await db.execute(
            text("SELECT llm_config->'api_key_encrypted' FROM tenants WHERE id = :tid"),
            {"tid": str(tenant.id)},
        )
        existing_key = existing.scalar()
        if existing_key:
            config["api_key_encrypted"] = existing_key

    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    await db.execute(
        text("UPDATE tenants SET llm_config = CAST(:config AS jsonb) WHERE id = :tid"),
        {"tid": str(tenant.id), "config": json.dumps(config)},
    )
    await db.commit()

    from llm.provider import clear_llm_cache
    clear_llm_cache()

    logger.info(f"LLM config updated: provider={body.provider}, model={body.model}")
    return {"status": "ok", "provider": body.provider, "model": body.model}


# ── POST /settings/llm/test — test connection ────────────────────────────

@router.post("/llm/test", response_model=LLMTestResponse)
async def test_llm_connection_endpoint(
    body: LLMTestRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_llm")),
):
    """Test an LLM provider connection without saving. Admin only.

    If api_key is empty, uses the existing saved key from the database.
    """
    if body.provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {body.provider}")

    api_key = body.api_key
    if not api_key:
        jwt_secret = await _get_jwt_secret(db, str(tenant.id))
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
        result = await db.execute(
            text("SELECT llm_config FROM tenants WHERE id = :tid"),
            {"tid": str(tenant.id)},
        )
        row = result.fetchone()
        if row and row[0] and row[0].get("api_key_encrypted"):
            from api.services.crypto import decrypt_api_key
            api_key = decrypt_api_key(row[0]["api_key_encrypted"], jwt_secret)

    try:
        from llm.provider import build_llm_from_config, safe_invoke
        llm = build_llm_from_config(
            provider=body.provider,
            model=body.model,
            base_url=body.base_url,
            api_key=api_key,
            temperature=body.temperature,
            max_tokens=body.max_tokens,
            request_timeout=body.request_timeout,
            azure_deployment=body.azure_deployment,
            azure_api_version=body.azure_api_version,
        )

        content = safe_invoke(llm, [
            {"role": "system", "content": "You are a test assistant."},
            {"role": "user", "content": "Reply with only the word READY."},
        ], timeout_seconds=30)

        if content and "READY" in content.upper():
            return LLMTestResponse(
                success=True,
                message=f"Connected to {SUPPORTED_PROVIDERS[body.provider]['label']} successfully",
                response_preview="READY",
            )
        elif content:
            return LLMTestResponse(
                success=True,
                message="Connected but unexpected response",
                response_preview=content[:100],
            )
        else:
            return LLMTestResponse(
                success=False,
                message="Connection succeeded but no response received (timeout)",
            )

    except Exception as e:
        logger.warning(f"LLM test failed for provider={body.provider}: {e}")
        # Class name only — httpx errors can embed the endpoint URL + API key.
        return LLMTestResponse(
            success=False,
            message=f"Connection failed: {type(e).__name__}",
        )
