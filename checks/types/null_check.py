import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


class NullCheck(BaseCheck):
    """Field must be populated. Sole owner of blank detection (SAP-aware)."""

    check_class = "null_check"
    default_dimension = "completeness"

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        field = self.rule["field"]
        return Evaluation(pd.Series(True, index=df.index), is_blank(df[field]))
