"""Golden-record write-back to SAP: plan, simulate and apply, per target system and field.

Reuses the fix write-back machinery (api/routes/writeback.py): its BAPI_MAP and verified
BAPI parameter mapping (``_bapi_params``), its live write-back switch and its four-eyes rule,
plus the connector dispatch in api/services/connectivity_manager.py.

What can be written (nothing is guessed):
  - ABAP systems (ecc, s4hana_onprem, ewm): the BAPI named for the object in BAPI_MAP, and only
    for fields with a verified parameter mapping in BAPI_FIELDS. That mapping is empty today, so
    every field reports "no verified BAPI parameter mapping" and the system is unsupported.
  - S/4HANA Cloud and SAP BTP, business partner: OData PATCH of A_BusinessPartner for the
    BUT000 fields below (the property names come from sap/s4hana_cloud.py S4HC_TABLE_MAP).
  - Anything else: unsupported, with the reason.

Targets are the SAP systems the record's values came from: a source_contributions entry's
``source_system`` is a registered system (id or name) or ``upload:<version id prefix>`` whose
analysis version was a live extraction (metadata.system_id). File uploads have no system.

The planner and executor never send raw SAP data to an LLM; everything here is deterministic.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from sap.btp import ecc_value
from sap.s4hana_cloud import S4HC_TABLE_MAP

logger = logging.getLogger("meridian.golden_writeback")

RFC_TYPES = ("ecc", "s4hana_onprem", "ewm")
ODATA_TYPES = ("s4hana_cloud", "btp")

# Domain -> (SAP table holding its header fields, object key field). The object keys are the
# ones build_golden_records groups on (workers/tasks/build_golden_records.py _KEY_CANDIDATES).
DOMAIN_OBJECTS: dict[str, tuple[str, str]] = {
    "business_partner": ("BUT000", "PARTNER"),
    "material_master": ("MARA", "MATNR"),
    "accounts_payable": ("LFA1", "LIFNR"),
    "accounts_receivable": ("KNA1", "KUNNR"),
    "sd_customer_master": ("KNA1", "KUNNR"),
}

# Business partner fields A_BusinessPartner accepts in a PATCH: plain text fields of the
# central data. Keys, the category, the grouping, dates and flags are left out on purpose.
ODATA_BP_ENTITY = "A_BusinessPartner"
_BUT000 = S4HC_TABLE_MAP["BUT000"][1]
ODATA_BP_FIELDS: dict[str, str] = {
    f: _BUT000[f] for f in ("NAME_FIRST", "NAME_LAST", "NAME_ORG1", "BU_SORT1", "LANGU_CORR")
}

SYSTEM_LABELS = {
    "ecc": "SAP ECC", "s4hana_onprem": "S/4HANA", "ewm": "EWM", "s4hana_cloud": "S/4HANA Cloud",
    "btp": "SAP BTP", "successfactors": "SuccessFactors", "concur": "Concur", "ariba": "Ariba",
}

# One audit_log row per step (request, submit, approve/reject, simulate, apply). actor_user_id is the
# users row when the actor is one; actor_email keeps the id either way.
AUDIT_SQL = (
    "INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path, "
    "status_code, after_json) VALUES (:t, (SELECT id FROM users WHERE CAST(id AS text) = :u), "
    "NULLIF(:u, ''), :a, 'golden_writeback_request', :ei, :m, :p, 200, CAST(:af AS jsonb))"
)

# Request lifecycle (golden_writeback_requests.status)
OPEN_STATUSES = ("simulating", "simulated", "pending_approval", "approved", "applying")
BLOCKING_STATUSES = ("pending_approval", "approved", "applying")


def bare_field(name: str, table: str) -> Optional[str]:
    """``TABLE.FIELD`` / ``TABLE_FIELD`` / ``FIELD`` -> FIELD when it belongs to ``table``; None for another table."""
    n = str(name).strip().upper()
    if "." in n:
        t, f = n.split(".", 1)
        return f if t == table else None
    if n.startswith(table + "_"):
        return n[len(table) + 1:]
    return n


def _norm(v: Any) -> str:
    """Compare values the way RFC_READ_TABLE shows them (flags X/'', dates YYYYMMDD), trimmed."""
    v = ecc_value(v)
    return "" if v is None else str(v).strip()


def plan_target(system_type: str, domain: str, sap_object_key: str, golden_fields: dict) -> dict:
    """Which golden fields this system can take, and how. Never contacts SAP."""
    from api.routes.writeback import BAPI_MAP, _bapi_params

    label = SYSTEM_LABELS.get(system_type, system_type)
    obj = DOMAIN_OBJECTS.get(domain)
    fields: list[dict] = []

    def unsupported(reason: str) -> dict:
        return {"supported": False, "method": None, "reason": reason, "fields": [
            {"field": f, "golden_value": v, "target": None, "supported": False, "reason": reason}
            for f, v in golden_fields.items()]}

    if system_type in RFC_TYPES:
        bapi = BAPI_MAP.get(domain)
        if not bapi or not obj:
            return unsupported(f"No write-back BAPI for {domain} on {label}")
        table, key = obj
        for f, v in golden_fields.items():
            bf = bare_field(f, table)
            if bf == key:
                continue
            if bf is None:
                fields.append({"field": f, "golden_value": v, "target": None, "supported": False,
                               "reason": f"Not a {table} field"})
                continue
            fix = {"field": f"{table}.{bf}", "record_key": f"{key}={sap_object_key}", "proposed_value": v}
            ok = _bapi_params(bapi, fix) is not None
            fields.append({"field": f, "golden_value": v, "target": bapi if ok else None, "supported": ok,
                           "reason": None if ok else f"No verified {bapi} parameter mapping for {table}.{bf}"})
        supported = any(x["supported"] for x in fields)
        return {"supported": supported, "method": "rfc_bapi" if supported else None, "bapi": bapi,
                "reason": None if supported else
                f"{bapi} has no verified parameter mapping for these fields yet; load them with a remediation batch",
                "fields": fields}

    if system_type in ODATA_TYPES:
        if domain != "business_partner":
            return unsupported(f"OData write-back on {label} covers business partners only")
        for f, v in golden_fields.items():
            bf = bare_field(f, "BUT000")
            if bf == "PARTNER":
                continue
            prop = ODATA_BP_FIELDS.get(bf or "")
            fields.append({"field": f, "golden_value": v, "target": prop, "supported": prop is not None,
                           "reason": None if prop else f"{ODATA_BP_ENTITY} has no writable property for {f}"})
        supported = any(x["supported"] for x in fields)
        return {"supported": supported, "method": "odata_patch" if supported else None,
                "reason": None if supported else "None of these fields is writable through A_BusinessPartner",
                "fields": fields}

    return unsupported(f"The {label} connector has no write method")


# ── Execution (Celery worker; connectors only via sap/) ─────────────────────────────────


def _rfc_current(conn: Any, table: str, key: str, obj_key: str, bare: list[str]) -> dict[str, Any]:
    safe = str(obj_key).replace("'", "''")
    df = conn.read_table(table, [key, *bare], where=f"{key} = '{safe}'", max_rows=1)
    if df is None or df.empty:
        raise LookupError(f"{key} {obj_key} not found in {table}")
    return {c.split(".")[-1]: v for c, v in df.iloc[0].to_dict().items()}


def run_target(conn: Any, system_type: str, domain: str, sap_object_key: str, plan: dict, apply: bool) -> dict:
    """Simulate (read current values, diff) or apply one target's supported fields.

    Per-field ``result``: unsupported | unchanged | would_change (simulate) | written | error.
    Applying re-reads the current value first, so a repeated run writes nothing twice.
    """
    from api.routes.writeback import _bapi_params
    from sap.base import BAPICall, SAPConnectorError

    fields = [dict(x) for x in plan["fields"]]
    # Applying writes only what the approver saw as a change in the simulation; the rest keep that result.
    todo = [x for x in fields if x["supported"] and (not apply or x.get("result") == "would_change")]
    for x in fields:
        if not x["supported"]:
            x["result"] = "unsupported"
    if not todo:
        return {**plan, "fields": fields}

    try:
        if system_type in ODATA_TYPES:
            current, _ = conn.read_entity(ODATA_BP_ENTITY, sap_object_key, [x["target"] for x in todo])
            cur = {x["field"]: current.get(x["target"]) for x in todo}
        else:
            table, key = DOMAIN_OBJECTS[domain]
            row = _rfc_current(conn, table, key, sap_object_key, [bare_field(x["field"], table) for x in todo])
            cur = {x["field"]: row.get(bare_field(x["field"], table)) for x in todo}
    except (SAPConnectorError, LookupError) as e:
        for x in todo:
            x.update(result="error", message=f"Could not read the current value: {e}")
        return {**plan, "fields": fields}

    for x in todo:
        x["current_value"] = cur[x["field"]]
        if _norm(cur[x["field"]]) == _norm(x["golden_value"]):
            x["result"] = "unchanged"
        elif not apply:
            x["result"] = "would_change"
        else:
            try:
                if system_type in ODATA_TYPES:
                    conn.update_entity(ODATA_BP_ENTITY, sap_object_key, {x["target"]: x["golden_value"]})
                else:
                    table, key = DOMAIN_OBJECTS[domain]
                    params = _bapi_params(plan["bapi"], {"field": f"{table}.{bare_field(x['field'], table)}",
                                                         "record_key": f"{key}={sap_object_key}",
                                                         "proposed_value": x["golden_value"]})
                    conn.execute_bapi(BAPICall(bapi_name=plan["bapi"], params=params or {}))
                x["result"] = "written"
            except SAPConnectorError as e:
                x.update(result="error", message=str(e))
    return {**plan, "fields": fields}


def connect_system(session: Any, tenant_id: str, system_id: str) -> Any:
    """Connected connector for a registered system (same dispatch as extraction)."""
    from api.services.connectivity_manager import ConnectivityManager, connect_sap_system

    cm = ConnectivityManager(session, tenant_id)
    row = cm._load_system(system_id)
    return connect_sap_system(row.system_type, cm._build_connection_params(row))


def execute_targets(targets: list[dict], domain: str, sap_object_key: str, apply: bool,
                    connect: Callable[[str], Any]) -> list[dict]:
    """Run every supported target; a connection failure marks that target's fields as errors."""
    from sap.base import SAPConnectorError

    out = []
    for t in targets:
        if not t["supported"]:
            out.append({**t, "fields": [{**x, "result": "unsupported"} for x in t["fields"]]})
            continue
        if apply and not any(x.get("result") == "would_change" for x in t["fields"]):
            out.append(t)  # nothing approved for this system: do not connect
            continue
        conn = None
        try:
            conn = connect(t["system_id"])
            out.append({"system_id": t["system_id"], "system_name": t["system_name"],
                        "system_type": t["system_type"],
                        **run_target(conn, t["system_type"], domain, sap_object_key, t, apply)})
        except SAPConnectorError as e:
            hit = (lambda x: x.get("result") == "would_change") if apply else (lambda x: x["supported"])
            out.append({**t, "fields": [
                {**x, "result": "error", "message": f"Connection failed: {e}"} if hit(x)
                else {**x, "result": x.get("result") or "unsupported"}
                for x in t["fields"]]})
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    logger.debug("connector close failed", exc_info=True)
    return out


def summarise(targets: list[dict]) -> dict[str, int]:
    """Count per-field results across targets."""
    counts: dict[str, int] = {}
    for t in targets:
        for x in t["fields"]:
            r = x.get("result") or ("supported" if x["supported"] else "unsupported")
            counts[r] = counts.get(r, 0) + 1
    return counts


# ── Planning from the database (API, async) ─────────────────────────────────────────────

_HEX = set("0123456789abcdef-")


async def resolve_targets(db: Any, tenant_id: str, source_contributions: dict) -> tuple[list[dict], list[str]]:
    """Registered SAP systems the record's values came from, and the source labels that name none.

    Returns ([{system_id, system_name, system_type}], [unresolved source labels]).
    """
    import uuid as _uuid

    from sqlalchemy import text

    # A value from a file upload is never a write-back target, even when the file was attached to a
    # system: it was hand-made, not read from that system.
    labels = sorted({str(c["source_system"]) for c in source_contributions.values()
                     if isinstance(c, dict) and c.get("source_system") and c.get("origin") != "upload"})
    systems: dict[str, dict] = {}
    unresolved: list[str] = []
    for label in labels:
        if label.startswith(("merge:", "steward_override")):
            continue  # merged-in or steward-picked values: their system is another contribution's
        row = None
        if label.startswith("upload:"):
            prefix = label.split(":", 1)[1].lower()
            if prefix and set(prefix) <= _HEX:
                row = (await db.execute(text(
                    "SELECT s.id, s.name, s.system_type FROM analysis_versions v "
                    "JOIN sap_systems s ON CAST(s.id AS text) = v.metadata->>'system_id' AND s.tenant_id = v.tenant_id "
                    "WHERE v.tenant_id = :t AND CAST(v.id AS text) LIKE :p "
                    "AND NOT (v.metadata->>'upload_path' IS NOT NULL OR v.metadata->>'source' IS NULL "
                    "OR v.metadata->>'source' = 'upload') "
                    "ORDER BY v.run_at DESC NULLS LAST LIMIT 1"),
                    {"t": tenant_id, "p": prefix + "%"})).fetchone()
        else:
            try:
                sid = str(_uuid.UUID(label))
            except ValueError:
                sid = ""
            row = (await db.execute(text(
                "SELECT id, name, system_type FROM sap_systems WHERE tenant_id = :t "
                "AND (CAST(id AS text) = :sid OR name = :n) LIMIT 1"),
                {"t": tenant_id, "sid": sid, "n": label})).fetchone()
        if row:
            systems[str(row[0])] = {"system_id": str(row[0]), "system_name": row[1], "system_type": row[2]}
        else:
            unresolved.append(label)
    return sorted(systems.values(), key=lambda s: s["system_name"] or ""), unresolved


async def build_preview(db: Any, tenant_id: str, record: dict) -> dict:
    """What a write-back of this golden record would do, per target system. No SAP contact."""
    from api.config import settings

    targets, unresolved = await resolve_targets(db, tenant_id, record["source_contributions"] or {})
    golden = record["golden_fields"] or {}
    planned = [{**t, **plan_target(t["system_type"], record["domain"], record["sap_object_key"], golden)}
               for t in targets]
    supported = any(t["supported"] for t in planned)
    if not targets:
        message = ("No registered SAP system supplied this record (its values came from a file upload), "
                   "so there is no system to write back to.")
    elif supported:
        message = "Simulate the write-back to see what would change in each system, then request approval."
    else:
        message = "Write-back is not supported for this object on its source systems. " + " ".join(
            f"{t['system_name']}: {t['reason']}." for t in planned)
    return {
        "record_id": record["id"], "domain": record["domain"], "sap_object_key": record["sap_object_key"],
        "golden_fields": golden, "writeback_supported": supported,
        "live_enabled": bool(settings.live_writeback_enabled),
        "message": message, "targets": planned, "unresolved_sources": unresolved,
    }


# ── Request lifecycle (API, async) ──────────────────────────────────────────────────────

REQUEST_COLUMNS = ("id, master_record_id, status, requested_by, approved_by, rejected_by, targets, error, "
                   "created_at, simulated_at, decided_at, applied_at")


def request_out(row: Any) -> dict:
    """A golden_writeback_requests row as the API returns it."""
    targets = row[6] or []

    def iso(d: Any) -> Optional[str]:
        return d.isoformat() if d else None

    return {"id": str(row[0]), "master_record_id": str(row[1]), "status": row[2], "requested_by": row[3],
            "approved_by": row[4], "rejected_by": row[5], "targets": targets, "error": row[7],
            "counts": summarise(targets), "created_at": iso(row[8]), "simulated_at": iso(row[9]),
            "decided_at": iso(row[10]), "applied_at": iso(row[11])}


async def audit(db: Any, tenant_id: str, actor: str, action: str, request_id: str, after: dict,
                path: str = "") -> None:
    """One audit_log row for a request step (caller commits)."""
    import json

    from sqlalchemy import text

    await db.execute(text(AUDIT_SQL), {"t": tenant_id, "u": actor or "", "a": action, "ei": request_id,
                                       "m": "POST", "p": path, "af": json.dumps(after, default=str)})


class DecisionError(Exception):
    """A refused approval or rejection: HTTP status and message for the caller."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status, self.detail = status, detail


async def decide(db: Any, tenant_id: str, record_id: str, action: str, user_id: str) -> str:
    """Approve or reject the record's request waiting for approval. The caller commits and, on
    approve, then enqueues the apply task. Returns the request id.

    Four-eyes: the approver must be a different user from the requester. Approving also needs
    live SAP write-back switched on for this deployment (MERIDIAN_LIVE_WRITEBACK_ENABLED), the
    same switch the fix write-back obeys.
    """
    from sqlalchemy import text

    from api.config import settings

    row = (await db.execute(text(
        "SELECT id, requested_by FROM golden_writeback_requests WHERE tenant_id = :t AND master_record_id = :r "
        "AND status = 'pending_approval' FOR UPDATE"), {"t": tenant_id, "r": record_id})).fetchone()
    if not row:
        raise DecisionError(409, "No write-back of this record is waiting for approval.")
    rid = str(row[0])
    if action == "approve":
        if not user_id:
            raise DecisionError(403, "Authentication required")
        if user_id == row[1]:
            raise DecisionError(403, "4-eyes violation: approving user must differ from requesting user")
        if not settings.live_writeback_enabled:
            raise DecisionError(409, "Live SAP write-back is disabled on this deployment "
                                     "(MERIDIAN_LIVE_WRITEBACK_ENABLED). Nothing was written.")
        new, who = "approved", "approved_by"
    elif action == "reject":
        new, who = "rejected", "rejected_by"
    else:
        raise DecisionError(400, "action must be 'approve' or 'reject'")
    await db.execute(text(
        f"UPDATE golden_writeback_requests SET status = :st, {who} = :u, decided_at = now(), updated_at = now() "
        "WHERE id = :id AND tenant_id = :t AND status = 'pending_approval'"),
        {"st": new, "u": user_id, "id": rid, "t": tenant_id})
    await db.execute(text(
        "UPDATE stewardship_queue SET status = 'resolved', updated_at = now(), resolved_at = now() "
        "WHERE tenant_id = :t AND item_type = 'golden_writeback' AND source_id = :r "
        "AND status IN ('open', 'in_progress', 'escalated')"), {"t": tenant_id, "r": record_id})
    await audit(db, tenant_id, user_id, f"golden_writeback.{new}", rid, {"master_record_id": record_id})
    return rid


def enqueue(request_id: str, tenant_id: str, mode: str) -> None:
    """Hand the request to the worker (``simulate`` or ``apply``). Call after the commit."""
    from workers.tasks.run_golden_writeback import run_golden_writeback

    run_golden_writeback.delay(request_id, tenant_id, mode)
