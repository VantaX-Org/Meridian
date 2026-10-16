"""reconciliation_check: a total here must equal a total in another table.

The gap this closes, and why the existing classes cannot: `aggregate_check` reconciles two
totals within one table, `exists_check` checks a record against a reference set, and
`cross_field_check` sees one row at a time. A wrong amount in the sub-ledger is not wrong on its
own row - it is wrong relative to the general ledger - so no existing class can express it, and
the finance packs sat at a handful of accuracy rules because of it.
"""

import pandas as pd

from checks.frames import TableFrames
from checks.runner import _with_target_sums, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")

BASE_RULE = {"id": "T1", "check_class": "reconciliation_check", "field": "BSIK.DMBTR",
             "target_table": "BSEG", "target_field": "DMBTR", "severity": "high",
             "dimension": "accuracy", "message": "Sub-ledger does not agree with the G/L",
             "why_it_matters": "w", "rule_authority": "sap_hard_constraint", "sap_impact": "i",
             "fix_map": {"__other__": "f"}, "record_fix_template": "t"}


def _frames(source=None, target=None) -> TableFrames:
    tables = {}
    if source is not None:
        tables["BSIK"] = source
    if target is not None:
        tables["BSEG"] = target
    return TableFrames(tables, D, module="accounts_payable")


def _resolved(rule, target_amounts):
    return _with_target_sums(rule, _frames(target=pd.DataFrame({"BSEG.DMBTR": target_amounts})), None)


def _result(resolved, source):
    return run_rule(resolved, _frames(source=source), {})[1]


def test_equal_totals_pass():
    res = _result(_resolved({**BASE_RULE}, ["100.00", "50.00"]),
                  pd.DataFrame({"BSIK.DMBTR": ["100.00", "50.00"]}))
    assert res.affected_count == 0, res.details
    assert res.details["source_total"] == 150.0 and res.details["target_total"] == 150.0


def test_a_difference_beyond_tolerance_fails_every_row():
    """The whole population is one group, so every row carries the finding: a reconciliation
    cannot say which row is wrong, only that the total does not agree."""
    res = _result(_resolved({**BASE_RULE}, ["100.00"]),
                  pd.DataFrame({"BSIK.DMBTR": ["100.00", "50.00"]}))
    assert res.affected_count == 2
    assert res.details["difference"] == 50.0


def test_a_difference_within_tolerance_passes():
    res = _result(_resolved({**BASE_RULE, "tolerance": 0.05}, ["100.02"]),
                  pd.DataFrame({"BSIK.DMBTR": ["100.00"]}))
    assert res.affected_count == 0, res.details


def test_an_incomplete_target_is_not_judged():
    """A total over a partial target is a false difference, so the rule refuses to run."""
    frames = _frames(target=pd.DataFrame({"BSEG.DMBTR": ["100.00"]}))
    frames.incomplete = {"BSEG"}
    out = _with_target_sums({**BASE_RULE}, frames, None)
    assert isinstance(out, str) and "not read in full" in out, out


def test_a_missing_target_table_is_not_judged():
    frames = _frames(source=pd.DataFrame({"BSIK.DMBTR": ["1"]}))
    assert _with_target_sums({**BASE_RULE}, frames, None) is None


def test_a_missing_target_column_is_not_judged():
    frames = _frames(target=pd.DataFrame({"BSEG.BELNR": ["1"]}))
    assert _with_target_sums({**BASE_RULE}, frames, None) is None


def test_without_a_target_total_nothing_is_condemned():
    """Defensive: if the runner ever fails to resolve the target, every row must not fail."""
    res = _result({**BASE_RULE}, pd.DataFrame({"BSIK.DMBTR": ["100.00"]}))
    assert res.affected_count == 0
    assert res.details.get("skipped") == "target total unavailable"
