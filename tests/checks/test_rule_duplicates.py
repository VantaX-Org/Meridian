"""Two rules in one pack must not test the same predicate.

``test_rule_proofs`` proves each rule on its own, so two rules with identical semantics both
pass: one flags the records, the other flags exactly the same records again. The customer
sees a doubled finding, and where the copies disagree on severity - which is how they are
usually written, by a later pass that did not notice the earlier one - the same defect
appears as both "medium" and "high". The rule count is inflated by one per copy, which is
the number the depth gates and the README report.

This is the gate that was missing. It found 18 such pairs in the shipped library.

What counts as the "same predicate": every field a check class or the runner reads to
decide which records fail - the class, the field(s), the expression, the target key and its
filters, allowed values, pattern, thresholds, grain. What does NOT count: message, severity,
dimension, why_it_matters, sap_impact, fix_map, record_fix_template, auto_fix. Those are how
a finding is presented, not which records it selects, so two rules differing only in those
are the same check written twice - and severity and message are exactly what the copies
tend to differ in.

Duplication *across* modules is not flagged: the same base table legitimately appears in more
than one module (KNA1 in accounts_receivable and sd_customer_master; PERADDRESS in
employee_central and payroll_integration), and each module is analysed and scored on its own.
"""

from __future__ import annotations

import collections
import glob
import json
from pathlib import Path

import pytest
import yaml

def _rules_dir() -> Path:
    """``checks/rules``, found from whichever of these points at the checkout.

    ``Path(__file__).resolve()`` and the working directory can disagree on macOS (/tmp is a
    symlink to /private/tmp), and a wrong guess here silently loads no rules - a gate that
    passes because it checked nothing is worse than no gate.
    """
    for base in (Path.cwd(), Path(__file__).resolve().parents[2],
                 Path(__file__).resolve().parents[1]):
        candidate = base / "checks" / "rules"
        if candidate.is_dir():
            return candidate
    raise RuntimeError("could not locate checks/rules from the working directory or __file__")

# Every rule key a check class (checks/types/*.py) or the runner (checks/runner.py
# target_columns / _with_targets / _with_child_sums) reads to select failing records.
PREDICATE_KEYS = (
    "check_class", "field", "fields", "fail_when", "applies_when",
    "target_table", "target_fields", "target_when", "negate",
    "allowed", "allowed_values", "reference", "reference_table", "reference_field",
    "reference_values", "left_values", "right_values", "valid_values_with_labels",
    "pattern", "format", "normalize", "case_insensitive", "multi_value", "ranges",
    "countries", "country_field", "street_field", "scope_field",
    "group_by", "group_field", "groups", "amount", "group_keys", "sign_field", "child_when",
    "id_field", "keys", "unique_across", "block_by", "block_fields", "max_block", "determinant",
    "evidence_key", "exact_rule", "specs", "split_field", "compare", "condition", "kind", "family",
    "config_table", "baseline", "fauna", "no_children",
    "max_age_hours", "time_field", "max_depth", "threshold",
    # interval_check: `mode` and `open_ended` decide overlap vs gap vs open-ended, so two
    # interval rules on the same field are different checks (this is what made an earlier
    # version of this gate report PA043/PA051 as duplicates when one is overlap and the
    # other is gap).
    "start", "end", "mode", "open_ended",
    "grain", "require_populated", "tolerance", "tolerance_field", "tolerance_pct",
    "zero_is_blank", "as_of",
)



def _load() -> list[tuple[str, dict]]:
    out = []
    for p in sorted(glob.glob(str(_rules_dir() / "**" / "*.yaml"), recursive=True)):
        doc = yaml.safe_load(open(p)) or {}
        if not (isinstance(doc, dict) and doc.get("rules")):
            continue
        module = doc.get("module") or Path(p).stem.split(".")[0]
        for r in doc["rules"]:
            out.append((module, r))
    return out


def _key(rule: dict) -> tuple:
    """The predicate, with two normalisations that are about meaning, not presentation.

    * ``valid_values_with_labels``: the label is display text ("Amount" vs "Monetary
      amount"), so only the codes select records. Two rules differing only in a label are
      the same check.
    * ``interval_check.mode``: absent means "no_overlap" (checks/types/interval_check.py
      reads ``r.get("mode") == "continuous"``), so absent and "no_overlap" are the same
      check, while "continuous" adds gap detection and is genuinely different.
    """
    parts = []
    for k in PREDICATE_KEYS:
        v = rule.get(k)
        if k == "valid_values_with_labels" and isinstance(v, dict):
            v = sorted(v.keys())
        elif k == "mode" and rule.get("check_class") == "interval_check":
            v = v or "no_overlap"
        parts.append(json.dumps(v, sort_keys=True, default=str))
    return tuple(parts)


def same_module_duplicates(rules: list[tuple[str, dict]]) -> dict[str, list[str]]:
    """{module: [rule id, ...]} for every group of >1 rule sharing a predicate."""
    groups: dict[tuple, list[tuple[str, str]]] = collections.defaultdict(list)
    for module, r in rules:
        groups[(module, _key(r))].append((module, r["id"]))
    out: dict[str, list[str]] = {}
    for (module, _), members in groups.items():
        if len(members) > 1:
            out.setdefault(module, []).extend(sorted(i for _, i in members))
    return out


def test_the_gate_actually_loaded_the_rule_library():
    """The gate is worthless if it silently loads nothing - which is exactly what it did
    when first written, against a wrong root, and passed."""
    rules = _load()
    assert len(rules) > 8000, f"loaded only {len(rules)} rules - wrong path?"


# Duplicates that exist today and are not yet resolved. Removing one of a pair is not a
# one-line change: several packs have depth gates asserting that their ids are contiguous, so a
# deletion has to come with that gate's range updated, and where the pair sits mid-range the
# freed id wants a genuinely different check rather than a gap. Listed explicitly so the
# assertion below fails on any NEW duplicate - a regression gate rather than a blocker.
KNOWN_DUPLICATES: dict[str, set[str]] = {}



def test_no_new_rule_is_duplicated_within_its_pack():
    """Anything outside KNOWN_DUPLICATES fails; the known set is the outstanding cleanup.

    learning_management is deliberately absent: LMS086 duplicated LMS041 (same field, same
    fail_when, severity medium vs high) and was removed, with the id retired in
    test_sf_talent_depth_rules so it is not reused for an unrelated rule.
    """
    dupes = same_module_duplicates(_load())
    new = {
        module: [i for i in ids if i not in KNOWN_DUPLICATES.get(module, set())]
        for module, ids in dupes.items()
    }
    new = {m: ids for m, ids in new.items() if ids}
    assert not new, (
        "new duplicate rule(s) - rules in one pack testing the same predicate, which flag the "
        f"same records twice and inflate the rule count:\n"
        + "\n".join(f"  {m}: {', '.join(ids)}" for m, ids in sorted(new.items()))
    )


def test_the_known_duplicate_list_does_not_grow_stale():
    """If a listed duplicate is fixed, drop it here - an over-long list stops being a signal."""
    dupes = same_module_duplicates(_load())
    stale = {m: sorted(ids - set(dupes.get(m, []))) for m, ids in KNOWN_DUPLICATES.items()}
    stale = {m: ids for m, ids in stale.items() if ids}
    assert not stale, f"already resolved, remove from KNOWN_DUPLICATES: {stale}"


def test_the_gate_detects_a_known_duplicate_pair():
    """Guard against the gate silently passing everything.

    PAY043 and PAY127 are byte-identical regex_checks on PAYMENTINFO.BIC - they differ only
    in severity and message, which is the shape the gate has to see through.
    """
    rules = [
        ("payroll_integration", {"id": "X1", "check_class": "regex_check", "field": "A.B",
                                 "pattern": "^X$", "severity": "medium", "message": "one"}),
        ("payroll_integration", {"id": "X2", "check_class": "regex_check", "field": "A.B",
                                 "pattern": "^X$", "severity": "high", "message": "another"}),
    ]
    assert same_module_duplicates(rules) == {"payroll_integration": ["X1", "X2"]}


def test_a_genuinely_different_rule_is_not_flagged():
    """A different target filter is a different check (the MARC.NFMAT family)."""
    rules = [
        ("material_master", {"id": "Y1", "check_class": "exists_check", "field": "MARC.NFMAT",
                             "target_table": "MARC", "target_fields": ["MATNR", "WERKS"]}),
        ("material_master", {"id": "Y2", "check_class": "exists_check", "field": "MARC.NFMAT",
                             "target_table": "MARC", "target_fields": ["MATNR", "WERKS"],
                             "target_when": {"LVORM": ["X"]}}),
    ]
    assert same_module_duplicates(rules) == {}


def test_cross_module_duplication_is_allowed():
    """KNA1 is legitimately analysed by two modules, each scored on its own."""
    rules = [
        ("accounts_receivable", {"id": "AR001", "check_class": "null_check", "field": "KNA1.KUNNR"}),
        ("sd_customer_master", {"id": "SDCM001", "check_class": "null_check", "field": "KNA1.KUNNR"}),
    ]
    assert same_module_duplicates(rules) == {}
