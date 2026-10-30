"""Master data change requests (migration 120): propose, check, approve and create or change a record in SAP.

Lifecycle:

  draft         the requester edits the proposal: SAP fields with values (``payload``, TABLE.FIELD: value), for a
                create, or for a change of the record ``object_key`` (MATNR=...|WERKS=...)
  (validate)    Meridian's own rules run on the proposal as a one-row frame (checks/runner.py run_checks, the tenant's
                rule governance applied), and the master records are searched for likely duplicates
                (api/services/merge_explain.py explain_pair, with the tenant's match rules). Nothing is blocked: the
                requester and the approvers see what the record would fail and what it may duplicate, and a
                workflow condition may test it (rule_failures, critical_failures, duplicates).
  submitted     validated again and handed to the tenant's change request workflow (api/services/workflow.py)
  in_approval   the workflow runs; approved or rejected when it ends
  approved      every step approved. With live write-back on (MERIDIAN_LIVE_WRITEBACK_ENABLED), outside sandbox mode,
                and a registered ABAP system with stored credentials, it moves to creating and a worker creates it;
                otherwise it stays approved with an export load file and the reason (``delivery`` = export)
  creating      workers/tasks/change_requests.py: simulate, then create (sap/bapi_create.py) or change
                (sap/bapi_writeback.py), commit only on no E or A message; the phase reached is stored before the
                commit is sent, so a retry never creates twice
  created       SAP committed it; ``sap_key`` is the created key, ``sap_result`` SAP's RETURN messages
  failed        SAP refused it or the connection failed after the retries; the messages say why. A failure before
                the commit may be retried; one during the commit is not retried (check SAP first)
  rejected, cancelled

Every transition is a workflow_events row (and audit_log), a ``change_request.*`` webhook event and, for the
requester, an inbox notification. Synchronous (a Session, app.tenant_id set by the caller, who commits).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text

from api.services import workflow
from sap.bapi_create import MODULE_OF, OBJECTS, plan_create

logger = logging.getLogger("meridian.change_requests")

KIND = "change_request"
STATUSES = ("draft", "submitted", "in_approval", "approved", "rejected", "creating", "created", "failed", "cancelled")
EDITABLE = ("draft",)
CANCELLABLE = ("draft", "submitted", "in_approval", "approved", "failed")
OBJECT_TABLES: dict[str, set[str]] = {
    "material": {"MARA", "MARC", "MBEW", "MVKE", "MAKT", "MARM"},
    "business_partner": {"BUT000", "BUT100", "ADRC"},
    "customer": {"KNA1", "KNVV", "KNB1", "BUT000", "BUT100", "ADRC"},
    "vendor": {"LFA1", "LFB1", "LFM1", "LFBK", "BUT000", "BUT100", "ADRC"},
}
# The record key field of each object and the table it lives in (placeholders while a record is not created yet).
KEY_FIELD = {"material": ("MARA", "MATNR"), "business_partner": ("BUT000", "PARTNER"), "customer": ("KNA1", "KUNNR"),
             "vendor": ("LFA1", "LIFNR")}
NEW_KEY = "NEW"
# Master record domains searched for duplicates, and how the proposal's fields read in each domain.
DUPLICATE_DOMAINS: dict[str, tuple[str, ...]] = {
    "material": ("material_master",), "business_partner": ("business_partner",),
    "customer": ("business_partner", "sd_customer_master"), "vendor": ("business_partner", "accounts_payable"),
}
MAX_CANDIDATES = 5000
MAX_DUPLICATES = 10
EXPORT_FORMAT = "meridian.change_request.v1"
LIVE_OFF = ("Live SAP write-back is off on this deployment (MERIDIAN_LIVE_WRITEBACK_ENABLED); the approved record "
            "goes to SAP with the export load file")
SANDBOX = "Sandbox mode is on: nothing is written to SAP; the approved record goes with the export load file"
NO_SYSTEM = ("No registered ABAP system with stored credentials is the target of this request; the approved record "
             "goes with the export load file")


class RequestError(Exception):
    def __init__(self, status: int, detail: Any) -> None:
        super().__init__(str(detail))
        self.status = status
        self.detail = detail


# ── the proposal ──────────────────────────────────────────────────────────────


def normalise(payload: dict[str, Any]) -> dict[str, Any]:
    return {str(k).strip().upper(): v for k, v in payload.items()}


def check_payload(obj: str, kind: str, payload: dict[str, Any], object_key: Optional[str]) -> list[str]:
    """Problems with a proposal, as sentences: fields of another object, fields SAP does not have, values longer than
    the field, values that are not plain text or numbers, a change without its record key."""
    from sap.ddic import get_dictionary

    if obj not in OBJECTS:
        return [f"Unknown object {obj}."]
    d = get_dictionary("ecc")
    out: list[str] = []
    for f, v in normalise(payload).items():
        table = f.split(".")[0] if "." in f else ""
        if table not in OBJECT_TABLES[obj]:
            out.append(f"{f}: not a field of a {obj.replace('_', ' ')} (tables {', '.join(sorted(OBJECT_TABLES[obj]))}).")
            continue
        meta = d.resolve(f)
        if meta is None:
            out.append(f"{f}: SAP has no such field.")
            continue
        if v is not None and not isinstance(v, (str, int, float, bool)):
            out.append(f"{f}: give a single value.")
            continue
        length = getattr(meta, "length", None)
        if meta.type == "CHAR" and length and v is not None and len(str(v)) > int(length) and f != "BUT100.RLTYP":
            out.append(f"{f}: at most {length} characters.")
    if kind == "change" and not (object_key or "").strip():
        out.append("A change names the record it changes (object_key).")
    if not payload:
        out.append("Propose at least one field.")
    return out


def _frame(obj: str, payload: dict[str, Any], object_key: Optional[str]):
    """The proposal as a one-row TABLE.FIELD frame, with the record key in every table that has its fields."""
    import pandas as pd

    from sap.bapi_writeback import parse_key
    from sap.ddic import get_dictionary

    d = get_dictionary("ecc")
    row = {f: ("" if v is None else str(v)) for f, v in normalise(payload).items()}
    keys = parse_key(object_key or "")
    table, kf = KEY_FIELD[obj]
    keys.setdefault(kf, str(row.get(f"{table}.{kf}") or NEW_KEY))
    placeholders = set()
    for t in sorted({f.split(".")[0] for f in row} | {table}):
        for k, v in keys.items():
            col = f"{t}.{k}"
            if col not in row and d.resolve(col) is not None:
                row[col] = v
                if v == NEW_KEY:
                    placeholders.add(col)
    return pd.DataFrame([row]), placeholders


def rule_results(tid: str, obj: str, payload: dict[str, Any], object_key: Optional[str],
                 overrides: dict | None, extra_rules: list[dict] | None) -> dict:
    """Meridian's rules on the proposal: {rules_run, failures: [{check_id, severity, dimension, field, message}]}.
    CPU only (no database): the route runs it on a worker thread."""
    from checks.runner import run_checks

    df, placeholders = _frame(obj, payload, object_key)
    results = run_checks(MODULE_OF[obj], df, tid, overrides=overrides, extra_rules=extra_rules)
    failures = []
    for r in results:
        if r.passed or r.error or not r.affected_count:
            continue
        if r.field in placeholders:
            continue  # a rule on the number SAP has not given yet
        failures.append({"check_id": r.check_id, "severity": r.severity, "dimension": r.dimension, "field": r.field,
                         "message": r.message})
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    failures.sort(key=lambda x: (order.get(x["severity"], 9), x["check_id"]))
    return {"rules_run": len(results), "failures": failures}


def governance(session) -> tuple[dict, list[dict]]:
    """The tenant's rule overrides and authored rules, as a run applies them (workers/tasks/run_checks.py)."""
    from checks import lifecycle
    from checks.overrides import load_overrides

    overrides = load_overrides(session)
    authored = lifecycle.authored_rules({rid: o["body"] for rid, o in overrides.items() if "body" in o})
    return overrides, authored


def _aliases(obj: str) -> dict[str, str]:
    from sap.bapi_create import CVI_ALIASES
    return CVI_ALIASES.get(obj, {})


def duplicates(session, tid: str, obj: str, payload: dict[str, Any], exclude_key: Optional[str] = None) -> list[dict]:
    """Master records the proposal may duplicate: scored with the tenant's match rules of each domain (the shipped
    defaults where it has none), best first, the review band and above. Values shown are masked as the merge
    explanation masks them."""
    from api.services.merge_explain import explain_pair
    from workers.tasks.run_match import DEFAULT_RULES

    values = normalise(payload)
    for src, dst in _aliases(obj).items():
        if src in values:
            values.setdefault(dst, values[src])
    out: list[dict] = []
    for domain in DUPLICATE_DOMAINS[obj]:
        rules = [dict(r._mapping) for r in session.execute(text(
            "SELECT field, match_type, weight, threshold FROM match_rules WHERE tenant_id = CAST(:t AS uuid) "
            "AND domain = :d AND active"), {"t": tid, "d": domain})]
        if not rules:
            rules = [{"field": f, "match_type": m, "weight": w, "threshold": th} for f, m, w, th in
                     DEFAULT_RULES.get(domain, [])]
        if not rules or not any(values.get(r["field"].upper()) for r in rules):
            continue
        a = {r["field"]: values.get(r["field"].upper()) for r in rules}
        rows = session.execute(text(
            "SELECT id::text, sap_object_key, golden_fields FROM master_records WHERE tenant_id = CAST(:t AS uuid) "
            "AND domain = :d AND merged_into IS NULL AND (CAST(:x AS text) IS NULL OR sap_object_key <> :x) "
            "ORDER BY updated_at DESC LIMIT :n"), {"t": tid, "d": domain, "x": exclude_key, "n": MAX_CANDIDATES})
        for rid, key, golden in rows:
            g = golden or {}
            b = {r["field"]: g.get(r["field"], g.get(r["field"].split(".")[-1])) for r in rules}
            ex = explain_pair(rules, a, b)
            if ex["band"] == "auto_dismiss":
                continue
            out.append({"master_record_id": rid, "domain": domain, "sap_object_key": key, "score": ex["total"],
                        "band": ex["band"],
                        "attributes": [{"field": x["field"], "similarity": x["similarity"], "value": x.get("value_b")}
                                       for x in ex["attributes"] if not x["skipped"]]})
    out.sort(key=lambda x: (-x["score"], x["sap_object_key"]))
    return out[:MAX_DUPLICATES]


def facts(cr: dict, precheck: Optional[dict], classes: list[str]) -> dict:
    """What a workflow condition may test about a change request (workflow.FACTS)."""
    pc = precheck or {}
    failures = pc.get("failures") or []
    fields = sorted(normalise(cr["payload"]))
    return {"title": title_of(cr), "kind": cr["kind"], "object": cr["object"], "modules": [MODULE_OF[cr["object"]]],
            "fields": fields, "policy_classes": classes,
            "target_system_id": str(cr["target_system_id"]) if cr.get("target_system_id") else None,
            "rule_failures": len(failures), "critical_failures": sum(1 for f in failures if f["severity"] == "critical"),
            "duplicates": len(pc.get("duplicates") or [])}


def title_of(cr: dict) -> str:
    if cr.get("title"):
        return str(cr["title"])
    what = cr["object"].replace("_", " ")
    return f"New {what}" if cr["kind"] == "create" else f"Change of {what} {cr.get('object_key') or ''}".strip()


# ── reading and writing ───────────────────────────────────────────────────────


COLS = ("id::text AS id, kind, object, target_system_id::text AS target_system_id, object_key, title, payload, status, "
        "requester_id::text AS requester_id, requester_label, workflow_instance_id::text AS workflow_instance_id, "
        "precheck, validated_at, sap_key, sap_result, sap_phase, sap_attempts, delivery, export IS NOT NULL AS has_export, "
        "reason, created_at, updated_at, submitted_at, decided_at, completed_at")


def load(session, tid: str, cr_id: str, lock: bool = False) -> dict:
    row = session.execute(text(f"SELECT {COLS} FROM change_requests WHERE id = CAST(:i AS uuid) "
                               f"AND tenant_id = CAST(:t AS uuid){' FOR UPDATE' if lock else ''}"),
                          {"i": cr_id, "t": tid}).mappings().first()
    if row is None:
        raise RequestError(404, "Change request not found.")
    return dict(row)


def webhook_data(cr: dict, status: str) -> dict:
    return {"change_request_id": cr["id"], "kind": cr["kind"], "object": cr["object"], "status": status,
            "title": title_of(cr)[:200], "target_system_id": cr.get("target_system_id")}


def transition(session, tid: str, cr: dict, to: str, actor_id: Optional[str], actor_label: Optional[str],
               note: Optional[str] = None, *, event: Optional[str] = None, notify: bool = False,
               **cols: Any) -> dict:
    """Move a request to ``to`` (with any other columns), record it, queue its webhook event and, when asked, tell
    the requester. Returns the request as it now is."""
    sets = ", ".join([f"{k} = :{k}" if k not in ("sap_result", "export", "precheck") else f"{k} = CAST(:{k} AS jsonb)"
                      for k in cols] + ["status = :to", "updated_at = now()"])
    params = {k: (json.dumps(v, default=str) if k in ("sap_result", "export", "precheck") and v is not None else v)
              for k, v in cols.items()}
    session.execute(text(f"UPDATE change_requests SET {sets} WHERE id = CAST(:i AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                    {**params, "to": to, "i": cr["id"], "t": tid})
    workflow.event(session, tid, KIND, cr["id"], event or to, instance_id=cr.get("workflow_instance_id"),
                   from_status=cr["status"], to_status=to, actor_id=actor_id, actor_label=actor_label,
                   detail={"note": note} if note else None)
    name = f"change_request.{to}" if to in ("submitted", "approved", "rejected", "created", "failed", "cancelled") \
        else None
    if name:
        workflow._webhook(session, tid, name, webhook_data(cr, to))
    if notify and cr.get("requester_id") and cr["requester_id"] != actor_id:
        words = {"created": "was created in SAP", "failed": "could not be written to SAP",
                 "approved": "was approved"}.get(to, f"is {to.replace('_', ' ')}")
        workflow._notify(session, tid, cr["requester_id"], f"{title_of(cr)} {words}",
                         note or f"Your change request {words}.", workflow.link_of(KIND, cr["id"]))
    return load(session, tid, cr["id"])


# ── after the approval: SAP or the export ─────────────────────────────────────


def export_file(cr: dict, reason: str) -> dict:
    """The load file of an approved request: its fields, how SAP would take them (the planned calls, or for a change
    the BAPI per field) and why it goes by file."""
    from sap.bapi_writeback import plan_field

    payload = normalise(cr["payload"])
    doc: dict[str, Any] = {"format": EXPORT_FORMAT, "change_request_id": cr["id"], "kind": cr["kind"],
                           "object": cr["object"], "object_key": cr.get("object_key"),
                           "target_system_id": cr.get("target_system_id"), "reason": reason,
                           "fields": [{"field": f, "value": v} for f, v in sorted(payload.items())]}
    if cr["kind"] == "create":
        doc["plan"] = plan_create(cr["object"], payload).as_dict()
    else:
        module = MODULE_OF[cr["object"]]
        doc["plan"] = [{"field": f, "bapi": p.bapi, "supported": p.supported, "reason": p.reason}
                       for f in sorted(payload) for p in [plan_field(module, f, cr.get("object_key") or "")]]
    return doc


def abap_system(session, tid: str, system_id: Optional[str]) -> bool:
    if not system_id:
        return False
    return bool(session.execute(text(
        "SELECT 1 FROM sap_systems s JOIN system_credentials c ON c.system_id = s.id WHERE s.tenant_id = CAST(:t AS uuid) "
        "AND s.id = CAST(:s AS uuid) AND s.system_type IN ('ecc', 's4hana_onprem', 'ewm') LIMIT 1"),
        {"t": tid, "s": system_id}).first())


def after_approval(session, tid: str, cr: dict, actor_id: Optional[str], actor_label: Optional[str],
                   live_enabled: bool) -> dict:
    """An approved request: to SAP (status creating; the caller queues the worker after its commit) or, when live
    write-back is off, the tenant is in sandbox mode or no ABAP system with credentials is its target, approved with
    the export load file and the reason."""
    from api.services.sandbox import held_back_sync

    reason = None
    if not live_enabled:
        reason = LIVE_OFF
    elif held_back_sync(session, tid, "write_back", "change_request", cr["id"]):
        reason = SANDBOX
    elif not abap_system(session, tid, cr.get("target_system_id")):
        reason = NO_SYSTEM
    now = datetime.now(timezone.utc)
    if reason:
        return transition(session, tid, cr, "approved", actor_id, actor_label, reason, notify=True, decided_at=now,
                          delivery="export", reason=reason, export=export_file(cr, reason))
    cr = transition(session, tid, cr, "approved", actor_id, actor_label, notify=False, decided_at=now)
    return transition(session, tid, cr, "creating", actor_id, actor_label, delivery="sap", sap_phase=None)


def on_decided(session, tid: str, cr: dict, res: dict, actor_id: Optional[str], actor_label: Optional[str],
               comment: Optional[str], live_enabled: bool) -> dict:
    """Follow the workflow's outcome after a decision."""
    if res["status"] == "approved":
        return after_approval(session, tid, cr, actor_id, actor_label, live_enabled)
    if res["status"] == "rejected":
        return transition(session, tid, cr, "rejected", actor_id, actor_label, comment,
                          decided_at=datetime.now(timezone.utc))
    return load(session, tid, cr["id"])


# ── in SAP (the worker) ───────────────────────────────────────────────────────


def run_in_sap(session, tid: str, cr: dict, conn: Any, persist_phase) -> dict:
    """Create or change the record on ``conn`` (connected). Returns {status, sap_key, sap_result, reason, export?}
    for the caller to store; never raises a connector error for a refused record (it is in the result)."""
    payload = normalise(cr["payload"])
    if cr["kind"] == "create":
        from sap.bapi_create import create

        r = create(conn, cr["object"], payload, on_phase=persist_phase).as_dict()
        if r["unavailable"]:
            return {"status": "approved", "sap_result": r, "reason": r["unavailable"], "delivery": "export",
                    "export": export_file(cr, r["unavailable"])}
        if r["committed"]:
            return {"status": "created", "sap_key": r["key"], "sap_result": r, "reason": r["note"]}
        return {"status": "failed", "sap_result": r, "reason": r["error"] or "SAP refused the record; see its RETURN "
                                                                            "messages"}
    from sap.bapi_writeback import plan_field, write_record

    module = MODULE_OF[cr["object"]]
    key = cr["object_key"] or ""
    plans = {f: plan_field(module, f, key) for f in payload}
    send = {f: v for f, v in payload.items() if plans[f].supported}
    export = [{"field": f, "reason": p.reason} for f, p in sorted(plans.items()) if not p.supported]
    if not send:
        reason = "No field of this change has a BAPI mapping; it goes with the export load file"
        return {"status": "approved", "sap_result": {"export": export}, "reason": reason, "delivery": "export",
                "export": export_file(cr, reason)}
    persist_phase("committing")  # a change is idempotent, but the phase is kept the same way
    r = write_record(conn, module, key, send, apply=True).as_dict()
    r["export"] = export + r.get("export", [])
    if r["committed"]:
        note = f"{len(r['export'])} field(s) were not sent and go with the export load file" if r["export"] else None
        return {"status": "created", "sap_key": key, "sap_result": r, "reason": note,
                **({"export": export_file(cr, note)} if r["export"] else {})}
    return {"status": "failed", "sap_result": r, "reason": r["error"] or "SAP refused the change; see its RETURN "
                                                                         "messages"}
