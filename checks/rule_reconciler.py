"""Reconcile DQ rules against the SAP data dictionary.

The rule set (``checks/rules/**/*.yaml``) and the data dictionary
(``sap/data_dictionary.py``) are two independent descriptions of the same SAP
fields, and nothing keeps them in sync. This module is the reconciler that makes
the drift visible. It reports two classes of inconsistency:

  1. **Value drift** — a ``domain_value_check`` rule whose ``allowed_values`` do
     not match the dictionary's ``valid_values`` for the same ``TABLE.FIELD``.
     ``rule_only`` values (allowed by the rule but absent from the dictionary)
     are the dangerous case: the rule will pass data SAP would reject.
     ``dict_only`` values (valid per dictionary, missing from the rule) are
     informational — the rule may be deliberately narrower.

  2. **Coverage gaps** — a field the dictionary flags ``mandatory: True`` that
     has no ``null_check`` rule, so its absence ships unvalidated.

Run as a tool::

    python -m checks.rule_reconciler          # human-readable report
    python -m checks.rule_reconciler --strict  # exit 1 if any rule_only drift

The ``--strict`` form is suitable as a CI gate once the existing drift is
resolved; it is intentionally not wired into the build yet.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field as dc_field
from pathlib import Path

import yaml

from sap.data_dictionary import DATA_DICTIONARY, get_valid_values

RULES_DIR = Path(__file__).parent / "rules"

# Rule files that are not rule sets (column maps, placeholders).
_NON_RULE_FILES = {"column_map.yaml"}


# ── Findings ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ValueDrift:
    """A domain_value_check rule whose allowed_values diverge from the dictionary."""

    module: str
    rule_id: str
    field: str  # TABLE.FIELD
    rule_only: tuple[str, ...]  # in the rule, not the dictionary — dangerous
    dict_only: tuple[str, ...]  # in the dictionary, not the rule — informational
    source_file: str

    @property
    def is_dangerous(self) -> bool:
        """True when the rule admits values the dictionary considers invalid."""
        return bool(self.rule_only)


@dataclass(frozen=True)
class CoverageGap:
    """A mandatory dictionary field with no null_check rule."""

    table: str
    field: str  # TABLE.FIELD

    @property
    def reason(self) -> str:
        return "dictionary marks field mandatory but no null_check rule covers it"


@dataclass
class ReconcileReport:
    value_drift: list[ValueDrift] = dc_field(default_factory=list)
    coverage_gaps: list[CoverageGap] = dc_field(default_factory=list)

    @property
    def dangerous_drift(self) -> list[ValueDrift]:
        return [d for d in self.value_drift if d.is_dangerous]

    @property
    def ok(self) -> bool:
        """Clean = no dangerous value drift. Coverage gaps and dict-only
        narrowing are surfaced but do not by themselves fail a strict run."""
        return not self.dangerous_drift


# ── Rule loading ─────────────────────────────────────────────────────────────


def _load_rule_files() -> list[tuple[str, dict]]:
    """Return ``(relative_path, parsed_yaml)`` for every rule YAML with a
    ``rules:`` list."""
    out: list[tuple[str, dict]] = []
    for path in sorted(RULES_DIR.rglob("*.yaml")):
        if path.name in _NON_RULE_FILES:
            continue
        try:
            cfg = yaml.safe_load(path.read_text()) or {}
        except yaml.YAMLError:
            continue
        if not isinstance(cfg, dict) or "rules" not in cfg:
            continue
        rel = str(path.relative_to(RULES_DIR))
        out.append((rel, cfg))
    return out


def load_all_rules() -> list[dict]:
    """Flatten every rule, annotating each with ``_module`` and ``_source_file``."""
    rules: list[dict] = []
    for rel, cfg in _load_rule_files():
        module = cfg.get("module", Path(rel).stem)
        for rule in cfg.get("rules", []) or []:
            if not isinstance(rule, dict):
                continue
            rules.append({**rule, "_module": module, "_source_file": rel})
    return rules


def _norm(values) -> set[str]:
    return {str(v).strip() for v in (values or []) if str(v).strip()}


def _split_field(field: str) -> tuple[str, str] | None:
    """Split ``TABLE.FIELD`` into ``(TABLE, FIELD)``; None if not that shape."""
    if not field or "." not in field:
        return None
    table, _, fld = field.partition(".")
    if not table or not fld:
        return None
    return table.upper(), fld.upper()


# ── Reconciliation ───────────────────────────────────────────────────────────


def reconcile_allowed_values(rules: list[dict]) -> list[ValueDrift]:
    """Compare each domain_value_check rule's allowed_values to the dictionary."""
    drift: list[ValueDrift] = []
    for rule in rules:
        if rule.get("check_class") != "domain_value_check":
            continue
        allowed = rule.get("allowed_values")
        if not allowed:
            continue
        parts = _split_field(rule.get("field", ""))
        if parts is None:
            continue
        table, fld = parts
        dict_values = get_valid_values(table, fld)
        if not dict_values:
            # Dictionary is silent / free-form for this field — nothing to compare.
            continue

        rule_set = _norm(allowed)
        dict_set = _norm(dict_values)
        rule_only = tuple(sorted(rule_set - dict_set))
        dict_only = tuple(sorted(dict_set - rule_set))
        if rule_only or dict_only:
            drift.append(
                ValueDrift(
                    module=rule.get("_module", ""),
                    rule_id=rule.get("id", "?"),
                    field=f"{table}.{fld}",
                    rule_only=rule_only,
                    dict_only=dict_only,
                    source_file=rule.get("_source_file", ""),
                )
            )
    return drift


def coverage_gaps(rules: list[dict]) -> list[CoverageGap]:
    """Mandatory dictionary fields with no null_check rule."""
    null_checked: set[str] = set()
    for rule in rules:
        if rule.get("check_class") != "null_check":
            continue
        parts = _split_field(rule.get("field", ""))
        if parts is not None:
            null_checked.add(f"{parts[0]}.{parts[1]}")

    gaps: list[CoverageGap] = []
    for table, fields in DATA_DICTIONARY.items():
        for fld, meta in fields.items():
            if not meta.get("mandatory"):
                continue
            key = f"{table.upper()}.{fld.upper()}"
            if key not in null_checked:
                gaps.append(CoverageGap(table=table.upper(), field=key))
    return gaps


def reconcile() -> ReconcileReport:
    """Run both reconciliations over the full rule set."""
    rules = load_all_rules()
    return ReconcileReport(
        value_drift=reconcile_allowed_values(rules),
        coverage_gaps=coverage_gaps(rules),
    )


# ── CLI ──────────────────────────────────────────────────────────────────────


def _format_report(report: ReconcileReport) -> str:
    lines: list[str] = []
    lines.append("Rule ↔ data-dictionary reconciliation")
    lines.append("=" * 44)

    dangerous = report.dangerous_drift
    lines.append("")
    lines.append(f"Value drift: {len(report.value_drift)} field(s), "
                 f"{len(dangerous)} dangerous (rule admits dict-invalid values)")
    for d in report.value_drift:
        tag = "DANGER" if d.is_dangerous else "narrow"
        lines.append(f"  [{tag}] {d.rule_id} {d.field} ({d.module})")
        if d.rule_only:
            lines.append(f"        rule-only (not in dictionary): {list(d.rule_only)}")
        if d.dict_only:
            lines.append(f"        dict-only (rule omits):        {list(d.dict_only)}")

    lines.append("")
    lines.append(f"Coverage gaps: {len(report.coverage_gaps)} mandatory "
                 f"dictionary field(s) with no null_check")
    for g in report.coverage_gaps:
        lines.append(f"  {g.field}")

    lines.append("")
    lines.append("CLEAN" if report.ok else "DRIFT DETECTED")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    strict = "--strict" in argv
    report = reconcile()
    print(_format_report(report))
    if strict and not report.ok:
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
