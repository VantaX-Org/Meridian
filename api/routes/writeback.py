"""Write-back to SAP — apply deterministic fixes via BAPI with 4-eyes approval.

Rules (non-negotiable):
- Only apply fixes where sql_statement is populated (deterministic fixes only)
- NEVER apply LLM-generated fix_instructions directly to SAP
- dry_run=True reports, per field, whether a BAPI can carry it (sap/bapi_writeback.py) and why not
- Live execution simulates each record first (TESTRUN or no commit), then commits only when RETURN holds no
  E or A message, and records SAP's RETURN messages per record
- Every write-back is logged to write_back_log
- 4-eyes: requesting_user != approving_user
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_any_permission, require_permission

router = APIRouter(prefix="/api/v1", tags=["writeback"])
logger = logging.getLogger("meridian.writeback")

# BAPI per ECC module. The modules with field-level parameter mappings (material master, business partner,
# customer) are in sap/bapi_writeback.py, which builds, verifies against the connected system, simulates and
# commits each call. The others have no field mapping yet: every field of theirs is reported per field as
# "no BAPI mapping" and goes out through the export (LSMW / BAPI file) instead.
# SuccessFactors modules use OData APIs (not RFC BAPIs) — excluded intentionally.
BAPI_MAP = {
    "business_partner": "BAPI_BUPA_CENTRAL_CHANGE",
    "material_master": "BAPI_MATERIAL_SAVEDATA",
    "fi_gl": "BAPI_GL_ACCOUNT_CREATE",
    "accounts_receivable": "BAPI_CUSTOMER_CHANGEFROMDATA1",
    "asset_accounting": "BAPI_FIXEDASSET_CHANGE",
    "hcm": "HR_INFOTYPE_OPERATION",
    "mm_purchasing": "BAPI_PO_CHANGE",
    "plant_maintenance": "BAPI_EQUI_CHANGE",
    "production_planning": "BAPI_PRODORD_CHANGE",
    "sd_customer_master": "BAPI_CUSTOMER_CHANGEFROMDATA1",
    "sd_sales_orders": "BAPI_SALESORDER_CHANGE",
}


def _structured(fix) -> bool:
    """A structured auto_fix proposal: field, full record key and proposed value (never instruction text)."""
    return isinstance(fix, dict) and bool(fix.get("auto_fix") and fix.get("record_key")
                                          and fix.get("field") and fix.get("proposed_value") is not None)


def field_support(module: str, fix: dict) -> dict:
    """Whether a BAPI carries this fix's field for this record, which one, and why not: one honest line per field.
    ``delivery`` is "bapi" when live write-back can send it, else "export"."""
    from sap.bapi_writeback import plan_field

    plan = plan_field(module, str(fix.get("field") or ""), str(fix.get("record_key") or ""))
    return {"record_key": str(fix.get("record_key") or ""), "field": plan.field, "supported": plan.supported,
            "bapi": plan.bapi, "reason": plan.reason, "delivery": "bapi" if plan.supported else "export"}


class SAPConnection(BaseModel):
    host: str
    client: str
    user: str
    password: str = Field(..., description="NEVER logged or stored")
    sysnr: str


class WriteBackRequest(BaseModel):
    finding_id: uuid.UUID = Field(..., description="The finding (findings.id) whose record fixes are written back.")
    record_fixes: list[dict] = Field(
        ..., description="Only fixes with sql_statement are applied"
    )
    sap_connection: SAPConnection
    dry_run: bool = Field(
        True, description="ALWAYS defaults to dry-run — explicit false required"
    )


class FieldSupportOut(BaseModel):
    record_key: str
    field: str                       # TABLE.FIELD
    supported: bool                  # a BAPI mapping carries it
    bapi: Optional[str] = None
    reason: Optional[str] = None     # why not, as a sentence
    delivery: str                    # "bapi" (live write-back) | "export" (LSMW / BAPI file)


class RecordResultOut(BaseModel):
    record_key: str
    bapis: list[str] = []
    fields: list[str] = []
    simulated: bool = False
    simulate_messages: list[dict] = []   # RETURN of the test run: type, id, number, message
    applied: bool = False
    committed: bool = False
    messages: list[dict] = []            # RETURN of the real call and the commit
    error: Optional[str] = None


class WriteBackResponse(BaseModel):
    applied: int
    skipped: int
    errors: list[str]
    dry_run: bool
    pending_approval_id: Optional[str] = None
    # per field: whether live write-back can send it, through which BAPI, and why not
    fields: list[FieldSupportOut] = []


class ApprovalResponse(BaseModel):
    applied: int
    errors: list[str]
    status: str
    fields: list[FieldSupportOut] = []
    records: list[RecordResultOut] = []   # per record: simulation, call and commit, with SAP's RETURN messages


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
        {"fid": str(body.finding_id), "tid": tenant_id},
    )
    finding = result.fetchone()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    module = finding[1]

    # Filter: only structured auto_fix proposals (deterministic fixes only)
    valid_fixes = []
    skipped = 0
    for fix in body.record_fixes:
        if _structured(fix):
            valid_fixes.append(fix)
        else:
            skipped += 1
            logger.info(f"Skipping fix without sql_statement: {fix.get('field', 'unknown')}")

    if not valid_fixes:
        return WriteBackResponse(
            applied=0,
            skipped=skipped,
            errors=["No structured auto_fix proposals found — nothing to apply"],
            dry_run=body.dry_run,
            pending_approval_id=None,
        )

    # Requesting user — the real authenticated user, so 4-eyes can compare it
    # against the approver at approval time.
    requesting_user = _require_user(request)

    # Per field: can a BAPI carry it? Fields without a mapping are said so here, one by one.
    support = [field_support(module, f) for f in valid_fixes]
    errors: list[str] = []
    if not any(x["supported"] for x in support):
        errors.append(f"None of these fields has a BAPI mapping for '{module}'; deliver them with the export")
    if body.dry_run:
        # Verify the configured connector backend is available
        from sap import get_connector
        try:
            get_connector()
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
                    :requested_by, true, :count, CAST(:errors AS jsonb), :host, now()
            """),
            {
                "log_id": log_id,
                "tid": tenant_id,
                "fid": str(body.finding_id),
                "requested_by": requesting_user,
                "count": len(valid_fixes),
                "errors": json.dumps({"errors": errors}) if errors else None,
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
            fields=support,
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
            "fid": str(body.finding_id),
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
        errors=errors,
        dry_run=False,
        pending_approval_id=approval_id,
        fields=support,
    )


class PendingApproval(BaseModel):
    id: str
    finding_id: Optional[str] = None
    version_id: Optional[str] = None
    requested_by: Optional[str] = None
    records_updated: int = 0
    sap_host: Optional[str] = None
    created_at: Optional[str] = None
    # Named here so an approver reads the rule and the requester without the findings or users APIs, which a data
    # owner may not hold (`assign`, `manage_users`); before, the inbox showed a bare finding id and "Unknown user".
    check_id: Optional[str] = None
    module: Optional[str] = None
    rule_message: Optional[str] = None
    requested_by_name: Optional[str] = None


class PendingApprovalList(BaseModel):
    approvals: list[PendingApproval]
    live_enabled: bool


@router.get(
    "/writeback/approvals",
    response_model=PendingApprovalList,
    dependencies=[Depends(require_permission("approve"))],
)
async def list_pending_writebacks(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Live write-back requests still waiting for a second user (newest first)."""
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{tenant_id}\'"))
    result = await db.execute(
        text("""
            SELECT w.id, w.finding_id, w.version_id, w.requested_by, w.records_updated, w.sap_host, w.created_at,
                   f.check_id, f.module, COALESCE(f.details->>'message', f.rule_context->>'message'), COALESCE(NULLIF(u.name, ''), u.email)
            FROM write_back_log w
            LEFT JOIN findings f ON f.id = w.finding_id AND f.tenant_id = w.tenant_id
            LEFT JOIN users u ON u.id::text = w.requested_by AND u.tenant_id = w.tenant_id
            WHERE w.tenant_id = :tid AND w.dry_run = false AND w.approved_by IS NULL
            ORDER BY w.created_at DESC
            LIMIT 200
        """),
        {"tid": tenant_id},
    )
    from api.config import settings
    return PendingApprovalList(
        approvals=[
            PendingApproval(
                id=str(r[0]), finding_id=str(r[1]) if r[1] else None, version_id=str(r[2]) if r[2] else None,
                requested_by=str(r[3]) if r[3] else None, records_updated=r[4] or 0, sap_host=r[5],
                created_at=r[6].isoformat() if r[6] else None,
                check_id=r[7], module=r[8], rule_message=r[9] or None, requested_by_name=r[10] or None,
            )
            for r in result.fetchall()
        ],
        live_enabled=bool(settings.live_writeback_enabled),
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

    if record[5]:  # dry_run — a validation-only request can never be executed
        raise HTTPException(status_code=409, detail="This was a dry-run request; submit a new write-back to execute")

    from api.config import settings
    if not settings.live_writeback_enabled:
        raise HTTPException(
            status_code=409,
            detail="Live SAP write-back is off on this deployment (setting MERIDIAN_LIVE_WRITEBACK_ENABLED). "
                   "Until an administrator turns it on, deliver the fixes with the export (LSMW / BAPI file) "
                   "from the finding or cleaning queue.",
        )

    from api.services.sandbox import held_back
    if await held_back(db, tenant_id, "write_back", "bapi", approval_id):  # sandbox mode: nothing leaves (115)
        await db.commit()
        raise HTTPException(status_code=409, detail="Sandbox mode is on: nothing is written back to SAP. "
                                                    "Exit the sandbox to apply this write-back.")

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
    valid_fixes = [f for f in record_fixes if _structured(f)]

    support = [field_support(module, f) for f in valid_fixes]
    errors: list[str] = []
    applied = 0
    records: list[dict] = []
    # record_key -> {TABLE.FIELD: proposed value}, only the fields a BAPI carries
    by_record: dict[str, dict] = {}
    for fix, sup in zip(valid_fixes, support):
        if sup["supported"]:
            by_record.setdefault(sup["record_key"], {})[sup["field"]] = fix["proposed_value"]
    unsupported = [x for x in support if not x["supported"]]
    if unsupported:
        errors.append(f"{len(unsupported)} field(s) have no BAPI mapping and were not sent; deliver them with the "
                      "export (see fields)")

    if not valid_fixes:
        errors.append("No deterministic fixes available")
    elif not by_record:
        errors.append(f"No field of this finding has a BAPI mapping for '{module}'")
    else:
        # Execute via SAP connector. Resolve REAL credentials from the
        # registered on-prem SAP system matching this write-back's host —
        # never fabricate a user/password (the old "WRITEBACK"/"****" literals
        # could never connect). Decrypted only here, at execution time.
        from sap import get_connector
        from sap.base import SAPConnectionParams, SAPConnectorError

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

            def _apply() -> tuple[list[dict], list[str]]:
                """Synchronous RFC work on a worker thread (asyncio.to_thread): this handler is ``async def``,
                so calling it directly would block the event loop for every request for the whole round-trip."""
                try:
                    with get_connector() as conn:
                        conn.connect(params)
                        return apply_records(conn, module, by_record), []
                except SAPConnectorError as e:
                    if "pyrfc_not_installed" in str(e):
                        return [], ["PyRFC not installed"]
                    return [], [f"RFC connection failed: {e}"]

            records, conn_errors = await asyncio.to_thread(_apply)
            errors.extend(conn_errors)
            applied = sum(1 for r in records if r["committed"])
            for r in records:
                if r["error"]:
                    errors.append(f"{r['record_key']}: {r['error']}")
                elif not r["committed"]:
                    errors.append(f"{r['record_key']}: SAP refused the change; see its RETURN messages")

    # Update the log record
    await db.execute(
        text("""
            UPDATE write_back_log
            SET approved_by = :approver, applied_at = :now,
                records_updated = :applied, errors = CAST(:errors AS jsonb)
            WHERE id = :aid AND tenant_id = :tid
        """),
        {
            "approver": approving_user,
            "now": datetime.now(timezone.utc),
            "applied": applied,
            # per record: the simulation and the call with SAP's RETURN messages; no field values
            "errors": json.dumps({"errors": errors, "records": records}) if errors or records else None,
            "aid": approval_id,
            "tid": tenant_id,
        },
    )
    await db.commit()

    status = "completed" if not errors else "completed_with_errors"
    logger.info(f"Write-back approved: {approval_id} — applied={applied}, errors={len(errors)}")

    return ApprovalResponse(applied=applied, errors=errors, status=status, fields=support, records=records)


def apply_records(conn, module: str, by_record: dict[str, dict]) -> list[dict]:
    """Simulate then write each record (sap/bapi_writeback.py write_record) on one connection; per-record
    results with SAP's RETURN messages. The interface of each BAPI is read once per run."""
    from sap.bapi_writeback import write_record

    cache: dict = {}
    return [write_record(conn, module, key, changes, apply=True, cache=cache).as_dict()
            for key, changes in by_record.items()]


# ── An approved fix batch, written back on screen ─────────────────────────────
# The batch inspector's "Send to SAP" when live write-back is on (MERIDIAN_LIVE_WRITEBACK_ENABLED): first a check
# (which fields a BAPI carries and why not, nothing sent), then the send by an approver who did not build the batch.
# The four eyes are the batch's own: a second person approved it, and its creator may never send it (as with the
# load-file export). Values come from the approved batch items, never from the request.


class BatchCheckResponse(BaseModel):
    batch_id: str
    live_enabled: bool
    records: int                       # records with a proposed value
    bapi: int                          # fields a BAPI carries
    export_only: int                   # fields that go out with the export instead
    fields: list[FieldSupportOut] = []
    errors: list[str] = []


class BatchSendResponse(BaseModel):
    batch_id: str
    status: str                        # completed | completed_with_errors
    sent: int                          # records SAP committed
    failed: int                        # records SAP refused or that could not be sent
    export_only: int                   # fields left for the export
    errors: list[str] = []
    fields: list[FieldSupportOut] = []
    records: list[RecordResultOut] = []  # per record: simulation, call and commit, with SAP's RETURN messages


_LIVE_OFF = ("Live SAP write-back is off on this deployment (setting MERIDIAN_LIVE_WRITEBACK_ENABLED). Until an "
             "administrator turns it on, deliver the fixes with the export (LSMW / BAPI file).")


async def _approved_batch(db: AsyncSession, tenant: Tenant, batch_id: uuid.UUID) -> tuple[dict, list[dict]]:
    """The batch and its items with a proposed value; 409 unless it is approved (or already sent)."""
    from api.routes.remediation import _batch, _items

    b = await _batch(db, tenant, batch_id)
    if b["status"] == "draft":
        raise HTTPException(status_code=409, detail="Approve the batch before sending it to SAP.")
    items = [i for i in await _items(db, batch_id) if i.get("field") and i.get("proposed_value") is not None]
    return b, items


def _batch_support(items: list[dict]) -> list[dict]:
    return [field_support(i["module"], {"field": i["field"], "record_key": i["record_key"]}) for i in items]


@router.post(
    "/writeback/batches/{batch_id}/check",
    response_model=BatchCheckResponse,
    dependencies=[Depends(require_any_permission("apply", "approve"))],
)
async def check_batch_writeback(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Check with SAP: per field of the approved batch, whether a BAPI carries it, which, and why not. Sends nothing."""
    from api.config import settings

    _, items = await _approved_batch(db, tenant, batch_id)
    support = _batch_support(items)
    errors: list[str] = []
    if not items:
        errors.append("No record of this batch has a proposed value; there is nothing to send")
    elif not any(x["supported"] for x in support):
        errors.append("None of these fields has a BAPI mapping; deliver them with the export")
    from sap import get_connector
    try:
        get_connector()
    except Exception:
        errors.append("SAP connector not available on this deployment; the send would fail")
    return BatchCheckResponse(
        batch_id=str(batch_id), live_enabled=bool(settings.live_writeback_enabled),
        records=len({(i["module"], i["record_key"]) for i in items}),
        bapi=sum(1 for x in support if x["supported"]), export_only=sum(1 for x in support if not x["supported"]),
        fields=support, errors=errors,
    )


@router.post(
    "/writeback/batches/{batch_id}/send",
    response_model=BatchSendResponse,
    dependencies=[Depends(require_permission("approve"))],
)
async def send_batch_writeback(
    request: Request,
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Send an approved batch to SAP: each record simulated, then committed only when SAP's RETURN holds no E or A
    message. Fields without a BAPI mapping are not sent and stay for the export. The batch becomes Sent to SAP once
    SAP has committed a record."""
    from api.config import settings
    from api.routes.remediation import _event

    tenant_id = str(tenant.id)
    if not settings.live_writeback_enabled:
        raise HTTPException(status_code=409, detail=_LIVE_OFF)
    b, items = await _approved_batch(db, tenant, batch_id)
    user = _require_user(request)
    if b.get("created_by") and str(b["created_by"]) == user:
        raise HTTPException(status_code=403, detail="The batch creator cannot send it to SAP; a second person sends it.")
    from api.services.sandbox import held_back
    if await held_back(db, tenant_id, "write_back", "bapi", str(batch_id)):
        await db.commit()
        raise HTTPException(status_code=409, detail="Sandbox mode is on: nothing is written back to SAP. "
                                                    "Exit the sandbox to send this batch.")

    support = _batch_support(items)
    errors: list[str] = []
    # (system, module) -> record_key -> {TABLE.FIELD: proposed value}, only the fields a BAPI carries
    groups: dict[tuple[str, str], dict[str, dict]] = {}
    for item, sup in zip(items, support):
        if sup["supported"]:
            groups.setdefault((str(item["scope"]), item["module"]), {}).setdefault(item["record_key"], {})[
                sup["field"]] = item["proposed_value"]
    export_only = sum(1 for x in support if not x["supported"])
    if export_only:
        errors.append(f"{export_only} field(s) have no BAPI mapping and were not sent; deliver them with the export")
    if not groups:
        errors.append("No field of this batch has a BAPI mapping")

    records: list[dict] = []
    for (system_id, module), by_record in groups.items():
        row = (await db.execute(text("""
            SELECT s.host, s.client, s.sysnr, c.encrypted_password
              FROM sap_systems s JOIN system_credentials c ON c.system_id = s.id
             WHERE s.tenant_id = :tid AND CAST(s.id AS text) = :sid
               AND s.system_type IN ('ecc', 's4hana_onprem', 'ewm')
             LIMIT 1"""), {"tid": tenant_id, "sid": system_id})).fetchone()
        if not row:
            msg = "No registered SAP system with stored credentials holds these records; deliver them with the export"
            records += [{"record_key": k, "error": msg} for k in by_record]
            continue
        from api.services.credential_store import decrypt_password
        from sap import get_connector
        from sap.base import SAPConnectionParams, SAPConnectorError

        params = SAPConnectionParams(host=row[0], client=row[1] or "", sysnr=row[2] or "",
                                     user=os.getenv("SAP_RFC_USER", "RFC_USER"),
                                     password=decrypt_password(tenant_id, row[3]))

        def _apply(params=params, module=module, by_record=by_record) -> tuple[list[dict], Optional[str]]:
            try:
                with get_connector() as conn:
                    conn.connect(params)
                    return apply_records(conn, module, by_record), None
            except SAPConnectorError as e:
                return [], "PyRFC not installed" if "pyrfc_not_installed" in str(e) else f"RFC connection failed: {e}"

        done, err = await asyncio.to_thread(_apply)
        records += done or [{"record_key": k, "error": err} for k in by_record]

    out = [RecordResultOut(**r) for r in records]
    sent = sum(1 for r in out if r.committed)
    failed = len(out) - sent
    for r in out:
        if r.error:
            errors.append(f"{r.record_key}: {r.error}")
        elif not r.committed:
            errors.append(f"{r.record_key}: SAP refused the change; see its RETURN messages")
    if sent:
        await db.execute(text("UPDATE remediation_batches SET status = 'exported', exported_at = now() "
                              "WHERE id = :id AND tenant_id = :tid"), {"id": batch_id, "tid": tenant_id})
        await _event(db, tenant, batch_id, "exported", request, to_value="bapi")
        from api.services import webhooks, worklist
        await db.run_sync(lambda s: worklist.refresh_batch(s, tenant_id, batch_id))
        await db.run_sync(lambda s: webhooks.batch_event(s, tenant_id, str(batch_id), "batch.sent"))
    await db.commit()
    logger.info(f"Batch write-back {batch_id}: sent={sent}, failed={failed}, export_only={export_only}")
    return BatchSendResponse(batch_id=str(batch_id), status="completed" if not errors else "completed_with_errors",
                             sent=sent, failed=failed, export_only=export_only, errors=errors, fields=support,
                             records=out)
