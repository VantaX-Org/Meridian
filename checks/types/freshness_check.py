from datetime import datetime, timezone

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank
from checks.types.domain_value_check import _parse_dates


class FreshnessCheck(BaseCheck):
    """Populated dates must be newer than ``max_age_hours``.

    Blank dates are out of scope (null_check owns them); a populated value
    that is not a date fails. Optional ``time_field`` (SAP TIMS hhmmss) is
    combined with the DATS ``field`` for hour-accurate ages.
    """

    check_class = "freshness_check"
    default_dimension = "timeliness"

    def columns(self) -> list[str]:
        cols = super().columns()
        t = self.rule.get("time_field")
        return cols + [t] if t and t not in cols else cols

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        field = self.rule["field"]
        max_age_hours = self.rule["max_age_hours"]
        dates = df[field]
        if self.rule.get("time_field"):
            times = df[self.rule["time_field"]].astype("string").str.strip().fillna("").str.zfill(6)
            d = dates.astype("string").str.strip()
            ok = d.str.fullmatch(r"\d{8}").fillna(False) & times.str.fullmatch(r"\d{6}").fillna(False)
            dates = d.where(~ok, d + times)  # malformed time: fall back to the date alone
        parsed = _parse_dates(dates)
        # ponytail: compares SAP system-local date/time with UTC now; skew = system UTC offset.
        # Fine for day-scale thresholds; read TZONE from the system profile if hour precision matters.
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - pd.Timedelta(hours=max_age_hours)
        failing = parsed.isna() | (parsed < cutoff)
        valid = parsed.dropna()
        return Evaluation(~is_blank(df[field]), failing, {
            "max_age_hours": max_age_hours,
            "cutoff_datetime": cutoff.isoformat(),
            "oldest_value": str(valid.min()) if len(valid) else None,
            "newest_value": str(valid.max()) if len(valid) else None,
        })
