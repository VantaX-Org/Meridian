import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


class FieldStatusCheck(BaseCheck):
    """A field the record's account group makes *required* must be filled; one it
    *suppresses* should be empty. Generated from the source system's own
    field-status customizing (checks/field_status_rules.py) — never hand-written.
    """

    check_class = "field_status_check"
    default_dimension = "completeness"

    def columns(self) -> list[str]:
        return [self.rule["field"], self.rule["group_field"]]

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        groups = {str(g) for g in self.rule["groups"]}
        in_scope = df[self.rule["group_field"]].astype("string").str.strip().isin(groups).fillna(False)
        blank = is_blank(df[self.rule["field"]])
        failing = blank if self.rule["kind"] == "required" else ~blank
        return Evaluation(in_scope, failing, {"account_groups": sorted(groups), "status": self.rule["kind"],
                                              "config_table": self.rule.get("config_table"),
                                              "field_selection_definition": self.rule.get("fauna")})
