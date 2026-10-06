"""Derive the process model from extracted configuration (header and config tables only).

``derive_model(tables, system_type)`` starts from the template reference model and, for every node with a probe
(``sap.process_templates.PROBES``), reads the config table:

* rows present   -> node "configured", evidence = config keys and value (table, key fields, code only)
* table present, no rows -> "not_configured"
* table not extracted    -> node untouched (template fallback)
* Z/Y codes in the table with no template step -> new "client_specific" L5 spliced into the L4 diagram

Variant probes list the config values of an L4 (``config_variants``). On S/4HANA the vendor and customer master
steps are replaced by the Business Partner (BP). Only configuration is read; no transactional or master data.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

import pandas as pd

from api.models.process_model import ProcessModelDocument
from sap.process_definitions import PROCESS_DEFINITIONS, _diagram
from sap.process_templates import PROBES, VARIANT_PROBES, Probe

S4_SYSTEMS = {"s4hana_onprem", "s4hana_cloud"}
BP_REPLACED = {"FK01": "vendor", "XK01": "vendor", "FD01": "customer", "XD01": "customer", "VD01": "customer"}
MAX_EVIDENCE = 10
MAX_VARIANTS = 25
MAX_CLIENT_SPECIFIC = 10


def _frame(tables: Mapping[str, pd.DataFrame], probe: Probe, s4: bool) -> tuple[Optional[pd.DataFrame], str]:
    """First extracted table of the probe that has all its key columns, and its name."""
    from sap.ddic import get_dictionary

    dic = get_dictionary("ecc6")
    for name in (probe.table, *probe.alt):
        t = dic.table(name)
        if s4 and t is not None and t.obsolete_in == "s4hana":
            continue
        df = tables.get(name)
        if df is None:
            continue
        need = list(dict.fromkeys([*probe.keys, *(k for k, _ in probe.where)]))
        if all(_col(df, name, c) is not None for c in need):
            return df, name
    return None, probe.table


def _col(df: pd.DataFrame, table: str, name: str) -> Optional[pd.Series]:
    for c in (f"{table}.{name}", name):
        if c in df.columns:
            return df[c]
    return None


def _rows(df: pd.DataFrame, table: str, probe: Probe) -> list[dict[str, str]]:
    """Distinct key rows (as strings) after the where-filter, sorted by code."""
    mask = pd.Series(True, index=df.index)
    for fld, vals in probe.where:
        mask &= _col(df, table, fld).astype(str).str.strip().isin(vals)
    cols = {k: _col(df, table, k).astype(str).str.strip() for k in probe.keys}
    sub = pd.DataFrame(cols)[mask].drop_duplicates()
    code = probe.code or probe.keys[0]
    sub = sub[sub[code] != ""]
    return sub.sort_values(code).to_dict("records") if len(sub) else []


def _evidence(table: str, probe: Probe, row: dict[str, str]) -> dict[str, Any]:
    return {"table": table, "keys": row, "value": row[probe.code or probe.keys[0]]}


def _client_specific(code: str) -> bool:
    return code[:1].upper() in ("Z", "Y")


def _apply_probe(node: dict[str, Any], probe: Probe, tables: Mapping[str, pd.DataFrame], s4: bool) -> list[dict[str, str]]:
    df, name = _frame(tables, probe, s4)
    if df is None:
        return []
    rows = _rows(df, name, probe)
    node["source"] = "config"
    node["status"] = "configured" if rows else "not_configured"
    node["evidence"] = [_evidence(name, probe, r) for r in rows[:MAX_EVIDENCE]]
    return rows


def _splice(l4: dict[str, Any], probe: Probe, rows: list[dict[str, str]], table: str) -> None:
    code = probe.code or probe.keys[0]
    z = [r for r in rows if _client_specific(r[code])][:MAX_CLIENT_SPECIFIC]
    seen = {a["name"] for a in l4["activities"]}
    for r in z:
        name = f"Client-specific {r[code]}"
        if name in seen:
            continue
        n = len(l4["activities"]) + 1
        l4["activities"].append({
            "id": f"{l4['id']}-X{n:02d}", "name": name, "description": f"Customer-defined {table} entry {r[code]}.",
            "order": n, "tcode": l4["tcode"], "fields": [], "check_ids": [], "sap_tables": [table], "rule_modules": [],
            "source": "config", "status": "client_specific", "evidence": [_evidence(table, probe, r)]})


def detect_system_type(tables: Mapping[str, pd.DataFrame]) -> str:
    """S/4HANA when its universal journal / material document tables were extracted, else ECC."""
    return "s4hana_onprem" if {"ACDOCA", "MATDOC"} & set(tables) else "ecc"


def derive_model(tables: Mapping[str, pd.DataFrame], system_type: str = "ecc") -> ProcessModelDocument:
    """Derived model: template where no config table was extracted, config evidence where it was."""
    from copy import deepcopy

    s4 = system_type in S4_SYSTEMS
    l1s = deepcopy(PROCESS_DEFINITIONS)
    derived = False
    for l1 in l1s:
        for l2 in l1["l2"]:
            for l3 in l2["l3"]:
                for l4 in l3["l4"]:
                    derived |= _derive_l4(l4, tables, s4)
    doc = {"schema_version": 1, "source": "config" if derived else "template", "system_type": system_type, "l1": l1s}
    return ProcessModelDocument.model_validate(doc)


def _derive_l4(l4: dict[str, Any], tables: Mapping[str, pd.DataFrame], s4: bool) -> bool:
    touched = False
    for a in l4["activities"]:
        probe = PROBES.get(a["id"])
        if probe:
            touched |= bool(_apply_probe(a, probe, tables, s4) or a.get("status"))
    probe = PROBES.get(l4["id"])
    if probe:
        rows = _apply_probe(l4, probe, tables, s4)
        touched |= l4.get("status") is not None
        if probe.client_specific and rows:
            _splice(l4, probe, rows, _frame(tables, probe, s4)[1])
    for vp in VARIANT_PROBES.get(l4["id"], ()):
        df, name = _frame(tables, vp, s4)
        if df is not None:
            l4.setdefault("config_variants", []).extend(
                _evidence(name, vp, r) for r in _rows(df, name, vp)[:MAX_VARIANTS])
            l4["source"] = "config"
            touched = True
    if s4 and l4["tcode"] in BP_REPLACED:
        _to_business_partner(l4, BP_REPLACED[l4["tcode"]])
    if l4.get("source") == "config":
        l4["diagram"] = _diagram(l4)
    return touched


def _to_business_partner(l4: dict[str, Any], role: str) -> None:
    """S/4HANA: the vendor/customer master transaction is BP with the matching role."""
    l4["name"] = f"Maintain Business Partner ({role} role)"
    l4["tcode"] = "BP"
    l4["description"] = f"S/4HANA replaces the {role} master transaction by the Business Partner (BP)."
    for a in l4["activities"]:
        a["tcode"] = "BP"
