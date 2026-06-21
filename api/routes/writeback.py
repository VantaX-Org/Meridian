"""Write-back to SAP — apply deterministic fixes via BAPI with 4-eyes approval.

Rules (non-negotiable):
- Only apply fixes where sql_statement is populated (deterministic fixes only)
- NEVER apply LLM-generated fix_instructions directly to SAP
- dry_run=True validates BAPIs without committing
- Every write-back is logged to write_back_log
- 4-eyes: requesting_user != approving_user
"""

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

router = APIRouter(prefix="/api/v1", tags=["writeback"])
logger = logging.getLogger("meridian.writeback")

# BAPI mapping for ECC module write-back.
# SuccessFactors modules use OData APIs (not RFC BAPIs) — excluded intentionally.
# Warehouse modules may use RFC but with specialised function modules — extend as needed.
BAPI_MAP = {
    "business_partner": "BAPI_BUPA_CENTRAL_DATA_SET",
    "material_master": "BAPI_MATERIAL_SAVEDATA",
    "fi_gl": "BAPI_GL_ACCOUNT_CREATE",
    "accounts_payable": "BAPI_VENDOR_CHANGEFROMDATA",
    "accounts_receivable": "BAPI_CUSTOMER_CHANGEFROMDATA1",
    "asset_accounting": "BAPI_FIXEDASSET_CHANGE",
    "mm_purchasing": "BAPI_PO_CHANGE",
    "plant_maintenance": "BAPI_EQUI_CHANGE",
    "production_planning": "BAPI_PRODORD_CHANGE",
    "sd_customer_master": "BAPI_CUSTOMER_CHANGEFROMDATA1",
    "sd_sales_orders": "BAPI_SALESORDER_CHANGE",
}


class SAPConnection(BaseModel):
    host: str
    client: str
    user: str
    password: str = Field(..., description="NEVER logged or stored")
    sysnr: str


class WriteBackRequest(BaseModel):
    finding_id: str
    record_fixes: list[dict] = Field(
        ..., description="Only fixes with sql_statement are applied"
    )
    sap_connection: SAPConnection
    dry_run: bool = Field(
        True, description="ALWAYS defaults to dry-run — explicit false required"
    )


class WriteBackResponse(BaseModel):
    applied: int
    skipped: int
    errors: list[str]
    dry_run: bool
    pending_approval_id: Optional[str] = None


class ApprovalResponse(BaseModel):
    applied: int
    errors: list[str]
    status: str


def _mask_password(msg: str, password: str) -> str:
    if password:
        msg = msg.replace(password, "****")
    return msg


@router.post("/writeback", response_model=WriteBackResponse)
async def create_writeback(
    body: WriteBackRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Create a pending write-back request. Requires 4-eyes approval to execute."""
    tenant_id = str(tenant.id)

    # Set RLS context
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

    # Validate finding exists
    result = await db.execute(
        text("SELECT id, module, record_fixes FROM findings WHERE id = :fid AND tenant_id = :tid"),
        {"fid": body.finding_id, "tid": tenant_id},
    )
    finding = result.fetchone()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    module = finding[1]

    # Filter: only fixes with sql_statement (deterministic fixes only)
    valid_fixes = []
    skipped = 0
    for fix in body.record_fixes:
        if fix.get("sql_statement"):
            valid_fixes.append(fix)
        else:
            skipped += 1
            logger.info(f"Skipping fix without sql_statement: {fix.get('field', 'unknown')}")

    if not valid_fixes:
        return WriteBackResponse(
            applied=0,
            skipped=skipped,
            errors=["No fixes with sql_statement found — nothing to apply"],
            dry_run=body.dry_run,
            pending_approval_id=None,
        )

    # Acting user identity from the auth proxy (x-user-id). Falls back to a
    # tenant-scoped marker only in local/dev where no per-user header exists.
    requesting_user = request.headers.get("x-user-id") or f"tenant:{tenant_id}"

    # Dry run: validate BAPIs can be called
    errors: list[str] = []
    if body.dry_run:
        bapi = BAPI_MAP.get(module)
        if not bapi:
            errors.append(f"No BAPI mapping for module '{module}' — write-back not supported")
        else:
            # Verify the configured connector backend is available
            from sap import get_connector
            from sap.base import SAPConnectorError
            try:
                _test_conn = get_connector()
            except Exception:
                errors.append("SAP connector not available — cannot validate BAPI calls")

        # Create pending write-back log entry
        log_id = str(uuid.uuid4())
        await db.execute(
            text("""
                INSERT INTO write_back_log
                    (id, tenant_id, finding_id, version_id, requested_by, dry_run,
                     records_updated, errors, sap_host, created_at)
                SELECT :log_id, :tid, :fid,
                    (SELECT version_id FROM findings WHERE id = :fid AND tenant_id = :tid),
                    :requested_by, true, :count, :errors, :host, now()
            """),
            {
                "log_id": log_id,
                "tid": tenant_id,
                "fid": body.finding_id,
                "requested_by": requesting_user,
                "count": len(valid_fixes),
                "errors": str(errors) if errors else None,
                "host": body.sap_connection.host,
            },
        )
        await db.commit()

        return WriteBackResponse(
            applied=0,
            skipped=skipped,
            errors=errors,
            dry_run=True,
            pending_approval_id=log_id,
        )

    # Non-dry-run: create pending approval record (4-eyes requirement)
    approval_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO write_back_log
                (id, tenant_id, finding_id, version_id, requested_by, dry_run,
                 records_updated, sap_host, created_at)
            SELECT :log_id, :tid, :fid,
                (SELECT version_id FROM findings WHERE id = :fid AND tenant_id = :tid),
                :requested_by, false, :count, :host, now()
        """),
        {
            "log_id": approval_id,
            "tid": tenant_id,
            "fid": body.finding_id,
            "requested_by": requesting_user,
            "count": len(valid_fixes),
            "host": body.sap_connection.host,
        },
    )
    await db.commit()

    logger.info(f"Write-back pending approval: {approval_id} ({len(valid_fixes)} fixes)")

    return WriteBackResponse(
        applied=0,
        skipped=skipped,
        errors=[],
        dry_run=False,
        pending_approval_id=approval_id,
    )


@router.post("/writeback/approve/{approval_id}", response_model=ApprovalResponse)
async def approve_writeback(
    approval_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Second user approves a pending write-back. Validates approving_user != requesting_user."""
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

    # Load the pending write-back
    result = await db.execute(
        text("""
            SELECT id, requested_by, approved_by, finding_id, sap_host, dry_run
            FROM write_back_log
            WHERE id = :aid AND tenant_id = :tid
        """),
        {"aid": approval_id, "tid": tenant_id},
    )
    record = result.fetchone()
    if not record:
        raise HTTPException(status_code=404, detail="Write-back request not found")

    if record[2]:  # approved_by already set
        raise HTTPException(status_code=409, detail="Write-back already approved")

    # 4-eyes: a real, distinct approver identity is required. Without a per-user
    # identity from the auth proxy the two-person rule cannot be enforced, so
    # fail closed rather than rubber-stamp a live SAP write.
    approving_user = request.headers.get("x-user-id")
    if not approving_user:
        raise HTTPException(
            status_code=403,
            detail="4-eyes: approver identity required",
        )
    if approving_user == record[1]:
        raise HTTPException(
            status_code=403,
            detail="4-eyes violation: approving user must differ from requesting user",
        )

    # Load the finding's record_fixes
    finding_result = await db.execute(
        text("SELECT module, record_fixes FROM findings WHERE id = :fid AND tenant_id = :tid"),
        {"fid": str(record[3]), "tid": tenant_id},
    )
    finding = finding_result.fetchone()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding no longer exists")

    module = finding[0]
    record_fixes = finding[1] or []

    # Filter to deterministic fixes only
    valid_fixes = [f for f in record_fixes if isinstance(f, dict) and f.get("sql_statement")]

    bapi = BAPI_MAP.get(module)
    errors: list[str] = []
    applied = 0

    if not bapi:
        errors.append(f"No BAPI mapping for module '{module}'")
    elif not valid_fixes:
        errors.append("No deterministic fixes available")
    else:
        # Execute via SAP connector
        import os

        from sap import get_connector
        from sap.base import SAPConnectionParams, SAPConnectorError, BAPICall
        from api.services.credential_store import decrypt_password

        # Resolve real connection params from the registered destination system.
        # Never write to a live SAP system with placeholder creds — fail closed
        # if the host isn't a registered on-prem RFC system with stored creds.
        sys_row = (await db.execute(
            text("""
                SELECT id, client, sysnr, system_type
                FROM sap_systems
                WHERE tenant_id = :tid AND host = :host
                  AND system_type IN ('ecc', 's4hana_onprem', 'ewm')
                LIMIT 1
            """),
            {"tid": tenant_id, "host": record[4]},
        )).fetchone()
        if not sys_row:
            raise HTTPException(
                status_code=409,
                detail="Write-back blocked: destination host is not a registered on-prem SAP system",
            )
        enc = (await db.execute(
            text("SELECT encrypted_password FROM system_credentials WHERE system_id = :sid"),
            {"sid": str(sys_row[0])},
        )).scalar()
        if not enc:
            raise HTTPException(
                status_code=409,
                detail="Write-back blocked: no stored credentials for destination system",
            )
        params = SAPConnectionParams(
            host=record[4],
            client=sys_row[1] or "100",
            sysnr=sys_row[2] or "00",
            user=os.getenv("SAP_RFC_USER", "RFC_USER"),
            password=decrypt_password(tenant_id, enc),
        )
        try:
            with get_connector() as conn:
                conn.connect(params)
                for fix in valid_fixes:
                    try:
                        conn.execute_bapi(BAPICall(
                            bapi_name=bapi,
                            params=fix.get("bapi_params", {}),
                        ))
                        applied += 1
                    except SAPConnectorError as e:
                        errors.append(f"BAPI call failed for {fix.get('field', '?')}: {str(e)}")
        except SAPConnectorError as e:
            if "pyrfc_not_installed" in str(e):
                errors.append("PyRFC not installed")
            else:
                errors.append(f"RFC connection failed: {str(e)}")

    # Update the log record
    await db.execute(
        text("""
            UPDATE write_back_log
            SET approved_by = :approver, applied_at = :now,
                records_updated = :applied, errors = :errors
            WHERE id = :aid AND tenant_id = :tid
        """),
        {
            "approver": approving_user,
            "now": datetime.now(timezone.utc),
            "applied": applied,
            "errors": str(errors) if errors else None,
            "aid": approval_id,
            "tid": tenant_id,
        },
    )
    await db.commit()

    status = "completed" if not errors else "completed_with_errors"
    logger.info(f"Write-back approved: {approval_id} — applied={applied}, errors={len(errors)}")

    return ApprovalResponse(applied=applied, errors=errors, status=status)
