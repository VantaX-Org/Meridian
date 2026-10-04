import pandas as pd

from checks.base import BaseCheck, Evaluation, as_of_time, is_blank
from checks.types.domain_value_check import _parse_dates


class FreshnessCheck(BaseCheck):
    """Populated dates must be newer than ``max_age_hours`` before the run's
    as-of (snapshot) date, or now when the run has none.

    Blank dates are out of scope (null_check owns them); a populated value
    that is not a date fails.
    """

    check_class = "freshness_check"
    default_dimension = "timeliness"

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        field = self.rule["field"]
        max_age_hours = self.rule["max_age_hours"]
        parsed = _parse_dates(df[field])
        cutoff = as_of_time(self.rule.get("_as_of")) - pd.Timedelta(hours=max_age_hours)
        failing = parsed.isna() | (parsed < cutoff)
        valid = parsed.dropna()
        return Evaluation(~is_blank(df[field]), failing, {
            "max_age_hours": max_age_hours,
            "cutoff_datetime": cutoff.isoformat(),
            "oldest_value": str(valid.min()) if len(valid) else None,
            "newest_value": str(valid.max()) if len(valid) else None,
        })
