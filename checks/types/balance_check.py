"""A group of records must net to zero — e.g. an FI document's line items in
company-code currency (debits = credits). One record per group (its first
line) carries the result, so a group counts once; the imbalance is reported."""

import pandas as pd

from checks.base import BaseCheck, Evaluation, sap_number


class BalanceCheck(BaseCheck):
    check_class = "balance_check"
    default_dimension = "accuracy"

    def columns(self) -> list[str]:
        r = self.rule
        return list(dict.fromkeys(r["group_by"] + [r["amount"], r["sign_field"]]))

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        amount = sap_number(df[r["amount"]]).fillna(0).abs()
        sign = df[r["sign_field"]].astype("string").str.strip().eq(r.get("debit_value", "S"))
        signed = amount.where(sign, -amount)
        keys = df[r["group_by"]].astype("string").apply(lambda s: s.str.strip()).fillna("")
        net = signed.groupby([keys[c] for c in r["group_by"]]).transform("sum")
        first = ~keys.duplicated()
        tolerance = float(r.get("tolerance", 0.005))
        off = first & (net.abs() > tolerance)
        return Evaluation(first, off, {"groups": int(first.sum()), "unbalanced": int(off.sum()),
                                       "largest_imbalance": round(float(net[off].abs().max()), 2) if off.any() else 0.0})
