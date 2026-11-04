"""At most (and optionally at least) N child rows matching a condition per parent key.

Evaluated at the child grain: every child row with a populated parent key is in scope.
Parents never get a row of their own, so the failing records are the rows to correct:

* ``parent_keys``  child columns identifying the parent (KNVA.KUNNR; BUT020.PARTNER)
* ``count_when``   {column: [values]} rows that are counted (default: ``field`` equals X)
* ``max``          more matching rows than this: the matching rows fail
* ``min``          fewer matching rows than this: every row of the parent fails

Rows with a blank parent key are out of scope. A parent with no matching row meets ``max``
and, with ``min``, fails on all its rows. Whole-group check: needs a complete extract."""

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank
from checks.types.exists_check import key_of


class CountPerParentCheck(BaseCheck):
    check_class = "count_per_parent_check"
    default_dimension = "uniqueness"

    def _when(self) -> dict[str, list]:
        return self.rule.get("count_when") or {self.rule["field"]: ["X"]}

    def columns(self) -> list[str]:
        return list(dict.fromkeys([self.rule["field"], *self.rule["parent_keys"], *self._when()]))

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        if r.get("max") is None and r.get("min") is None:
            raise ValueError("count_per_parent_check needs max, min or both")
        keys = list(r["parent_keys"])
        scope = pd.Series(True, index=df.index)
        for k in keys:
            scope &= ~is_blank(df[k])
        match = scope.copy()
        for col, allowed in self._when().items():
            match &= df[col].astype("string").str.strip().isin({str(v) for v in allowed}).fillna(False).astype(bool)
        parent = key_of(df, keys)
        n = match.astype(int).groupby(parent).transform("sum")
        over = match & (n > int(r["max"])) if r.get("max") is not None else pd.Series(False, index=df.index)
        under = scope & (n < int(r["min"])) if r.get("min") is not None else pd.Series(False, index=df.index)
        return Evaluation(scope, over | under,
                          {"parents": int(parent[scope].nunique()), "parents_out_of_bounds": int(parent[over | under].nunique())})
