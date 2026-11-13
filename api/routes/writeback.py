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
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import current_user_label, require_any_permission, require_permission

router = APIRouter(prefix="/api/v1", tags=["writeback"])
logger = logging.getLogger("meridian.writeback")

# BAPI per ECC module. The modules with field-level parameter mappings (material master, business partner,
# customer, and vendor through its business partner where the system has CVI) are in sap/bapi_writeback.py, which builds, verifies against the connected system, simulates and
# commits each call. The others have no field mapping yet: every field of theirs is reported per field as
# "no BAPI mapping" and goes out through the export (LSMW / BAPI file) instead.
# SuccessFactors modules use OData APIs (not RFC BAPIs) — excluded intentionally.
BAPI_MAP = {
    "business_partner": "BAPI_BUPA_CENTRAL_CHANGE",
    "accounts_payable": "BAPI_BUPA_CENTRAL_CHANGE",  # the vendor's business partner (CVI); else export
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


class WriteBackRequest(BaseModel):
    finding_id: uuid.UUID = Field(..., description="The finding (findings.id) whose record fixes are written back.")
    record_fixes: list[dict] = Field(
        ..., description="Only fixes with sql_statement are applied"
    )
    # The registered SAP system to write to. Its credentials stay in the credential store; the request never
    # carries a user or password (as the batch write-back route).
    system_id: uuid.UUID = Field(..., description="The registered SAP system (sap_systems.id) to write back to.")
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
    export: list[dict] = []              # fields the system could not take by BAPI ({field, reason}): export


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

    system = await _system_params(db, tenant_id, str(body.system_id))
    if system is None:
        raise HTTPException(status_code=404, detail="No registered SAP system with stored credentials has this id; "
                                                    "register and connect the system before write-back")

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
                "host": system.host,
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
            "host": system.host,
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
            WHERE w.tenant_id = :tid AND w.dry_run = false AND w.approved_by IS NULL AND w.rejected_at IS NULL
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
            SELECT id, requested_by, approved_by, finding_id, sap_host, dry_run, rejected_at
            FROM write_back_log
            WHERE id = :aid AND tenant_id = :tid
            FOR UPDATE
        """),
        {"aid": approval_id, "tid": tenant_id},
    )
    record = result.fetchone()
    if not record:
        raise HTTPException(status_code=404, detail="Write-back request not found")

    if record[2]:  # approved_by already set (the row is locked, so two approvers cannot both pass)
        raise HTTPException(status_code=409, detail="Write-back already approved")

    if record[6]:
        raise HTTPException(status_code=409, detail="This write-back request was rejected; submit a new one")

    if record[5]:  # dry_run — a validation-only request can never be executed
        raise HTTPException(status_code=409, detail="This was a dry-run request; submit a new write-back to execute")

    # 4-eyes: approving user must differ from requesting user (checked before the deployment switches, so the
    # requester always hears that a second person is needed)
    approving_user = _require_user(request)
    if approving_user == record[1]:
        raise HTTPException(
            status_code=403,
            detail="4-eyes violation: approving user must differ from requesting user",
        )

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
        from sap.base import SAPConnectionParams, SAPConnectorError, rfc_route_params, rfc_user

        sys_result = await db.execute(
            text("""
                SELECT s.client, s.sysnr, c.encrypted_password, s.saprouter, s.snc_mode, s.snc_partnername,
                       s.snc_qop, s.snc_myname, s.username
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
                user=rfc_user(sys_row),
                password=decrypt_password(tenant_id, sys_row[2]),
                **rfc_route_params(sys_row),
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
            errors.extend(record_errors(records, support))

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
    from api.services.rbac import write_audit
    await write_audit(db, tenant.id, request, "writeback.approve", "write_back_log", approval_id,
                      {"requested_by": record[1]}, {"approved_by": approving_user, "applied": applied, "errors": len(errors)})
    await db.commit()

    status = "completed" if not errors else "completed_with_errors"
    logger.info(f"Write-back approved: {approval_id} — applied={applied}, errors={len(errors)}")

    return ApprovalResponse(applied=applied, errors=errors, status=status, fields=support, records=records)


def record_errors(records: list[dict], support: list[dict]) -> list[str]:
    """One line per record that was not committed, and the fields the connected system sent to the export instead
    (a vendor that is no business partner there): ``support`` is updated in place so fields[] says so."""
    errors: list[str] = []
    moved = 0
    for r in records:
        for x in r.get("export") or []:
            for sup in support:
                if sup["record_key"] == r["record_key"] and sup["field"] == x["field"] and sup["supported"]:
                    sup.update(supported=False, delivery="export", reason=x["reason"])
                    moved += 1
        if r.get("error"):
            errors.append(f"{r['record_key']}: {r['error']}")
        elif r.get("fields") and not r.get("committed"):
            errors.append(f"{r['record_key']}: SAP refused the change; see its RETURN messages")
    if moved:
        errors.append(f"{moved} field(s) could not go by BAPI on this system and were not sent; deliver them with "
                      "the export (see fields)")
    return errors


def record_failed(r: dict) -> bool:
    """Not committed although something was to be sent (a record whose fields all went to the export is not)."""
    return bool(r.get("error")) or (bool(r.get("fields")) and not r.get("committed"))


def resolve_vendors(conn, by_record: dict[str, list[str]]) -> dict[str, dict[str, str]]:
    """record_key -> {field: reason} for the vendor fields the connected system cannot take by BAPI (read only)."""
    from sap.bapi_writeback import resolve_vendor

    cache: dict = {}
    return {key: resolve_vendor(conn, key, fields, cache)[1] for key, fields in by_record.items()}


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


class RunCounts(BaseModel):
    pending: int = 0
    sending: int = 0
    committed: int = 0
    failed: int = 0
    needs_check: int = 0              # SAP may hold the change: check it in SAP before sending the record again
    export_only: int = 0


class RunOut(BaseModel):
    """A batch's send to SAP, which runs in the background in chunks (workers/tasks/run_batch_writeback.py)."""
    id: str
    batch_id: str
    status: str                       # queued | running | paused | cancelling | completed | completed_with_errors | cancelled
    pause_reason: Optional[str] = None
    records: int                      # records the run sends
    counts: RunCounts
    export_only_fields: int           # fields without a BAPI: they stay for the export
    errors: list[str] = []
    stale: bool = False               # open, but no worker has reported for a long time: Resume takes it over
    requested_label: Optional[str] = None
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class RunRecordOut(BaseModel):
    record_key: str
    description: Optional[str] = None  # the record's name in the work list
    module: str
    state: str
    fields: list[str] = []
    error: Optional[str] = None
    messages: list[dict] = []          # SAP's RETURN messages: the test run first, then the call and commit
    attempts: int = 0


class RunRecordsPage(BaseModel):
    items: list[RunRecordOut]
    total: int
    limit: int
    offset: int


class RetryRequest(BaseModel):
    include_needs_check: bool = Field(False, description="also requeue the records marked needs_check; only after "
                                                         "someone has looked in SAP and found the change not there")


_LIVE_OFF = ("Live SAP write-back is off on this deployment (setting MERIDIAN_LIVE_WRITEBACK_ENABLED). Until an "
             "administrator turns it on, deliver the fixes with the export (LSMW / BAPI file).")


async def _approved_batch(db: AsyncSession, tenant: Tenant, batch_id: uuid.UUID) -> tuple[dict, list[dict]]:
    """The batch and its items with a proposed value; 409 unless it is approved (or already sent)."""
    from api.routes.remediation import _batch, _items

    from api.services.remediation import has_value

    b = await _batch(db, tenant, batch_id)
    if b["status"] == "draft":
        raise HTTPException(status_code=409, detail="Approve the batch before sending it to SAP.")
    # a change without a new value (blank, or a placeholder such as "no value yet") is never sent (F12)
    items = [i for i in await _items(db, batch_id) if i.get("field") and has_value(i.get("proposed_value"))]
    return b, items


def _batch_support(items: list[dict]) -> list[dict]:
    return [field_support(i["module"], {"field": i["field"], "record_key": i["record_key"]}) for i in items]


async def _system_params(db: AsyncSession, tenant_id: str, system_id: str):
    """Connection parameters of a registered ABAP system with stored credentials, or None."""
    row = (await db.execute(text("""
        SELECT s.host, s.client, s.sysnr, c.encrypted_password, s.saprouter, s.snc_mode, s.snc_partnername,
               s.snc_qop, s.snc_myname, s.username
          FROM sap_systems s JOIN system_credentials c ON c.system_id = s.id
         WHERE s.tenant_id = :tid AND CAST(s.id AS text) = :sid
           AND s.system_type IN ('ecc', 's4hana_onprem', 'ewm')
         LIMIT 1"""), {"tid": tenant_id, "sid": system_id})).fetchone()
    if not row:
        return None
    from api.services.credential_store import decrypt_password
    from sap.base import SAPConnectionParams, rfc_route_params, rfc_user

    return SAPConnectionParams(host=row[0], client=row[1] or "", sysnr=row[2] or "",
                               user=rfc_user(row), password=decrypt_password(tenant_id, row[3]),
                               **rfc_route_params(row))


async def _check_vendors(db: AsyncSession, tenant_id: str, items: list[dict], support: list[dict]) -> list[str]:
    """Vendor fields a BAPI may carry: ask the connected system (read only) whether each vendor is a business partner
    there, and move the fields it cannot take to the export with the reason. Other objects need no lookup."""
    from sap import get_connector
    from sap.base import SAPConnectorError

    # system -> record_key -> fields
    groups: dict[str, dict[str, list[str]]] = {}
    for item, sup in zip(items, support):
        if item["module"] == "accounts_payable" and sup["supported"]:
            groups.setdefault(str(item["scope"]), {}).setdefault(item["record_key"], []).append(sup["field"])
    errors: list[str] = []
    for system_id, by_record in groups.items():
        params = await _system_params(db, tenant_id, system_id)
        if params is None:
            errors.append("No registered SAP system with stored credentials holds these vendors; the send cannot "
                          "check them")
            continue

        def _probe(params=params, by_record=by_record) -> tuple[dict, Optional[str]]:
            try:
                with get_connector() as conn:
                    conn.connect(params)
                    return resolve_vendors(conn, by_record), None
            except SAPConnectorError as e:
                return {}, f"RFC connection failed: {e}"

        found, err = await asyncio.to_thread(_probe)
        if err:
            errors.append(f"Could not ask SAP whether these vendors are business partners ({err}); the send decides "
                          "per record")
            continue
        records = [{"record_key": k, "export": [{"field": f, "reason": r} for f, r in v.items()]}
                   for k, v in found.items()]
        errors += record_errors(records, support)
    return errors


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
    from sap import get_connector
    try:
        get_connector()
    except Exception:
        errors.append("SAP connector not available on this deployment; the send would fail")
    else:
        if settings.live_writeback_enabled:
            errors += await _check_vendors(db, str(tenant.id), items, support)
    if not items:
        errors.insert(0, "No record of this batch has a proposed value; there is nothing to send")
    elif not any(x["supported"] for x in support):
        errors.insert(0, "None of these fields has a BAPI mapping; deliver them with the export")
    return BatchCheckResponse(
        batch_id=str(batch_id), live_enabled=bool(settings.live_writeback_enabled),
        records=len({(i["module"], i["record_key"]) for i in items}),
        bapi=sum(1 for x in support if x["supported"]), export_only=sum(1 for x in support if not x["supported"]),
        fields=support, errors=errors,
    )


_OPEN = ("queued", "running", "paused", "cancelling")
_RUN_SQL = """
    SELECT r.id::text AS id, r.batch_id::text AS batch_id, r.status, r.pause_reason, r.export_only, r.errors,
           r.requested_label, r.created_at, r.started_at, r.finished_at,
           (r.status IN ('queued', 'running', 'cancelling')
            AND COALESCE(r.heartbeat_at, r.created_at) < now() - make_interval(secs => :stale)) AS stale
      FROM writeback_runs r WHERE r.tenant_id = :tid AND r.batch_id = :bid
     ORDER BY r.created_at DESC LIMIT 1"""


async def _latest_run(db: AsyncSession, tenant: Tenant, batch_id: uuid.UUID) -> Optional[dict]:
    from api.config import settings
    from api.routes.remediation import _rls

    await _rls(db, tenant)
    row = (await db.execute(text(_RUN_SQL), {"tid": str(tenant.id), "bid": batch_id,
                                             "stale": settings.writeback_stale_seconds})).mappings().fetchone()
    return dict(row) if row else None


async def _run_out(db: AsyncSession, tenant: Tenant, run: dict) -> RunOut:
    rows = (await db.execute(text("SELECT state, count(*) FROM writeback_run_records WHERE run_id = :r "
                                  "AND tenant_id = :tid GROUP BY state"),
                             {"r": run["id"], "tid": str(tenant.id)})).fetchall()
    c = {k: int(n) for k, n in rows}
    errs = run["errors"] or []
    return RunOut(id=run["id"], batch_id=run["batch_id"], status=run["status"], pause_reason=run["pause_reason"],
                  records=sum(c.values()), counts=RunCounts(**c), export_only_fields=int(run["export_only"] or 0),
                  errors=errs if isinstance(errs, list) else [], stale=bool(run["stale"]),
                  requested_label=run["requested_label"], created_at=run["created_at"],
                  started_at=run["started_at"], finished_at=run["finished_at"])


async def _send_guards(request: Request, db: AsyncSession, tenant: Tenant, batch_id: uuid.UUID):
    """The guards of a send, in the request: live write-back on, approved batch, not its creator, no sandbox hold."""
    from api.config import settings
    from api.services.sandbox import held_back

    if not settings.live_writeback_enabled:
        raise HTTPException(status_code=409, detail=_LIVE_OFF)
    b, items = await _approved_batch(db, tenant, batch_id)
    user = _require_user(request)
    if b.get("created_by") and str(b["created_by"]) == user:
        raise HTTPException(status_code=403, detail="The batch creator cannot send it to SAP; a second person sends it.")
    if await held_back(db, str(tenant.id), "write_back", "bapi", str(batch_id)):
        await db.commit()
        raise HTTPException(status_code=409, detail="Sandbox mode is on: nothing is written back to SAP. "
                                                    "Exit the sandbox to send this batch.")
    return b, items, user


def _enqueue(run_id: str, tenant_id: str) -> None:
    from workers.tasks.run_batch_writeback import run_batch_writeback

    try:
        run_batch_writeback.delay(run_id, tenant_id)
    except Exception:  # noqa: BLE001 - the run stays queued; once stale, Resume enqueues it again
        logger.exception("Batch write-back %s could not be queued", run_id)


@router.post(
    "/writeback/batches/{batch_id}/send",
    response_model=RunOut,
    dependencies=[Depends(require_permission("approve"))],
)
async def send_batch_writeback(
    request: Request,
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Send an approved batch to SAP. The request checks everything and returns at once with the run; a worker sends
    the records in chunks (each simulated, committed only when SAP's RETURN holds no E or A message) and the screen
    follows the run. Fields without a BAPI are not sent and stay for the export. The batch becomes Sent to SAP once
    SAP has committed a record. A send while a run of this batch is open returns that run."""
    from sqlalchemy.exc import IntegrityError

    tenant_id = str(tenant.id)
    _, items, user = await _send_guards(request, db, tenant, batch_id)
    open_run = await _latest_run(db, tenant, batch_id)
    if open_run and open_run["status"] in _OPEN:
        return await _run_out(db, tenant, open_run)

    support = _batch_support(items)
    errors: list[str] = []
    # (system, module, record_key) -> {TABLE.FIELD: proposed value}, only the fields a BAPI carries
    by_record: dict[tuple[str, str, str], dict] = {}
    for item, sup in zip(items, support):
        if sup["supported"]:
            by_record.setdefault((str(item["scope"]), item["module"], item["record_key"]), {})[
                sup["field"]] = item["proposed_value"]
    export_only = sum(1 for x in support if not x["supported"])
    if export_only:
        errors.append(f"{export_only} field(s) have no BAPI mapping and were not sent; deliver them with the export")
    if not by_record:
        raise HTTPException(status_code=409, detail="No field of this batch has a BAPI mapping; deliver it with the "
                                                    "export.")
    # a record an earlier run committed, or may have committed, is never sent again by a new run
    done = {(r[0], r[1], r[2]) for r in (await db.execute(text(
        "SELECT x.system_id, x.module, x.record_key FROM writeback_run_records x JOIN writeback_runs r ON r.id = x.run_id "
        "WHERE r.tenant_id = :tid AND r.batch_id = :bid AND x.state IN ('committed', 'needs_check', 'sending')"),
        {"tid": tenant_id, "bid": batch_id})).fetchall()}
    todo = {k: v for k, v in by_record.items() if k not in done}
    if not todo:
        raise HTTPException(status_code=409, detail="Every record of this batch is already committed in SAP or waits "
                                                    "for a check there; nothing is left to send.")
    if done & by_record.keys():
        errors.append(f"{len(done & by_record.keys())} record(s) were sent by an earlier run and are not sent again")

    run_id = str(uuid.uuid4())
    try:
        await db.execute(text(
            "INSERT INTO writeback_runs (id, tenant_id, batch_id, status, requested_by, requested_label, export_only, "
            "errors) VALUES (:id, :tid, :bid, 'queued', :u, :l, :eo, CAST(:errs AS jsonb))"),
            {"id": run_id, "tid": tenant_id, "bid": batch_id, "u": user, "l": current_user_label(), "eo": export_only,
             "errs": json.dumps(errors)})
        await db.execute(text(
            "INSERT INTO writeback_run_records (tenant_id, run_id, seq, system_id, module, record_key, changes) "
            "VALUES (:tid, :r, :seq, :sys, :m, :k, CAST(:c AS jsonb))"),
            [{"tid": tenant_id, "r": run_id, "seq": seq, "sys": system_id, "m": module, "k": key,
              "c": json.dumps(changes, default=str)}
             for seq, ((system_id, module, key), changes) in enumerate(sorted(todo.items()))])
        await db.commit()
    except IntegrityError:  # a second send won the race for the one open run
        await db.rollback()
        run = await _latest_run(db, tenant, batch_id)
        if run and run["status"] in _OPEN:
            return await _run_out(db, tenant, run)
        raise
    _enqueue(run_id, tenant_id)
    logger.info(f"Batch write-back {batch_id}: run {run_id} queued, records={len(todo)}")
    return await _run_out(db, tenant, (await _latest_run(db, tenant, batch_id)) or {})


@router.get(
    "/writeback/batches/{batch_id}/run",
    response_model=RunOut,
    dependencies=[Depends(require_any_permission("apply", "approve"))],
)
async def get_batch_run(batch_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The latest send of this batch: status, counts, the pause reason. Changes nothing."""
    run = await _latest_run(db, tenant, batch_id)
    if not run:
        raise HTTPException(status_code=404, detail="This batch has not been sent to SAP")
    return await _run_out(db, tenant, run)


@router.get(
    "/writeback/batches/{batch_id}/run/records",
    response_model=RunRecordsPage,
    dependencies=[Depends(require_any_permission("apply", "approve"))],
)
async def get_batch_run_records(
    batch_id: uuid.UUID,
    state: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Records of the latest send, a page at a time, failed and needs_check by default, with SAP's messages."""
    run = await _latest_run(db, tenant, batch_id)
    if not run:
        raise HTTPException(status_code=404, detail="This batch has not been sent to SAP")
    states = [state] if state else ["failed", "needs_check"]
    limit, offset = max(1, min(limit, 200)), max(0, offset)
    args = {"r": run["id"], "tid": str(tenant.id), "st": states}
    total = (await db.execute(text("SELECT count(*) FROM writeback_run_records WHERE run_id = :r AND tenant_id = :tid "
                                   "AND state = ANY(:st)"), args)).scalar() or 0
    rows = (await db.execute(text("""
        SELECT x.record_key, x.module, x.state, x.error, x.attempts, x.result, x.changes,
               (SELECT w.name FROM work_records w WHERE w.tenant_id = x.tenant_id AND w.module = x.module
                   AND w.record_key = x.record_key AND w.name IS NOT NULL LIMIT 1) AS description
          FROM writeback_run_records x WHERE x.run_id = :r AND x.tenant_id = :tid AND x.state = ANY(:st)
         ORDER BY x.seq LIMIT :n OFFSET :o"""), {**args, "n": limit, "o": offset})).mappings().fetchall()
    items = []
    for x in rows:
        res = x["result"] or {}
        items.append(RunRecordOut(
            record_key=x["record_key"], description=x["description"], module=x["module"], state=x["state"],
            fields=sorted((x["changes"] or {}).keys()), error=x["error"], attempts=x["attempts"],
            messages=list(res.get("simulate_messages") or []) + list(res.get("messages") or [])))
    return RunRecordsPage(items=items, total=int(total), limit=limit, offset=offset)


@router.post(
    "/writeback/batches/{batch_id}/run/resume",
    response_model=RunOut,
    dependencies=[Depends(require_permission("approve"))],
)
async def resume_batch_run(request: Request, batch_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant)):
    """Continue a paused run, or take over a run whose worker stopped reporting (stale). A record the dead worker was
    sending is not sent again: it is marked needs_check, since SAP may already hold the change. Same four eyes as the
    send: not the batch creator."""
    tenant_id = str(tenant.id)
    await _send_guards(request, db, tenant, batch_id)
    run = await _latest_run(db, tenant, batch_id)
    if not run:
        raise HTTPException(status_code=404, detail="This batch has not been sent to SAP")
    if run["status"] != "paused" and not (run["status"] in ("queued", "running", "cancelling") and run["stale"]):
        raise HTTPException(status_code=409, detail="The run is neither paused nor stalled; there is nothing to resume.")
    await db.execute(text(
        "UPDATE writeback_run_records SET state = 'needs_check', updated_at = now(), error = 'The run stopped while this "
        "record was being sent; check it in SAP before sending it again' "
        "WHERE run_id = :r AND tenant_id = :tid AND state = 'sending'"), {"r": run["id"], "tid": tenant_id})
    await db.execute(text(
        "UPDATE writeback_runs SET status = 'queued', pause_reason = NULL, conn_failures = 0, heartbeat_at = now() "
        "WHERE id = :r AND tenant_id = :tid"), {"r": run["id"], "tid": tenant_id})
    await db.commit()
    _enqueue(run["id"], tenant_id)
    return await _run_out(db, tenant, (await _latest_run(db, tenant, batch_id)) or {})


@router.post(
    "/writeback/batches/{batch_id}/run/cancel",
    response_model=RunOut,
    dependencies=[Depends(require_permission("approve"))],
)
async def cancel_batch_run(batch_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Stop the run after the chunk in progress. A queued, paused or stalled run stops at once; committed records stay
    committed and the others stay unsent."""
    tenant_id = str(tenant.id)
    run = await _latest_run(db, tenant, batch_id)
    if not run:
        raise HTTPException(status_code=404, detail="This batch has not been sent to SAP")
    if run["status"] not in _OPEN:
        raise HTTPException(status_code=409, detail="The run is already finished.")
    if run["status"] in ("running", "cancelling") and not run["stale"]:  # the worker is alive: it finishes the stop
        new = "cancelling"
    else:
        new = "cancelled"
        await db.execute(text(
            "UPDATE writeback_run_records SET state = 'needs_check', updated_at = now(), error = 'The run stopped while "
            "this record was being sent; check it in SAP before sending it again' "
            "WHERE run_id = :r AND tenant_id = :tid AND state = 'sending'"), {"r": run["id"], "tid": tenant_id})
    await db.execute(text("UPDATE writeback_runs SET status = :s, heartbeat_at = now(), "
                          "finished_at = CASE WHEN :s = 'cancelled' THEN now() ELSE finished_at END "
                          "WHERE id = :r AND tenant_id = :tid"), {"s": new, "r": run["id"], "tid": tenant_id})
    await db.commit()
    return await _run_out(db, tenant, (await _latest_run(db, tenant, batch_id)) or {})


@router.post(
    "/writeback/batches/{batch_id}/run/retry-failed",
    response_model=RunOut,
    dependencies=[Depends(require_permission("approve"))],
)
async def retry_failed_batch_run(
    request: Request,
    batch_id: uuid.UUID,
    body: RetryRequest = RetryRequest(),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Send the failed records of the run again (and the needs_check ones only when asked). Committed records are never
    touched. Works on a finished or paused run; same four eyes as the send."""
    tenant_id = str(tenant.id)
    await _send_guards(request, db, tenant, batch_id)
    run = await _latest_run(db, tenant, batch_id)
    if not run:
        raise HTTPException(status_code=404, detail="This batch has not been sent to SAP")
    if run["status"] in ("queued", "running", "cancelling"):
        raise HTTPException(status_code=409, detail="The run is still going; retry once it has finished or paused.")
    states = ["failed", "needs_check"] if body.include_needs_check else ["failed"]
    n = (await db.execute(text(
        "UPDATE writeback_run_records SET state = 'pending', error = NULL, updated_at = now() "
        "WHERE run_id = :r AND tenant_id = :tid AND state = ANY(:st) RETURNING 1"),
        {"r": run["id"], "tid": tenant_id, "st": states})).rowcount
    if not n:
        await db.rollback()
        raise HTTPException(status_code=409, detail="No failed record to send again.")
    await db.execute(text(
        "UPDATE writeback_runs SET status = 'queued', pause_reason = NULL, conn_failures = 0, finished_at = NULL, "
        "heartbeat_at = now() WHERE id = :r AND tenant_id = :tid"), {"r": run["id"], "tid": tenant_id})
    await db.commit()
    _enqueue(run["id"], tenant_id)
    return await _run_out(db, tenant, (await _latest_run(db, tenant, batch_id)) or {})


# --- request view: list, detail (before/after), reject ---------------------------------------------------------

class RejectRequest(BaseModel):
    reason: str = Field("", max_length=500, description="Why the second person declines; shown to the requester.")


class RejectResponse(BaseModel):
    id: str
    status: str


class ChangeOut(BaseModel):
    record_key: str                  # the full SAP key, as stored on the finding
    field: str                       # TABLE.FIELD
    before: Optional[str] = None     # the fix's invalid_value: what the record holds now
    after: str                       # the fix's proposed_value: what the write-back sets
    delivery: str                    # "bapi" | "export"
    bapi: Optional[str] = None
    reason: Optional[str] = None


class RequestRow(BaseModel):
    id: str
    state: str                       # pending | approved | rejected | dry_run
    finding_id: Optional[str] = None
    version_id: Optional[str] = None
    module: Optional[str] = None
    check_id: Optional[str] = None
    rule_message: Optional[str] = None
    requested_by: Optional[str] = None
    requested_by_name: Optional[str] = None
    approved_by_name: Optional[str] = None
    rejected_by_name: Optional[str] = None
    records_updated: int = 0
    sap_host: Optional[str] = None
    created_at: Optional[str] = None
    applied_at: Optional[str] = None
    rejected_at: Optional[str] = None
    reject_reason: Optional[str] = None


class RequestList(BaseModel):
    items: list[RequestRow]
    live_enabled: bool


class RequestDetail(RequestRow):
    changes: list[ChangeOut] = []
    approvers: list[str] = []        # names of the other active users who hold the approve permission
    is_requester: bool = False       # the viewer made this request
    can_decide: bool = False         # the viewer may approve or reject it now
    cannot_decide_reason: Optional[str] = None   # own_request | not_pending | no_permission
    errors: list[str] = []           # the run's error sentences (no values, no SAP messages with data)
    live_enabled: bool = True
    undo_available: bool = False     # always false: no SAP prior value is stored, see undo_note
    undo_note: str = "SAP's previous values are not stored by a write-back, so it cannot be reversed here. The before column is the value Meridian found at the last run."


_REQ_SELECT = """
    SELECT w.id, w.finding_id, w.version_id, w.requested_by, w.approved_by, w.records_updated, w.sap_host,
           w.created_at, w.applied_at, w.dry_run, w.rejected_by, w.rejected_at, w.reject_reason, w.errors,
           f.check_id, f.module, COALESCE(f.details->>'message', f.rule_context->>'message'),
           COALESCE(NULLIF(ru.name, ''), ru.email), COALESCE(NULLIF(au.name, ''), au.email),
           COALESCE(NULLIF(xu.name, ''), xu.email)
    FROM write_back_log w
    LEFT JOIN findings f ON f.id = w.finding_id AND f.tenant_id = w.tenant_id
    LEFT JOIN users ru ON ru.id::text = w.requested_by AND ru.tenant_id = w.tenant_id
    LEFT JOIN users au ON au.id::text = w.approved_by AND au.tenant_id = w.tenant_id
    LEFT JOIN users xu ON xu.id::text = w.rejected_by AND xu.tenant_id = w.tenant_id
"""


def _row_out(r) -> dict:
    from api.services.writeback_view import request_state

    iso = lambda d: d.isoformat() if d else None  # noqa: E731
    return {
        "id": str(r[0]), "finding_id": str(r[1]) if r[1] else None, "version_id": str(r[2]) if r[2] else None,
        "requested_by": r[3], "records_updated": r[5] or 0, "sap_host": r[6], "created_at": iso(r[7]),
        "applied_at": iso(r[8]), "rejected_at": iso(r[11]), "reject_reason": r[12] or None,
        "state": request_state(dry_run=bool(r[9]), approved_by=r[4], rejected_at=r[11]),
        "check_id": r[14], "module": r[15], "rule_message": r[16] or None,
        "requested_by_name": r[17] or None, "approved_by_name": r[18] or None, "rejected_by_name": r[19] or None,
    }


@router.get("/writeback/requests", response_model=RequestList, dependencies=[Depends(require_permission("view"))])
async def list_writeback_requests(
    state: Optional[str] = None, limit: int = 100,
    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
):
    """Every live write-back request, newest first, whatever its state (pending, approved, rejected). Dry runs are
    validation only and never listed. ``state`` narrows to one of pending | approved | rejected."""
    if state not in (None, "", "pending", "approved", "rejected"):
        raise HTTPException(status_code=422, detail="state must be pending, approved or rejected")
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
    rows = (await db.execute(
        text(_REQ_SELECT + " WHERE w.tenant_id = :tid AND w.dry_run = false ORDER BY w.created_at DESC LIMIT :n"),
        {"tid": tenant_id, "n": max(1, min(limit, 500))},
    )).fetchall()
    from api.config import settings
    items = [RequestRow(**_row_out(r)) for r in rows]
    if state:
        items = [i for i in items if i.state == state]
    return RequestList(items=items, live_enabled=bool(settings.live_writeback_enabled))


@router.get("/writeback/requests/{request_id}", response_model=RequestDetail,
            dependencies=[Depends(require_permission("view"))])
async def get_writeback_request(
    request: Request, request_id: uuid.UUID,
    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
):
    """One request with each changed field before and after, who requested it, who can approve it, and whether the
    caller may decide it now."""
    from api.config import settings
    from api.services.rbac import active_users_holding_sync, current_user_id
    from api.services.writeback_view import change_rows, viewer_can_decide

    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
    r = (await db.execute(text(_REQ_SELECT + " WHERE w.id = :aid AND w.tenant_id = :tid"),
                          {"aid": str(request_id), "tid": tenant_id})).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Write-back request not found")
    out = _row_out(r)

    fixes: list[dict] = []
    if r[1]:
        fr = (await db.execute(text("SELECT record_fixes FROM findings WHERE id = :fid AND tenant_id = :tid"),
                               {"fid": str(r[1]), "tid": tenant_id})).fetchone()
        fixes = (fr[0] if fr else None) or []
    module = r[15] or ""
    pairs = [(f, field_support(module, f)) for f in fixes if _structured(f)]

    people = (await db.execute(
        text("SELECT id::text, COALESCE(NULLIF(name, ''), email) FROM users WHERE tenant_id = :tid AND is_active"),
        {"tid": tenant_id})).fetchall()
    names = {p[0]: p[1] for p in people}
    holders = await db.run_sync(lambda s: active_users_holding_sync(s, tenant_id, list(names), "approve"))
    viewer = current_user_id(request)
    ok, why = viewer_can_decide(out["state"], r[3], viewer, bool(viewer and viewer in holders))
    err = r[13] if isinstance(r[13], dict) else {}
    return RequestDetail(
        **out, changes=[ChangeOut(**c) for c in change_rows(pairs)],
        approvers=sorted(names[u] for u in holders if u != r[3] and names.get(u)),
        is_requester=bool(viewer and viewer == r[3]), can_decide=ok, cannot_decide_reason=why,
        errors=[str(e) for e in (err.get("errors") or [])][:20], live_enabled=bool(settings.live_writeback_enabled),
    )


@router.post("/writeback/reject/{approval_id}", response_model=RejectResponse,
             dependencies=[Depends(require_permission("approve"))])
async def reject_writeback(
    request: Request, approval_id: uuid.UUID, body: RejectRequest,
    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
):
    """Second user declines a pending write-back. The requester cannot (403); a request already decided gives 409."""
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
    rec = (await db.execute(
        text("SELECT requested_by, approved_by, dry_run, rejected_at FROM write_back_log "
             "WHERE id = :aid AND tenant_id = :tid FOR UPDATE"),
        {"aid": str(approval_id), "tid": tenant_id})).fetchone()
    if not rec:
        raise HTTPException(status_code=404, detail="Write-back request not found")
    if rec[2]:
        raise HTTPException(status_code=409, detail="This was a dry-run request; there is nothing to reject")
    if rec[1]:
        raise HTTPException(status_code=409, detail="Write-back already approved")
    if rec[3]:
        raise HTTPException(status_code=409, detail="Write-back already rejected")
    user = _require_user(request)
    if user == rec[0]:
        raise HTTPException(status_code=403, detail="4-eyes violation: rejecting user must differ from requesting user")
    reason = body.reason.strip()
    await db.execute(
        text("UPDATE write_back_log SET rejected_by = :u, rejected_at = :now, reject_reason = :why "
             "WHERE id = :aid AND tenant_id = :tid"),
        {"u": user, "now": datetime.now(timezone.utc), "why": reason or None, "aid": str(approval_id), "tid": tenant_id})
    from api.services.rbac import write_audit
    await write_audit(db, tenant.id, request, "writeback.reject", "write_back_log", str(approval_id),
                      {"requested_by": rec[0]}, {"rejected_by": user, "reason": reason or None})
    await db.commit()
    return RejectResponse(id=str(approval_id), status="rejected")
