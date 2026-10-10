"""A field the data shows to be decided by another one must follow it: a
steward accepted a mined dependency (field_dependencies, profile page) such as
"MARC.DISPO determines MARC.EKGRP" as a check.

The expected value of ``field`` is the most common one among the records
sharing the same ``determinant`` value; a record holding another value fails.
Blank determinants are out of scope.

A learned rule (``LR-``) carries ``allowed``: the mapping frozen when a person
approved it. Only its determinant values are in scope."""

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


class DependencyCheck(BaseCheck):
    check_class = "dependency_check"
    default_dimension = "consistency"

    def columns(self) -> list[str]:
        return [self.rule["determinant"], self.rule["field"]]

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        a = df[self.rule["determinant"]].astype("string").str.strip()
        b = df[self.rule["field"]].astype("string").str.strip().fillna("")
        populated = ~is_blank(df[self.rule["determinant"]])
        allowed: dict[str, list[str]] | None = self.rule.get("allowed")
        if allowed:
            pairs = {f"{k}\x1f{v}" for k, vs in allowed.items() for v in vs}
            scope = populated & a.isin(list(allowed))
            failing = scope & ~(a.fillna("") + "\x1f" + b).isin(pairs)
            return Evaluation(scope, failing, {"determinant": self.rule["determinant"], "groups": len(allowed),
                                               "frozen": True})
        # ponytail: expected mapping follows the data's majority each run; learned rules freeze it in ``allowed``
        expected = b[populated].groupby(a[populated]).agg(lambda s: s.value_counts().index[0])
        failing = populated & b.ne(a.map(expected).fillna(""))
        return Evaluation(populated, failing, {"determinant": self.rule["determinant"],
                                               "groups": int(expected.size)})
