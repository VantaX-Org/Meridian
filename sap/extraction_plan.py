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
from datetime import date, timedelta
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
              "fleet_management", "transport_management", "mdg_master_data", "grc_compliance",
              "interface_health"]
_SF = ["employee_central", "compensation", "benefits", "payroll_integration", "performance_goals",
       "succession_planning", "recruiting_onboarding", "learning_management", "time_attendance"]

# Modules whose rules can be evaluated on data from each system type.
MODULES_BY_SYSTEM: dict[str, list[str]] = {
    "ecc": _ECC + _LOGISTICS + ["s4_readiness", "banking_tax"],  # S/4HANA conversion readiness of ECC data
    "s4hana_onprem": _ECC + _LOGISTICS + ["s4hc_master_data"],
    "ewm": ["batch_management", "ewms_stock", "ewms_transfer_orders", "wm_interface", "interface_health"],
    "s4hana_cloud": _ECC + ["s4hc_master_data"],
    "successfactors": _SF,
    "concur": ["concur_expense", "concur_users"],
    "ariba": ["ariba_supplier", "ariba_contracts", "ariba_procurement"],
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
    wide_where: Optional[str] = None   # retry when the default window is empty (stale/sandbox systems)
    via: Optional[str] = None          # read by parent keys (see extraction_windows.yaml)
    purpose: str = "data"              # data | config
    modules: set[str] = field(default_factory=set)
    partial: bool = False              # windowed / parent-keyed / scoped: not every record of the table

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
    out = re.sub(r"\{days_ago:(\d+)\}", lambda m: (today - timedelta(days=int(m.group(1)))).strftime("%Y%m%d"), out)
    return re.sub(r"\{years_ago:(\d+)\}", lambda m: str(today.year - int(m.group(1))), out)


# Scope filters a download can carry → the SAP field they restrict. Applied to
# every planned table that has the field; tables without it are read in full.
SCOPE_FIELDS = {"company_codes": "BUKRS", "plants": "WERKS", "sales_orgs": "VKORG", "purchasing_orgs": "EKORG"}
_SCOPE_VALUE = re.compile(r"^[A-Z0-9_]{1,10}$")
_SCOPE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalise_scope(scope: Optional[dict]) -> dict:
    """Validated scope ({} = everything). Values go into RFC WHERE clauses, so
    only organisational-unit codes and ISO dates are accepted."""
    out: dict = {}
    for key in SCOPE_FIELDS:
        vals = sorted({str(v).strip().upper() for v in (scope or {}).get(key) or [] if str(v).strip()})
        bad = [v for v in vals if not _SCOPE_VALUE.match(v)]
        if bad:
            raise ValueError(f"Invalid {key}: {', '.join(bad)}")
        if vals:
            out[key] = vals
    for key in ("date_from", "date_to"):
        v = (scope or {}).get(key)
        if v:
            if not _SCOPE_DATE.match(str(v)):
                raise ValueError(f"{key} must be YYYY-MM-DD")
            out[key] = str(v)
    if out.get("date_from") and out.get("date_to") and out["date_from"] > out["date_to"]:
        raise ValueError("date_from is after date_to")
    return out


def _scope_filters(table: str, dictionary: Dictionary, scope: dict) -> list[str]:
    out = []
    for key, field in SCOPE_FIELDS.items():
        if scope.get(key) and dictionary.field(table, field) is not None:
            out.append(f"{field} IN (" + ", ".join(f"'{v}'" for v in scope[key]) + ")")
    return out


def widen(template: str, factor: int = 4, cap: int = 24) -> Optional[str]:
    """The window with every ``{months_ago:N}`` (N > 0) stretched to N*factor, capped.

    A copy or sandbox client often has no postings in the last quarter: the
    default window then reads nothing. None when there is nothing to stretch."""
    out = re.sub(r"\{months_ago:(\d+)\}",
                 lambda m: f"{{months_ago:{min(int(m.group(1)) * factor, cap)}}}" if int(m.group(1)) else m.group(0),
                 template)
    return out if out != template else None


def _window(template: str, scope: dict) -> str:
    """The table's default window, or the download's date range on the same field."""
    if not (scope.get("date_from") or scope.get("date_to")):
        return render_where(template)
    field = template.split()[0]
    parts = []
    if scope.get("date_from"):
        parts.append(f"{field} >= '{scope['date_from'].replace('-', '')}'")
    if scope.get("date_to"):
        parts.append(f"{field} <= '{scope['date_to'].replace('-', '')}'")
    return " AND ".join(parts)


def plan_modules(modules: list[str], dictionary: Dictionary, scope: Optional[dict] = None) -> dict[str, TablePlan]:
    """Tables/fields to extract so every rule of ``modules`` can be evaluated."""
    from checks.population import fields_for
    from checks.config_rules import fields_for as config_fields
    from checks.country_rules import fields_for as country_fields
    from checks.value_placement import fields_for as placement_fields
    from checks.runner import _find_module_yaml, rule_columns, target_columns

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
            # the master table a reference must exist in (read in full)
            for c in target_columns(rule):
                add(c.split(".", 1)[0], {c.split(".", 1)[1]}, module)
            # configuration tables holding the allowed values
            if rule.get("check_class") in ("domain_value_check", "referential_check") and rule.get("field"):
                f = dictionary.resolve(rule["field"])
                ref = (f"{rule['reference_table']}.{rule['reference_field']}"
                       if rule.get("reference_table") and rule.get("reference_field") else (f.check_ref if f else None))
                if ref and _is_config_table(dictionary, ref.split(".")[0]):
                    add(ref.split(".")[0], {ref.split(".")[1]}, module, purpose="config")

    # S/4 tables judged only when the live dictionary has their fields (checks/config_rules.py)
    from checks.config_rules import live_tables
    for module in modules:
        for t, fields in live_tables(module, dictionary).items():
            add(t, set(fields), module)

    # the tables population exclusions look values up in (JEST status, T370T category)
    from checks.population import policy
    for t, p in list(plans.items()):
        for x in policy().get(t, []) if p.purpose == "data" else []:
            if spec := x.get("in_table"):
                for m in p.modules:
                    add(spec["table"], {spec["column"], *spec.get("where", {})}, m,
                        purpose="config" if _is_config_table(dictionary, spec["table"]) else "data")

    # keys, join fields, filters
    for t, p in plans.items():
        p.keys = list(dictionary.keys(t))
        for e in edges:
            if e.child == t:
                p.fields |= {c for c, _ in e.on} | {f for f, _ in e.filter + e.prefer}
            if e.parent == t:
                p.fields |= {pf for _, pf in e.on}
        p.fields |= fields_for(t)  # active-population flags (checks/population.py)
        if p.purpose == "data":
            p.fields |= placement_fields(t, dictionary) | country_fields(t, dictionary) | config_fields(t, dictionary)
        p.fields = {f for f in p.fields if dictionary.field(t, f) is not None}
        w = _windows().get(t) or {}
        filters = [f"{f} = '{v or ' '}'" for e in edges if e.child == t for f, v in e.filter]
        wide = None
        if w.get("where"):
            if not (scope or {}).get("date_from") and not (scope or {}).get("date_to") and widen(w["where"]):
                wide = filters + [render_where(widen(w["where"]))]
            filters.append(_window(w["where"], scope or {}))
        scoped = _scope_filters(t, dictionary, scope or {}) if p.purpose == "data" else []
        filters += scoped
        p.partial = bool(w.get("where") or w.get("via") or scoped)
        p.where = " AND ".join(filters) or None
        p.wide_where = " AND ".join(wide + scoped) if wide else None
        p.via = w.get("via") if w.get("via") in plans else None

    # the check table of every field read: the DDIC conformance check value-checks each one
    # against the live configuration, which exists only once some extraction has read it
    for t, p in list(plans.items()):
        if p.purpose != "data":
            continue
        for f in sorted(p.fields):
            ref = getattr(dictionary.field(t, f), "check_ref", None) or ""
            rt, _, rf = ref.partition(".")
            if rt and rt not in plans and dictionary.field(rt, rf) is not None and _is_config_table(dictionary, rt) \
                    and dictionary.table(rt).category != "VIEW":
                plans[rt] = TablePlan(table=rt, fields={rf}, keys=list(dictionary.keys(rt)), purpose="config",
                                      modules=set(p.modules))
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
