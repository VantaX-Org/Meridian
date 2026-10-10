"""A numeric field must stay inside the range its group learned from the data
(house rule ``range``): e.g. raw-material gross weight between 0.1 and 10.9.
Rows whose group has no learned range, or whose value is not numeric, are out
of scope (other rules own them)."""

import pandas as pd

from checks.base import BaseCheck, Evaluation


class GroupRangeCheck(BaseCheck):
    check_class = "group_range_check"
    default_dimension = "validity"

    def columns(self) -> list[str]:
        return [self.rule["group_by"], self.rule["field"]]

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        ranges: dict[str, list[float]] = self.rule["ranges"]
        g = df[self.rule["group_by"]].astype("string").str.strip().fillna("")
        # ponytail: SAP trailing-minus values ("100-") read as non-numeric and stay out of scope
        x = pd.to_numeric(df[self.rule["field"]].astype("string").str.strip(), errors="coerce")
        lo = g.map({k: v[0] for k, v in ranges.items()})
        hi = g.map({k: v[1] for k, v in ranges.items()})
        scope = lo.notna() & x.notna()
        failing = scope & ((x < lo) | (x > hi))
        return Evaluation(scope, failing.fillna(False).astype(bool),
                          {"group_by": self.rule["group_by"], "groups": len(ranges)},
                          invalid_values_field=self.rule["field"])
