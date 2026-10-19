"""A total in this table must equal a total in another table.

The library's other whole-group checks reconcile two totals *within* one table
(``aggregate_check``) or check one record against a reference set (``exists_check``).
Neither can express the reconciliation a finance close actually depends on: the open items in
the sub-ledger against the balance on the reconciliation account in the general ledger, a
goods-receipt accrual against its clearing account, a control total in a load file against the
detail it contains.

That is the gap ``cross_field_check`` cannot close either, and it is why the finance packs sit
at a handful of accuracy rules: a wrong amount is not wrong on its own row, it is wrong relative
to a total held somewhere else.

A rule declares::

    check_class: reconciliation_check
    field: BSIK.DMBTR            # the column summed in this table
    target_table: BSEG           # the table whose total it must agree with
    target_field: DMBTR          # the column summed there
    target_when: {BSEG.HKONT: ...}   # optional filter on the target rows
    tolerance: 0.01              # defaults to 0.01

The whole population is one group: it fails when the two totals differ by more than
``tolerance``, and every row carries the result (like ``balance_check``).

Referential honesty: a target table that was not read in full must not be judged, exactly as
``exists_check`` refuses to. The runner returns the rule unevaluated when the target was
incomplete, partial or absent, rather than reporting a difference against a partial total.
"""

import pandas as pd

from checks.base import BaseCheck, Evaluation, sap_number


class ReconciliationCheck(BaseCheck):
    check_class = "reconciliation_check"
    default_dimension = "accuracy"

    def columns(self) -> list[str]:
        return [self.rule["field"]]

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        # The runner supplies the target total; without it the check cannot judge anything, and
        # it says so rather than failing every row.
        target_total = r.get("_target_total")
        if target_total is None:
            none = pd.Series(False, index=df.index)
            return Evaluation(none, none, {"skipped": "target total unavailable"})

        # No sign handling on purpose. A rule that needs debits positive and credits negative
        # should sum a field that already carries the sign, or be written as an aggregate_check
        # over the same table. An earlier version accepted a `sign_field` and returned no result
        # at all (the runner skipped it), which is worse than not offering the option: a check
        # that silently does nothing reads as a passing reconciliation.
        amount = sap_number(df[r["field"]]).fillna(0)

        source_total = float(amount.sum())
        want = float(target_total)
        diff = source_total - want
        tol = float(r.get("tolerance", 0.01))
        off = pd.Series(abs(diff) > tol, index=df.index)
        return Evaluation(pd.Series(True, index=df.index), off, {
            "source_total": round(source_total, 3),
            "target_total": round(want, 3),
            "difference": round(diff, 3),
            "tolerance": tol,
        })
