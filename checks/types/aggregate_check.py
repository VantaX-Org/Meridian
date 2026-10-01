"""Two signed totals of one group must agree — e.g. per purchase order item, the
quantity received (EKBE.VGABE 1) against the quantity invoiced (VGABE 2).
Rows are split by ``split_field`` into ``left_values`` / ``right_values``;
amounts are signed by ``sign_field`` (``debit_value`` positive). The group
fails when ``compare`` holds on (left - right): ``unequal``, ``left_gt_right``
or ``right_gt_left``, beyond ``tolerance``. One record per group (its first
row) carries the result, like balance_check."""

import pandas as pd

from checks.base import BaseCheck, Evaluation, sap_number


class AggregateCheck(BaseCheck):
    check_class = "aggregate_check"
    default_dimension = "consistency"

    def columns(self) -> list[str]:
        r = self.rule
        cols = r["group_by"] + [r["amount"], r["split_field"]] + ([r["sign_field"]] if r.get("sign_field") else [])
        return list(dict.fromkeys(cols))

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        amount = sap_number(df[r["amount"]]).fillna(0).abs()
        if r.get("sign_field"):
            debit = df[r["sign_field"]].astype("string").str.strip().eq(r.get("debit_value", "S")).fillna(False)
            amount = amount.where(debit, -amount)
        split = df[r["split_field"]].astype("string").str.strip()
        left = amount.where(split.isin([str(v) for v in r["left_values"]]).fillna(False), 0.0)
        right = amount.where(split.isin([str(v) for v in r["right_values"]]).fillna(False), 0.0)
        keys = df[r["group_by"]].astype("string").apply(lambda s: s.str.strip()).fillna("")
        by = [keys[c] for c in r["group_by"]]
        diff = left.groupby(by).transform("sum") - right.groupby(by).transform("sum")
        tol = float(r.get("tolerance", 0.0005))
        first = ~keys.duplicated()
        mode = r.get("compare", "unequal")
        bad = diff > tol if mode == "left_gt_right" else diff < -tol if mode == "right_gt_left" else diff.abs() > tol
        off = first & bad
        return Evaluation(first, off, {"groups": int(first.sum()), "failing_groups": int(off.sum()),
                                       "largest_difference": round(float(diff[off].abs().max()), 3) if off.any() else 0.0})
