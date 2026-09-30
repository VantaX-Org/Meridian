import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


class FieldStatusCheck(BaseCheck):
    """A field the record's account group makes *required* must be filled; one it
    *suppresses* should be empty. Generated from the source system's own
    field-status customizing (checks/field_status_rules.py) — never hand-written.
    """

    check_class = "field_status_check"
    default_dimension = "completeness"

    def _group_fields(self) -> list[str]:
        g = self.rule["group_field"]
        return list(g) if isinstance(g, (list, tuple)) else [g]

    def columns(self) -> list[str]:
        return [self.rule["field"], *self._group_fields()]

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        groups = {str(g) for g in self.rule["groups"]}
        parts = [df[c].astype("string").str.strip().fillna("") for c in self._group_fields()]
        key = parts[0]
        for p in parts[1:]:  # composite group, e.g. material type | industry sector
            key = key + "|" + p
        in_scope = key.isin(groups).fillna(False)
        blank = is_blank(df[self.rule["field"]])
        failing = blank if self.rule["kind"] == "required" else ~blank
        return Evaluation(in_scope, failing, {"account_groups": sorted(groups), "status": self.rule["kind"],
                                              "config_table": self.rule.get("config_table"),
                                              "field_selection_definition": self.rule.get("fauna")})
