"""IS_CURRENT keeps every historic row and marks the one in force today per business key."""
import pandas as pd

from api.services.connectivity_manager import _mark_current


def test_open_ended_row_is_current_and_history_kept():
    df = pd.DataFrame({"FODIVISION.EXTERNAL_CODE": ["D1", "D1", "D2", "D2"],
                       "FODIVISION.EFFECTIVE_START_DATE": ["2001-01-01", "2020-01-01", "2010-01-01", "2099-01-01"],
                       "FODIVISION.EFFECTIVE_END_DATE": ["2019-12-31", "9999-12-31", "2098-12-31", "9999-12-31"]})
    out = _mark_current(df, "FODIVISION", ["FODIVISION.EXTERNAL_CODE"], ["FODIVISION.EFFECTIVE_START_DATE"])
    assert len(out) == 4
    # D2's open row starts in 2099: the row in force today is the 2010 one
    assert out["FODIVISION.IS_CURRENT"].tolist() == ["false", "true", "true", "false"]


def test_latest_start_and_seq_without_end_date():
    df = pd.DataFrame({"EMPJOBHIST.USERID": ["u", "u", "u", "u"],
                       "EMPJOBHIST.START_DATE": ["2020-01-01", "2024-01-01", "2024-01-01", "2999-01-01"],
                       "EMPJOBHIST.SEQ_NUMBER": ["1", "1", "2", "1"]})
    out = _mark_current(df, "EMPJOBHIST", ["EMPJOBHIST.USERID", "EMPJOBHIST.START_DATE", "EMPJOBHIST.SEQ_NUMBER"], [])
    assert out["EMPJOBHIST.IS_CURRENT"].tolist() == ["false", "false", "true", "false"]


def test_undated_table_all_current():
    df = pd.DataFrame({"FOCOSTCENTER.EXTERNAL_CODE": ["A", "B"]})
    out = _mark_current(df, "FOCOSTCENTER", ["FOCOSTCENTER.EXTERNAL_CODE"], [])
    assert out["FOCOSTCENTER.IS_CURRENT"].tolist() == ["true", "true"]
