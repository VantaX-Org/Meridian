import uuid
from typing import AsyncGenerator

from fastapi import Depends, Request
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import settings

engine = create_async_engine(settings.database_url, echo=False)
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
            await session.execute(text("SET LOCAL app.tenant_id = :tid"), {"tid": str(tenant_id)})
        yield session


class Tenant:
    def __init__(self, id: uuid.UUID, name: str, licensed_modules: list[str]):
        self.id = id
        self.name = name
        self.licensed_modules = licensed_modules


# Hardcoded dev tenant for AUTH_MODE=local
_DEV_TENANT = Tenant(
    id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
    name="Dev Tenant",
    licensed_modules=[
        "business_partner", "material_master", "fi_gl",
        "accounts_payable", "accounts_receivable", "asset_accounting",
        "mm_purchasing", "plant_maintenance", "production_planning",
        "sd_customer_master", "sd_sales_orders",
        "employee_central", "compensation", "benefits",
        "payroll_integration", "performance_goals", "succession_planning",
        "recruiting_onboarding", "learning_management", "time_attendance",
        "ewms_stock", "ewms_transfer_orders", "batch_management",
        "mdg_master_data", "grc_compliance", "fleet_management",
        "transport_management", "wm_interface", "cross_system_integration",
    ],
)


async def get_tenant(request: Request) -> Tenant:
    if settings.auth_mode == "local":
        return _DEV_TENANT

    # JWT extraction for local auth
    # For now, return dev tenant as fallback
    return _DEV_TENANT


# Aliases used by newer routes
get_session = get_db


async def get_tenant_id(tenant: Tenant = Depends(get_tenant)) -> uuid.UUID:
    """Return just the tenant UUID — convenience alias for routes that need only the ID."""
    return tenant.id
