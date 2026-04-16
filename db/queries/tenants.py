import os
import uuid
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.schema import Tenant


async def get_tenant_by_id(db: AsyncSession, tenant_id: uuid.UUID) -> Optional[Tenant]:
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    return result.scalar_one_or_none()


async def create_tenant(
    db: AsyncSession, name: str, licensed_modules: list[str]
) -> Tenant:
    tenant = Tenant(name=name, licensed_modules=licensed_modules)
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    return tenant


def create_initial_tenant() -> None:
    """Create the first tenant if none exist. Uses sync engine.

    Called by install.sh via: python -c "from db.queries.tenants import create_initial_tenant; create_initial_tenant()"
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    db_url = os.environ.get(
        "DATABASE_URL_SYNC",
        os.environ.get("DATABASE_URL", "").replace("+asyncpg", ""),
    )
    if not db_url:
        print("DATABASE_URL_SYNC not set — skipping tenant creation")
        return

    engine = create_engine(db_url)
    with Session(engine) as session:
        count = session.execute(select(Tenant)).scalars().first()
        if count is not None:
            print(f"Tenant already exists: {count.name}")
            return

        name = os.environ.get("INITIAL_TENANT_NAME", "Default Tenant")
        # Read licensed modules from LICENSED_MODULES env or default to base package
        modules_str = os.environ.get(
            "LICENSED_MODULES", "business_partner,material_master,fi_gl"
        )
        modules = [m.strip() for m in modules_str.split(",") if m.strip()]

        tenant = Tenant(name=name, licensed_modules=modules)
        session.add(tenant)
        session.commit()
        print(f"Created initial tenant: {name} with modules: {modules}")
