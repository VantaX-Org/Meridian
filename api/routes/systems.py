"""SAP Systems and Sync Profile management routes.

CRUD for sap_systems and sync_profiles.
All endpoints apply require_permission checks.
"""

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["systems"])
logger = logging.getLogger("meridian.systems")


# ── Request / Response models ────────────────────────────────────────────────


class RegisterSystemRequest(BaseModel):
    name: str
    host: str
    client: str
    sysnr: str
    description: Optional[str] = None
    environment: str = Field(default="DEV", pattern="^(PRD|QAS|DEV)$")
    password: str = Field(..., description="SAP RFC password — encrypted at rest, never returned")


class SystemResponse(BaseModel):
    id: str
    name: str
    host: Optional[str] = None
    client: Optional[str] = None
    sysnr: Optional[str] = None
    description: Optional[str] = None
    environment: str
    is_active: bool
    system_type: str = "ecc"
    base_url: Optional[str] = None
    company_id: Optional[str] = None
    auth_type: Optional[str] = None
    health_status: str = "unknown"
    health_message: Optional[str] = None
    last_health_check: Optional[str] = None
    config_last_synced_at: Optional[str] = None
    config_sync_status: Optional[str] = None
    created_at: str
    updated_at: str
    last_sync_at: Optional[str] = None
    last_sync_status: Optional[str] = None


class UpdateSystemRequest(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    client: Optional[str] = None
    sysnr: Optional[str] = None
    description: Optional[str] = None
    environment: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class TestConnectionResponse(BaseModel):
    connected: bool
    message: str


class CreateSyncProfileRequest(BaseModel):
    system_id: str
    domain: str
    tables: list[str]
    schedule_cron: Optional[str] = None
    active: bool = True


class SyncProfileResponse(BaseModel):
    id: str
    system_id: str
    domain: str
    tables: list[str]
    schedule_cron: Optional[str]
    active: bool
    last_run_at: Optional[str]
    next_run_at: Optional[str]


class SyncRunResponse(BaseModel):
    id: str
    profile_id: str
    started_at: str
    completed_at: Optional[str]
    rows_extracted: int
    findings_delta: int
    golden_records_updated: int
    status: str
    error_detail: Optional[str]
    ai_quality_score: Optional[float]
    anomaly_flags: Optional[list[dict]] = None


# ── System CRUD ──────────────────────────────────────────────────────────────


@router.post("/systems", response_model=SystemResponse)
async def register_system(
    body: RegisterSystemRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_rules")),
):
    """Register a new SAP system. Admin and Steward only."""
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})

    # Encrypt the password
    from api.services.credential_store import encrypt_password
    encrypted = encrypt_password(str(tenant.id), body.password)

    # Insert system
    result = await db.execute(
        text("""
            INSERT INTO sap_systems (id, tenant_id, name, host, client, sysnr, description, environment)
            VALUES (gen_random_uuid(), :tid, :name, :host, :client, :sysnr, :description, :environment)
            RETURNING id, name, host, client, sysnr, description, environment, is_active,
                      created_at::text, updated_at::text
        """),
        {
            "tid": str(tenant.id),
            "name": body.name,
            "host": body.host,
            "client": body.client,
            "sysnr": body.sysnr,
            "description": body.description,
            "environment": body.environment,
        },
    )
    row = result.fetchone()
    system_id = str(row[0])

    # Store encrypted credentials
    await db.execute(
        text("""
            INSERT INTO system_credentials (id, system_id, encrypted_password, key_version)
            VALUES (gen_random_uuid(), :sid, :epw, 1)
        """),
        {"sid": system_id, "epw": encrypted},
    )
    await db.commit()

    return SystemResponse(
        id=system_id,
        name=row[1],
        host=row[2],
        client=row[3],
        sysnr=row[4],
        description=row[5],
        environment=row[6],
        is_active=row[7],
        created_at=row[8],
        updated_at=row[9],
    )


@router.get("/systems", response_model=list[SystemResponse])
async def list_systems(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
):
    """List all SAP systems for the tenant with last sync status."""
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})

    result = await db.execute(
        text("""
            SELECT s.id, s.name, s.host, s.client, s.sysnr, s.description,
                   s.environment, s.is_active, s.created_at::text, s.updated_at::text,
                   s.system_type, s.base_url, s.company_id, s.auth_type,
                   s.health_status, s.health_message, s.last_health_check::text,
                   s.config_last_synced_at::text, s.config_sync_status,
                   (SELECT sr.started_at::text FROM sync_runs sr
                    JOIN sync_profiles sp ON sr.profile_id = sp.id
                    WHERE sp.system_id = s.id
                    ORDER BY sr.started_at DESC LIMIT 1) as last_sync_at,
                   (SELECT sr.status FROM sync_runs sr
                    JOIN sync_profiles sp ON sr.profile_id = sp.id
                    WHERE sp.system_id = s.id
                    ORDER BY sr.started_at DESC LIMIT 1) as last_sync_status
            FROM sap_systems s
            WHERE s.tenant_id = :tid
            ORDER BY s.created_at DESC
        """),
        {"tid": str(tenant.id)},
    )
    rows = result.fetchall()
    return [
        SystemResponse(
            id=str(r[0]), name=r[1], host=r[2], client=r[3], sysnr=r[4],
            description=r[5], environment=r[6], is_active=r[7],
            created_at=r[8], updated_at=r[9],
            system_type=r[10] or "ecc", base_url=r[11], company_id=r[12],
            auth_type=r[13], health_status=r[14] or "unknown",
            health_message=r[15], last_health_check=r[16],
            config_last_synced_at=r[17], config_sync_status=r[18],
            last_sync_at=r[19], last_sync_status=r[20],
        )
        for r in rows
    ]


@router.put("/systems/{system_id}", response_model=SystemResponse)
async def update_system(
    system_id: str,
    body: UpdateSystemRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_rules")),
):
    """Update an SAP system. Admin and Steward only."""
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})

    # Build dynamic SET clause
    updates = {}
    set_parts = []
    if body.name is not None:
        set_parts.append("name = :name")
        updates["name"] = body.name
    if body.host is not None:
        set_parts.append("host = :host")
        updates["host"] = body.host
    if body.client is not None:
        set_parts.append("client = :client")
        updates["client"] = body.client
    if body.sysnr is not None:
        set_parts.append("sysnr = :sysnr")
        updates["sysnr"] = body.sysnr
    if body.description is not None:
        set_parts.append("description = :description")
        updates["description"] = body.description
    if body.environment is not None:
        set_parts.append("environment = :environment")
        updates["environment"] = body.environment
    if body.is_active is not None:
        set_parts.append("is_active = :is_active")
        updates["is_active"] = body.is_active

    if set_parts:
        set_parts.append("updated_at = now()")
        updates["sid"] = system_id
        updates["tid"] = str(tenant.id)
        await db.execute(
            text(f"UPDATE sap_systems SET {', '.join(set_parts)} WHERE id = :sid AND tenant_id = :tid"),
            updates,
        )

    # Update password if provided
    if body.password is not None:
        from api.services.credential_store import encrypt_password
        encrypted = encrypt_password(str(tenant.id), body.password)
        await db.execute(
            text("""
                UPDATE system_credentials SET encrypted_password = :epw, key_version = key_version + 1
                WHERE system_id = :sid
            """),
            {"epw": encrypted, "sid": system_id},
        )

    await db.commit()

    result = await db.execute(
        text("""
            SELECT id, name, host, client, sysnr, description, environment, is_active,
                   created_at::text, updated_at::text
            FROM sap_systems WHERE id = :sid AND tenant_id = :tid
        """),
        {"sid": system_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="System not found")

    return SystemResponse(
        id=str(row[0]), name=row[1], host=row[2], client=row[3], sysnr=row[4],
        description=row[5], environment=row[6], is_active=row[7],
        created_at=row[8], updated_at=row[9],
    )


@router.delete("/systems/{system_id}")
async def delete_system(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_rules")),
):
    """Delete an SAP system and its credentials. Admin and Steward only."""
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})

    result = await db.execute(
        text("SELECT id FROM sap_systems WHERE id = :sid AND tenant_id = :tid"),
        {"sid": system_id, "tid": str(tenant.id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="System not found")

    # CASCADE will handle credentials and profiles
    await db.execute(
        text("DELETE FROM sap_systems WHERE id = :sid AND tenant_id = :tid"),
        {"sid": system_id, "tid": str(tenant.id)},
    )
    await db.commit()
    return {"status": "deleted"}


@router.post("/systems/{system_id}/test", response_model=TestConnectionResponse)
async def test_connection(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_rules")),
):
    """Test RFC connection to an SAP system. Admin and Steward only."""
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})

    # Load system and credentials
    result = await db.execute(
        text("""
            SELECT s.host, s.client, s.sysnr, sc.encrypted_password
            FROM sap_systems s
            JOIN system_credentials sc ON sc.system_id = s.id
            WHERE s.id = :sid AND s.tenant_id = :tid
        """),
        {"sid": system_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="System not found")

    host, client, sysnr, encrypted_password = row

    from api.services.credential_store import decrypt_password
    import os

    try:
        password = decrypt_password(str(tenant.id), encrypted_password)
    except Exception:
        return TestConnectionResponse(connected=False, message="Failed to decrypt credentials")

    from sap import get_connector
    from sap.base import SAPConnectionParams, SAPConnectorError

    rfc_user = os.getenv("SAP_RFC_USER", "RFC_USER")

    params = SAPConnectionParams(
        host=host,
        client=client,
        sysnr=sysnr,
        user=rfc_user,
        password=password,
    )
    try:
        with get_connector() as conn:
            conn.connect(params)
            connected = conn.ping()
        password = ""  # clear from memory
        if connected:
            return TestConnectionResponse(connected=True, message="Connection successful")
        return TestConnectionResponse(connected=False, message="Ping failed")
    except SAPConnectorError as e:
        safe_msg = re.sub(re.escape(password), "****", str(e)) if password else str(e)
        password = ""  # clear from memory
        if "pyrfc_not_installed" in str(e):
            return TestConnectionResponse(connected=False, message="PyRFC is not installed")
        return TestConnectionResponse(connected=False, message=f"Connection failed: {safe_msg}")


@router.post("/systems/{system_id}/sync")
async def trigger_sync(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_rules")),
):
    """Trigger a manual sync for all active profiles on this system."""
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})

    result = await db.execute(
        text("""
            SELECT id FROM sync_profiles
            WHERE system_id = :sid AND tenant_id = :tid AND active = true
        """),
        {"sid": system_id, "tid": str(tenant.id)},
    )
    profiles = result.fetchall()

    if not profiles:
        raise HTTPException(status_code=404, detail="No active sync profiles found")

    from workers.tasks.run_sync import run_sync
    job_ids = []
    for p in profiles:
        result = run_sync.delay(str(p[0]), str(tenant.id))
        job_ids.append(str(result.id))

    return {"status": "enqueued", "profile_count": len(profiles), "job_ids": job_ids}


# ── Sync Profile CRUD ───────────────────────────────────────────────────────


@router.post("/systems/{system_id}/profiles", response_model=SyncProfileResponse)
async def create_sync_profile(
    system_id: str,
    body: CreateSyncProfileRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_rules")),
):
    """Create a sync profile for an SAP system."""
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})

    # Verify system exists
    result = await db.execute(
        text("SELECT id FROM sap_systems WHERE id = :sid AND tenant_id = :tid"),
        {"sid": system_id, "tid": str(tenant.id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="System not found")

    result = await db.execute(
        text("""
            INSERT INTO sync_profiles (id, tenant_id, system_id, domain, tables, schedule_cron, active)
            VALUES (gen_random_uuid(), :tid, :sid, :domain, :tables, :cron, :active)
            RETURNING id, system_id, domain, tables, schedule_cron, active,
                      last_run_at::text, next_run_at::text
        """),
        {
            "tid": str(tenant.id),
            "sid": system_id,
            "domain": body.domain,
            "tables": body.tables,
            "cron": body.schedule_cron,
            "active": body.active,
        },
    )
    row = result.fetchone()
    await db.commit()

    return SyncProfileResponse(
        id=str(row[0]), system_id=str(row[1]), domain=row[2],
        tables=row[3], schedule_cron=row[4], active=row[5],
        last_run_at=row[6], next_run_at=row[7],
    )


@router.get("/systems/{system_id}/profiles", response_model=list[SyncProfileResponse])
async def list_sync_profiles(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
):
    """List sync profiles for a system."""
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})

    result = await db.execute(
        text("""
            SELECT id, system_id, domain, tables, schedule_cron, active,
                   last_run_at::text, next_run_at::text
            FROM sync_profiles
            WHERE system_id = :sid AND tenant_id = :tid
            ORDER BY domain
        """),
        {"sid": system_id, "tid": str(tenant.id)},
    )
    rows = result.fetchall()
    return [
        SyncProfileResponse(
            id=str(r[0]), system_id=str(r[1]), domain=r[2],
            tables=r[3], schedule_cron=r[4], active=r[5],
            last_run_at=r[6], next_run_at=r[7],
        )
        for r in rows
    ]


# ── Sync Runs ────────────────────────────────────────────────────────────────


@router.get("/systems/{system_id}/runs", response_model=list[SyncRunResponse])
async def list_sync_runs(
    system_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
):
    """List sync run history for a system."""
    await db.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})

    result = await db.execute(
        text("""
            SELECT sr.id, sr.profile_id, sr.started_at::text, sr.completed_at::text,
                   sr.rows_extracted, sr.findings_delta, sr.golden_records_updated,
                   sr.status, sr.error_detail, sr.ai_quality_score, sr.anomaly_flags
            FROM sync_runs sr
            JOIN sync_profiles sp ON sr.profile_id = sp.id
            WHERE sp.system_id = :sid AND sr.tenant_id = :tid
            ORDER BY sr.started_at DESC
            LIMIT :lim
        """),
        {"sid": system_id, "tid": str(tenant.id), "lim": limit},
    )
    rows = result.fetchall()
    return [
        SyncRunResponse(
            id=str(r[0]), profile_id=str(r[1]),
            started_at=r[2], completed_at=r[3],
            rows_extracted=r[4], findings_delta=r[5],
            golden_records_updated=r[6], status=r[7],
            error_detail=r[8], ai_quality_score=r[9],
            anomaly_flags=r[10],
        )
        for r in rows
    ]
