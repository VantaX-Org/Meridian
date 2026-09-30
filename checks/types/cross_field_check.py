import re

import pandas as pd

from checks.base import BaseCheck, Evaluation

_BACKTICKED = re.compile(r"`([^`]+)`")


class CrossFieldCheck(BaseCheck):
    """Rows where ``condition`` is True pass; False or NaN fail.

    Uses ``df.eval(engine="python")`` (not ``df.query``) so Series methods such
    as ``.notna()`` / ``.duplicated()`` work on backticked ``TABLE.FIELD`` names.
    """

    check_class = "cross_field_check"
    default_dimension = "consistency"

    def columns(self) -> list[str]:
        cols = super().columns()
        return cols + [c for c in _BACKTICKED.findall(self.rule["condition"]) if c not in cols]

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        condition = self.rule["condition"]
        passing = df.eval(condition, engine="python")
        if not isinstance(passing, pd.Series):
            passing = pd.Series(passing, index=df.index)
        passing = passing.astype("boolean").fillna(False).astype(bool)
        return Evaluation(pd.Series(True, index=df.index), ~passing,
                          {"condition": condition, "fields_checked": self.columns()})
