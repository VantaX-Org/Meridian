import os

import pandas as pd

from checks.base import BaseCheck, Evaluation, as_of_time, is_blank
from checks.types.domain_value_check import _parse_dates


class FreshnessCheck(BaseCheck):
    """Populated dates must be newer than ``max_age_hours`` before the run's
    as-of (snapshot) date, or now when the run has none.

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
        # SAP dates/times are system-local: move the UTC cutoff onto the system's clock
        cutoff = as_of_time(self.rule.get("_as_of")) - pd.Timedelta(hours=max_age_hours) \
            + pd.Timedelta(seconds=sap_utc_offset(self.rule.get("_sap_utc_offset_seconds")))
        failing = parsed.isna() | (parsed < cutoff)
        valid = parsed.dropna()
        return Evaluation(~is_blank(df[field]), failing, {
            "max_age_hours": max_age_hours,
            "cutoff_datetime": cutoff.isoformat(),  # in SAP system-local time
            "oldest_value": str(valid.min()) if len(valid) else None,
            "newest_value": str(valid.max()) if len(valid) else None,
        })


def sap_utc_offset(stored) -> int:
    """Seconds SAP local time is ahead of UTC: MERIDIAN_SAP_UTC_OFFSET_SECONDS when set,
    else the offset read at extraction (RFC_SYSTEM_INFO RFCZONE), else 0 (uploads,
    cloud connectors, snapshots taken before the offset was recorded)."""
    # ponytail: RFCZONE sign assumed as documented (SAP local = UTC + RFCZONE). Unverified on a live
    # system: compare RFC_SYSTEM_INFO RFCZONE with SY-UZEIT vs UTC; if the sign is wrong, set the env
    # override (it wins) until the reader is fixed.
    env = os.getenv("MERIDIAN_SAP_UTC_OFFSET_SECONDS", "").strip()
    return int(env) if env else int(stored or 0)
