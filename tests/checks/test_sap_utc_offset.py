"""Freshness compares SAP system-local dates against the UTC as-of shifted by the system's UTC offset."""
import pandas as pd

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary
from sap.ddic_reader import utc_offset_seconds

D = get_dictionary("ecc6")
RULE = {"id": "F", "field": "LFA1.ERDAT", "time_field": "LFA1.ERZET", "check_class": "freshness_check",
        "max_age_hours": 1, "module": "accounts_payable"}
AS_OF = "2020-06-30T12:00:00+00:00"  # cutoff 11:00 UTC


def _frames():  # created 13:30 SAP local time
    return TableFrames({"LFA1": pd.DataFrame({"LFA1.LIFNR": ["1"], "LFA1.ERDAT": ["20200630"],
                                              "LFA1.ERZET": ["133000"]})}, D, module="accounts_payable")


def test_offset_missing_is_unchanged(monkeypatch):
    monkeypatch.delenv("MERIDIAN_SAP_UTC_OFFSET_SECONDS", raising=False)
    _, r = run_rule(RULE, _frames(), as_of=AS_OF)
    assert r.affected_count == 0 and r.details["cutoff_datetime"] == "2020-06-30T11:00:00"


def test_offset_applied(monkeypatch):
    # UTC+3: 13:30 local is 10:30 UTC, older than the 11:00 UTC cutoff
    monkeypatch.delenv("MERIDIAN_SAP_UTC_OFFSET_SECONDS", raising=False)
    _, r = run_rule(RULE, _frames(), as_of=AS_OF, sap_utc_offset_seconds=3 * 3600)
    assert r.affected_count == 1 and r.details["cutoff_datetime"] == "2020-06-30T14:00:00"


def test_env_override_wins(monkeypatch):
    monkeypatch.setenv("MERIDIAN_SAP_UTC_OFFSET_SECONDS", "0")
    _, r = run_rule(RULE, _frames(), as_of=AS_OF, sap_utc_offset_seconds=3 * 3600)
    assert r.affected_count == 0


def test_offset_read_from_rfc_system_info():
    class Conn:
        def __init__(self, si):
            self.si = si

        def call(self, fm):
            return {"RFCSI_EXPORT": self.si}
    assert utc_offset_seconds(Conn({"RFCZONE": " 10800", "RFCDAYST": ""})) == 10800
    assert utc_offset_seconds(Conn({"RFCZONE": "-18000"})) == -18000
    assert utc_offset_seconds(Conn({})) is None
