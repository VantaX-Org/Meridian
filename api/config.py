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
    # Async pool of the API process (api/deps.py). Every request holds one connection while it
    # runs; SSE streams must not hold one at all (api/routes/jobs.py). Size for the request
    # concurrency of one API container; pool_timeout is how long a request waits for a free
    # connection before failing with "QueuePool limit reached".
    db_pool_size: int = Field(default=20, validation_alias="MERIDIAN_DB_POOL_SIZE")
    db_max_overflow: int = Field(default=20, validation_alias="MERIDIAN_DB_MAX_OVERFLOW")
    db_pool_timeout: int = Field(default=30, validation_alias="MERIDIAN_DB_POOL_TIMEOUT")
    # Seconds before a pooled connection is replaced: under firewall or PgBouncer idle cut-offs. Every pool also
    # pings a connection on checkout (pool_pre_ping), so a connection dropped by a Postgres restart is replaced.
    db_pool_recycle: int = Field(default=1800, ge=-1, validation_alias="MERIDIAN_DB_POOL_RECYCLE")
    # API processes (docker/entrypoint.api.sh starts this many uvicorn workers): one slow or blocking request then
    # holds one process, not the whole API. The pool above is shared out between them, so the total stays the same.
    api_workers: int = Field(default=3, ge=1, validation_alias="API_WORKERS")
    # Longest a single API query may run. A page gives up after 30s and an export after 300s, but Postgres kept
    # running the abandoned query, and every Retry piled another on; past this it is cancelled instead.
    db_statement_timeout_ms: int = Field(default=300_000, ge=0, validation_alias="MERIDIAN_DB_STATEMENT_TIMEOUT_MS")

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # MinIO
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "meridian"
    # Fallback to MINIO_PASSWORD for compatibility with compose envs that use
    # MinIO's native variable names.
    minio_secret_key: str = os.environ.get("MINIO_SECRET_KEY") or os.environ.get("MINIO_PASSWORD") or ""
    minio_bucket_uploads: str = "meridian-uploads"
    # Largest export copy kept for reconciliation, in MB of compressed files. A larger export still downloads; it just
    # keeps no copy, and the comparison falls back to an older copy or a rebuild. 0 keeps none.
    migration_snapshot_max_mb: int = Field(
        default=2048, ge=0, validation_alias=AliasChoices("MERIDIAN_MIGRATION_SNAPSHOT_MAX_MB"))
    minio_bucket_reports: str = "meridian-reports"

    # Licence
    # `.env.example` documents these as MERIDIAN_LICENCE_* — accept both the
    # MERIDIAN_-prefixed names and the bare names so a standard customer .env
    # works without a workaround.
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
    # Only a development deployment may run without a licence key.
    env: str = Field(default="production", validation_alias=AliasChoices("MERIDIAN_ENV", "ENV"))
    licence_file: Optional[str] = None
    licence_file_path: Optional[str] = None
    licence_secret: Optional[str] = None
    # Scheduled exports with "save to the server folder" are written to <dir>/<tenant id>/<file name>
    # (REPORT_EXPORT_DIR). Unset: such schedules note that no folder is configured and still deliver.
    report_export_dir: Optional[str] = None
    # Legacy signatures are opt-in (default off, DR-3). Set MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES=true only for
    # an installation that still holds an old licence: it then also accepts the old HMAC-signed offline licence
    # file (LICENCE_SECRET), the old RS256 offline token (MERIDIAN_OFFLINE_PUBLIC_KEY) and the old RSA-signed
    # online response (LICENCE_SERVER_PUBLIC_KEY), and, when no such key is configured, an unsigned online
    # response. Every such acceptance is logged as a warning, and the startup check
    # (api/middleware/licence.py check_legacy_licence_at_startup) says how to opt in when a legacy licence is
    # found with this off. Otherwise licences are verified only against the vendor's Ed25519 keys compiled into
    # the image (api/middleware/licence_keys.py).
    licence_allow_legacy_signatures: bool = Field(
        default=False, validation_alias=AliasChoices("MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES"))
    # Offline grace: when HQ is unreachable, the last valid signed online response is honoured for this many
    # days after it was signed, with a warning and status "offline_grace" (api/middleware/licence.py).
    licence_offline_grace_days: int = Field(
        default=14, ge=0, le=30, validation_alias=AliasChoices("MERIDIAN_LICENCE_OFFLINE_GRACE_DAYS"))
    # Where the last valid signed online response is kept so the grace survives a restart (best effort; it is
    # re-verified on load, so editing the file grants nothing).
    licence_state_path: str = Field(
        default="/var/lib/meridian/licence-last-valid.json",
        validation_alias=AliasChoices("MERIDIAN_LICENCE_STATE_PATH"))

    # Updater sidecar (docker/docker-compose.updater.yml) — holds the Docker
    # socket so the api container never needs it. Unset secret means this
    # deployment hasn't onboarded the self-update feature yet (see
    # scripts/enable-auto-update.sh); routes degrade to "updater_configured: false"
    # rather than erroring.
    updater_url: str = Field(
        default="http://updater:8080",
        validation_alias=AliasChoices("UPDATER_URL", "MERIDIAN_UPDATER_URL"),
    )
    updater_shared_secret: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "UPDATER_SHARED_SECRET", "MERIDIAN_UPDATER_SHARED_SECRET"
        ),
    )

    @field_validator("auth_mode", mode="before")
    @classmethod
    def _auth_mode(cls, v: object) -> str:
        mode = str(v or "").strip().lower()
        if mode in ("local", "oidc"):
            return "local"
        raise ValueError(f"AUTH_MODE={v!r} is not supported. Set AUTH_MODE to 'local' or 'oidc'.")

    @field_validator("licence_server_url")
    @classmethod
    def _normalise_licence_server_url(cls, v: str) -> str:
        """Accept a bare base URL, a `.../api/licence` URL, or a full
        `.../api/licence/validate` URL — normalising all three to the base.

        The licence middleware appends `/api/licence/validate` itself, so any
        of these forms left un-stripped doubles the path (404, mis-logged as
        "licence server unreachable"). `.env.example` ships the full-path
        form under MERIDIAN_LICENCE_SERVER_URL; the `/api/licence` mid-form
        has shipped from at least one install path too — strip both.
        """
        v = v.rstrip("/")
        for suffix in ("/api/licence/validate", "/api/licence"):
            if v.endswith(suffix):
                v = v[: -len(suffix)]
                break
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
    # One auth path: local sign-in (password and OIDC SSO both issue the local session cookie). "oidc" is
    # accepted as a synonym of "local"; any other value refuses to start (see _auth_mode), so a typo can never
    # boot the API without its auth middleware.
    auth_mode: str = "local"
    # This deployment's own tenant. A signed-in request takes its tenant from the verified token's tenant_id
    # claim (api/middleware/local_auth.py); this id is used only for the public pages before sign-in (theme,
    # status page, licence), API keys and HQ manifest sync. A single-tenant install keeps the default.
    deployment_tenant_id: str = Field(default="00000000-0000-0000-0000-000000000001",
                                      validation_alias=AliasChoices("MERIDIAN_TENANT_ID", "DEPLOYMENT_TENANT_ID"))
    # Live SAP write-back (BAPI execution) stays off until per-module BAPI
    # parameter builders + commit/rollback are verified against the customer's
    # release. With it off, fixes are delivered as export files (LSMW/BAPI).
    # Forced updates (min_version from HQ) only start inside this UTC window,
    # e.g. "Sun 02:00-04:00" or "02:00-04:00" (daily). Empty = any time.
    update_window: str = Field(default="", validation_alias="MERIDIAN_UPDATE_WINDOW")
    live_writeback_enabled: bool = Field(default=False, validation_alias="MERIDIAN_LIVE_WRITEBACK_ENABLED")
    # Batch write-back runs (workers/tasks/run_batch_writeback.py): records per SAP connection and database commit,
    # seconds a worker slice runs before it re-enqueues itself (well inside the task soft limit), pause between
    # chunks (0 = none), consecutive connection failures that pause a run, seconds without a heartbeat before a
    # running run counts as stale (above the task hard limit, so a stale worker is already gone), and the wait
    # between connection attempts.
    writeback_chunk_size: int = Field(default=50, validation_alias="MERIDIAN_WRITEBACK_CHUNK_SIZE")
    writeback_slice_seconds: int = Field(default=300, validation_alias="MERIDIAN_WRITEBACK_SLICE_SECONDS")
    writeback_chunk_pause_seconds: float = Field(default=0.0, validation_alias="MERIDIAN_WRITEBACK_CHUNK_PAUSE_SECONDS")
    writeback_max_connect_failures: int = Field(default=3, validation_alias="MERIDIAN_WRITEBACK_MAX_CONNECT_FAILURES")
    writeback_stale_seconds: int = Field(default=900, validation_alias="MERIDIAN_WRITEBACK_STALE_SECONDS")
    writeback_connect_retry_seconds: float = Field(default=10.0, validation_alias="MERIDIAN_WRITEBACK_CONNECT_RETRY_SECONDS")

    # Rule evaluation: decoded-byte budget of one prefetched joined frame (checks/runner.py).
    # It applies per check task, so peak use is about budget x worker concurrency (--concurrency=4 in
    # docker-compose.yml): size it together with the concurrency and the host memory.
    checks_prefetch_budget_bytes: int = 3_000_000_000

    # SAP RFC sync
    credential_master_key: Optional[str] = None
    sap_rfc_user: str = "RFC_USER"

    # Stripe (exception billing)
    stripe_api_key: Optional[str] = None

    # Observability
    sentry_dsn: Optional[str] = None

    # The interactive API docs (/docs, /redoc) and /openapi.json answer only on a development
    # deployment (MERIDIAN_ENV=development) or when this is set; otherwise they are 404, since nginx
    # proxies them without sign-in.
    openapi_public: bool = Field(default=False, validation_alias=AliasChoices("MERIDIAN_OPENAPI_PUBLIC",
                                                                              "OPENAPI_PUBLIC"))

    def api_docs_enabled(self) -> bool:
        """Whether to serve /docs, /redoc and /openapi.json (see ``openapi_public``)."""
        return self.openapi_public or self.env == "development"

    model_config = {"env_file": ".env", "case_sensitive": False, "extra": "ignore"}


settings = Settings()
