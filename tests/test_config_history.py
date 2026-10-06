"""Customizing change history from DBTABLOG: dates and counts only, logging off is a state."""

from datetime import date

import pandas as pd

from sap.config_loader import read_history, not_available_history


class Log:
    def __init__(self, rows=None, error=None):
        self.rows, self.error, self.asked = rows, error, []

    def read_table(self, table, fields, where=None, max_rows=0):
        assert table == "DBTABLOG"
        self.asked.append((fields, where))
        if self.error:
            raise RuntimeError(self.error)
        df = pd.DataFrame(self.rows or [], columns=["TABNAME", "LOGDATE"])
        if where and "TABNAME = '" in where:
            df = df[df.TABNAME == where.split("'")[1]]
        return df.head(max_rows) if max_rows else df


def test_counts_and_last_change_per_table():
    log = Log([("TVAK", "20260301"), ("TVAK", "20260915"), ("T161", "20260101")])
    h = read_history(log, ["TVAK", "T003"], today=date(2026, 10, 6))
    assert h["table_logging_off"] is False and h["since"] == "2025-10-06"
    assert h["tables"]["TVAK"] == {"last_change": "2026-09-15", "changes_in_window": 2, "truncated": False}
    assert h["tables"]["T003"]["changes_in_window"] == 0 and h["tables"]["T003"]["last_change"] is None


def test_empty_dbtablog_is_logging_off_state_not_error():
    h = read_history(Log([]), ["TVAK"])
    assert h["table_logging_off"] is True and h["tables"] == {} and "off" in h["detail"]


def test_unreadable_dbtablog_is_logging_off_state():
    h = read_history(Log(error="RFC_READ_TABLE denied"), ["TVAK"])
    assert h["table_logging_off"] is True and "not readable" in h["detail"]


def test_no_user_names_requested_or_returned():
    log = Log([("TVAK", "20260301")])
    h = read_history(log, ["TVAK"], today=date(2026, 10, 6))
    assert all(set(fields) <= {"TABNAME", "LOGDATE"} for fields, _ in log.asked)
    assert "USERNAME" not in str(h).upper()


def test_bad_table_name_never_reaches_the_where_clause():
    log = Log([("TVAK", "20260301")])
    h = read_history(log, ["TVAK' OR 1=1 --"], today=date(2026, 10, 6))
    assert h["tables"] == {}


def test_non_abap_has_explicit_not_available_history():
    h = not_available_history("x")
    assert h["available"] is False and h["tables"] == {}
