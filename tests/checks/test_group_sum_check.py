"""group_sum_check: a child amount summed per parent against one parent value."""

import pandas as pd
import pytest

from checks.frames import TableFrames
from checks.runner import run_rule
from checks.types.group_sum_check import GroupSumCheck, child_sums
from sap.ddic import get_dictionary

RULE = {"id": "T", "check_class": "group_sum_check", "field": "EKPO.MENGE", "amount": "EKBE.MENGE",
        "group_keys": {"EKBE.EBELN": "EKPO.EBELN", "EKBE.EBELP": "EKPO.EBELP"},
        "sign_field": "EKBE.SHKZG", "severity": "high", "message": "m"}


def _parents(menge: list, uebto: list | None = None) -> pd.DataFrame:
    n = len(menge)
    df = pd.DataFrame({"EKPO.EBELN": ["45"] * n, "EKPO.EBELP": [f"{i + 1:05d}" for i in range(n)], "EKPO.MENGE": menge})
    if uebto is not None:
        df["EKPO.UEBTO"] = uebto
    return df


def _history(rows: list[tuple[str, str, str, str]]) -> pd.DataFrame:
    """(item, VGABE, MENGE, SHKZG) per PO history line."""
    return pd.DataFrame({"EKBE.EBELN": ["45"] * len(rows), "EKBE.EBELP": [r[0] for r in rows],
                         "EKBE.VGABE": [r[1] for r in rows], "EKBE.MENGE": [r[2] for r in rows],
                         "EKBE.SHKZG": [r[3] for r in rows]})


def _run(rule: dict, parents: pd.DataFrame, history: pd.DataFrame):
    return GroupSumCheck({**rule, "_child_sums": child_sums(rule, history)}).run(parents)


def test_over_and_under_with_signs():
    # item 1: 10 received, 4 returned (H) => 6 <= 8; item 2: 12 received => over 8
    h = _history([("00001", "1", "10", "S"), ("00001", "1", "4", "H"), ("00002", "1", "12", "S")])
    r = _run(RULE, _parents(["8", "8"]), h)
    assert (r.total_count, r.affected_count) == (2, 1)
    assert r.details["largest_excess"] == 4.0
    # without the sign field the return counts as a receipt: 14 > 8
    r = _run({k: v for k, v in RULE.items() if k != "sign_field"}, _parents(["8", "8"]), h)
    assert r.affected_count == 2


def test_compare_equal_and_greater():
    h = _history([("00001", "1", "8", "S"), ("00002", "1", "5", "S"), ("00003", "1", "9", "S")])
    p = _parents(["8", "8", "8"])
    assert _run({**RULE, "compare": "=="}, p, h).affected_count == 2
    assert _run({**RULE, "compare": ">="}, p, h).affected_count == 1
    with pytest.raises(ValueError):
        GroupSumCheck({**RULE, "compare": "<>"}).evaluate(p)


def test_tolerances():
    h = _history([("00001", "1", "105", "S"), ("00002", "1", "111", "S")])
    p = _parents(["100", "100"], uebto=["10", "10"])
    assert _run(RULE, p, h).affected_count == 2                                 # no tolerance
    assert _run({**RULE, "tolerance": 6}, p, h).affected_count == 1             # absolute
    assert _run({**RULE, "tolerance_pct": 10}, p, h).affected_count == 1        # percent
    assert _run({**RULE, "tolerance_field": "EKPO.UEBTO"}, p, h).affected_count == 1  # UEBTO 10%
    blank = _parents(["100", "100"], uebto=["", None])                          # blank UEBTO = 0%
    assert _run({**RULE, "tolerance_field": "EKPO.UEBTO"}, blank, h).affected_count == 2


def test_no_children_modes():
    h = _history([("00001", "1", "1", "S")])
    p = _parents(["8", "8"])
    r = _run(RULE, p, h)
    assert (r.total_count, r.affected_count) == (2, 0)
    assert r.details["parents_without_children"] == 1
    assert _run({**RULE, "no_children": "skip"}, p, h).total_count == 1
    # judged with a sum of 0: fails only a ">=" style rule
    r = _run({**RULE, "no_children": "zero", "compare": ">="}, p, h)
    assert (r.total_count, r.affected_count) == (2, 2)


def test_nulls_excluded():
    h = _history([("00001", "1", "", "S"), ("00001", "1", "3", "S"), ("00002", "1", "50", "S")])
    r = _run(RULE, _parents(["8", None]), h)  # blank parent value: out of scope
    assert (r.total_count, r.affected_count) == (1, 0)


def test_runner_child_filter_incomplete_and_missing_child():
    d = get_dictionary("ecc6")
    rule = {**RULE, "module": "mm_purchasing", "grain": "EKPO", "child_when": {"EKBE.VGABE": ["1"]}}
    ekpo = _parents(["8", "8"])
    # item 1: 6 received plus an invoice for 20 (VGABE 2, not counted); item 2: 9 received
    ekbe = _history([("00001", "1", "6", "S"), ("00001", "2", "20", "S"), ("00002", "1", "9", "S")])
    frames = TableFrames({"EKPO": ekpo, "EKBE": ekbe}, d, module="mm_purchasing")
    _, r = run_rule(rule, frames)
    assert (r.total_count, r.affected_count) == (2, 1)
    frames.incomplete = {"EKBE"}  # history missing rows is not an under-received item
    _, r = run_rule(rule, frames)
    assert r.error and "incomplete" in r.error
    _, r = run_rule(rule, TableFrames({"EKPO": ekpo}, d, module="mm_purchasing"))
    assert r is None
