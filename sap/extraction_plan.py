"""Derive what to extract from an ABAP system from the rules themselves.

The plan for a set of modules is exactly the tables/fields their rules read,
plus each table's DDIC key, the join fields and filters from
sap/dictionaries/joins.yaml (so the engine can evaluate every rule at its
grain), and the configuration (check) tables whose live values replace the
rules' SAP-standard value lists. The plan therefore can never drift from the
rules — the hand-kept registry did (it had no LFBK, ADR6, ANLZ, EQUZ, ILOA …).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Optional

import yaml

from checks.frames import _MOVED, TableFrames, _graph, tables_of
from sap.ddic import Dictionary

_WINDOWS = Path(__file__).resolve().parent / "dictionaries" / "extraction_windows.yaml"

_ECC = ["business_partner", "material_master", "fi_gl", "accounts_payable", "accounts_receivable",
        "asset_accounting", "mm_purchasing", "plant_maintenance", "production_planning",
        "sd_customer_master", "sd_sales_orders"]
_LOGISTICS = ["batch_management", "ewms_stock", "ewms_transfer_orders", "wm_interface",
              "fleet_management", "transport_management", "mdg_master_data", "grc_compliance"]
_SF = ["employee_central", "compensation", "benefits", "payroll_integration", "performance_goals",
       "succession_planning", "recruiting_onboarding", "learning_management", "time_attendance"]

# Modules whose rules can be evaluated on data from each system type.
MODULES_BY_SYSTEM: dict[str, list[str]] = {
    "ecc": _ECC + _LOGISTICS,
    "s4hana_onprem": _ECC + _LOGISTICS,
    "ewm": ["batch_management", "ewms_stock", "ewms_transfer_orders", "wm_interface"],
    "s4hana_cloud": _ECC,
    "successfactors": _SF,
}
ABAP_SYSTEM_TYPES = ("ecc", "s4hana_onprem", "ewm")
_CONFIG_DELIVERY_CLASSES = {"C", "G", "E", "S"}
CONFIG_MAX_ROWS = 50_000


@dataclass
class TablePlan:
    table: str
    fields: set[str] = field(default_factory=set)
    keys: list[str] = field(default_factory=list)
    where: Optional[str] = None
    via: Optional[str] = None          # read by parent keys (see extraction_windows.yaml)
    purpose: str = "data"              # data | config
    modules: set[str] = field(default_factory=set)

    def columns(self) -> list[str]:
        return list(dict.fromkeys(self.keys + sorted(self.fields - set(self.keys))))


@lru_cache(maxsize=1)
def _windows() -> dict:
    return yaml.safe_load(_WINDOWS.read_text()) or {}


def _months_ago(n: int, today: date) -> str:
    y, m = today.year, today.month - n
    while m <= 0:
        m += 12
        y -= 1
    return f"{y:04d}{m:02d}{min(today.day, 28):02d}"


def render_where(template: str, today: Optional[date] = None) -> str:
    today = today or date.today()
    out = re.sub(r"\{months_ago:(\d+)\}", lambda m: _months_ago(int(m.group(1)), today), template)
    return re.sub(r"\{years_ago:(\d+)\}", lambda m: str(today.year - int(m.group(1))), out)


def plan_modules(modules: list[str], dictionary: Dictionary) -> dict[str, TablePlan]:
    """Tables/fields to extract so every rule of ``modules`` can be evaluated."""
    from checks.runner import _find_module_yaml, rule_columns

    edges, _ = _graph()
    joinable = {t for e in edges for t in (e.parent, e.child)}
    plans: dict[str, TablePlan] = {}

    def add(table: str, cols: set[str], module: str, purpose: str = "data") -> None:
        if dictionary.table(table) is None or dictionary.table(table).category == "VIEW":
            return  # canonical views are not ABAP tables
        p = plans.setdefault(table, TablePlan(table=table, purpose=purpose))
        p.fields |= cols
        p.modules.add(module)
        if purpose == "data":
            p.purpose = "data"

    for module in modules:
        try:
            rules = yaml.safe_load(_find_module_yaml(module).read_text()).get("rules", [])
        except FileNotFoundError:
            continue
        for rule in rules:
            cols = rule_columns(rule)
            # S/4 field layout on an ECC source (VBAK.GBSTK lives in VBUK on ECC)
            for c in list(cols):
                if dictionary.resolve(c) is None and c in _MOVED:
                    cols.append(_MOVED[c])
            # tables on the join path the engine will use for this rule
            skeleton = {t: [] for t in set(tables_of(cols)) | joinable}
            tf = TableFrames({t: _empty(dictionary, t) for t in skeleton}, dictionary, module=module)
            path_tables = tf.path_tables(cols, grain=rule.get("grain")) or set(tables_of(cols))
            for t in path_tables:
                add(t, {c.split(".", 1)[1] for c in cols if c.startswith(t + ".")}, module)
            # configuration tables holding the allowed values
            if rule.get("check_class") in ("domain_value_check", "referential_check") and rule.get("field"):
                f = dictionary.resolve(rule["field"])
                ref = (f"{rule['reference_table']}.{rule['reference_field']}"
                       if rule.get("reference_table") and rule.get("reference_field") else (f.check_ref if f else None))
                if ref and _is_config_table(dictionary, ref.split(".")[0]):
                    add(ref.split(".")[0], {ref.split(".")[1]}, module, purpose="config")

    # keys, join fields, filters
    for t, p in plans.items():
        p.keys = list(dictionary.keys(t))
        for e in edges:
            if e.child == t:
                p.fields |= {c for c, _ in e.on} | {f for f, _ in e.filter + e.prefer}
            if e.parent == t:
                p.fields |= {pf for _, pf in e.on}
        p.fields = {f for f in p.fields if dictionary.field(t, f) is not None}
        w = _windows().get(t) or {}
        filters = [f"{f} = '{v or ' '}'" for e in edges if e.child == t for f, v in e.filter]
        if w.get("where"):
            filters.append(render_where(w["where"]))
        p.where = " AND ".join(filters) or None
        p.via = w.get("via") if w.get("via") in plans else None
    return plans


def read_order(plans: dict[str, TablePlan]) -> list[str]:
    """Tables ordered so every ``via`` parent is read before its children."""
    done: list[str] = []

    def visit(t: str, seen: set[str]) -> None:
        if t in done or t in seen:
            return
        seen.add(t)
        parent = plans[t].via
        if parent:
            visit(parent, seen)
        done.append(t)

    for t in sorted(plans):
        visit(t, set())
    return done


def via_filters(child: str, parent: str, parent_rows, chunk: int = 60) -> list[str]:
    """WHERE clauses selecting child rows of already-read parent rows (key IN-lists)."""
    edges, _ = _graph()
    edge = next((e for e in edges if e.parent == parent and e.child == child), None)
    if edge is None or parent_rows is None or len(parent_rows) == 0:
        return []
    # use the most selective single join field (document number) for IN-lists
    child_f, parent_f = max(edge.on, key=lambda cp: cp[1] not in ("BUKRS", "GJAHR", "LGNUM", "MANDT"))
    values = sorted({str(v).strip() for v in parent_rows[parent_f].tolist() if str(v).strip()})
    return [f"{child_f} IN (" + ",".join(f"'{v}'" for v in values[i:i + chunk]) + ")"
            for i in range(0, len(values), chunk)]


def _is_config_table(dictionary: Dictionary, table: str) -> bool:
    t = dictionary.table(table)
    if t is None:
        return bool(re.match(r"^T[0-9A-Z]", table))  # unknown customizing table (T134, TVAK …)
    return getattr(t, "delivery_class", None) in _CONFIG_DELIVERY_CLASSES or bool(re.match(r"^T[0-9A-Z]", table))


def _empty(dictionary: Dictionary, table: str):
    import pandas as pd
    return pd.DataFrame(columns=[f"{table}.{k}" for k in dictionary.keys(table)])
