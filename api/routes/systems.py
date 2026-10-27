"""SAP Systems and Sync Profile management routes.

CRUD for sap_systems and sync_profiles.
All endpoints apply require_permission checks.
"""

import asyncio
import logging
import re
import uuid
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.config_pairing import enqueue_config_load, pair_error
from api.services.rbac import Scope, _as_uuid, require_permission, require_scope, scope_from_path
from api.services.version_status import finished_sql
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
    token_url: Optional[str] = None  # OAuth client credentials, e.g. the BTP XSUAA /oauth/token URL
    # RFC: overrides the global SAP_RFC_USER for this system if set. Cloud
    # basic-auth: the actual username (e.g. SuccessFactors username@company_id).
    username: Optional[str] = None
    # RFC: {"password": ...}. Cloud: {"client_id", "client_secret", "api_key", "password" (basic auth)}
    credentials: dict[str, str] = Field(default_factory=dict)
    role: str = Field(default="source", pattern="^(source|target)$")


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
    token_url: Optional[str] = None  # not a secret: the edit form shows and changes it
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
    discovery_status: Optional[str] = None
    discovered_at: Optional[str] = None
    sap_release: Optional[str] = None
    last_analysis_at: Optional[str] = None
    role: str = "source"
    target_system_id: Optional[str] = None


class UpdateSystemRequest(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    client: Optional[str] = None
    sysnr: Optional[str] = None
    base_url: Optional[str] = None
    company_id: Optional[str] = None
    auth_type: Optional[str] = None
    username: Optional[str] = None
    token_url: Optional[str] = None  # "" clears it
    description: Optional[str] = None
    environment: Optional[str] = None
    is_active: Optional[bool] = None
    # migration cut-over: records created before it and never changed are migration-era (root cause)
    go_live: Optional[date] = None
    credentials: dict[str, str] = Field(default_factory=dict)
    role: Optional[str] = Field(default=None, pattern="^(source|target)$")
    target_system_id: Optional[str] = None  # "" clears the target


class TestConnectionResponse(BaseModel):
    connected: bool
    message: str


class CreateSyncProfileRequest(BaseModel):
    system_id: str
    domain: str
    tables: list[str]
    schedule_cron: Optional[str] = None
    active: bool = True
    # delta: re-read only what SAP's change documents say changed since the last download
    extraction_mode: Literal["full", "delta"] = "full"


class UpdateSyncProfileRequest(BaseModel):
    # "" clears the schedule (manual sync only)
    schedule_cron: Optional[str] = None
    active: Optional[bool] = None
    extraction_mode: Optional[Literal["full", "delta"]] = None


class SyncProfileResponse(BaseModel):
    id: str
    system_id: str
    domain: str
    tables: list[str]
    schedule_cron: Optional[str]
    active: bool
    last_run_at: Optional[str]
    next_run_at: Optional[str]
    extraction_mode: str = "full"


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
    role: str = Depends(require_permission("manage_systems", scope=scope_from_path)),
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
                base_url, company_id, auth_type, token_url, description, environment, role
            )
            VALUES (
                gen_random_uuid(), :tid, :name, :system_type, :host, :client, :sysnr, :username,
                :base_url, :company_id, :auth_type, :token_url, :description, :environment, :role
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
            "token_url": body.token_url,
            "description": body.description,
            "environment": body.environment,
            "role": body.role,
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
    await enqueue_config_load(db, str(tenant.id), system_id)  # config on connect; never fails the register
    # Learn the source system's design straight away (DDIC, Z-objects,
    # configuration). A connection failure is recorded on the snapshot.
    enqueue_discovery(str(tenant.id), system_id)

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
        role=body.role,
        token_url=body.token_url,
    )


@router.get("/systems", response_model=list[SystemResponse])
async def list_systems(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    """List all SAP systems for the tenant with last sync status."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    result = await db.execute(
        text(f"""
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
                    ORDER BY sr.started_at DESC LIMIT 1) as last_sync_status,
                   s.discovery_status, s.discovered_at::text, s.sap_release,
                   (SELECT max(v.run_at)::text FROM analysis_versions v
                    WHERE v.metadata->>'system_id' = s.id::text AND {finished_sql('v.status')}) AS last_analysis_at,
                   s.role, s.target_system_id::text, s.token_url
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
            discovery_status=r[22], discovered_at=r[23], sap_release=r[24], last_analysis_at=r[25],
            role=r[26], target_system_id=r[27], token_url=r[28],
        )
        for r in rows
    ]


@router.put("/systems/{system_id}", response_model=SystemResponse)
async def update_system(
    system_id: str,
    body: UpdateSystemRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_systems", scope=scope_from_path)),
):
    """Update an SAP system. Admin and Steward only."""
    if body.target_system_id:  # pairing with another system needs rights on it too
        tgt = _as_uuid(body.target_system_id)
        if tgt:
            await require_scope(request, db, tenant, "manage_systems", Scope(tgt, None))
    if body.role == "source":  # the cascade below writes other systems' rows: tenant-wide only
        await require_scope(request, db, tenant, "manage_systems", Scope())
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    # An endpoint change must bring its own secrets: the stored ones are never kept for a new endpoint.
    stored = await _stored_connection(db, system_id, str(tenant.id))
    if stored is None:
        raise HTTPException(status_code=404, detail="System not found")
    changed = _endpoint_changes(stored, body)
    if changed:
        missing = _missing_secrets(stored, stored["system_type"], body.auth_type or stored["auth_type"], body.credentials)
        if missing:
            raise HTTPException(status_code=422, detail=_reenter_message(changed, missing))

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
    if body.token_url is not None:
        set_parts.append("token_url = :token_url")
        updates["token_url"] = body.token_url.strip() or None
    if body.description is not None:
        set_parts.append("description = :description")
        updates["description"] = body.description
    if body.environment is not None:
        set_parts.append("environment = :environment")
        updates["environment"] = body.environment
    if body.is_active is not None:
        set_parts.append("is_active = :is_active")
        updates["is_active"] = body.is_active
    if body.go_live is not None:
        set_parts.append("go_live = :go_live")
        updates["go_live"] = body.go_live
    if body.role is not None:
        set_parts.append("role = :role")
        updates["role"] = body.role
        if body.role == "target":
            set_parts.append("target_system_id = NULL")  # a target has no target of its own
    if body.target_system_id is not None and body.role != "target":
        if body.target_system_id == "":
            set_parts.append("target_system_id = NULL")
        else:
            try:
                uuid.UUID(body.target_system_id)
            except ValueError:
                raise HTTPException(status_code=400, detail="The assigned system must have the target role.")
            roles = (await db.execute(text(
                "SELECT (SELECT role FROM sap_systems WHERE id = CAST(:sid AS uuid) AND tenant_id = :tid), "
                "(SELECT role FROM sap_systems WHERE id = CAST(:tgt AS uuid) AND tenant_id = :tid)"),
                {"sid": system_id, "tgt": body.target_system_id, "tid": str(tenant.id)})).one()
            msg = pair_error(body.role or roles[0] or "source", roles[1] or "", body.target_system_id == system_id)
            if msg:
                raise HTTPException(status_code=400, detail=msg)
            set_parts.append("target_system_id = CAST(:tgt AS uuid)")
            updates["tgt"] = body.target_system_id

    if set_parts:
        set_parts.append("updated_at = now()")
        updates["sid"] = system_id
        updates["tid"] = str(tenant.id)
        await db.execute(
            text(f"UPDATE sap_systems SET {', '.join(set_parts)} WHERE id = :sid AND tenant_id = :tid"),
            updates,
        )
    if body.role == "source":  # no source may keep pointing at a system that is no longer a target
        await db.execute(
            text("UPDATE sap_systems SET target_system_id = NULL "
                 "WHERE target_system_id = CAST(:sid AS uuid) AND tenant_id = :tid"),
            {"sid": system_id, "tid": str(tenant.id)},
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
                   created_at::text, updated_at::text, role, target_system_id::text, token_url
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
        created_at=row[13], updated_at=row[14], role=row[15], target_system_id=row[16],
        token_url=row[17],
    )


@router.delete("/systems/{system_id}")
async def delete_system(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_systems", scope=scope_from_path)),
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


@router.delete("/systems/{system_id}/profiles/{profile_id}", status_code=204)
async def delete_sync_profile(
    system_id: str,
    profile_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_systems", scope=scope_from_path)),
):
    """Delete one extraction schedule (sync profile). Its extraction log (sync_runs) cascades; analysis runs stay."""
    if not _as_uuid(system_id) or not _as_uuid(profile_id):
        raise HTTPException(status_code=404, detail="Schedule not found")  # never reaches the uuid cast
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    result = await db.execute(
        text("DELETE FROM sync_profiles WHERE id = :pid AND system_id = :sid AND tenant_id = :tid RETURNING id"),
        {"pid": profile_id, "sid": system_id, "tid": str(tenant.id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Schedule not found")
    await db.commit()


def _connection_test_once(system_type: str, params: dict, secrets_to_mask: list[str]) -> TestConnectionResponse:
    """Connect + ping with the given params, masking any secret that leaks into an error message.

    Synchronous and blocking by nature (pyRFC gives no timeout parameter; cloud clients
    default to 120 s) — callers must run it off the event loop, see _run_connection_test.
    """
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
    except Exception as e:
        # A missing endpoint field raised AttributeError inside the connector constructor,
        # outside SAPConnectorError's reach: the route 500'd and every UI surface read that as
        # "Could not reach the server." — our own defect disguised as a network outage. Name it
        # as a parameter problem and log the real cause for ops; never 500 a connection test.
        logger.exception("connection test crashed on malformed params (%s)", system_type)
        return TestConnectionResponse(
            connected=False,
            message="Connection failed: the stored or entered connection parameters are incomplete.",
        )
    finally:
        if connector is not None:
            connector.close()


# A "Test connection" click must answer in seconds, not when the TCP stack gives up. pyRFC accepts
# no timeout, so the wall-clock bound is enforced here. The thread cannot be killed on timeout — the
# socket dies with pyRFC's own retries — but the event loop is released, which is the point: these
# probes used to run inline in `async def` handlers, so one filtered host froze every tenant's API.
_CONNECTION_TEST_TIMEOUT_S = 45.0


async def _run_connection_test(system_type: str, params: dict, secrets_to_mask: list[str]) -> TestConnectionResponse:
    """Run _connection_test_once on a worker thread with a hard timeout, off FastAPI's event loop."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_connection_test_once, system_type, params, secrets_to_mask),
            timeout=_CONNECTION_TEST_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        return TestConnectionResponse(
            connected=False,
            message=f"Connection attempt timed out after {int(_CONNECTION_TEST_TIMEOUT_S)} seconds — the system did not answer.",
        )


def _require_endpoint_fields(system_type: str, params: dict) -> None:
    """400 when a connection cannot even be attempted: the check POST /systems applies on register,
    so the test routes — which validated nothing — could only fail as a 500 or a confusing ping error."""
    if system_type in RFC_SYSTEM_TYPES:
        if not (params.get("host") and params.get("client") and params.get("sysnr")):
            raise HTTPException(status_code=400, detail="host, client and sysnr are required for this system_type")
    elif system_type in CLOUD_SYSTEM_TYPES:
        if not params.get("base_url"):
            raise HTTPException(status_code=400, detail="base_url is required for this system_type")


_SECRET_KEYS = ("password", "client_id", "client_secret", "api_key")

# The fields that decide where a stored secret is sent. Changing any of them needs the secrets retyped.
_ENDPOINT_FIELDS = ("host", "client", "sysnr", "base_url", "token_url", "auth_type")


async def _stored_connection(db: AsyncSession, system_id: str, tenant_id: str) -> Optional[dict]:
    """This tenant's stored endpoint fields and encrypted secrets for one system, or None."""
    row = (await db.execute(
        text("""
            SELECT s.system_type, s.auth_type, s.client_id_encrypted, s.client_secret_encrypted,
                   s.api_key_encrypted, sc.encrypted_password,
                   s.host, s.client, s.sysnr, s.base_url, s.token_url
            FROM sap_systems s
            LEFT JOIN system_credentials sc ON sc.system_id = s.id
            WHERE s.id = :sid AND s.tenant_id = :tid
        """),
        {"sid": system_id, "tid": tenant_id},
    )).fetchone()
    if not row:
        return None
    keys = ("system_type", "auth_type", "client_id", "client_secret", "api_key", "password",
            "host", "client", "sysnr", "base_url", "token_url")
    return dict(zip(keys, row))


def _endpoint_changes(stored: dict, body: BaseModel) -> list[str]:
    """The endpoint fields the body sets to something other than the stored value (None = not sent)."""
    changed = []
    for field in _ENDPOINT_FIELDS:
        value = getattr(body, field, None)
        if value is None:
            continue
        if field == "auth_type" and (stored["system_type"] in RFC_SYSTEM_TYPES or not stored["auth_type"]):
            continue  # RFC ignores it; an unset stored auth type is the connector's default
        if value.strip() != (stored[field] or "").strip():
            changed.append(field)
    return changed


def _needed_secrets(system_type: str, auth_type: Optional[str]) -> tuple[str, ...]:
    """The secrets a connection of this type and auth sends."""
    if system_type in RFC_SYSTEM_TYPES or auth_type == "basic":
        return ("password",)
    return ("client_id", "client_secret", "api_key") if system_type == "ariba" else ("client_id", "client_secret")


def _missing_secrets(stored: dict, system_type: str, auth_type: Optional[str], credentials: dict[str, str]) -> list[str]:
    """The secrets this connection uses that are stored but were not typed again."""
    return [k for k in _needed_secrets(system_type, auth_type) if stored.get(k) and not credentials.get(k)]


def _reenter_message(changed: list[str], missing: list[str]) -> str:
    label = {"password": "password", "client_id": "client ID", "client_secret": "client secret", "api_key": "API key"}
    return (f"Re-enter the {', '.join(label[k] for k in missing)} when you change the "
            f"{', '.join(f.replace('_', ' ') for f in changed)}: stored secrets are never sent to a changed endpoint.")


def _draft_params(body: RegisterSystemRequest, system_type: str, secrets: dict[str, str]) -> dict:
    """Connector params for a draft connection: the typed fields plus the given secrets."""
    import os

    return {
        "host": body.host,
        "client": body.client,
        "sysnr": body.sysnr,
        "user": body.username or os.getenv("SAP_RFC_USER", "RFC_USER"),
        "password": secrets.get("password", ""),
        "base_url": body.base_url,
        "company_id": body.company_id,
        "auth_type": body.auth_type,
        "username": (body.username or "") if system_type in CLOUD_SYSTEM_TYPES else "",
        "client_id": secrets.get("client_id", ""),
        "client_secret": secrets.get("client_secret", ""),
        "api_key": secrets.get("api_key", ""),
        "token_url": body.token_url or "",
    }


@router.post("/systems/test-connection", response_model=TestConnectionResponse)
async def test_draft_connection(
    body: RegisterSystemRequest,
    role: str = Depends(require_permission("manage_systems", scope=scope_from_path)),
):
    """Test connection parameters before the system is registered (no system_id yet).

    Used by the "Test connection" button in the Connect-system dialog, so a
    bad host/client/user can be caught before saving anything.
    """
    if body.system_type not in RFC_SYSTEM_TYPES and body.system_type not in CLOUD_SYSTEM_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported system_type: {body.system_type}")

    secrets = {k: body.credentials.get(k, "") for k in _SECRET_KEYS}
    params = _draft_params(body, body.system_type, secrets)
    _require_endpoint_fields(body.system_type, params)
    return await _run_connection_test(body.system_type, params, [secrets["password"], secrets["client_secret"], secrets["api_key"]])


@router.post("/systems/{system_id}/test-connection", response_model=TestConnectionResponse)
async def test_edited_connection(
    system_id: str,
    body: RegisterSystemRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_systems", scope=scope_from_path)),
) -> TestConnectionResponse:
    """Test an existing system's edited, unsaved connection fields.

    The edit form sends the fields as they stand; a secret left empty falls back to the one
    stored for this system in this tenant, except when an endpoint field (host, client, system
    number, base URL, token URL or auth type) differs from the stored one: then every secret the
    connection uses must be typed again (422 otherwise), so a stored credential is never sent to
    a new endpoint. Nothing is saved and the system's health is not
    touched: the result describes the draft, not the stored connection.
    """
    if not _as_uuid(system_id):
        raise HTTPException(status_code=404, detail="System not found")
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    stored = await _stored_connection(db, system_id, str(tenant.id))
    if stored is None:
        raise HTTPException(status_code=404, detail="System not found")
    system_type = stored["system_type"]
    auth_type = body.auth_type or stored["auth_type"]
    # A changed endpoint never receives a stored secret: it could be an attacker's host.
    changed = _endpoint_changes(stored, body)
    if changed:
        missing = _missing_secrets(stored, system_type, auth_type, body.credentials)
        if missing:
            raise HTTPException(status_code=422, detail=_reenter_message(changed, missing))

    from api.services.credential_store import decrypt_password

    secrets: dict[str, str] = {}
    for key in _SECRET_KEYS:
        typed = body.credentials.get(key, "")
        if typed or changed:
            secrets[key] = typed
            continue
        try:
            secrets[key] = decrypt_password(str(tenant.id), stored[key]) if stored[key] else ""
        except Exception:
            return TestConnectionResponse(connected=False, message="Failed to decrypt the stored credentials")

    # The type is the stored one (an edit cannot change it); an absent auth type keeps the stored one.
    draft = body.model_copy(update={"auth_type": auth_type})
    params = _draft_params(draft, system_type, secrets)
    _require_endpoint_fields(system_type, params)
    return await _run_connection_test(system_type, params, [secrets["password"], secrets["client_secret"], secrets["api_key"]])


@router.post("/systems/{system_id}/test", response_model=TestConnectionResponse)
async def test_connection(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_systems", scope=scope_from_path)),
):
    """Test the connection to an SAP system, for any system_type. Admin and Steward only."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    # LEFT JOIN — cloud systems using pure OAuth client-credentials never get a
    # system_credentials row, so an INNER JOIN here would 404 a system that exists.
    result = await db.execute(
        text("""
            SELECT s.system_type, s.host, s.client, s.sysnr, s.username, s.base_url, s.company_id,
                   s.auth_type, s.client_id_encrypted, s.client_secret_encrypted,
                   s.api_key_encrypted, sc.encrypted_password, s.token_url, s.discovery_status
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
     client_id_encrypted, client_secret_encrypted, api_key_encrypted, encrypted_password,
     token_url, discovery_status) = row

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
        "token_url": token_url or "",
    }
    result = await _run_connection_test(system_type, params, [password, client_secret, api_key])
    if result.connected and not discovery_status:
        enqueue_discovery(str(tenant.id), system_id)  # first successful connect → learn the design
    if result.connected:
        await enqueue_config_load(db, str(tenant.id), system_id)  # no-op once a load exists
    return result


def enqueue_discovery(tenant_id: str, system_id: str) -> Optional[str]:
    """Queue source-design discovery; never fails the calling request."""
    try:
        from workers.tasks.run_discovery import discover_system
        return discover_system.delay(tenant_id, system_id).id
    except Exception as e:
        logger.warning(f"could not enqueue discovery for {system_id}: {e}")
        return None


@router.post("/systems/{system_id}/sync")
async def trigger_sync(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("trigger_sync", scope=scope_from_path)),
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
    role: str = Depends(require_permission("manage_systems", scope=scope_from_path)),
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
            INSERT INTO sync_profiles (id, tenant_id, system_id, domain, tables, schedule_cron, active, extraction_mode)
            VALUES (gen_random_uuid(), :tid, :sid, :domain, :tables, :cron, :active, :mode)
            RETURNING id, system_id, domain, tables, schedule_cron, active,
                      last_run_at::text, next_run_at::text, extraction_mode
        """),
        {
            "tid": str(tenant.id),
            "sid": system_id,
            "domain": body.domain,
            "tables": body.tables,
            "cron": body.schedule_cron,
            "active": body.active,
            "mode": body.extraction_mode,
        },
    )
    row = result.fetchone()
    await db.commit()

    return SyncProfileResponse(
        id=str(row[0]), system_id=str(row[1]), domain=row[2],
        tables=row[3], schedule_cron=row[4], active=row[5],
        last_run_at=row[6], next_run_at=row[7], extraction_mode=row[8] or "full",
    )


@router.get("/systems/{system_id}/profiles", response_model=list[SyncProfileResponse])
async def list_sync_profiles(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    """List sync profiles for a system."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    result = await db.execute(
        text("""
            SELECT id, system_id, domain, tables, schedule_cron, active,
                   last_run_at::text, next_run_at::text, extraction_mode
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
            last_run_at=r[6], next_run_at=r[7], extraction_mode=r[8] or "full",
        )
        for r in rows
    ]


@router.patch("/systems/{system_id}/profiles/{profile_id}", response_model=SyncProfileResponse)
async def update_sync_profile(
    system_id: str,
    profile_id: str,
    body: UpdateSyncProfileRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("manage_systems", scope=scope_from_path)),
):
    """Change a profile's re-evaluation schedule or pause it. The next run is
    recomputed from the new cron so a change never fires an immediate sync."""
    from croniter import croniter
    from workers.scheduler import _compute_next_run

    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    sets, params = [], {"pid": profile_id, "sid": system_id, "tid": str(tenant.id)}
    if body.schedule_cron is not None:
        cron = body.schedule_cron.strip() or None
        if cron and not croniter.is_valid(cron):
            raise HTTPException(status_code=422, detail="Invalid cron expression")
        sets += ["schedule_cron = :cron", "next_run_at = :next"]
        params |= {"cron": cron, "next": _compute_next_run(cron) if cron else None}
    if body.active is not None:
        sets.append("active = :active")
        params["active"] = body.active
    if body.extraction_mode is not None:
        sets.append("extraction_mode = :mode")
        params["mode"] = body.extraction_mode
    if not sets:
        raise HTTPException(status_code=422, detail="Nothing to update")

    row = (await db.execute(
        text(f"""
            UPDATE sync_profiles SET {", ".join(sets)}
            WHERE id = :pid AND system_id = :sid AND tenant_id = :tid
            RETURNING id, system_id, domain, tables, schedule_cron, active,
                      last_run_at::text, next_run_at::text, extraction_mode
        """),
        params,
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Sync profile not found")
    await db.commit()
    return SyncProfileResponse(
        id=str(row[0]), system_id=str(row[1]), domain=row[2],
        tables=row[3], schedule_cron=row[4], active=row[5],
        last_run_at=row[6], next_run_at=row[7], extraction_mode=row[8] or "full",
    )


# ── Sync Runs ────────────────────────────────────────────────────────────────


@router.get("/systems/{system_id}/runs", response_model=list[SyncRunResponse])
async def list_sync_runs(
    system_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view", scope=scope_from_path)),
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
