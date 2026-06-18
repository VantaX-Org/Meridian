import os
from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # LLM
    llm_provider: str = "ollama"
    ollama_base_url: str = "http://llm:11434"
    ollama_model: str = "llama3.2:3b"
    ollama_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None

    # Database
    database_url: str = "postgresql+asyncpg://meridian:password@db:5432/meridian"
    database_url_sync: str = "postgresql://meridian:password@db:5432/meridian"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # MinIO
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "meridian"
    # Fallback to MINIO_PASSWORD for compatibility with compose envs that use
    # MinIO's native variable names.
    minio_secret_key: str = os.environ.get("MINIO_SECRET_KEY") or os.environ.get("MINIO_PASSWORD") or ""
    minio_bucket_uploads: str = "meridian-uploads"
    minio_bucket_reports: str = "meridian-reports"

    # Licence
    # `.env.example` documents these as MERIDIAN_LICENCE_* — accept both the
    # MERIDIAN_-prefixed names and the bare names so a standard customer .env
    # works without a workaround. licence_service.py already reads the
    # MERIDIAN_-prefixed names; this keeps config.py — and the licence
    # middleware that depends on it — consistent with that.
    licence_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("LICENCE_KEY", "MERIDIAN_LICENCE_KEY"),
    )
    licence_server_url: str = Field(
        default="https://licence.meridian.vantax.co.za",
        validation_alias=AliasChoices(
            "LICENCE_SERVER_URL", "MERIDIAN_LICENCE_SERVER_URL"
        ),
    )
    licence_mode: str = Field(  # online | offline
        default="online",
        validation_alias=AliasChoices("LICENCE_MODE", "MERIDIAN_LICENCE_MODE"),
    )
    licence_file: Optional[str] = None
    licence_file_path: Optional[str] = None
    licence_secret: Optional[str] = None

    @field_validator("licence_server_url")
    @classmethod
    def _normalise_licence_server_url(cls, v: str) -> str:
        """Accept either a base URL or a full `.../api/licence/validate` URL.

        The licence middleware appends `/api/licence/validate` itself, so this
        normalises to the base — `.env.example` ships the full-path form under
        MERIDIAN_LICENCE_SERVER_URL, which would otherwise double the path.
        """
        v = v.rstrip("/")
        suffix = "/api/licence/validate"
        if v.endswith(suffix):
            v = v[: -len(suffix)]
        return v

    # Notifications
    resend_api_key: Optional[str] = None
    teams_webhook_url: Optional[str] = None

    # SMTP (air-gapped deployments)
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from: str = "noreply@meridian.local"

    # Microsoft Graph API (alternative email backend)
    microsoft_tenant_id: Optional[str] = None
    microsoft_client_id: Optional[str] = None
    microsoft_client_secret: Optional[str] = None
    email_from: Optional[str] = None

    # CORS — comma-separated string, e.g. http://localhost:3000,http://myhost:3000
    # Stored as str to avoid pydantic-settings v2 JSON-parsing issues with list fields.
    # main.py splits this into a list when configuring CORSMiddleware.
    cors_origins: str = "http://localhost:3000,http://frontend:3000"

    # Auth
    # Clerk removed - using local auth only
    auth_mode: str = "local"

    # SAP RFC sync
    credential_master_key: Optional[str] = None
    sap_rfc_user: str = "RFC_USER"

    # Stripe (exception billing)
    stripe_api_key: Optional[str] = None

    # Observability
    sentry_dsn: Optional[str] = None

    model_config = {"env_file": ".env", "case_sensitive": False, "extra": "ignore"}


settings = Settings()
