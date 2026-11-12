"""Load simulation: a Migration-Cockpit-style "would fail" report for one migration run.

Not to be confused with load_sim.py, which *produces* s4_load findings during analysis. This module only
reads findings a run already stored and regroups them the way SAP's Migration Cockpit reports a simulated
load: per load object, per error message, with the record count, sample record keys and, for check-table
misses, the configuration that has to be transported before the load can pass.

A finding makes its record fail the simulated load when its severity is blocking (critical/high) or it
is a check-table miss of any severity: SAP rejects a value its check table does not hold, whatever the
analysis rated it. A check-table miss measured against the SAP standard baseline rather than the
connected target's own configuration (provenance ``target_baseline_config``) is provisional: the
target may already hold the value. Messages are built deterministically from the gap type and the DDIC
field; nothing here calls an LLM.
"""
from __future__ import annotations

import re
from typing import Optional

from sap.ddic import Dictionary, Field

BLOCKING = ("critical", "high")
BASELINE = "target_baseline_config"
VALUE_GAPS = ("check_table_value", "domain_value", "value_unmapped")
SEVERITIES = ("critical", "high", "medium", "low")
SAMPLES = 5
_CHECK_TABLE_IN_DETAIL = re.compile(r"'s ([A-Z0-9_/]+)$")


def would_fail(gap_type: str, severity: str) -> bool:
    """True when the finding makes its record fail a simulated load."""
    return severity in BLOCKING or gap_type == "check_table_value"


def split_field(dest_table: Optional[str], field: Optional[str]) -> tuple[str, str]:
    """Finding field to (table, field). Engine findings carry ``TABLE.FIELD`` (keys ``TABLE.K1+K2``),
    s4_load findings carry the bare field with the table in dest_table."""
    f = (field or "").strip()
    if "." in f:
        t, n = f.split(".", 1)
        return t.upper(), n.upper()
    return (dest_table or "").upper(), f.upper()


def _q(v: Optional[str]) -> str:
    return f"'{v}'" if v not in (None, "") else "(initial)"


def message(gap_type: str, table: str, field: str, ddic: Optional[Field], value: Optional[str] = None,
            other_values: int = 0, detail: str = "", check_table: Optional[str] = None) -> str:
    """Migration-Cockpit-style error text for one group. Deterministic; uses DDIC type, length,
    decimals, domain and check table where the dictionary knows the field."""
    tf = f"{table}-{field}" if table else field
    typ = (ddic.type or "").upper() if ddic else ""
    more = f" (+{other_values} more values)" if other_values > 0 else ""
    if gap_type == "check_table_value":
        ct = check_table or (ddic.check_table if ddic else None)
        return f"Value {_q(value)} not allowed for field {tf}" + (f" (check table {ct})" if ct else "") + more
    if gap_type == "domain_value":
        dom = ddic.domain if ddic and ddic.domain else None
        return f"Value {_q(value)} is not a fixed value" + (f" of domain {dom}" if dom else "") + f" for field {tf}{more}"
    if gap_type == "value_unmapped":
        return f"No value mapping for {_q(value)} in field {tf}{more}"
    if gap_type == "length_truncation":
        return f"Field {tf} too long: {typ or 'CHAR'} {ddic.length}" if ddic and ddic.length else f"Field {tf} too long"
    if gap_type == "type_conversion":
        return f"Value cannot be converted for field {tf}: {typ} {ddic.length}" if ddic else f"Value cannot be converted for field {tf}"
    if gap_type == "precision_loss":
        return f"Value exceeds {typ} {ddic.length},{ddic.decimals} for field {tf}" if ddic else f"Value too large for field {tf}"
    if gap_type in ("target_mandatory", "field_status_blank_in_target"):
        return f"Required entry missing for field {tf}"
    if gap_type == "field_status_obsolete_in_target":
        return f"Field {tf} is suppressed by the target field status; value is not accepted"
    if gap_type == "key_missing":
        return f"Key {tf} is initial; record cannot be created"
    if gap_type == "key_collision":
        return f"Duplicate key {tf} in the load file"
    if gap_type == "target_key_exists":
        return f"Record with key {tf} already exists in the target"
    if gap_type in ("obsolete_target", "target_field_missing"):
        return f"Field {tf} does not exist in the target"
    if gap_type == "s4_load":
        return detail or f"S/4HANA load rule failed for field {tf}"
    return f"{gap_type.replace('_', ' ').capitalize()} for field {tf}" + (f": {detail}" if detail else "")


def _check_table(gap_type: str, ddic: Optional[Field], detail: str) -> Optional[str]:
    if gap_type != "check_table_value":
        return None
    if ddic and ddic.check_table:
        return ddic.check_table
    m = _CHECK_TABLE_IN_DETAIL.search(detail or "")
    return m.group(1) if m else None


def build(groups: list[dict], values: list[dict], failing: list[dict], records: dict[str, int],
          modules: list[str], dictionary: Dictionary, labels: dict[str, str]) -> dict:
    """Assemble the report.

    groups: one row per (module, dest_table, gap_type, field, rule) with records, findings, sev_rank,
        all_baseline, detail and samples (record keys).
    values: offending values per (module, dest_table, gap_type, field) with records, most first.
    failing: per module, distinct failing records and how many of them fail only provisionally.
    records: records analysed per module (run gap_summary).
    """
    vals: dict[tuple, list[dict]] = {}
    for v in values:
        vals.setdefault((v["module"], v["dest_table"], v["gap_type"], v["field"]), []).append(
            {"value": v["value"], "records": int(v["records"] or 0)})
    fail = {f["module"]: f for f in failing}
    out_groups: list[dict] = []
    transports: list[dict] = []
    for g in groups:
        table, fname = split_field(g["dest_table"], g["field"])
        ddic = dictionary.field(table, fname) if table and fname and "+" not in fname else None
        detail = g.get("detail") or ""
        ct = _check_table(g["gap_type"], ddic, detail)
        vs = vals.get((g["module"], g["dest_table"], g["gap_type"], g["field"]), [])
        top = vs[0]["value"] if vs else None
        sev = SEVERITIES[min(int(g["sev_rank"]), 3)]
        provisional = bool(g["all_baseline"]) and g["gap_type"] == "check_table_value"
        row = {
            "module": g["module"], "dest_table": table, "field": fname, "gap_type": g["gap_type"],
            "rule": g.get("rule") or None, "severity": sev, "records": int(g["records"] or 0),
            "findings": int(g["findings"] or 0), "structural": not g["records"], "provisional": provisional,
            "message": message(g["gap_type"], table, fname, ddic, top, max(len(vs) - 1, 0), detail, ct),
            "field_text": ddic.description if ddic else None, "check_table": ct,
            "values": vs[:20] if g["gap_type"] in VALUE_GAPS else [],
            "samples": [s for s in (g.get("samples") or []) if s][:SAMPLES],
        }
        out_groups.append(row)
        if ct:
            t = dictionary.table(ct)
            transports.append({
                "module": g["module"], "check_table": ct, "check_table_text": t.description if t else None,
                "field": f"{table}-{fname}", "field_text": row["field_text"], "provisional": provisional,
                "records": row["records"], "values": vs,
            })
    out_groups.sort(key=lambda r: (SEVERITIES.index(r["severity"]), -r["records"], r["message"]))
    transports.sort(key=lambda r: (r["provisional"], -r["records"]))
    objects = []
    for m in modules:
        total = int(records.get(m) or 0)
        f = fail.get(m) or {}
        n_fail = min(int(f.get("failing") or 0), total) if total else int(f.get("failing") or 0)
        mine = [g for g in out_groups if g["module"] == m]
        objects.append({
            "module": m, "label": labels.get(m, m), "records": total, "would_fail": n_fail,
            "would_load": max(total - n_fail, 0), "provisional": int(f.get("provisional") or 0),
            "tables": sorted({g["dest_table"] for g in mine if g["dest_table"]}),
            "structural": sum(1 for g in mine if g["structural"]), "messages": len(mine),
        })
    return {
        "release": dictionary.release, "objects": objects, "groups": out_groups, "transports": transports,
        "totals": {k: sum(o[k] for o in objects) for k in ("records", "would_load", "would_fail", "provisional")},
    }
