"""Write-back to SAP — apply deterministic fixes via BAPI with 4-eyes approval.

Rules (non-negotiable):
- Only apply fixes where sql_statement is populated (deterministic fixes only)
- NEVER apply LLM-generated fix_instructions directly to SAP
- dry_run=True validates BAPIs without committing
- Every write-back is logged to write_back_log
- 4-eyes: requesting_user != approving_user
"""

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

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


def _require_user(request: Request) -> str:
    """Return the authenticated user id, or fail closed.

    The 4-eyes control over SAP writes is only meaningful if requester and
    approver are the REAL users — never a synthetic per-tenant constant.
    """
    user_id = getattr(request.state, "local_user_id", None)
    if not user_id:
        raise HTTPException(status_code=403, detail="Authentication required")
    return str(user_id)


@router.post(
    "/writeback",
    response_model=WriteBackResponse,
    dependencies=[Depends(require_permission("apply"))],
)
async def create_writeback(
    request: Request,
    body: WriteBackRequest,
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

    # Requesting user — the real authenticated user, so 4-eyes can compare it
    # against the approver at approval time.
    requesting_user = _require_user(request)

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


@router.post(
    "/writeback/approve/{approval_id}",
    response_model=ApprovalResponse,
    dependencies=[Depends(require_permission("approve"))],
)
async def approve_writeback(
    request: Request,
    approval_id: str,
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

    # 4-eyes: approving user must differ from requesting user
    approving_user = _require_user(request)
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
        # Execute via SAP connector. Resolve REAL credentials from the
        # registered on-prem SAP system matching this write-back's host —
        # never fabricate a user/password (the old "WRITEBACK"/"****" literals
        # could never connect). Decrypted only here, at execution time.
        from sap import get_connector
        from sap.base import SAPConnectionParams, SAPConnectorError, BAPICall

        sys_result = await db.execute(
            text("""
                SELECT s.client, s.sysnr, c.encrypted_password
                FROM sap_systems s
                JOIN system_credentials c ON c.system_id = s.id
                WHERE s.tenant_id = :tid AND s.host = :host
                  AND s.system_type IN ('ecc', 's4hana_onprem', 'ewm')
                LIMIT 1
            """),
            {"tid": tenant_id, "host": record[4]},
        )
        sys_row = sys_result.fetchone()
        if not sys_row:
            errors.append(
                "No registered SAP system with stored credentials for this host "
                "— register and connect the system before write-back"
            )
        else:
            from api.services.credential_store import decrypt_password

            params = SAPConnectionParams(
                host=record[4],   # sap_host from write_back_log
                client=sys_row[0] or "",
                sysnr=sys_row[1] or "",
                user=os.getenv("SAP_RFC_USER", "RFC_USER"),
                password=decrypt_password(tenant_id, sys_row[2]),
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
