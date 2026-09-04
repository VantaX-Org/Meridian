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
from api.services.connectivity_manager import (
    RFC_SYSTEM_TYPES,
    CLOUD_SYSTEM_TYPES,
    connect_sap_system,
)

router = APIRouter(prefix="/api/v1", tags=["systems"])
logger = logging.getLogger("meridian.systems")


# ── Request / Response models ────────────────────────────────────────────────


class RegisterSystemRequest(BaseModel):
    name: str
    system_type: str = Field(default="ecc")
    environment: str = Field(default="DEV", pattern="^(PRD|QAS|DEV)$")
    description: Optional[str] = None
    # RFC fields — required when system_type in RFC_SYSTEM_TYPES
    host: Optional[str] = None
    client: Optional[str] = None
    sysnr: Optional[str] = None
    # Cloud fields — required when system_type in CLOUD_SYSTEM_TYPES
    base_url: Optional[str] = None
    company_id: Optional[str] = None
    auth_type: Optional[str] = None
    # RFC: overrides the global SAP_RFC_USER for this system if set. Cloud
    # basic-auth: the actual username (e.g. SuccessFactors username@company_id).
    username: Optional[str] = None
    # RFC: {"password": ...}. Cloud: {"client_id", "client_secret", "api_key", "password" (basic auth)}
    credentials: dict[str, str] = Field(default_factory=dict)


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
    username: Optional[str] = None
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
    base_url: Optional[str] = None
    company_id: Optional[str] = None
    auth_type: Optional[str] = None
    username: Optional[str] = None
    description: Optional[str] = None
    environment: Optional[str] = None
    is_active: Optional[bool] = None
    credentials: dict[str, str] = Field(default_factory=dict)


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
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    if body.system_type not in RFC_SYSTEM_TYPES and body.system_type not in CLOUD_SYSTEM_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported system_type: {body.system_type}")

    if body.system_type in RFC_SYSTEM_TYPES:
        if not (body.host and body.client and body.sysnr and body.credentials.get("password")):
            raise HTTPException(
                status_code=400,
                detail="host, client, sysnr and credentials.password are required for this system_type",
            )
        auth_type = "rfc"
    else:
        if not body.base_url:
            raise HTTPException(status_code=400, detail="base_url is required for this system_type")
        auth_type = body.auth_type or "oauth2_client_credentials"

    from api.services.credential_store import encrypt_password

    result = await db.execute(
        text("""
            INSERT INTO sap_systems (
                id, tenant_id, name, system_type, host, client, sysnr, username,
                base_url, company_id, auth_type, description, environment
            )
            VALUES (
                gen_random_uuid(), :tid, :name, :system_type, :host, :client, :sysnr, :username,
                :base_url, :company_id, :auth_type, :description, :environment
            )
            RETURNING id, name, system_type, host, client, sysnr, username, base_url, company_id,
                      auth_type, description, environment, is_active,
                      created_at::text, updated_at::text
        """),
        {
            "tid": str(tenant.id),
            "name": body.name,
            "system_type": body.system_type,
            "host": body.host,
            "client": body.client,
            "sysnr": body.sysnr,
            "username": body.username,
            "base_url": body.base_url,
            "company_id": body.company_id,
            "auth_type": auth_type,
            "description": body.description,
            "environment": body.environment,
        },
    )
    row = result.fetchone()
    system_id = str(row[0])

    # Password-based secret (RFC user/password, or cloud basic auth) -> system_credentials
    password = body.credentials.get("password")
    if password:
        encrypted = encrypt_password(str(tenant.id), password)
        await db.execute(
            text("""
                INSERT INTO system_credentials (id, system_id, encrypted_password, key_version)
                VALUES (gen_random_uuid(), :sid, :epw, 1)
            """),
            {"sid": system_id, "epw": encrypted},
        )

    # OAuth/API-key secrets live directly on sap_systems
    cloud_secret_columns = {
        "client_id": "client_id_encrypted",
        "client_secret": "client_secret_encrypted",
        "api_key": "api_key_encrypted",
    }
    cloud_updates = {
        column: encrypt_password(str(tenant.id), body.credentials[cred_key])
        for cred_key, column in cloud_secret_columns.items()
        if body.credentials.get(cred_key)
    }
    if cloud_updates:
        set_clause = ", ".join(f"{col} = :{col}" for col in cloud_updates)
        await db.execute(
            text(f"UPDATE sap_systems SET {set_clause} WHERE id = :sid"),
            {**cloud_updates, "sid": system_id},
        )

    await db.commit()

    return SystemResponse(
        id=system_id,
        name=row[1],
        system_type=row[2],
        host=row[3],
        client=row[4],
        sysnr=row[5],
        username=row[6],
        base_url=row[7],
        company_id=row[8],
        auth_type=row[9],
        description=row[10],
        environment=row[11],
        is_active=row[12],
        created_at=row[13],
        updated_at=row[14],
    )


@router.get("/systems", response_model=list[SystemResponse])
async def list_systems(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
):
    """List all SAP systems for the tenant with last sync status."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    result = await db.execute(
        text("""
            SELECT s.id, s.name, s.host, s.client, s.sysnr, s.description,
                   s.environment, s.is_active, s.created_at::text, s.updated_at::text,
                   s.system_type, s.base_url, s.company_id, s.auth_type, s.username,
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
            auth_type=r[13], username=r[14], health_status=r[15] or "unknown",
            health_message=r[16], last_health_check=r[17],
            config_last_synced_at=r[18], config_sync_status=r[19],
            last_sync_at=r[20], last_sync_status=r[21],
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
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

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
    if body.base_url is not None:
        set_parts.append("base_url = :base_url")
        updates["base_url"] = body.base_url
    if body.company_id is not None:
        set_parts.append("company_id = :company_id")
        updates["company_id"] = body.company_id
    if body.auth_type is not None:
        set_parts.append("auth_type = :auth_type")
        updates["auth_type"] = body.auth_type
    if body.username is not None:
        set_parts.append("username = :username")
        updates["username"] = body.username
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

    # Update credentials if provided
    if password := body.credentials.get("password"):
        from api.services.credential_store import encrypt_password
        encrypted = encrypt_password(str(tenant.id), password)
        await db.execute(
            text("""
                INSERT INTO system_credentials (id, system_id, encrypted_password, key_version)
                VALUES (gen_random_uuid(), :sid, :epw, 1)
                ON CONFLICT (system_id) DO UPDATE
                    SET encrypted_password = :epw, key_version = system_credentials.key_version + 1
            """),
            {"epw": encrypted, "sid": system_id},
        )

    cloud_secret_columns = {
        "client_id": "client_id_encrypted",
        "client_secret": "client_secret_encrypted",
        "api_key": "api_key_encrypted",
    }
    cloud_secret_updates = {}
    for cred_key, column in cloud_secret_columns.items():
        if value := body.credentials.get(cred_key):
            from api.services.credential_store import encrypt_password
            cloud_secret_updates[column] = encrypt_password(str(tenant.id), value)
    if cloud_secret_updates:
        set_clause = ", ".join(f"{col} = :{col}" for col in cloud_secret_updates)
        await db.execute(
            text(f"UPDATE sap_systems SET {set_clause} WHERE id = :sid AND tenant_id = :tid"),
            {**cloud_secret_updates, "sid": system_id, "tid": str(tenant.id)},
        )

    await db.commit()

    result = await db.execute(
        text("""
            SELECT id, name, system_type, host, client, sysnr, username, base_url, company_id,
                   auth_type, description, environment, is_active,
                   created_at::text, updated_at::text
            FROM sap_systems WHERE id = :sid AND tenant_id = :tid
        """),
        {"sid": system_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="System not found")

    return SystemResponse(
        id=str(row[0]), name=row[1], system_type=row[2], host=row[3], client=row[4],
        sysnr=row[5], username=row[6], base_url=row[7], company_id=row[8], auth_type=row[9],
        description=row[10], environment=row[11], is_active=row[12],
        created_at=row[13], updated_at=row[14],
    )


@router.delete("/systems/{system_id}")
async def delete_system(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_rules")),
):
    """Delete an SAP system and its credentials. Admin and Steward only."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

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


def _run_connection_test(system_type: str, params: dict, secrets_to_mask: list[str]) -> TestConnectionResponse:
    """Connect + ping with the given params, masking any secret that leaks into an error message."""
    from sap.base import SAPConnectorError

    def mask(message: str) -> str:
        for secret in secrets_to_mask:
            if secret:
                message = re.sub(re.escape(secret), "****", message)
        return message

    connector = None
    try:
        connector = connect_sap_system(system_type, params)
        connected = connector.ping()
        if connected:
            return TestConnectionResponse(connected=True, message="Connection successful")
        return TestConnectionResponse(connected=False, message="Ping failed")
    except SAPConnectorError as e:
        if "pyrfc_not_installed" in str(e):
            return TestConnectionResponse(connected=False, message="PyRFC is not installed")
        return TestConnectionResponse(connected=False, message=f"Connection failed: {mask(str(e))}")
    finally:
        if connector is not None:
            connector.close()


@router.post("/systems/test-connection", response_model=TestConnectionResponse)
async def test_draft_connection(
    body: RegisterSystemRequest,
    role: str = Depends(require_permission("manage_rules")),
):
    """Test connection parameters before the system is registered (no system_id yet).

    Used by the "Test connection" button in the Connect-system dialog, so a
    bad host/client/user can be caught before saving anything.
    """
    if body.system_type not in RFC_SYSTEM_TYPES and body.system_type not in CLOUD_SYSTEM_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported system_type: {body.system_type}")

    import os

    password = body.credentials.get("password", "")
    client_id = body.credentials.get("client_id", "")
    client_secret = body.credentials.get("client_secret", "")
    api_key = body.credentials.get("api_key", "")

    rfc_user = body.username or os.getenv("SAP_RFC_USER", "RFC_USER")
    params = {
        "host": body.host,
        "client": body.client,
        "sysnr": body.sysnr,
        "user": rfc_user,
        "password": password,
        "base_url": body.base_url,
        "company_id": body.company_id,
        "auth_type": body.auth_type,
        "username": (body.username or "") if body.system_type in CLOUD_SYSTEM_TYPES else "",
        "client_id": client_id,
        "client_secret": client_secret,
        "api_key": api_key,
        "token_url": "",
    }
    return _run_connection_test(body.system_type, params, [password, client_secret, api_key])


@router.post("/systems/{system_id}/test", response_model=TestConnectionResponse)
async def test_connection(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_rules")),
):
    """Test the connection to an SAP system, for any system_type. Admin and Steward only."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    # LEFT JOIN — cloud systems using pure OAuth client-credentials never get a
    # system_credentials row, so an INNER JOIN here would 404 a system that exists.
    result = await db.execute(
        text("""
            SELECT s.system_type, s.host, s.client, s.sysnr, s.username, s.base_url, s.company_id,
                   s.auth_type, s.client_id_encrypted, s.client_secret_encrypted,
                   s.api_key_encrypted, sc.encrypted_password
            FROM sap_systems s
            LEFT JOIN system_credentials sc ON sc.system_id = s.id
            WHERE s.id = :sid AND s.tenant_id = :tid
        """),
        {"sid": system_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="System not found")

    (system_type, host, client, sysnr, username, base_url, company_id, auth_type,
     client_id_encrypted, client_secret_encrypted, api_key_encrypted, encrypted_password) = row

    from api.services.credential_store import decrypt_password
    import os

    def safe_decrypt(value: Optional[str]) -> str:
        return decrypt_password(str(tenant.id), value) if value else ""

    try:
        password = safe_decrypt(encrypted_password)
        client_id = safe_decrypt(client_id_encrypted)
        client_secret = safe_decrypt(client_secret_encrypted)
        api_key = safe_decrypt(api_key_encrypted)
    except Exception:
        return TestConnectionResponse(connected=False, message="Failed to decrypt credentials")

    rfc_user = username or os.getenv("SAP_RFC_USER", "RFC_USER")
    params = {
        "host": host,
        "client": client,
        "sysnr": sysnr,
        "user": rfc_user,
        "password": password,
        "base_url": base_url,
        "company_id": company_id,
        "auth_type": auth_type,
        "username": (username or "") if system_type in CLOUD_SYSTEM_TYPES else "",
        "client_id": client_id,
        "client_secret": client_secret,
        "api_key": api_key,
        "token_url": "",
    }
    return _run_connection_test(system_type, params, [password, client_secret, api_key])


@router.post("/systems/{system_id}/sync")
async def trigger_sync(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_rules")),
):
    """Trigger a manual sync for all active profiles on this system."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

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
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

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
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

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
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

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
