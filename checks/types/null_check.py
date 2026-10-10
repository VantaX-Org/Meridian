import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank, sap_number

# DDIC numeric types whose initial value is 0: SAP stores an unfilled QUAN/CURR/DEC field as
# 0, not blank, so for these 0 is "not maintained" unless the rule says zero_is_blank: false.
ZERO_IS_BLANK_TYPES = frozenset({"QUAN", "CURR", "DEC", "FLTP", "INT1", "INT2", "INT4", "INT8"})


class NullCheck(BaseCheck):
    """Field must be populated. Sole owner of blank detection (SAP-aware)."""

    check_class = "null_check"
    default_dimension = "completeness"

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        field = self.rule["field"]
        blank = is_blank(df[field])
        if self.rule.get("_zero_is_blank"):  # set by checks.runner.run_rule from the DDIC type
            blank = blank | sap_number(df[field]).eq(0).fillna(False)
        return Evaluation(pd.Series(True, index=df.index), blank)
