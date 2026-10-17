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


# ── the constraint that stops the first shipped rule ────────────────────────────────────────────
# docs/reconciliation-check.md records that no reconciliation rule can ship on this deployment
# because the G/L side is a windowed read. That reasoning is only true while the extraction plan
# says so, so it is asserted here: if BSEG ever becomes a full read, this test fails and the
# finance reconciliation becomes writable - which is the moment worth noticing.

def test_the_documented_full_read_facts_still_hold():
    from sap.extraction_plan import plan_modules, MODULES_BY_SYSTEM

    modules = [m for ms in MODULES_BY_SYSTEM.values() for m in ms]
    plans = plan_modules(modules, D)
    full = {t: not getattr(p, "partial", True) for t, p in plans.items()}

    assert full.get("BSIK") is True, "BIK is the full-read source side"
    assert full.get("BSID") is True, "BSID is the full-read source side"
    for t in ("BSEG", "BKPF", "BSAK"):
        assert full.get(t) is False, (
            f"{t} is now read in full - the sub-ledger/GL reconciliation documented as "
            f"unwritable in docs/reconciliation-check.md has become writable"
        )


# ── the proof harness must be able to prove one ─────────────────────────────────────────────────
# Every shipped rule is required to be `proven` by tests/checks/test_rule_proofs.py. Before this
# was added, prove() ran a reconciliation rule with no target total - so the check correctly
# condemned nothing - and returned "never_fails". Any reconciliation rule would therefore have
# been unprovable and could never have shipped.

def test_the_proof_harness_can_prove_a_reconciliation_rule():
    from tests.checks.rule_proofs import prove

    rule = {**BASE_RULE, "id": "ZX1", "module": "accounts_payable"}
    verdict, detail = prove(rule, D)
    assert verdict == "proven", f"{verdict} - {detail}"
    assert "passes" in detail and "fails" in detail


def test_the_proof_rejects_a_check_that_never_condemns(monkeypatch):
    """The failure mode that made every reconciliation rule unprovable, reproduced deliberately.

    With no target total the check condemns nothing. prove() used to accept that as the rule's
    behaviour and report "never_fails"; it must instead refuse to call such a rule proven. Broken
    here by suppressing the runner's target so the check can only ever pass.
    """
    from checks.types import reconciliation_check as rc
    from tests.checks.rule_proofs import prove

    original = rc.ReconciliationCheck.evaluate

    def never_fails(self, df):
        import pandas as pd
        none = pd.Series(False, index=df.index)
        return rc.Evaluation(pd.Series(True, index=df.index), none, {})

    monkeypatch.setattr(rc.ReconciliationCheck, "evaluate", never_fails)
    rule = {**BASE_RULE, "id": "ZX2", "module": "accounts_payable"}
    verdict, _ = prove(rule, D)
    assert verdict != "proven", "a check that cannot fail must never be reported as proven"
    monkeypatch.setattr(rc.ReconciliationCheck, "evaluate", original)
