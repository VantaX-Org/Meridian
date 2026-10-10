"""Remediation batches: failing records + proposed values, exported as files.

Meridian never writes to SAP. A batch is a file a human loads through their own
controlled process (Migration Cockpit staging, LSMW, mass change). Proposed
values come from the rule's ``auto_fix`` (checks/auto_fix.py, self-verified against
the rule), a steward's entry, or stay blank for manual correction. High-confidence
rule proposals can be bulk-accepted by a second person (four eyes).

Reconciliation rides on the record-issue lifecycle (api/services/record_issues.track):
on the next extraction every exported item whose check ran is marked
``still_failing`` (record in finding_records) or ``fixed`` (check ran cleanly
and the record was present).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Iterable, Optional

import pandas as pd
import yaml
from sqlalchemy import text

from checks.base import record_keys
from checks import auto_fix


@lru_cache(maxsize=64)
def module_rules(module: str) -> dict[str, dict]:
    from checks.runner import _find_module_yaml
    try:
        rules = yaml.safe_load(_find_module_yaml(module).read_text()).get("rules", [])
    except FileNotFoundError:
        return {}
    return {r["id"]: r for r in rules if r.get("id")}


def _value(v) -> Optional[str]:
    return None if v is None or (not isinstance(v, str) and pd.isna(v)) else str(v)


def _rule_frame(frames, rule: dict, field: str, grain):
    for cols in ([field, *auto_fix.columns(rule)], [field]):
        try:
            built = frames.frame_for(list(dict.fromkeys(cols)), grain=grain)
        except ValueError:
            built = None
        if built is not None:
            return built
    return None


def build_items(issues: Iterable[dict], frames) -> list[dict]:
    """Batch rows for record issues: current value read from the extraction, proposed
    value and confidence from the rule's auto_fix, verified by re-running the rule."""
    from checks.runner import REGISTRY
    issues = list(issues)
    found: dict[tuple, dict[str, tuple]] = {}  # (check, field, grain) -> record_key -> (current, proposal)
    for i in issues:
        field, grain = i.get("field"), i.get("grain")
        ck = (i["module"], i["check_id"], field, grain)
        if not field or frames is None or ck in found:
            continue
        found[ck] = {}
        rule = module_rules(i["module"]).get(i["check_id"], {})
        built = _rule_frame(frames, rule, field, grain)
        if built is None:
            continue
        df, _, key_cols = built
        keys = record_keys(df, key_cols)
        wanted = {x["record_key"] for x in issues if (x["module"], x["check_id"], x.get("field"), x.get("grain")) == ck}
        rows = pd.Series([k in wanted for k in keys])
        check = REGISTRY.get(rule.get("check_class", ""))
        props = auto_fix.proposals(rule, df.reset_index(drop=True), rows, frames.frames,
                                   check(rule).evaluate if check else None) if auto_fix.enabled(rule) else {}
        found[ck] = {k: (_value(v), props.get(n)) for n, (k, v) in enumerate(zip(keys, df[field])) if k in wanted}
    out = []
    for i in issues:
        field = i.get("field")
        ck = (i["module"], i["check_id"], field, i.get("grain"))
        current, hit = found.get(ck, {}).get(i["record_key"], (None, None))
        if hit is None and field and frames is None:  # dataset gone: unverified, never auto-approvable
            hit = auto_fix.propose(module_rules(i["module"]).get(i["check_id"], {}), {field: None})
            hit = hit and (hit[0], "low")
        out.append({**{k: i.get(k) for k in ("issue_id", "scope", "module", "check_id", "record_key", "grain")},
                    "field": field, "current_value": current, "proposed_value": hit[0] if hit else None,
                    "confidence": hit[1] if hit else None, "proposal_source": "rule" if hit else "manual"})
    return out


def auto_approvable(item: dict) -> bool:
    """A self-verified high-confidence rule proposal a second person may accept in bulk."""
    return item.get("proposal_source") == "rule" and item.get("confidence") == "high" \
        and item.get("proposed_value") is not None


# object type → (anchor table, its business key) for cleaning rows whose record_key is a bare number
ANCHOR: dict[str, tuple[str, str]] = {
    "material": ("MARA", "MATNR"), "material_master": ("MARA", "MATNR"),
    "customer": ("KNA1", "KUNNR"), "customer_master": ("KNA1", "KUNNR"), "sd_customer_master": ("KNA1", "KUNNR"),
    "accounts_receivable": ("KNA1", "KUNNR"),
    "vendor": ("LFA1", "LIFNR"), "vendor_master": ("LFA1", "LIFNR"), "accounts_payable": ("LFA1", "LIFNR"),
    "business_partner": ("BUT000", "PARTNER"),
}


def _item(scope: str, module: str, check_id: str, record_key: str, field: str,
         current: Optional[str], proposed: str) -> dict:
    return {"issue_id": None, "scope": scope, "module": module, "check_id": check_id, "record_key": record_key,
            "grain": field.split(".", 1)[0], "field": field, "current_value": current,
            "proposed_value": proposed, "proposal_source": scope, "confidence": None}


def items_from_cleaning(rows: list[dict]) -> list[dict]:
    """Approved cleaning_queue rows → one item per field whose value changes.

    ``check_id`` is ``"{rule}:{TABLE.FIELD}"``, not just the rule, because
    ``uq_remediation_items`` is (batch, check, record) and one cleaning row can
    change several fields."""
    out = []
    for r in rows:
        table, key = ANCHOR.get(r["object_type"], (None, None))
        before, after = r.get("record_data_before") or {}, r.get("record_data_after") or {}
        rk = r["record_key"] if "=" in r["record_key"] or key is None else f"{key}={r['record_key']}"
        for f in after:
            old, new = before.get(f), after.get(f)
            if new is None or str(new) == str(old if old is not None else ""):
                continue
            field = f if "." in f else (f"{table}.{f}" if table else None)
            if field is None:
                continue
            out.append(_item("cleaning", r["object_type"], f"{r.get('rule_id') or 'CLEANING'}:{field}", rk, field,
                             None if old is None else str(old), str(new)))
    return out


def items_from_simulation(fixes: list[dict]) -> list[dict]:
    """Record fixes a simulation applied (``[{check_id, module, field, record_key,
    current_value, new_value}]``)."""
    return [_item("simulation", f["module"], f["check_id"], f["record_key"], f["field"], f.get("current_value"),
                  str(f["new_value"])) for f in fixes if f.get("field") and f.get("new_value") is not None]


def draft_batch(session, tenant_id: str, name: str, filter_json: str, issues: list[dict],
                user_id: Optional[str], user_label: Optional[str]) -> dict:
    """Insert a draft batch for record issues (rows of issue_id, scope, module, check_id,
    record_key, grain, last_seen_version, field). Current values come from each issue's
    latest extraction, read locally. Sync: the API calls it through ``run_sync``, the
    monitor from the worker. ``user_id`` None marks a system-drafted batch."""
    from api.services.source_design import dictionary_for
    from workers.dataset import load_dataset

    items = []
    for vid in {i["last_seen_version"] for i in issues}:
        group = [i for i in issues if i["last_seen_version"] == vid]
        meta = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v"),
                               {"v": vid}).scalar() or {}
        frames = None
        if meta.get("dataset_path"):
            fields = {i["field"] for i in group if i["field"]}
            try:
                # ponytail: loads the version's dataset per batch; move to a worker task if batches get slow
                frames = load_dataset(meta["dataset_path"], dictionary_for(session, meta.get("system_id")),
                                      sorted({i["module"] for i in group}), fields)[0]
            except Exception:
                frames = None  # dataset gone: current values stay blank
        items += build_items(group, frames)

    return store_batch(session, tenant_id, name, filter_json, items, user_id, user_label)


def store_batch(session, tenant_id: str, name: str, filter_json: str, items: list[dict],
                user_id: Optional[str], user_label: Optional[str]) -> dict:
    """Insert a draft batch + its items + 'created' events. Caller has set app.tenant_id."""
    import json
    import uuid

    batch_id = uuid.uuid4()
    session.execute(text("""
        INSERT INTO remediation_batches (id, tenant_id, name, filter, created_by, created_by_label)
        VALUES (:id, :tid, :name, CAST(:filter AS jsonb), CAST(:uid AS uuid), :label)
    """), {"id": batch_id, "tid": tenant_id, "name": name, "filter": filter_json, "uid": user_id,
           "label": user_label})
    for chunk in range(0, len(items), 1000):
        session.execute(text("""
            INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key,
                                           grain, field, current_value, proposed_value, proposal_source, confidence)
            SELECT :tid, :bid, (x->>'issue_id')::uuid, x->>'scope', x->>'module', x->>'check_id', x->>'record_key',
                   x->>'grain', x->>'field', x->>'current_value', x->>'proposed_value', x->>'proposal_source',
                   x->>'confidence'
              FROM jsonb_array_elements(CAST(:items AS jsonb)) x
            ON CONFLICT DO NOTHING
        """), {"tid": tenant_id, "bid": batch_id, "items": json.dumps(items[chunk:chunk + 1000], default=str)})
    session.execute(text("INSERT INTO remediation_events (tenant_id, batch_id, item_id, user_id, user_label, action) "
                         "SELECT :tid, :bid, id, CAST(:uid AS uuid), :label, 'created' "
                         "FROM remediation_items WHERE batch_id = :bid"),
                    {"tid": tenant_id, "bid": batch_id, "uid": user_id, "label": user_label})
    return {"id": str(batch_id), "status": "draft", "items": len(items),
            "with_proposal": sum(1 for i in items if i["proposed_value"] is not None),
            "auto_approvable": sum(1 for i in items if auto_approvable(i))}


# ── export files ─────────────────────────────────────────────────────────────


def _key_parts(record_key: str) -> dict[str, str]:
    return dict(p.split("=", 1) for p in record_key.split("|") if "=" in p)


def _exportable(items: list[dict]) -> list[dict]:
    """Items with a value to load; blank proposals stay with the steward."""
    return [i for i in items if i.get("field") and i.get("proposed_value") is not None]


def cockpit_sheets(items: list[dict], dictionary=None) -> dict[str, pd.DataFrame]:
    """Migration Cockpit staging layout: one sheet per SAP table, technical field
    names as columns, the table's key fields first, one row per record."""
    rows: dict[str, dict[tuple, dict]] = {}
    for i in _exportable(items):
        table, fname = i["field"].split(".", 1)
        keys = _key_parts(i["record_key"])
        ddic_keys = set(dictionary.keys(table)) if dictionary is not None else set()
        if ddic_keys & set(keys):
            keys = {k: v for k, v in keys.items() if k in ddic_keys}
        row = rows.setdefault(table, {}).setdefault(tuple(keys.items()), dict(keys))
        row[fname] = i["proposed_value"]
    return {t: pd.DataFrame(list(r.values())).fillna("") for t, r in sorted(rows.items())}


def cockpit_csv(items: list[dict], dictionary=None) -> pd.DataFrame:
    sheets = cockpit_sheets(items, dictionary)
    return pd.concat([df.assign(TABLE=t)[["TABLE", *df.columns]] for t, df in sheets.items()],
                     ignore_index=True).fillna("") if sheets else pd.DataFrame(columns=["TABLE"])


def mass_change(items: list[dict]) -> pd.DataFrame:
    """Generic LSMW / mass-change file: one row per field change, old and new value."""
    from api.services.export_engine import TRANSACTION_CODES
    return pd.DataFrame([{
        "TCODE": TRANSACTION_CODES.get(i["module"], ""),
        "TABLE": i["field"].split(".", 1)[0],
        "FIELD": i["field"].split(".", 1)[1],
        "RECORD_KEY": i["record_key"],
        "OLD_VALUE": i.get("current_value") or "",
        "NEW_VALUE": i["proposed_value"],
        "RULE": i["check_id"],
    } for i in _exportable(items)], columns=["TCODE", "TABLE", "FIELD", "RECORD_KEY", "OLD_VALUE", "NEW_VALUE", "RULE"])


# ── post-load reconciliation ─────────────────────────────────────────────────


def reconcile(session, tenant_id: str, version_id: str, scope: str) -> int:
    """Mark exported batch items fixed / still failing from this run.

    Call right after ``record_issues.track`` in the same transaction: it reads
    ``tmp_present`` (records evaluated in this run). Only runs after the export count.
    """
    return session.execute(text("""
        WITH ran AS (
            SELECT check_id FROM findings
             WHERE version_id = :vid AND tenant_id = :tid
               AND details->>'error' IS NULL
               AND COALESCE((details->>'failing_keys_truncated')::boolean, false) = false
        ), upd AS (
            UPDATE remediation_items i
               SET recon_status = CASE WHEN EXISTS (
                       SELECT 1 FROM finding_records fr WHERE fr.version_id = :vid
                          AND fr.check_id = i.check_id AND fr.record_key = i.record_key)
                   THEN 'still_failing' ELSE 'fixed' END,
                   recon_version = :vid, updated_at = now()
              FROM remediation_batches b
             WHERE b.id = i.batch_id AND b.status = 'exported' AND i.tenant_id = :tid AND i.scope = :scope
               AND b.exported_at < (SELECT run_at FROM analysis_versions WHERE id = :vid)
               AND (EXISTS (SELECT 1 FROM finding_records fr WHERE fr.version_id = :vid
                              AND fr.check_id = i.check_id AND fr.record_key = i.record_key)
                    OR (i.check_id IN (SELECT check_id FROM ran)
                        AND EXISTS (SELECT 1 FROM tmp_present tp
                                     WHERE tp.grain = COALESCE(i.grain, '') AND tp.record_key = i.record_key)))
            RETURNING i.id, i.batch_id, i.recon_status
        )
        INSERT INTO remediation_events (tenant_id, batch_id, item_id, action, to_value, version_id, user_label)
        SELECT :tid, batch_id, id, 'reconciled', recon_status, :vid, 'system' FROM upd
    """), {"tid": tenant_id, "vid": version_id, "scope": scope}).rowcount
