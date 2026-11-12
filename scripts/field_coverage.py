"""Field-coverage reports for the licensed objects: which extracted field has which rule.

Scope per object is a fixed list of the object's own master-data tables (below). For each
table the field universe is every field the dictionary knows for it (ECC 6.0 DDIC bundle,
or the SuccessFactors canonical schema), minus the client. "Read" marks the fields the
current extraction plan actually pulls: ``sap.extraction_plan.plan_modules`` with disabled
rules included for ABAP; the whole canonical table for SuccessFactors (the SF connector
selects every mapped property of a table a rule touches).

A rule references a field when ``checks.runner.rule_columns``/``target_columns`` return it,
or when a ``TABLE.FIELD`` token appears in one of its non-prose keys (conditions, filters).
Hand-written and ``.generated.yaml`` rules both count.

Uncovered fields get a rule idea derived from the dictionary metadata (check table, fixed
values, type) unless ``CURATED`` holds a hand-written one; the curated entries are the
"top gaps" list of each report.

Usage::

    python scripts/field_coverage.py           # write docs/field-coverage/*.md
    python scripts/field_coverage.py --check   # exit 1 if any report is stale
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from checks.runner import module_rules, rule_columns, target_columns  # noqa: E402
from sap.ddic import Field, get_dictionary  # noqa: E402

OUT_DIR = ROOT / "docs" / "field-coverage"

OBJECTS: dict[str, dict] = {
    "material_master": {
        "title": "ECC material master",
        "system": "ecc",
        "tables": ["MARA", "MAKT", "MARC", "MARD", "MBEW", "MVKE", "MARM", "MEAN", "MLAN", "MLGN",
                   "MLGT", "MDMA", "MKAL", "QMAT", "CKMLHD", "AUSP", "KSSK", "INOB"],
    },
    "sd_customer_master": {
        "title": "ECC customer master",
        "system": "ecc",
        "tables": ["KNA1", "KNB1", "KNB5", "KNBK", "KNBW", "KNVV", "KNVP", "KNVI", "KNVA", "KNVD",
                   "KNVK", "KNAS", "KNKK", "KNKA", "TIBAN", "ADRC", "ADR2", "ADR3", "ADR6",
                   "UKMBP_CMS", "UKMBP_CMS_SGM", "CVI_CUST_LINK"],
    },
    "business_partner": {
        "title": "ECC business partner",
        "system": "ecc",
        "tables": ["BUT000", "BUT020", "BUT021_FS", "BUT0BK", "BUT0ID", "BUT100", "BUT050", "DFKKBPTAXNUM",
                   "ADRC", "ADR2", "ADR6", "CVI_CUST_LINK", "CVI_VEND_LINK"],
    },
    "employee_central": {
        "title": "SuccessFactors Employee Central",
        "system": "successfactors",
        "tables": ["EMPEMPLOYMENT", "EMPJOBHIST", "PERINFO", "PERADDRESS", "PEREMAIL", "PERPHONE",
                   "PEREMERGENCY", "EMPWORKPERMIT", "EMPGLOBALASSIGNMENT", "EMPJOBRELATIONSHIPS",
                   "PAYMENTINFO", "COMPINFO", "USERACCOUNT", "POSITION", "FOCOMPANY", "FODIVISION",
                   "FOBUSINESSUNIT", "FODEPARTMENT", "FOLOCATION", "FOCOSTCENTER", "FOJOBCODE",
                   "FOEVENTREASON"],
    },
}

# Hand-written ideas for the biggest gaps: (object, "TABLE.FIELD") -> idea. Listed as the
# report's top gaps, in this order. Every field name here must exist in the dictionary.
CURATED: dict[str, dict[str, str]] = {
    "material_master": {
    },
    "sd_customer_master": {
        "KNA1.KONZS": "consistency: customers sharing a KONZS share KNA1.LAND1 or KNA1.KTOKD pattern;"
        " flag singleton group keys (likely typos)",
        "UKMBP_CMS_SGM.XCRITICAL": "cross-field: critical customers (XCRITICAL = X) carry a credit limit"
        " (UKMBP_CMS_SGM.CREDIT_LIMIT > 0) in the same credit segment",
    },
    "employee_central": {
        "COMPINFO.PAYROLL_ID": "uniqueness: one USERID per PAYROLL_ID; mandatory for EC Payroll employees"
        " (unverified: non-standard property)",
    },
}

PROSE_KEYS = {"message", "why_it_matters", "rule_authority", "sap_impact", "fix_map",
              "record_fix_template", "auto_fix", "valid_values_with_labels", "simplification_item",
              "s4_impact", "s4_area"}
TOKEN = re.compile(r"\b([A-Z][A-Z0-9_]*)\.([A-Z][A-Z0-9_]*)\b")
CLIENT = {"MANDT", "CLIENT", "RCLNT"}
AUDIT_NAMES = {"ERSDA", "ERDAT", "ERNAM", "ERZET", "AEDAT", "AENAM", "LAEDA", "AEZET", "UPDAT",
               "UPTIM", "UPNAM", "CREATED_DATE", "CREATED_BY", "LAST_MODIFIED", "LAST_MODIFIED_BY",
               "CRUSR", "CRDAT", "CRTIM", "CHUSR", "CHDAT", "CHTIM", "TIMESTAMP", "CREATED_AT",
               "CHANGED_AT", "CREATED_ON", "CHANGED_ON", "CREATED_BY_USER", "CHANGED_BY_USER"}
AUDIT_WORDS = ("changed by", "created by", "time stamp", "timestamp", "last changed", "date of last change",
               "name of person who", "time of last change", "change counter", "created on", "changed on",
               "date on which the record was created", "last change")
MAX_IDS = 6


def _scan(value, out: set[str]) -> None:
    if isinstance(value, str):
        out.update(f"{t}.{f}" for t, f in TOKEN.findall(value))
    elif isinstance(value, dict):
        for k, v in value.items():
            _scan(k, out)
            _scan(v, out)
    elif isinstance(value, (list, tuple)):
        for v in value:
            _scan(v, out)


def rule_refs(rule: dict) -> set[str]:
    """Every TABLE.FIELD a rule reads, structurally and from its expressions."""
    refs = set(rule_columns(rule)) | set(target_columns(rule))
    for k, v in rule.items():
        if k not in PROSE_KEYS:
            _scan(v, refs)
    return refs


def _no_rule(f: Field) -> str | None:
    d = (f.description or "").lower()
    if f.name in AUDIT_NAMES or any(w in d for w in AUDIT_WORDS):
        return "no rule: technical audit field (system-set create/change stamp)"
    if f.data_element in {"TIMESTAMP", "TZNTSTMPS", "TZNTSTMPL"}:
        return "no rule: technical timestamp"
    return None


def idea(f: Field, obsolete: str | None) -> str:
    """A verifiable rule idea derived from the field's dictionary metadata."""
    if (nr := _no_rule(f)):
        return nr
    if obsolete:
        return f"S4-prerequisite: table is obsolete in S/4HANA ({obsolete}); check the value is carried to the replacement before conversion"
    if f.key:
        return "mandatory: key field never blank (null_check)"
    if f.picklist:
        return f"domain: value in the tenant picklist `{f.picklist}` (domain_value_check)"
    if f.check_ref:
        return f"domain: value exists in check table `{f.check_ref}` (referential_check)"
    if f.fixed_values:
        vals = sorted(v.low or "' '" for v in f.fixed_values)
        if vals == ["' '", "X"]:
            return "domain: flag is blank or `X`; profile set-rate, then a cross-field rule on what the flag implies"
        shown = ", ".join(vals[:10]) + (" ..." if len(vals) > 10 else "")
        return f"domain: value in DDIC fixed values {{{shown}}} (domain_value_check)"
    t = (f.type or "").upper()
    if t in {"DATS", "DATE", "DATETIME"}:
        return "format: valid date when populated; cross-field ordering against the record's validity dates"
    if t in {"QUAN", "DEC", "CURR", "FLTP", "INT1", "INT2", "INT4", "DECIMAL", "INTEGER"}:
        return "domain: value >= 0 when populated (confirm sign convention before enabling)"
    if t == "NUMC":
        return f"format: digits only, length {f.length}"
    if f.conversion_exit == "ALPHA":
        return "format: ALPHA-converted (numeric values zero-padded)"
    if t == "BOOLEAN":
        return "cross-field: profile true-rate, then a rule on what the flag implies (unverified)"
    return "mandatory-if-used: profile population rate per type/org unit, then a conditional null_check (unverified)"


def _extracted(obj: str, cfg: dict, dictionary) -> set[str]:
    if cfg["system"] == "successfactors":
        return {f"{t}.{n}" for t in cfg["tables"] for n, f in dictionary.table(t).fields.items()
                if f.source and "." in f.source}
    from sap.extraction_plan import plan_modules
    plans = plan_modules([obj], dictionary, include_disabled=True)
    return {f"{t}.{f}" for t, p in plans.items() if t in cfg["tables"] for f in p.fields}


def render(obj: str) -> str:
    cfg = OBJECTS[obj]
    dictionary = get_dictionary("ecc6")
    s4 = get_dictionary("s4hana")
    rules = module_rules(obj)
    by_field: dict[str, list[tuple[str, bool]]] = {}
    for r in rules:
        for ref in rule_refs(r):
            by_field.setdefault(ref, []).append((r["id"], r.get("enabled", True)))
    read = _extracted(obj, cfg, dictionary)
    curated = CURATED.get(obj, {})

    rows, per_table = [], []
    for t in cfg["tables"]:
        table = dictionary.table(t)
        s4t = s4.table(t)
        obsolete = getattr(s4t, "note", None) if s4t is not None and s4t.obsolete_in else None
        n = c = 0
        for name, f in table.fields.items():
            if name in CLIENT:
                continue
            q = f"{t}.{name}"
            ids = sorted({i for i, _ in by_field.get(q, [])})
            enabled = len({i for i, e in by_field.get(q, []) if e})
            n += 1
            c += bool(ids)
            shown = ", ".join(ids[:MAX_IDS]) + (f" +{len(ids) - MAX_IDS} more" if len(ids) > MAX_IDS else "")
            if ids:
                gap = "" if enabled else "only disabled (DDIC-generated) rules; review for enabling"
            else:
                gap = curated.get(q) or idea(f, obsolete)
            rows.append((t, name, f.description or "", len(ids), enabled, shown, q in read, gap))
        per_table.append((t, table.description, n, c))

    stale_gaps = [f"{r[0]}.{r[1]}" for r in rows if r[3] and f"{r[0]}.{r[1]}" in curated]
    if stale_gaps:  # a rule now covers a curated gap: drop it from CURATED
        raise SystemExit(f"CURATED gaps for {obj} are now covered by rules: {stale_gaps}")
    total = len(rows)
    covered = sum(1 for r in rows if r[3])
    enabled_cov = sum(1 for r in rows if r[4])
    read_rows = [r for r in rows if r[6]]
    no_rule = sum(1 for r in rows if not r[3] and r[7].startswith("no rule"))
    pct = lambda a, b: f"{100 * a / b:.1f}%" if b else "n/a"  # noqa: E731

    out = [
        f"# Field coverage: {cfg['title']}",
        "",
        f"Generated by `scripts/field_coverage.py` from the `{obj}` rule packs (hand-written and "
        "`.generated.yaml`) and the repo dictionaries. Do not edit by hand; rerun the script.",
        "",
        "## Summary",
        "",
        "| Measure | Value |",
        "|---|---|",
        f"| Tables in scope | {len(cfg['tables'])} |",
        f"| Fields extracted (dictionary fields of the in-scope tables, client excluded) | {total} |",
        f"| Fields read by the current extraction plan | {len(read_rows)} |",
        f"| Fields with at least 1 rule | {covered} |",
        f"| **Coverage** | **{pct(covered, total)}** |",
        f"| Fields with at least 1 enabled rule | {enabled_cov} ({pct(enabled_cov, total)}) |",
        f"| Coverage of fields the plan reads | {pct(sum(1 for r in read_rows if r[3]), len(read_rows))} |",
        f"| Uncovered fields marked \"no rule\" | {no_rule} |",
        f"| Coverage excluding \"no rule\" fields | {pct(covered, total - no_rule)} |",
        "",
        (
            "The SuccessFactors connector reads every mapped property of each canonical table the rules"
            " touch, so every field is read; the gaps below are read but never judged."
            if obj == "employee_central"
            else "The extraction plan reads exactly the fields rules reference, plus keys and join fields,"
            " so coverage of read fields is near 100% by construction. The gap list below is the rest of"
            " each table: fields SAP holds that no rule judges yet, so the plan never reads them."
        ),
        "",
        "| Table | Description | Fields | With rule | Coverage |",
        "|---|---|---|---|---|",
        *(f"| {t} | {d} | {n} | {c} | {pct(c, n)} |" for t, d, n, c in per_table),
        "",
    ]
    if curated:
        out += ["## Top gaps", "", "| # | Field | Rule idea |", "|---|---|---|"]
        out += [f"| {i} | `{q}` | {v} |" for i, (q, v) in enumerate(curated.items(), 1)]
        out.append("")
    out += ["## Fields", "",
            "Read: `y` when the current extraction plan pulls the field. Rules: all / enabled.", ""]
    for t, _, _, _ in per_table:
        out += [f"### {t}", "", "| Table | Field | Description | Read | Rules | Rule IDs | Gap note |",
                "|---|---|---|---|---|---|---|"]
        for tt, name, desc, n, e, shown, rd, gap in rows:
            if tt == t:
                desc = desc.replace("|", "/")
                out.append(f"| {tt} | {name} | {desc} | {'y' if rd else ''} | {n} / {e} | {shown} | {gap} |")
        out.append("")
    return "\n".join(out)


def build() -> dict[Path, str]:
    for obj, fields in CURATED.items():  # curated ideas must name real fields
        d = get_dictionary("ecc6")
        bad = [q for q in fields if d.resolve(q) is None or q.split(".")[0] not in OBJECTS[obj]["tables"]]
        if bad:
            raise SystemExit(f"CURATED names fields outside {obj}'s dictionary scope: {bad}")
    return {OUT_DIR / f"{obj}.md": render(obj) for obj in OBJECTS}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if any report is stale")
    args = parser.parse_args()
    stale = 0
    for path, text in build().items():
        if path.exists() and path.read_text(encoding="utf-8") == text:
            continue
        if args.check:
            stale += 1
            print(f"stale: {path.relative_to(ROOT)}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")
    if args.check:
        if stale:
            print(f"{stale} field-coverage report(s) out of date; run scripts/field_coverage.py")
            return 1
        print("field-coverage reports are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
