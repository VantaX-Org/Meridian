"""SPRO Config Reader API routes."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

router = APIRouter(prefix="/api/v1/spro", tags=["spro"])
logger = logging.getLogger("meridian.spro")


class SPROConfigResponse(BaseModel):
    module: str
    source: str  # live or baseline
    tables: dict  # {table_name: [{field: value, ...}]}
    field_purposes: dict  # {field: {config_table, description, impacts_features}}


@router.get("/config/{module}", response_model=SPROConfigResponse)
async def get_spro_config(
    module: str,
    system_id: str = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Read SPRO config for a module. Optionally from a live SAP system."""
    from api.services.spro_reader import SPROReader
    from sap.spro_tables import SPRO_REGISTRY

    connection_params = None
    system_type = "ecc"

    if system_id:
        await db.execute(text(f"SET app.tenant_id TO '{tenant.id}'"))
        result = await db.execute(
            text("SELECT system_type, host, client, sysnr, base_url, "
                 "company_id, auth_type, token_url "
                 "FROM sap_systems WHERE id = :sid AND tenant_id = :tid"),
            {"sid": system_id, "tid": str(tenant.id)},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(404, "System not found")
        system_type = row[0]

    reader = SPROReader(system_type, connection_params)
    config = reader.read_config(module)

    tables_dict = {}
    for table_name, df in config.items():
        tables_dict[table_name] = df.to_dict(orient="records") if not df.empty else []

    field_purposes = {}
    for table_def in SPRO_REGISTRY.get(module, []):
        for field in table_def.get("governs_fields", []):
            field_purposes[field] = {
                "config_table": table_def["table"],
                "description": table_def["description"],
                "config_context": table_def.get("config_context", ""),
                "impacts_features": table_def.get("impacts_features", []),
            }

    return SPROConfigResponse(
        module=module,
        source="live" if connection_params else "baseline",
        tables=tables_dict,
        field_purposes=field_purposes,
    )
