"""Remediation batches: failing records + proposed values, exported as files.

Meridian never writes to SAP. A batch is a file a human loads through their own
controlled process (Migration Cockpit staging, LSMW, mass change). Proposed
values come from the rule's ``fix_value`` (checks/fix_generator.proposed_value),
a steward's entry, or stay blank for manual correction.

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
from checks.fix_generator import proposed_value


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


def build_items(issues: Iterable[dict], frames) -> list[dict]:
    """Batch rows for record issues: current value read from the extraction, proposed value from the rule."""
    lookups: dict[tuple, dict[str, Optional[str]]] = {}
    out = []
    for i in issues:
        field, grain = i.get("field"), i.get("grain")
        current = None
        if field and frames is not None:
            if (field, grain) not in lookups:
                lookups[(field, grain)] = {}
                try:
                    built = frames.frame_for([field], grain=grain)
                except ValueError:
                    built = None
                if built is not None:
                    df, _, key_cols = built
                    lookups[(field, grain)] = dict(zip(record_keys(df, key_cols), [_value(v) for v in df[field]]))
            current = lookups[(field, grain)].get(i["record_key"])
        rule = module_rules(i["module"]).get(i["check_id"], {})
        proposed = proposed_value(rule, current) if field else None
        out.append({**{k: i.get(k) for k in ("issue_id", "scope", "module", "check_id", "record_key", "grain")},
                    "field": field, "current_value": current, "proposed_value": proposed,
                    "proposal_source": "rule" if proposed is not None else "manual"})
    return out


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
