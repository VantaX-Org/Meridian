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
    source: str  # live_snapshot | live | baseline | mixed (see table_sources)
    table_sources: dict = {}  # {table_name: live_snapshot | live | baseline | unavailable}
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

    system_type = "ecc"
    snapshot: dict[str, list] = {}

    if system_id:
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
        row = (await db.execute(
            text("SELECT system_type FROM sap_systems WHERE id = :sid AND tenant_id = :tid"),
            {"sid": system_id, "tid": str(tenant.id)},
        )).fetchone()
        if not row:
            raise HTTPException(404, "System not found")
        system_type = row[0]
        # live configuration read by discovery / extraction
        for table, data in (await db.execute(
            text("SELECT config_table, config_data FROM config_snapshots "
                 "WHERE system_id = :sid AND source = 'live'"), {"sid": system_id},
        )).fetchall():
            snapshot.setdefault(table, data or [])

    reader = SPROReader(system_type, None, snapshot_loader=snapshot.get)
    try:
        config = reader.read_config(module)
    except ValueError as e:
        raise HTTPException(404, str(e))
    table_sources = reader.sources.get(module, {})

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
        source=(next(iter(set(table_sources.values()))) if len(set(table_sources.values())) == 1 else "mixed"),
        table_sources=table_sources,
        tables=tables_dict,
        field_purposes=field_purposes,
    )
