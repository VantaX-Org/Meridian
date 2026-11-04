"""A parent must carry a flag when every one of its child rows does: every company code
of a customer is flagged for deletion, but the customer (central record) is not.

Evaluated at the parent grain. The runner counts the child table per parent (read in full,
never joined) and passes ``_child_total`` and ``_child_match``:

* ``field``            parent field that must hold one of ``parent_expected`` (default X)
* ``group_keys``       child field -> parent field (``KNB1.KUNNR: KNA1.KUNNR``)
* ``child_when``       {child column: allowed values} marking a child as flagged (``applies_when`` syntax)
* ``parent_expected``  values satisfying the parent

Only parents with at least one child are in scope: a parent without children has nothing
to be "all" of. Whole-group check."""

import pandas as pd

from checks.base import BaseCheck, Evaluation
from checks.types.exists_check import key_of


class AllChildrenCheck(BaseCheck):
    check_class = "all_children_check"
    default_dimension = "consistency"

    def columns(self) -> list[str]:
        return list(dict.fromkeys([self.rule["field"], *self.rule["group_keys"].values()]))

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        k = key_of(df, list(r["group_keys"].values()))
        total = k.map(r.get("_child_total") or {}).fillna(0)
        match = k.map(r.get("_child_match") or {}).fillna(0)
        scope = total > 0
        ok = df[r["field"]].astype("string").str.strip().isin({str(v) for v in r.get("parent_expected", ["X"])}).fillna(False)
        return Evaluation(scope, scope & (match == total) & ~ok.astype(bool),
                          {"parents": int(scope.sum()), "parents_all_children_flagged": int((scope & (match == total)).sum())})
