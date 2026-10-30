import uuid
from typing import AsyncGenerator

from fastapi import Depends, HTTPException, Request
from sqlalchemy import create_engine, event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import settings

# Each API process gets its share of the configured pool, so N workers never open more connections than one did.
_share = max(1, settings.api_workers)
engine = create_async_engine(
    settings.database_url, echo=False, pool_size=max(5, settings.db_pool_size // _share),
    max_overflow=max(5, settings.db_max_overflow // _share), pool_timeout=settings.db_pool_timeout,
    connect_args={"server_settings": {"statement_timeout": str(settings.db_statement_timeout_ms)}},
)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)

# Lazy-initialised sync engine for local auth endpoints
_sync_engine = None


def get_sync_engine_or_create():
    """Return a sync SQLAlchemy engine, creating it on first call."""
    global _sync_engine
    if _sync_engine is None:
        _sync_engine = create_engine(settings.database_url_sync, echo=False)
    return _sync_engine


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async DB session with RLS tenant context pre-set.

    Reads the current tenant ID from the TenantMiddleware ContextVar so every
    query executes within the correct tenant's RLS policy automatically.
    Individual routes may still call SET app.tenant_id explicitly — that is
    harmless and keeps backward compatibility.
    """
    from api.middleware.tenant import get_current_tenant_id  # deferred to avoid circular

    async with async_session_factory() as session:
        tenant_id = get_current_tenant_id()
        if tenant_id is not None:
            # Every transaction, not only the first: after a commit the session checks out a pooled connection
            # again, which may carry another request's tenant or none (an empty app.tenant_id fails every RLS
            # cast). Seen in the acceptance run: POST /admin/sandbox/enter answered 500 after its commit.
            tid = str(uuid.UUID(str(tenant_id)))
            event.listen(session.sync_session, "after_begin", lambda _s, _tx, conn: conn.execute(
                text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": tid}))
        yield session


class Tenant:
    def __init__(self, id: uuid.UUID, name: str, licensed_modules: list[str]):
        self.id = id
        self.name = name
        self.licensed_modules = licensed_modules


DEV_TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

# The development tenant: the fixed row a development stack and the tests sign in to. Never a fallback for a
# signed-in request outside development (get_tenant below).
_DEV_TENANT = Tenant(id=DEV_TENANT_ID, name="Dev Tenant", licensed_modules=["*"])


def deployment_tenant_id() -> uuid.UUID:
    """This deployment's own tenant (settings.deployment_tenant_id, MERIDIAN_TENANT_ID): the tenant of the public
    pages before sign-in, of API keys and of the HQ manifest sync. A single-tenant install keeps the default."""
    try:
        return uuid.UUID(str(settings.deployment_tenant_id))
    except (TypeError, ValueError):
        return DEV_TENANT_ID


# Paths LocalAuthMiddleware lets through without a token (sign-in, theme, status page, licence). Before sign-in
# there is no token to name a tenant, so these serve the deployment's own tenant.
def _is_public_path(path: str) -> bool:
    from api.middleware.local_auth import is_public_path  # deferred: local_auth imports this module

    return is_public_path(path)


# tenants.name per tenant id, read once a minute at most; a renamed tenant shows within the TTL.
_TENANT_NAME_TTL_S = 60.0
_tenant_names: dict[uuid.UUID, tuple[str, float]] = {}


async def _tenant_name(tenant_id: uuid.UUID) -> str:
    import time

    now = time.monotonic()
    hit = _tenant_names.get(tenant_id)
    if hit and hit[1] > now:
        return hit[0]
    name = "Dev Tenant" if tenant_id == DEV_TENANT_ID else "Tenant"
    try:
        async with async_session_factory() as session:
            row = (await session.execute(text("SELECT name FROM tenants WHERE id = :t"),
                                         {"t": str(tenant_id)})).scalar()
            if row:
                name = str(row)
    except Exception:  # noqa: BLE001 - a name is cosmetic: never fail a request over it
        pass
    _tenant_names[tenant_id] = (name, now + _TENANT_NAME_TTL_S)
    return name


def _licensed_modules(request: Request) -> list[str]:
    """The modules the validated licence entitles: LicenceMiddleware's request.state.licensed_modules, else the
    cached licence manifest, else none (the development bypass grants every module as ["*"])."""
    mods = getattr(request.state, "licensed_modules", None)
    if isinstance(mods, list):
        return list(mods)
    from api.middleware.licence import get_cached_manifest

    manifest = get_cached_manifest()
    if manifest.get("valid"):
        return list(manifest.get("enabled_modules") or [])
    if settings.env == "development" and not settings.licence_key:
        return ["*"]
    return []


async def get_tenant(request: Request) -> Tenant:
    """The request's tenant: the ``tenant_id`` claim of the verified session token (or API key), which
    LocalAuthMiddleware puts on ``request.state.verified_tenant_id``.

    Without one: the public pages before sign-in serve the deployment's own tenant; a development deployment
    falls back to the development tenant; anything else is refused (401), so a request can never land in a
    tenant its token does not name. Tests override this dependency.

    TenantMiddleware runs before routing; this dependency resolves inside the route. The tenant is written back
    onto request.state so anything that reads it after the route runs (AuditMiddleware) sees the real one.
    """
    verified = getattr(request.state, "verified_tenant_id", None)
    if verified is not None:
        tid = uuid.UUID(str(verified))
    elif _is_public_path(request.url.path):
        tid = deployment_tenant_id()
    elif settings.env == "development":
        tid = DEV_TENANT_ID
    else:
        raise HTTPException(status_code=401, detail="Not authenticated")
    request.state.tenant_id = tid
    return Tenant(id=tid, name=await _tenant_name(tid), licensed_modules=_licensed_modules(request))


# Aliases used by newer routes
get_session = get_db


async def get_tenant_id(tenant: Tenant = Depends(get_tenant)) -> uuid.UUID:
    """Return just the tenant UUID — convenience alias for routes that need only the ID."""
    return tenant.id
