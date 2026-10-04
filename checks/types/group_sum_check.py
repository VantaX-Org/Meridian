"""The sum of a child amount per parent record must stay within one value on the
parent — e.g. per PO item, the goods-receipt quantity in the PO history
(EKBE.MENGE, VGABE 1) against the ordered quantity plus the over-delivery
tolerance (EKPO.MENGE, UEBTO).

Evaluated at the parent grain: one record per parent, failing keys are parent
keys. The runner sums the child table (read in full per parent, never joined —
that would fan out) and passes the totals as ``_child_sums``:

* ``amount``      child amount field (its table is the child table)
* ``group_keys``  child field → parent field (``EKBE.EBELN: EKPO.EBELN``)
* ``child_when``  child rows counted (``applies_when`` syntax, e.g. VGABE '2')
* ``sign_field`` / ``negative_value``  amount negated where the indicator holds
  it (EKBE.SHKZG 'H': returns, reversals, credit memos)
* ``compare``     ``<=`` (default), ``==`` or ``>=`` — child sum against ``field``
* ``tolerance`` (absolute), ``tolerance_pct`` and ``tolerance_field`` (a
  percentage on the parent, e.g. EKPO.UEBTO; blank = 0) widen the limit
* ``no_children`` ``pass`` (default), ``skip`` (out of scope) or ``zero``
  (judged with a sum of 0)

A parent with a blank comparison value, and child rows with a blank amount,
are out of scope — null_check owns required fields."""

import pandas as pd

from checks.base import BaseCheck, Evaluation, sap_number
from checks.types.exists_check import key_of


def child_sums(rule: dict, child: pd.DataFrame) -> dict[str, float]:
    """Signed child amount per group key (``key_of`` over the child key fields)."""
    amount = sap_number(child[rule["amount"]])
    child = child[amount.notna()]
    amount = amount.dropna().abs() if rule.get("sign_field") else amount.dropna()
    if rule.get("sign_field"):
        neg = child[rule["sign_field"]].astype("string").str.strip().eq(rule.get("negative_value", "H")).fillna(False)
        amount = amount.where(~neg, -amount)
    return amount.groupby(key_of(child, list(rule["group_keys"]))).sum().to_dict()


class GroupSumCheck(BaseCheck):
    check_class = "group_sum_check"
    default_dimension = "consistency"

    def columns(self) -> list[str]:
        r = self.rule
        cols = [r["field"]] + list(r["group_keys"].values()) + ([r["tolerance_field"]] if r.get("tolerance_field") else [])
        return list(dict.fromkeys(cols))

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        sums = r.get("_child_sums") or {}
        parent = sap_number(df[r["field"]])
        total = key_of(df, list(r["group_keys"].values())).map(sums)
        has_children = total.notna()
        total = total.fillna(0.0).astype(float)
        pct = float(r.get("tolerance_pct", 0))
        if r.get("tolerance_field"):
            pct = pct + sap_number(df[r["tolerance_field"]]).fillna(0)
        band = parent.abs() * pct / 100 + float(r.get("tolerance", 0.005))
        compare = r.get("compare", "<=")
        if compare == "<=":
            bad = total > parent + band
        elif compare == ">=":
            bad = total < parent - band
        elif compare == "==":
            bad = (total - parent).abs() > band
        else:
            raise ValueError(f"compare must be <=, == or >=, not {compare!r}")
        no_children = r.get("no_children", "pass")
        population = parent.notna() & (has_children | (no_children != "skip"))
        failing = bad.fillna(False) & (has_children | (no_children == "zero"))
        off = population & failing
        return Evaluation(population, failing, {
            "child": r["amount"], "compare": compare, "parents": int(population.sum()),
            "parents_without_children": int((population & ~has_children).sum()),
            "largest_excess": round(float((total - parent).abs()[off].max()), 3) if off.any() else 0.0})
