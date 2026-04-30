import os
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
    licence_key: Optional[str] = None
    licence_server_url: str = "https://licence.meridian.vantax.co.za"
    licence_file: Optional[str] = None
    licence_mode: str = "online"  # online | offline
    licence_file_path: Optional[str] = None
    licence_secret: Optional[str] = None

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
