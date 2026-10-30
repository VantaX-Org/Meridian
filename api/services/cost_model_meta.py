"""Where the money on a page comes from: the tenant's own cost model, or the checks/cost_model.yaml defaults.

Every money payload (the object receipt, the landscape, the work list and record) carries
``cost_model = {"source": "default" | "tenant", "is_default": bool, "currency": str}`` so the client can mark
default-priced money as an estimate (or hide it) until the tenant has saved a cost model of its own.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class CostModelOut(BaseModel):
    source: str           # "tenant": the tenant saved a cost model; "default": checks/cost_model.yaml defaults
    is_default: bool      # true while no tenant cost model is saved: the money is an estimate from defaults
    currency: str


def meta_of(raw: Any) -> dict:
    """The cost-model marker for a tenants.cost_model value (None or {} = never saved)."""
    from checks.cost import effective

    saved = isinstance(raw, dict) and bool(raw)
    model: Optional[dict] = raw if saved else None
    return {"source": "tenant" if saved else "default", "is_default": not saved,
            "currency": str(effective(model)["currency"])}


async def for_tenant(db: AsyncSession, tenant_id: Any) -> dict:
    raw = (await db.execute(text("SELECT cost_model FROM tenants WHERE id = :t"), {"t": str(tenant_id)})).scalar()
    return meta_of(raw)
