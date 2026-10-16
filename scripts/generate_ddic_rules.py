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
import re
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

# Registry system type -> the rule category its modules live in. A module name is NOT
# unique across systems: the ABAP registry and SuccessFactors both have a
# ``payroll_integration`` module, so the system has to travel with the module name.
_SYSTEM_CATEGORY = {
    "ecc": "ecc", "s4hana_onprem": "ecc", "s4hana_cloud": "ecc",
    "successfactors": "successfactors",
    "ariba": "ariba",
    "concur": "concur",
    "ewms": "warehouse", "ewm": "warehouse",
}

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

ID_PREFIX = {"checktab": "DXR", "domain": "DXV", "invariant": "DXI"}



# ── scope ────────────────────────────────────────────────────────────────────


def owned_tables() -> dict[str, tuple[str, str]]:
    """table -> ``(rule category, module)``: the rule packs first, then the registry.

    The category travels with the module because module names are not unique across
    systems. Without it, ABAP payroll rules (PA0008, T512W, ...) derived for the ECC
    ``payroll_integration`` module were filed into the SuccessFactors pack of the same
    name, where the SF extraction never supplies those tables.
    """
    owners: dict[str, Counter] = defaultdict(Counter)
    for category in CATEGORIES:
        for path in pack_files(category):
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            module = doc.get("module") or path.stem
            for rule in doc.get("rules") or []:
                for ref in _columns(rule):
                    owners[ref.split(".", 1)[0]][(category, module)] += 1
    out: dict[str, tuple[str, str]] = {t: c.most_common(1)[0][0] for t, c in owners.items()}
    for system, category in _SYSTEM_CATEGORY.items():
        for module, targets in SYSTEM_EXTRACTIONS.get(system, {}).items():
            for target in targets:
                table = str(target.source).split(".", 1)[0].upper()
                out.setdefault(table, (category, module))
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


_CUSTOMISING = re.compile(r"^T[0-9A-Z]")


def _is_customising(table) -> bool:
    """True for a customer customising table (SPRO settings), which is not business data.

    Deriving a data-quality rule whose *subject* is one of these is meaningless — the rows
    are the tenant's own configuration, not records that can be wrong — and it silently
    changes extraction: ``sap.extraction_plan.add`` flips a table to ``purpose="data"`` as
    soon as any rule reads it as data, so a generated rule on T370T demoted it from the
    customising read that ``checks/field_status_rules.py`` depends on.

    Canonical (non-ABAP) entities are exempt: SuccessFactors' TIMESHEET is business data
    even though its name matches the T-number pattern.
    """
    if str(table.provenance).startswith("canonical:"):
        return False
    if getattr(table, "delivery_class", None) in {"C", "G", "E", "S"}:
        return True
    return bool(_CUSTOMISING.match(table.name))


CANONICAL_DIR = ROOT / "sap" / "dictionaries" / "canonical"


def canonical_invariants() -> list[tuple[str, dict]]:
    """``(table, invariant)`` declared under ``invariants:`` in the canonical dictionaries.

    Ordered-pair and sign properties (an effectivity cannot end before it starts, a spend
    amount cannot be negative) are true of the payload by definition. They are *declared*
    rather than inferred because the non-ABAP systems carry no ``check_table``, no
    ``picklist`` and no fixed values for the generator to reason from — without this the
    Ariba and Concur sides yield no derivable rules at all.
    """
    out: list[tuple[str, dict]] = []
    for path in sorted(CANONICAL_DIR.glob("*.yaml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for table, spec in (doc.get("tables") or {}).items():
            for invariant in spec.get("invariants") or []:
                out.append((table.upper(), invariant))
    return out


def expose_tables() -> dict[str, tuple[str, str]]:
    """table -> ``(category, module)``, unowned tables inheriting from an FK neighbour."""
    dictionary = get_dictionary("s4hana")
    owner = owned_tables()

    # Every table the platform reads is in scope, except the S/4-retired ones and the
    # customer's customising tables. Canonical (non-ABAP) entities are included on purpose:
    # SuccessFactors carries check_table and picklist metadata of its own, so the SF side
    # derives from SF ground truth rather than being silently skipped. Entities with no such
    # metadata (Ariba, Concur, fleet, XSYS) simply yield nothing — there is nothing to derive
    # from.
    def eligible(table) -> bool:
        return not table.obsolete_in and not _is_customising(table)

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


_NOTNA_GUARD = re.compile(r"(`[^`]+`)\.notna\(\)\s*&\s*")


def _strip_outer_parens(expr: str) -> str:
    """Drop parentheses that wrap the whole expression, and only those."""
    while expr.startswith("(") and expr.endswith(")"):
        depth = 0
        for i, ch in enumerate(expr):
            depth += ch == "("
            depth -= ch == ")"
            if depth == 0 and i < len(expr) - 1:
                return expr  # the opening paren closes before the end: not a wrapper
        expr = expr[1:-1].strip()
    return expr


def _predicate(rule: dict) -> tuple[str, str]:
    """A rule's predicate for duplicate detection: check class plus a normalised fail_when.

    Whitespace is collapsed, and a ``.notna() &`` guard is dropped when its field is compared
    in the rest of the expression: a comparison with a null never fails a row in
    cross_field_check, so ``A.notna() & (A < 0)`` selects exactly what ``A < 0`` selects."""
    expr = " ".join(str(rule.get("fail_when") or "").split())
    while True:
        m = _NOTNA_GUARD.match(expr)
        rest = expr[m.end():] if m else ""
        if not m or m.group(1) not in rest:
            break
        expr = rest
    return str(rule.get("check_class") or ""), _strip_outer_parens(expr)


def existing_predicates() -> dict[tuple[str, str], set[tuple[str, str]]]:
    """``(category, module)`` -> the predicates its hand-written pack already tests.

    An invariant from the canonical dictionaries is skipped when its module's pack already
    carries the same predicate, so retiring a duplicate by hand is never undone here."""
    out: dict[tuple[str, str], set[tuple[str, str]]] = defaultdict(set)
    for category in CATEGORIES:
        for path in pack_files(category):
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            module = str(doc.get("module") or path.stem)
            for rule in doc.get("rules") or []:
                if rule.get("fail_when"):
                    out[(category, module)].add(_predicate(rule))
    return out


def _sensitive(field: Field) -> bool:
    return field.name in _SENSITIVE and field.table not in _PUBLIC_TABLES



def derive(dictionary, exposed: dict[str, tuple[str, str]],
           covered: dict[str, set[str]],
           predicates: dict[tuple[str, str], set[tuple[str, str]]] | None = None) -> list[tuple[str, str, str, dict]]:
    """Every missing rule as ``(category, module, kind, rule)``."""
    out: list[tuple[str, str, str, dict]] = []
    for table_name in sorted(dictionary.tables):
        home = exposed.get(table_name)
        if home is None:
            continue
        category, module = home
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
            # live configuration), then a picklist (also live, tenant-configured); only
            # then a closed domain's static fixed values.
            if have & {"exists_check", "referential_check", "domain_value_check"}:
                continue
            if (field.check_table and field.check_field) or field.picklist:
                out.append((category, module, "checktab", _checktab_rule(field, desc)))
                continue
            values = sorted(v for v in (field.allowed_values() or set()) if str(v).strip())
            if values and len(values) > 1:
                out.append((category, module, "domain", _domain_rule(field, desc, values)))

    # Invariants declared in the canonical dictionaries (see canonical_invariants), unless the
    # module's hand-written pack already tests the same predicate.
    predicates = predicates if predicates is not None else existing_predicates()
    for table_name, invariant in canonical_invariants():
        home = exposed.get(table_name)
        if home is None:
            continue
        category, module = home
        kind = invariant.get("kind")
        if kind == "date_order":
            rule = _date_order_rule(table_name, invariant)
        elif kind == "non_negative":
            rule = _non_negative_rule(table_name, invariant)
        else:
            continue
        if _predicate(rule) in predicates.get((category, module), set()):
            continue
        out.append((category, module, "invariant", rule))
    return out


def _date_order_rule(table: str, invariant: dict) -> dict:
    start, end = str(invariant["start"]), str(invariant["end"])
    s, e = f"{table}.{start}", f"{table}.{end}"
    label = start.replace("_", " ").lower()
    return {
        "field": s, "check_class": "cross_field_check",
        "severity": "high", "dimension": "consistency",
        "message": f"{label.capitalize()} must not be after {end.replace('_', ' ').lower()}",
        "why_it_matters": (f"{s} and {e} are both carried by the same {table} record, so their order is a "
                           f"property of the record itself and not of any process. The source system cannot "
                           f"produce an inverted pair, so one marks a load, mapping or transformation defect "
                           f"rather than a data-entry mistake."),
        "rule_authority": "sap_hard_constraint",
        "sap_impact": (f"Every duration, age or validity window derived from {start} and {end} is wrong, and the "
                       f"record's place in time is unreliable."),
        "fail_when": f"`{s}`.notna() & `{e}`.notna() & (`{s}` > `{e}`)",
        "fix_map": {"__other__": f"Correct {s} or {e} so the pair is ordered."},
        "record_fix_template": f"{s} is after {e}.",
    }


def _non_negative_rule(table: str, invariant: dict) -> dict:
    fld = str(invariant["field"])
    ref = f"{table}.{fld}"
    return {
        "field": ref, "check_class": "cross_field_check",
        "severity": "high", "dimension": "validity",
        "message": f"{fld.replace('_', ' ').lower().capitalize()} must not be negative",
        "why_it_matters": (f"{ref} carries an amount the source system only ever returns unsigned. A negative "
                           f"value cannot originate from the API, so it marks a sign-convention error in the "
                           f"extraction or the load."),
        "rule_authority": "sap_hard_constraint",
        "sap_impact": (f"Totals including {fld} are understated, and the record reads as a credit where none exists."),
        "fail_when": f"`{ref}` < 0",
        "fix_map": {"__other__": f"{ref} is negative; the source does not return negative amounts here."},
        "record_fix_template": f"{ref} is negative.",
    }




def _ph(field: Field, placeholder: str) -> str:
    """A value placeholder, or '' for personal-data fields a fix instruction must never echo."""
    return "" if _sensitive(field) else f" {placeholder}"



def _checktab_rule(field: Field, desc: str) -> dict:
    """A referential rule from whichever reference the field declares.

    ABAP fields name a DDIC check table; canonical (SuccessFactors) fields name either a
    Foundation Object entity (``check_table``, resolved on ``externalCode``) or a picklist.
    The runner resolves both to live configuration at run time.
    """
    if field.check_table and field.check_field:
        target = f"{field.check_table}.{field.check_field}"
        source = f"check table {target}"
        fallback = (f"{field.name} ({desc}) is defined in the SAP Data Dictionary with check table {target} on "
                    f"domain {field.domain or 'n/a'}. A value outside that table is not a value SAP recognises, "
                    f"so the record is inconsistent with the configuration it depends on.")
    else:
        target = f"PICKLIST.{field.picklist}"
        source = f"picklist {field.picklist}"
        fallback = (f"{field.name} ({desc}) is a SuccessFactors picklist field (picklist {field.picklist}). Its "
                    f"permitted values are tenant configuration, so a value outside the configured set is not one "
                    f"the tenant's own system recognises.")
    why = fallback
    return {
        "field": field.qualified, "check_class": "referential_check",
        "severity": "high" if not field.key else "critical",
        "dimension": "consistency",
        "message": f"{desc} must exist in the {source}",
        "why_it_matters": why,
        "rule_authority": "sap_hard_constraint",
        "sap_impact": (f"Processes that read {field.name} resolve it through {source}; an unknown value "
                       f"leaves the record unclassified and can block posting, pricing or reporting."),
        "fix_map": {"__other__": f"{field.qualified}{_ph(field, chr(39) + '{invalid_value}' + chr(39))} "
                                 f"is not defined in the {source}. Correct it there or add the missing entry."},
        "record_fix_template": f"{field.qualified} points at a {source} entry that does not exist.",
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


def _rule_id(kind: str, module: str, rule: dict) -> str:
    """A stable id for a derived rule, derived from what the rule is about.

    Ids must survive an edit to any rule pack. They do not just label a rule here:
    ``rules_hq_cache``, the tenant ``rules`` table and ``checks/lifecycle.py`` all
    key on the bare id, so an id that moves silently re-points a tenant's or HQ's
    "enable this" decision at a different rule. The original scheme numbered rules
    from a single counter across every module in sorted order, which meant adding
    one rule to one module shifted the id of every later rule: adding a single
    authored rule to ``interface_health`` moved 1,584 of the 2,118 derived ids onto
    different fields, and the 1,962 DDIC rules a deployment had explicitly enabled
    would have started governing the wrong ones.

    So the id is a digest of the rule's natural key — its kind, module, field and
    (for a referential check) the table it points at — which is unique within a
    module and does not depend on position. Adding, removing or reordering rules
    leaves every other id alone.
    """
    import hashlib

    key = "|".join((
        kind, module, str(rule.get("field") or ""), str(rule.get("target_table") or ""),
        str(rule.get("check_class") or ""),
    ))
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]
    return f"{ID_PREFIX[kind]}{digest}"


def build() -> dict[tuple[str, str], str]:
    """(category, module) -> rendered sidecar, for modules that have a hand-written pack."""
    dictionary = get_dictionary("s4hana")
    exposed = expose_tables()
    covered = existing_coverage()
    by_home: dict[tuple[str, str], list[tuple[str, dict]]] = defaultdict(list)
    for category, module, kind, rule in derive(dictionary, exposed, covered):
        by_home[(category, module)].append((kind, rule))
    out: dict[tuple[str, str], str] = {}
    seen_ids: set[str] = set()
    for category, module in sorted(by_home):
        if not (RULES_DIR / category / f"{module}.yaml").exists():
            continue  # a registry-only module (process_discovery, s4_load_sim): no pack to sit beside
        rules = []
        for kind, rule in by_home[(category, module)]:
            rid = _rule_id(kind, module, rule)
            if rid in seen_ids:
                raise SystemExit(
                    f"generated rule id collision: {rid} ({module} {rule.get('field')}). "
                    f"The natural key must identify one rule."
                )
            seen_ids.add(rid)
            # Derived rules ship disabled: they are mechanically sound (every one is
            # proven to fire on a failing record) but not yet consultant-validated
            # against real customer data, so they must not flag clean records by
            # default. A tenant/HQ explicitly enables them via the rules table.
            rules.append({"id": rid, "enabled": False, **rule})
        out[(category, module)] = render(module, rules, _target_state(module))
    return out


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
    for (category, module), text in sidecars.items():
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
    by_provenance: Counter = Counter()
    by_category: Counter = Counter()
    no_pack = 0
    for category, module, kind, rule in rules:
        kinds[kind] += 1
        by_category[category] += 1
        if not (RULES_DIR / category / f"{module}.yaml").exists():
            no_pack += 1
        fld = dictionary.resolve(rule["field"])
        by_provenance[(fld.provenance if fld else "?").split(":")[0]] += 1
    owner = owned_tables()
    obsolete = [t.name for t in dictionary.tables.values() if t.obsolete_in]
    unmapped = sorted(t for t in dictionary.tables if t not in exposed and t not in obsolete)
    print(f"tables in the dictionary       : {len(dictionary.tables)}")
    print(f"tables in scope                : {len(exposed)}")
    print(f"  owned by a pack/registry     : {len([t for t in exposed if t in owner])}")
    print(f"  inherited via a foreign key  : {len([t for t in exposed if t not in owner])}")
    print(f"excluded - S/4HANA-obsolete    : {len(obsolete)}")
    print(f"excluded - no module home      : {len(unmapped)}")
    print(f"derived but no pack to hold it : {no_pack}")
    print()
    for kind, n in kinds.most_common():
        print(f"  {kind:20s} {n:6d}")
    print(f"  {'TOTAL':20s} {sum(kinds.values()):6d}")
    print()
    print("derived rules by field provenance:")
    for prov, n in by_provenance.most_common():
        print(f"  {prov:20s} {n:6d}")
    print()
    print("derived rules by target category:")
    for cat, n in by_category.most_common():
        print(f"  {cat:20s} {n:6d}")


if __name__ == "__main__":
    raise SystemExit(main())
