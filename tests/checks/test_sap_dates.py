"""checks.sap_dates.parse_sap_date: every shape a SAP date arrives in, to one ``date``.

Found on real data: a CSV date column read as float reached the z_object_profiles insert
as the string ``'20221007.0'`` and asyncpg refused it for a timestamp column."""

from datetime import date, datetime, timezone

import pytest

from api.services.z_object_intelligence.profiler import ZProfiler
from checks.sap_dates import parse_sap_date


@pytest.mark.parametrize("value", [
    20221007, 20221007.0, "20221007", "20221007.0", " 20221007 ", "2022-10-07", "2022-10-07T09:15:00",
    "2022-10-07 09:15:00", date(2022, 10, 7), datetime(2022, 10, 7, 9, 15, tzinfo=timezone.utc),
])
def test_every_shape_of_the_same_day(value):
    assert parse_sap_date(value) == date(2022, 10, 7)


@pytest.mark.parametrize("value", [
    None, "", "   ", 0, 0.0, "0", "00000000", "00000000.0", float("nan"), "20221340", 20221007.5,
    "2022107", "abc", "99991231x", True,
])
def test_no_date_for_initial_blank_or_unparsable(value):
    assert parse_sap_date(value) is None


def test_open_ended_sentinel_is_a_real_date():
    assert parse_sap_date("99991231") == date(9999, 12, 31)


def test_z_profile_date_range_from_float_dates_is_iso_and_ordered():
    records = [{"ERDAT": 20230105.0}, {"ERDAT": "20221007.0"}, {"ERDAT": "00000000"}, {"ERDAT": "2023-02-01"}]
    assert ZProfiler._extract_date_range(records) == ("2022-10-07", "2023-02-01")
    assert ZProfiler._extract_date_range([{"ERDAT": "0"}, {"BUDAT": ""}]) == (None, None)
    assert parse_sap_date("2022-10-07") == date(2022, 10, 7)


def test_initial_first_field_falls_through_to_a_later_valid_one():
    assert ZProfiler._extract_date_range([{"BUDAT": "00000000", "ERDAT": "20221007"}]) == ("2022-10-07", "2022-10-07")
    assert ZProfiler._extract_date_range([{"BUDAT": float("nan"), "CPUDT": 20230105.0}]) == ("2023-01-05", "2023-01-05")


def test_infinite_and_huge_floats_are_no_date():
    assert parse_sap_date(float("inf")) is None
    assert parse_sap_date(float("-inf")) is None
    assert parse_sap_date(1e300) is None


def test_timestamp_shape_for_timestamptz_columns():
    from datetime import datetime, timezone

    from checks.sap_dates import sap_date_to_timestamp

    assert sap_date_to_timestamp("2022-10-07") == datetime(2022, 10, 7, tzinfo=timezone.utc)
    assert sap_date_to_timestamp("20221007.0") == datetime(2022, 10, 7, tzinfo=timezone.utc)
    assert sap_date_to_timestamp("00000000") is None
