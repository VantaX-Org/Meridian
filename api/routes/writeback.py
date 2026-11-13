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
import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import NoReturn, Optional

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


# A write-back request waits this long for its second user; after that it expires and is submitted again.
APPROVAL_TTL_DAYS = 7


def fixes_sha256(fixes: list) -> str:
    """Hash of the exact fix rows a request asks approval for (the snapshot the approver signs). The approval runs only
    when every snapshot row is still, unchanged, a fix of the finding."""
    return hashlib.sha256(json.dumps(fixes, sort_keys=True, default=str).encode()).hexdigest()


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
    asked = []
    skipped = 0
    for fix in body.record_fixes:
        if _structured(fix):
            asked.append(fix)
        else:
            skipped += 1
            logger.info(f"Skipping fix without sql_statement: {fix.get('field', 'unknown')}")
    # The snapshot is the finding's own fix rows for the asked record fields, never values from the request: a fix
    # the finding does not hold (another value, or none) is refused.
    live = {(str(f["record_key"]), str(f["field"])): f for f in (finding[2] or []) if _structured(f)}
    foreign = [f for f in asked if (live.get((str(f["record_key"]), str(f["field"]))) or {}).get("proposed_value")
               != f["proposed_value"]]
    if foreign:
        raise HTTPException(status_code=409, detail=f"{len(foreign)} fix(es) are not fixes of this finding as it "
                                                    "stands (another value, or none); reload the finding and submit "
                                                    "again.")
    valid_fixes = list({(str(f["record_key"]), str(f["field"])): live[(str(f["record_key"]), str(f["field"]))]
                        for f in asked}.values())

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
                     records_updated, errors, sap_host, system_id, record_fixes, fixes_sha256, status, created_at)
                SELECT :log_id, :tid, :fid,
                    (SELECT version_id FROM findings WHERE id = :fid AND tenant_id = :tid),
                    :requested_by, true, :count, CAST(:errors AS jsonb), :host, CAST(:sid AS uuid),
                    CAST(:fixes AS jsonb), :sha, 'dry_run', now()
            """),
            {
                "log_id": log_id,
                "tid": tenant_id,
                "fid": str(body.finding_id),
                "requested_by": requesting_user,
                "count": len(valid_fixes),
                "errors": json.dumps({"errors": errors}) if errors else None,
                "host": system.host,
                "sid": str(body.system_id),
                "fixes": json.dumps(valid_fixes, default=str),
                "sha": fixes_sha256(valid_fixes),
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

    # Non-dry-run: create pending approval record (4-eyes requirement). The request freezes the exact fix rows it
    # asks approval for (record_fixes, with their sha256) and the system they go to; the approval runs only those.
    approval_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO write_back_log
                (id, tenant_id, finding_id, version_id, requested_by, dry_run,
                 records_updated, sap_host, system_id, record_fixes, fixes_sha256, status, expires_at, created_at)
            SELECT :log_id, :tid, :fid,
                (SELECT version_id FROM findings WHERE id = :fid AND tenant_id = :tid),
                :requested_by, false, :count, :host, CAST(:sid AS uuid), CAST(:fixes AS jsonb), :sha, 'pending',
                now() + make_interval(days => :ttl), now()
        """),
        {
            "log_id": approval_id,
            "tid": tenant_id,
            "fid": str(body.finding_id),
            "requested_by": requesting_user,
            "count": len(valid_fixes),
            "host": system.host,
            "sid": str(body.system_id),
            "fixes": json.dumps(valid_fixes, default=str),
            "sha": fixes_sha256(valid_fixes),
            "ttl": APPROVAL_TTL_DAYS,
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
    expires_at: Optional[str] = None   # after this the request expires and is submitted again


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
                   f.check_id, f.module, COALESCE(f.details->>'message', f.rule_context->>'message'), COALESCE(NULLIF(u.name, ''), u.email),
                   w.expires_at
            FROM write_back_log w
            LEFT JOIN findings f ON f.id = w.finding_id AND f.tenant_id = w.tenant_id
            LEFT JOIN users u ON u.id::text = w.requested_by AND u.tenant_id = w.tenant_id
            WHERE w.tenant_id = :tid AND w.dry_run = false AND w.approved_by IS NULL AND w.status = 'pending'
              AND (w.expires_at IS NULL OR w.expires_at > now())
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
                expires_at=r[11].isoformat() if r[11] else None,
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
    """Second user approves a pending write-back and it runs. The approval claims the request with one conditional
    UPDATE (pending, not expired, not the requester's own), so two approvals can never both run it. It runs only the
    fix rows frozen at submit, against the system named at submit, and is blocked when the finding's fixes have
    changed since. Per record, the current SAP value is read first; a record changed in SAP since is skipped."""
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

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

    approving_user = _require_user(request)
    # The claim: pending -> approved in one statement. Only one approval ever gets the row back.
    claimed = (await db.execute(
        text("""
            UPDATE write_back_log SET approved_by = :approver, status = 'approved'
             WHERE id = :aid AND tenant_id = :tid AND status = 'pending' AND approved_by IS NULL
               AND dry_run = false AND requested_by IS DISTINCT FROM :approver
               AND (expires_at IS NULL OR expires_at > now())
            RETURNING finding_id, system_id, record_fixes, fixes_sha256
        """),
        {"aid": approval_id, "tid": tenant_id, "approver": approving_user},
    )).fetchone()
    if not claimed:
        await db.rollback()
        await _refuse_claim(db, tenant_id, approval_id, approving_user)
    await db.commit()
    finding_id, system_id, snapshot, snapshot_sha = claimed

    async def _close(status: str, errors: list[str], records: Optional[list] = None, applied: int = 0) -> None:
        await db.execute(text("""
            UPDATE write_back_log SET status = :st, applied_at = :now, records_updated = :applied,
                   errors = CAST(:errors AS jsonb)
             WHERE id = :aid AND tenant_id = :tid
        """), {"st": status, "now": datetime.now(timezone.utc), "applied": applied, "aid": approval_id,
               "tid": tenant_id,
               # per record: the simulation and the call with SAP's RETURN messages; no field values
               "errors": json.dumps({"errors": errors, "records": records or []}) if errors or records else None})
        await db.commit()

    if not system_id or snapshot is None or not snapshot_sha:
        # submitted before requests froze their fixes (migration 173): never run the live fixes unseen
        msg = "This request was submitted before approvals froze their fixes; submit the write-back again."
        await _close("blocked", [msg])
        raise HTTPException(status_code=409, detail=msg)
    snapshot = snapshot if isinstance(snapshot, list) else json.loads(snapshot)
    if fixes_sha256(snapshot) != snapshot_sha:
        msg = "The stored fixes of this request do not match their hash; nothing was sent. Submit it again."
        await _close("blocked", [msg])
        raise HTTPException(status_code=409, detail=msg)

    finding = (await db.execute(
        text("SELECT module, record_fixes FROM findings WHERE id = :fid AND tenant_id = :tid"),
        {"fid": str(finding_id), "tid": tenant_id},
    )).fetchone()
    if not finding:
        await _close("blocked", ["Finding no longer exists"])
        raise HTTPException(status_code=404, detail="Finding no longer exists")
    module = finding[0]
    live = {fixes_sha256([f]) for f in (finding[1] or []) if _structured(f)}
    if any(fixes_sha256([f]) not in live for f in snapshot):
        msg = ("The finding's fixes changed after this request was submitted; nothing was sent. Review the fixes and "
               "submit the write-back again.")
        await _close("blocked", [msg])
        raise HTTPException(status_code=409, detail=msg)

    valid_fixes = [f for f in snapshot if _structured(f)]
    support = [field_support(module, f) for f in valid_fixes]
    errors: list[str] = []
    applied = 0
    records: list[dict] = []
    # record_key -> {TABLE.FIELD: proposed value}, only the fields a BAPI carries; and the value each was based on
    by_record: dict[str, dict] = {}
    based_on: dict[str, dict] = {}
    for fix, sup in zip(valid_fixes, support):
        if sup["supported"]:
            by_record.setdefault(sup["record_key"], {})[sup["field"]] = fix["proposed_value"]
            based_on.setdefault(sup["record_key"], {})[sup["field"]] = fix.get("invalid_value")
    unsupported = [x for x in support if not x["supported"]]
    if unsupported:
        errors.append(f"{len(unsupported)} field(s) have no BAPI mapping and were not sent; deliver them with the "
                      "export (see fields)")

    if not valid_fixes:
        errors.append("No deterministic fixes available")
    elif not by_record:
        errors.append(f"No field of this finding has a BAPI mapping for '{module}'")
    else:
        # Credentials of the system named at submit, by its id (never by host: two systems may share one).
        # Decrypted only here, at execution time.
        from sap import get_connector
        from sap.base import SAPConnectorError

        params = await _system_params(db, tenant_id, str(system_id))
        if params is None:
            errors.append("The SAP system of this request has no stored credentials any more; register and connect "
                          "it before write-back")
        else:
            def _apply() -> tuple[list[dict], list[str]]:
                """Synchronous RFC work on a worker thread (asyncio.to_thread): this handler is ``async def``,
                so calling it directly would block the event loop for every request for the whole round-trip."""
                try:
                    with get_connector() as conn:
                        conn.connect(params)
                        return apply_records(conn, module, by_record, based_on), []
                except SAPConnectorError as e:
                    if "pyrfc_not_installed" in str(e):
                        return [], ["PyRFC not installed"]
                    return [], [f"RFC connection failed: {e}"]

            records, conn_errors = await asyncio.to_thread(_apply)
            errors.extend(conn_errors)
            applied = sum(1 for r in records if r["committed"])
            errors.extend(record_errors(records, support))

    await _close("approved", errors, records, applied)

    status = "completed" if not errors else "completed_with_errors"
    logger.info(f"Write-back approved: {approval_id} — applied={applied}, errors={len(errors)}")

    return ApprovalResponse(applied=applied, errors=errors, status=status, fields=support, records=records)


async def _refuse_claim(db: AsyncSession, tenant_id: str, approval_id: str, user: str) -> NoReturn:
    """The claim got no row: say why (always raises)."""
    row = (await db.execute(text(
        "SELECT requested_by, status, dry_run, (expires_at IS NOT NULL AND expires_at <= now()) "
        "FROM write_back_log WHERE id = :aid AND tenant_id = :tid"), {"aid": approval_id, "tid": tenant_id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Write-back request not found")
    requested_by, status, dry_run, expired = row
    if dry_run:  # a validation-only request can never be executed
        raise HTTPException(status_code=409, detail="This was a dry-run request; submit a new write-back to execute")
    if status == "pending" and expired:
        await db.execute(text("UPDATE write_back_log SET status = 'expired' WHERE id = :aid AND tenant_id = :tid "
                              "AND status = 'pending'"), {"aid": approval_id, "tid": tenant_id})
        await db.commit()
        raise HTTPException(status_code=409, detail="This write-back request has expired; submit it again.")
    if status == "pending" and requested_by == user:
        raise HTTPException(status_code=403, detail="4-eyes violation: approving user must differ from requesting user")
    if status == "approved":
        raise HTTPException(status_code=409, detail="Write-back already approved")
    raise HTTPException(status_code=409, detail=f"This write-back request is {status}; it can no longer be approved.")


class RejectRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=4000, description="Why the write-back is not approved.")


@router.post(
    "/writeback/reject/{approval_id}",
    dependencies=[Depends(require_permission("approve"))],
)
async def reject_writeback(
    request: Request,
    approval_id: str,
    body: RejectRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Reject a pending write-back with a reason. Nothing is sent; the request is closed and keeps the reason."""
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{tenant_id}\'"))
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say why the write-back is rejected.")
    user = _require_user(request)
    row = (await db.execute(text("""
        UPDATE write_back_log SET status = 'rejected', rejected_by = :u, rejected_at = now(), reject_reason = :r
         WHERE id = :aid AND tenant_id = :tid AND status = 'pending' AND approved_by IS NULL
        RETURNING id
    """), {"u": user, "r": reason, "aid": approval_id, "tid": tenant_id})).fetchone()
    if not row:
        await db.rollback()
        exists = (await db.execute(text("SELECT status FROM write_back_log WHERE id = :aid AND tenant_id = :tid"),
                                   {"aid": approval_id, "tid": tenant_id})).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Write-back request not found")
        raise HTTPException(status_code=409, detail=f"This write-back request is {exists[0]}; it can no longer be "
                                                    "rejected.")
    await db.commit()
    return {"id": approval_id, "status": "rejected", "reason": reason}


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


def apply_records(conn, module: str, by_record: dict[str, dict],
                  based_on: Optional[dict[str, dict]] = None) -> list[dict]:
    """Simulate then write each record (sap/bapi_writeback.py write_record) on one connection; per-record
    results with SAP's RETURN messages. The interface of each BAPI is read once per run. ``based_on`` (record_key ->
    {TABLE.FIELD: value the fix was based on}): a record whose SAP value differs now is skipped as stale, never sent."""
    from sap.bapi_writeback import write_record

    cache: dict = {}
    return [write_record(conn, module, key, changes, apply=True, cache=cache,
                         based_on=(based_on or {}).get(key)).as_dict()
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
    stale: int = 0                    # changed in SAP since the fix was proposed: not sent, never overwritten


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
    from api.routes.remediation import APPROVAL_TTL_DAYS, items_sha256

    b, items = await _approved_batch(db, tenant, batch_id)
    user = _require_user(request)
    if b.get("created_by") and str(b["created_by"]) == user:
        raise HTTPException(status_code=403, detail="The batch creator cannot send it to SAP; a second person sends it.")
    approved_at = b.get("approved_at")
    if isinstance(approved_at, str):
        approved_at = datetime.fromisoformat(approved_at)
    if approved_at is not None and approved_at.tzinfo is None:
        approved_at = approved_at.replace(tzinfo=timezone.utc)
    if (b["status"] == "approved" and approved_at is not None
            and datetime.now(timezone.utc) - approved_at > timedelta(days=APPROVAL_TTL_DAYS)):
        raise HTTPException(status_code=409, detail=f"This approval is older than {APPROVAL_TTL_DAYS} days and has "
                                                    "expired. Send the batch back and approve it again before sending.")
    # the items must be the ones approved: a change edited after approval is never sent under that approval
    if b.get("approved_sha256") and items_sha256(items) != b["approved_sha256"]:
        raise HTTPException(status_code=409, detail="The batch's changes differ from the ones that were approved. "
                                                    "Send the batch back and approve it again before sending.")
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
    # the same keys -> {TABLE.FIELD: the value the change was based on}; the worker skips the record as stale when SAP
    # holds another value now (sap/bapi_writeback.py check_stale)
    based_on: dict[tuple[str, str, str], dict] = {}
    for item, sup in zip(items, support):
        if sup["supported"]:
            k = (str(item["scope"]), item["module"], item["record_key"])
            by_record.setdefault(k, {})[sup["field"]] = item["proposed_value"]
            based_on.setdefault(k, {})[sup["field"]] = item.get("current_value")
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
            "INSERT INTO writeback_run_records (tenant_id, run_id, seq, system_id, module, record_key, changes, "
            "based_on) VALUES (:tid, :r, :seq, :sys, :m, :k, CAST(:c AS jsonb), CAST(:b AS jsonb))"),
            [{"tid": tenant_id, "r": run_id, "seq": seq, "sys": system_id, "m": module, "k": key,
              "c": json.dumps(changes, default=str), "b": json.dumps(based_on.get((system_id, module, key)), default=str)}
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
    states = [state] if state else ["failed", "needs_check", "stale"]
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
