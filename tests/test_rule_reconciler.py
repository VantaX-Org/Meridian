"""Tests for checks/rule_reconciler.py — rule ↔ data-dictionary reconciliation.

Core logic is tested with synthetic rule lists so the assertions do not break
when the real rule set or dictionary is edited. A final smoke test runs the
reconciler over the live rule set to prove it loads and produces a report.
"""

from __future__ import annotations

from checks.rule_reconciler import (
    CoverageGap,
    ReconcileReport,
    ValueDrift,
    coverage_gaps,
    load_all_rules,
    reconcile,
    reconcile_allowed_values,
)


# ── Value drift (synthetic, deterministic) ───────────────────────────────────


def test_rule_only_value_is_flagged_dangerous(monkeypatch):
    # Rule allows 'E'; dictionary says valid set is {A, C}. 'E' is dangerous.
    import checks.rule_reconciler as rr

    monkeypatch.setattr(rr, "get_valid_values", lambda t, f: ["A", "C"])
    rules = [
        {
            "id": "X1",
            "field": "MARA.MBRSH",
            "check_class": "domain_value_check",
            "allowed_values": ["A", "C", "E"],
            "_module": "material_master",
            "_source_file": "ecc/material_master.yaml",
        }
    ]
    drift = reconcile_allowed_values(rules)
    assert len(drift) == 1
    d = drift[0]
    assert d.rule_only == ("E",)
    assert d.dict_only == ()
    assert d.is_dangerous


def test_dict_only_value_is_narrowing_not_dangerous(monkeypatch):
    # Rule is stricter than the dictionary — informational only.
    import checks.rule_reconciler as rr

    monkeypatch.setattr(rr, "get_valid_values", lambda t, f: ["A", "C", "V"])
    rules = [
        {
            "id": "X2",
            "field": "MARA.MBRSH",
            "check_class": "domain_value_check",
            "allowed_values": ["A", "C"],
            "_module": "material_master",
            "_source_file": "f.yaml",
        }
    ]
    drift = reconcile_allowed_values(rules)
    assert len(drift) == 1
    assert drift[0].dict_only == ("V",)
    assert drift[0].rule_only == ()
    assert not drift[0].is_dangerous


def test_no_drift_when_sets_match(monkeypatch):
    import checks.rule_reconciler as rr

    monkeypatch.setattr(rr, "get_valid_values", lambda t, f: ["A", "C"])
    rules = [
        {
            "id": "X3",
            "field": "MARA.MBRSH",
            "check_class": "domain_value_check",
            "allowed_values": ["C", "A"],  # order-insensitive
            "_module": "m",
            "_source_file": "f.yaml",
        }
    ]
    assert reconcile_allowed_values(rules) == []


def test_freeform_dictionary_field_is_skipped(monkeypatch):
    # Dictionary returns None (free-form) → nothing to compare.
    import checks.rule_reconciler as rr

    monkeypatch.setattr(rr, "get_valid_values", lambda t, f: None)
    rules = [
        {
            "id": "X4",
            "field": "MARA.MAKTX",
            "check_class": "domain_value_check",
            "allowed_values": ["anything"],
            "_module": "m",
            "_source_file": "f.yaml",
        }
    ]
    assert reconcile_allowed_values(rules) == []


def test_non_domain_check_is_ignored(monkeypatch):
    import checks.rule_reconciler as rr

    monkeypatch.setattr(rr, "get_valid_values", lambda t, f: ["A"])
    rules = [
        {
            "id": "X5",
            "field": "MARA.MBRSH",
            "check_class": "null_check",
            "allowed_values": ["A", "B"],  # present but irrelevant for null_check
            "_module": "m",
            "_source_file": "f.yaml",
        }
    ]
    assert reconcile_allowed_values(rules) == []


def test_field_without_table_qualifier_is_skipped(monkeypatch):
    import checks.rule_reconciler as rr

    monkeypatch.setattr(rr, "get_valid_values", lambda t, f: ["A"])
    rules = [
        {
            "id": "X6",
            "field": "MBRSH",  # no TABLE. prefix
            "check_class": "domain_value_check",
            "allowed_values": ["B"],
            "_module": "m",
            "_source_file": "f.yaml",
        }
    ]
    assert reconcile_allowed_values(rules) == []


# ── Coverage gaps (synthetic, deterministic) ─────────────────────────────────


def test_mandatory_field_without_null_check_is_a_gap(monkeypatch):
    import checks.rule_reconciler as rr

    monkeypatch.setattr(
        rr, "DATA_DICTIONARY",
        {"ZTAB": {"FLD1": {"mandatory": True}, "FLD2": {"mandatory": False}}},
    )
    rules = [
        {"id": "N1", "field": "ZTAB.FLD2", "check_class": "null_check"},
    ]
    gaps = coverage_gaps(rules)
    assert [g.field for g in gaps] == ["ZTAB.FLD1"]
    assert "no null_check" in gaps[0].reason


def test_mandatory_field_with_null_check_is_not_a_gap(monkeypatch):
    import checks.rule_reconciler as rr

    monkeypatch.setattr(
        rr, "DATA_DICTIONARY", {"ZTAB": {"FLD1": {"mandatory": True}}}
    )
    rules = [{"id": "N2", "field": "ZTAB.FLD1", "check_class": "null_check"}]
    assert coverage_gaps(rules) == []


# ── Report semantics ─────────────────────────────────────────────────────────


def test_report_ok_is_false_with_dangerous_drift():
    report = ReconcileReport(
        value_drift=[
            ValueDrift("m", "R1", "T.F", rule_only=("X",), dict_only=(), source_file="f")
        ],
        coverage_gaps=[],
    )
    assert report.dangerous_drift
    assert not report.ok


def test_report_ok_is_true_with_only_narrowing_and_gaps():
    report = ReconcileReport(
        value_drift=[
            ValueDrift("m", "R1", "T.F", rule_only=(), dict_only=("V",), source_file="f")
        ],
        coverage_gaps=[CoverageGap("T", "T.F")],
    )
    assert not report.dangerous_drift
    assert report.ok  # narrowing + gaps alone do not fail a strict run


# ── Live smoke test ──────────────────────────────────────────────────────────


def test_load_all_rules_annotates_source():
    rules = load_all_rules()
    assert rules, "expected the live rule set to load at least one rule"
    sample = rules[0]
    assert "_module" in sample and "_source_file" in sample


def test_reconcile_runs_over_live_ruleset():
    report = reconcile()
    assert isinstance(report, ReconcileReport)
    # Every drift entry is well-formed.
    for d in report.value_drift:
        assert d.field and "." in d.field
        assert d.rule_only or d.dict_only
    for g in report.coverage_gaps:
        assert g.field.endswith(g.field.split(".")[-1])
