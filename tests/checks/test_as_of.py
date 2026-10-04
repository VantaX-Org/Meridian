"""Date-relative rules measure against the run's as-of (snapshot) date, not the wall clock."""
from types import SimpleNamespace

import pandas as pd

from checks.base import as_of_time
from checks.frames import TableFrames
from checks.runner import apply_context, run_checks, run_rule
from sap.ddic import get_dictionary
from workers.tasks.run_checks import snapshot_as_of

D = get_dictionary("ecc6")
SNAP = "2020-06-30"


def _lfa1(dates: list[str]) -> TableFrames:
    return TableFrames({"LFA1": pd.DataFrame({"LFA1.LIFNR": [str(i) for i in range(len(dates))],
                                              "LFA1.ERDAT": dates})}, D, module="accounts_payable")


def test_as_of_time_is_naive_utc():
    assert as_of_time("2020-06-30T02:00:00+02:00") == pd.Timestamp("2020-06-30 00:00:00")
    assert as_of_time(None).tzinfo is None


def test_older_than_days_counts_back_from_as_of():
    df = pd.DataFrame({"EKKO.EBELN": ["1", "2"], "EKKO.BEDAT": ["20191201", "20200601"]})
    when = {"EKKO.BEDAT": {"older_than_days": 180}}
    assert apply_context(df, when, SNAP)["EKKO.EBELN"].tolist() == ["1"]
    assert apply_context(df, when)["EKKO.EBELN"].tolist() == ["1", "2"]  # wall clock: both are old


def test_freshness_against_as_of():
    rule = {"id": "F", "field": "LFA1.ERDAT", "check_class": "freshness_check", "max_age_hours": 24 * 90,
            "module": "accounts_payable"}
    frames = _lfa1(["20200101", "20200615"])
    _, at_snapshot = run_rule(rule, frames, as_of=SNAP)
    assert at_snapshot.affected_count == 1
    assert at_snapshot.details["cutoff_datetime"].startswith("2020-04-01")
    _, now = run_rule(rule, frames)
    assert now.affected_count == 2

    extra = [{**rule, "id": "F-EXTRA"}]
    got = {r.check_id: r for r in run_checks("accounts_payable", frames, "t", extra_rules=extra, as_of=SNAP)}
    assert got["F-EXTRA"].affected_count == 1  # run_checks threads the date to every rule


def test_future_date_bound_uses_as_of():
    rule = {"id": "DT", "field": "LFA1.ERDAT", "check_class": "value_placement_check", "family": "date_range",
            "module": "accounts_payable"}
    frames = _lfa1(["20200601", "20200915"])
    _, at_snapshot = run_rule(rule, frames, as_of=SNAP)
    assert at_snapshot.failing_record_keys == ["LIFNR=1"]  # after the snapshot was taken
    _, now = run_rule(rule, frames)
    assert now.affected_count == 0


class _Session:
    def __init__(self, started):
        self.started = started

    def execute(self, *_):
        return SimpleNamespace(fetchone=lambda: (self.started,) if self.started else None)


def test_snapshot_as_of_priority():
    s = _Session(pd.Timestamp("2020-01-01", tz="UTC"))
    assert snapshot_as_of(s, {"as_of": SNAP, "downloaded_at": "2021-01-01T00:00:00+00:00"}).startswith(SNAP)
    assert snapshot_as_of(s, {"downloaded_at": "2021-01-01T00:00:00+00:00"}).startswith("2021-01-01")
    assert snapshot_as_of(s, {"sync_run_id": "x"}).startswith("2020-01-01")
    assert snapshot_as_of(s, {"as_of": "not a date", "sync_run_id": "x"}).startswith("2020-01-01")
    assert snapshot_as_of(_Session(None), {"source": "upload"}) is None
