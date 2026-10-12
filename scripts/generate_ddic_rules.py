"""Generate SAP data-quality rules mechanically from the DDIC bundle.

Every rule this script emits is derived from SAP's own data dictionary — the
ABAP DDIC bundle in ``sap/dictionaries/`` — never invented. Three derivations:

  key       a DDIC key field with no ``null_check``            -> ``null_check``
  checktab  a field whose value domain is a DDIC check table
            and which has no ``exists``/``referential`` check  -> ``referential_check``
  domain    a field with closed domain fixed values and no
            ``domain_value_check``                             -> ``domain_value_check``

Output is one ``<module>.generated.yaml`` sidecar beside each hand-written pack.
``checks.runner.module_rules`` merges the two, so the rules execute, drive
extraction (``sap/extraction_plan.plan_modules`` reads the same helper) and seed
tenants — while the human-authored pack keeps its own pinned counts and stays
reviewable.

Usage::

    python scripts/generate_ddic_rules.py            # write the sidecars
    python scripts/generate_ddic_rules.py --check    # exit 1 if any sidecar is stale
    python scripts/generate_ddic_rules.py --report   # scope report only, write nothing

Scope policy (why a table is or is not covered):

  * IN   — the table is already owned by a module, either by an existing rule
           pack or by ``sap/extraction_registry.SYSTEM_EXTRACTIONS``.
  * IN   — the table is unowned but a real transparent table connected by a DDIC
           foreign key to an owned one; it inherits that neighbour's module.
  * OUT  — ``category: VIEW``: canonical non-ABAP surfaces (Ariba, Concur, SF,
           fleet), which have their own hand-written packs.
  * OUT  — ``obsolete_in`` is set: SAP itself retired the table (e.g. ANEP,
           BSAD, BSAK are S/4HANA-obsolete), so judging it would be wrong.
  * OUT  — no module home and no foreign key to one: the DDIC/system-table
           residue (DD02L, DD07L, CVERS, ...), which is not business data.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sap.ddic import Field, get_dictionary  # noqa: E402
from sap.extraction_registry import SYSTEM_EXTRACTIONS  # noqa: E402

RULES_DIR = ROOT / "checks" / "rules"
CATEGORIES = ("ecc", "successfactors", "warehouse", "concur", "ariba")

CLIENT_FIELDS = {"MANDT", "RCLNT", "CLIENT"}
NON_RULE_FILES = {"column_map.yaml"}
GENERATED_SUFFIX = ".generated.yaml"


def pack_files(category: str):
    """The hand-written rule packs of a category (never this script's own output)."""
    for path in sorted((RULES_DIR / category).glob("*.yaml")):
        if path.name in NON_RULE_FILES or path.name.endswith(GENERATED_SUFFIX):
            continue
        yield path

# System types whose module names match the DQ module names, in precedence order.
_REGISTRY_SYSTEMS = ("ecc", "s4hana_onprem", "ewms", "successfactors", "concur", "ariba")

# Personal / identifying data a fix instruction must never echo (mirrors
# tests/checks/test_rule_integrity.py — refer to the field by name instead).
_SENSITIVE = {
    "NAME1", "NAME2", "NAME3", "NAME4", "NAME_FIRST", "NAME_LAST", "NAME_ORG1", "NAME_ORG2", "STRAS",
    "ORT01", "ORT02", "PSTLZ", "PFACH", "BANKN", "BANKL", "IBAN", "STCD1", "STCD2", "STCD3", "STCD4",
    "STCEG", "SMTP_ADDR", "TELF1", "TELF2", "TELFX", "ADRNR", "BIRTHDT", "DEATHDT", "FOUND_DAT",
    "LIQUID_DAT", "STREET", "CITY1", "TEL_NUMBER", "SORT1", "SORT2", "NACHN", "VORNA", "GBDAT", "BKONT",
    "KOINH", "BKREF", "MCOD1", "MCOD2", "MCOD3",
}
_PUBLIC_TABLES = {"BNKA", "T012", "T012K"}

ID_PREFIX = {"checktab": "DXR", "domain": "DXV"}



# ── scope ────────────────────────────────────────────────────────────────────


def owned_tables() -> dict[str, str]:
    """table -> owning module, from the rule packs then the extraction registry."""
    owners: dict[str, Counter] = defaultdict(Counter)
    for category in CATEGORIES:
        for path in pack_files(category):
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            module = doc.get("module") or path.stem
            for rule in doc.get("rules") or []:
                for ref in _columns(rule):
                    owners[ref.split(".", 1)[0]][module] += 1
    out = {t: c.most_common(1)[0][0] for t, c in owners.items()}
    for system in _REGISTRY_SYSTEMS:
        for module, targets in SYSTEM_EXTRACTIONS.get(system, {}).items():
            for target in targets:
                table = str(target.source).split(".", 1)[0].upper()
                out.setdefault(table, module)
    return out


def _columns(rule: dict) -> list[str]:
    """Every ``TABLE.FIELD`` a rule reads, including join and target columns."""
    from checks.runner import rule_columns, target_columns

    return list(dict.fromkeys(rule_columns(rule) + target_columns(rule)))


def _rule_fields(rule: dict) -> list[str]:
    """The field(s) a rule directly judges — its primary subject, not its join targets."""
    if rule.get("field"):
        return [rule["field"]]
    return list(rule.get("fields") or [])


def expose_tables() -> dict[str, str]:
    """table -> owning module, with unowned tables inheriting from an FK neighbour."""
    dictionary = get_dictionary("s4hana")
    owner = owned_tables()

    # a real transparent table, not a canonical view or an S/4-retired one
    def eligible(table) -> bool:
        return table.category != "VIEW" and not table.obsolete_in

    edges: dict[str, set[str]] = defaultdict(set)
    for table in dictionary.tables.values():
        if not eligible(table):
            continue
        for foreign_key in table.foreign_keys or ():
            other = str(foreign_key.get("foreign_table", "")).upper()
            if other and other != table.name and other in dictionary.tables:
                edges[table.name].add(other)
                edges[other].add(table.name)

    exposed = {t: m for t, m in owner.items() if t in dictionary.tables and eligible(dictionary.tables[t])}
    # unowned business tables adopt a neighbour's module (deterministic: closest, then name)
    frontier = sorted(t for t in edges if t not in exposed and eligible(dictionary.tables[t]))
    changed = True
    while changed:
        changed = False
        for table in frontier:
            if table in exposed:
                continue
            neighbours = sorted(n for n in edges[table] if n in exposed)
            if neighbours:
                exposed[table] = exposed[neighbours[0]]
                changed = True
    return exposed


# ── derivations ──────────────────────────────────────────────────────────────


def existing_coverage() -> dict[str, set[str]]:
    """``TABLE.FIELD`` -> the check classes already shipped that judge it directly."""
    covered: dict[str, set[str]] = defaultdict(set)
    for category in CATEGORIES:
        for path in pack_files(category):
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            for rule in doc.get("rules") or []:
                for ref in _rule_fields(rule):
                    covered[ref].add(str(rule.get("check_class")))
    return covered


def _sensitive(field: Field) -> bool:
    return field.name in _SENSITIVE and field.table not in _PUBLIC_TABLES



def derive(dictionary, exposed: dict[str, str], covered: dict[str, set[str]]) -> list[tuple[str, str, dict]]:
    """Every missing rule as ``(module, kind, rule)``, ordered by (module, table, field, kind)."""
    out: list[tuple[str, str, dict]] = []
    for table_name in sorted(dictionary.tables):
        module = exposed.get(table_name)
        if module is None:
            continue
        table = dictionary.tables[table_name]
        for field in table.fields.values():
            if field.name in CLIENT_FIELDS:
                continue
            # Key fields are identifiers SAP itself enforces at transaction time (you cannot
            # create a BOM with an invalid STLTY, nor leave a split-valuation type blank when
            # one is required). DDIC derivation therefore targets non-key attributes, where
            # bad data actually accumulates — key-field rules are both redundant and, for
            # composite keys, unprovable against the synthetic proof frames.
            if field.key:
                continue
            ref = field.qualified
            have = covered.get(ref, set())
            desc = field.description or field.name

            # Value validation: at most ONE rule per field, and none when a hand-written
            # rule already validates it. A check-table reference is preferred (it carries
            # live configuration); otherwise a closed domain's fixed values are used.
            if have & {"exists_check", "referential_check", "domain_value_check"}:
                continue
            if field.check_table and field.check_field:
                out.append((module, "checktab", _checktab_rule(field, desc)))
                continue
            values = sorted(v for v in (field.allowed_values() or set()) if str(v).strip())
            if values and len(values) > 1:
                out.append((module, "domain", _domain_rule(field, desc, values)))
    return out




def _ph(field: Field, placeholder: str) -> str:
    """A value placeholder, or '' for personal-data fields a fix instruction must never echo."""
    return "" if _sensitive(field) else f" {placeholder}"



def _checktab_rule(field: Field, desc: str) -> dict:
    target = f"{field.check_table}.{field.check_field}"
    why = (f"{field.name} ({desc}) is defined in the SAP Data Dictionary with check table {target} on "
           f"domain {field.domain or 'n/a'}. A value outside that table is not a value SAP recognises, "
           f"so the record is inconsistent with the configuration it depends on.")
    return {
        "field": field.qualified, "check_class": "referential_check",
        "severity": "high" if not field.key else "critical",
        "dimension": "consistency",
        "message": f"{desc} must exist in the check table {target}",
        "why_it_matters": why,
        "rule_authority": "sap_hard_constraint",
        "sap_impact": (f"Processes that read {field.name} resolve it through {target}; an unknown value "
                       f"leaves the record unclassified and can block posting, pricing or reporting."),
        "fix_map": {"__other__": f"{field.qualified}{_ph(field, chr(39) + '{invalid_value}' + chr(39))} "
                                 f"is not defined in {target}. Correct it there or add the missing entry to {target}."},
        "record_fix_template": f"{field.qualified} points at a {target} entry that does not exist.",
    }


def _domain_rule(field: Field, desc: str, values: list[str]) -> dict:
    shown = ", ".join(values[:12]) + (" ..." if len(values) > 12 else "")
    why = (f"Domain {field.domain or 'n/a'} fixes the permitted values of {field.name} ({desc}) in the SAP "
           f"Data Dictionary. Any other non-blank value is outside SAP's own domain definition and is read "
           f"inconsistently by the programs that consume the field.")
    return {
        "field": field.qualified, "check_class": "domain_value_check",
        "severity": "medium", "dimension": "validity",
        "message": f"{desc} must be a value of domain {field.domain or 'n/a'} (e.g. {shown})",
        "why_it_matters": why,
        "rule_authority": "sap_hard_constraint",
        "sap_impact": f"{field.name} will not evaluate correctly wherever SAP branches on its value.",
        "allowed_values": values,
        "fix_map": {"__other__": f"{field.qualified}{_ph(field, chr(39) + '{invalid_value}' + chr(39))} "
                                 f"is not in domain {field.domain or 'n/a'}. Set it to one of: {shown}."},
        "record_fix_template": f"{field.qualified}{_ph(field, 'is {actual_value};')} expected one of: {shown}.",
    }


# ── rendering ────────────────────────────────────────────────────────────────


def _dump_rule(rule: dict) -> str:
    body = yaml.safe_dump(rule, default_flow_style=False, allow_unicode=True, sort_keys=False, width=118)
    lines = body.rstrip("\n").split("\n")
    return "- " + lines[0] + "\n" + "".join("  " + line + "\n" for line in lines[1:])


def render(module: str, rules: list[dict], target_state: str) -> str:
    head = (f"# Generated by scripts/generate_ddic_rules.py from the SAP DDIC bundle -- do not edit.\n"
            f"# Merged at runtime with {module}.yaml by checks.runner.module_rules().\n"
            f"# Every rule ships with enabled: false — mechanically sound but not consultant-\n"
            f"# validated, so it is off until a tenant/HQ enables it in the rules table.\n"
            f"module: {module}\n"
            f"target_state: {target_state}\n"
            f"generated: true\n"
            f"rules:\n")
    return head + "".join(_dump_rule(r) for r in rules)


def _target_state(module: str) -> str:
    """The sidecar declares the same target state as the pack it accompanies."""
    from checks.runner import module_config

    try:
        return str(module_config(module).get("target_state") or "ECC_AND_S4HANA")
    except FileNotFoundError:
        return "ECC_AND_S4HANA"


def build() -> dict[str, str]:
    """module -> rendered sidecar text (only modules that have a hand-written pack)."""
    dictionary = get_dictionary("s4hana")
    exposed = expose_tables()
    covered = existing_coverage()
    by_module: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for module, kind, rule in derive(dictionary, exposed, covered):
        by_module[module].append((kind, rule))
    # Rule ids are unique across the whole catalogue, not per module: the seeded tenant
    # rule table and the integrity gate both key on the bare id.
    counters: Counter = Counter()
    out: dict[str, str] = {}
    for module in sorted(by_module):
        if _category_of(module) is None:
            continue  # a registry-only module (process_discovery, s4_load_sim): no pack to sit beside
        rules = []
        for kind, rule in by_module[module]:
            counters[kind] += 1
            # Derived rules ship disabled: they are mechanically sound (every one is
            # proven to fire on a failing record) but not yet consultant-validated
            # against real customer data, so they must not flag clean records by
            # default. A tenant/HQ explicitly enables them via the rules table.
            rules.append({"id": f"{ID_PREFIX[kind]}{counters[kind]:05d}", "enabled": False, **rule})
        out[module] = render(module, rules, _target_state(module))
    return out


def _category_of(module: str) -> str | None:
    for category in CATEGORIES:
        if (RULES_DIR / category / f"{module}.yaml").exists():
            return category
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if any sidecar is stale")
    parser.add_argument("--report", action="store_true", help="print the scope report and write nothing")
    args = parser.parse_args()

    if args.report:
        _report()
        return 0

    sidecars = build()
    written = stale = 0
    for module, text in sidecars.items():
        category = _category_of(module)
        if category is None:
            continue
        path = RULES_DIR / category / f"{module}.generated.yaml"
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current == text:
            continue
        if args.check:
            stale += 1
            print(f"stale: {path.relative_to(ROOT)}")
            continue
        path.write_text(text, encoding="utf-8")
        written += 1
    if args.check:
        if stale:
            print(f"{stale} generated sidecar(s) out of date; run scripts/generate_ddic_rules.py")
            return 1
        print("generated sidecars are up to date")
        return 0
    total = sum(text.count("\n- id: ") + text.startswith("- id: ") for text in sidecars.values())
    print(f"wrote {written} sidecar file(s) covering {total} generated rule(s)")
    return 0


def _report() -> None:
    dictionary = get_dictionary("s4hana")
    exposed = expose_tables()
    covered = existing_coverage()
    rules = derive(dictionary, exposed, covered)
    kinds = Counter({"checktab": 0, "domain": 0})
    for _, kind, _rule in rules:
        kinds[kind] += 1
    owner = owned_tables()
    excluded_view = [t.name for t in dictionary.tables.values() if t.category == "VIEW"]
    excluded_obsolete = [t.name for t in dictionary.tables.values() if t.obsolete_in]
    unmapped = sorted(t for t in dictionary.tables
                      if t not in exposed and t not in excluded_view and t not in excluded_obsolete)
    print(f"DDIC tables                    : {len(dictionary.tables)}")
    print(f"tables in scope                : {len(exposed)}")
    print(f"  owned by a pack/registry     : {len([t for t in exposed if t in owner])}")
    print(f"  inherited via a foreign key  : {len([t for t in exposed if t not in owner])}")
    print(f"excluded - canonical views     : {len(excluded_view)}")
    print(f"excluded - S/4HANA-obsolete    : {len(excluded_obsolete)}")
    print(f"excluded - no module home      : {len(unmapped)}")
    print()
    for kind, n in kinds.most_common():
        print(f"  {kind:20s} {n:6d}")
    print(f"  {'TOTAL':20s} {sum(kinds.values()):6d}")


if __name__ == "__main__":
    raise SystemExit(main())
