"""Validity periods of one group must not overlap — and, in ``continuous`` mode,
must also leave no gap (HR time constraint 1: an employee's org assignment
exists without interruption). Dates are SAP YYYYMMDD; 99991231 is open-ended.
Rows are ordered by start within the group; a row fails when it starts on or
before the latest end of the rows before it (overlap) or, continuous, more
than a day after it (gap). ``open_ended`` also fails a group's last row when
it does not run to 99991231. Rows without a valid start/end, or ending before
they start, are out of scope (other rules own them)."""

import pandas as pd

from checks.base import BaseCheck, Evaluation

OPEN = pd.Timestamp("2262-04-11")  # pandas' ceiling stands in for 99991231


def _date(s: pd.Series) -> pd.Series:
    s = s.astype("string").str.strip().str.replace("-", "", regex=False).str[:8]
    return pd.to_datetime(s.where(s != "99991231", "22620411"), format="%Y%m%d", errors="coerce")


class IntervalCheck(BaseCheck):
    check_class = "interval_check"
    default_dimension = "consistency"

    def columns(self) -> list[str]:
        r = self.rule
        return list(dict.fromkeys(r["group_by"] + [r["start"], r["end"]]))

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        end_col = df[r["end"]]
        if r.get("mode") == "open_ended_only":
            # Only this opt-in path: "" and whitespace-only also mean open. The default path
            # (used by every other rule on this check type) is untouched — _date's own
            # 99991231-only sentinel keeps its exact prior behaviour there.
            blank = end_col.astype("string").str.strip().fillna("").eq("")
            end_col = end_col.mask(blank, "99991231")
        start, end = _date(df[r["start"]]), _date(end_col)
        valid = start.notna() & end.notna() & (start <= end)
        keys = df[r["group_by"]].astype("string").apply(lambda s: s.str.strip()).fillna("")
        group = keys.apply(lambda row: "|".join(row), axis=1) if len(df) else pd.Series(dtype="string")
        work = pd.DataFrame({"g": group, "s": start, "e": end})[valid].sort_values(["g", "s", "e"])
        prev_end = work.groupby("g")["e"].transform(lambda e: e.cummax().shift())
        overlap = work["s"] <= prev_end
        if r.get("mode") == "open_ended_only":
            # group_by is coarser than the interval's natural key (e.g. USERID alone, with
            # several concurrent pay components sharing a date range) — overlap is then
            # expected, not a defect; only the group's last row running open-ended is checked.
            bad = pd.Series(False, index=work.index)
        else:
            bad = overlap.copy()
            if r.get("mode") == "continuous":
                bad |= (work["s"] - prev_end) > pd.Timedelta(days=1)
        if r.get("open_ended"):
            last = ~work["g"].duplicated(keep="last")
            bad |= last & (work.groupby("g")["e"].transform("max") < OPEN)
        failing = bad.reindex(df.index, fill_value=False)
        return Evaluation(valid, failing, {"groups": int(work["g"].nunique()), "overlaps": int(overlap.sum()),
                                           "mode": r.get("mode", "no_overlap")})
