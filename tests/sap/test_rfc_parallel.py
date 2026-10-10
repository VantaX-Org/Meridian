"""Parallel RFC reads: same rows as the serial read, one thread per connection."""

import logging

import pandas as pd
import pytest

from sap.base import SAPConnectorError
from sap.ddic import get_dictionary
from sap.rfc import RFCConnector

from tests.sap.fake_rfc import FakeRFCConnector, FakeRFCError

MARD_COLS, MARD_KEYS = ["MATNR", "WERKS", "LABST"], ["MATNR", "WERKS"]


def _mard(n):
    matnr = [f"{i // 3:018d}" for i in range(n)]
    df = pd.DataFrame({"MATNR": matnr, "WERKS": [f"{i:04d}" for i in range(n)], "LABST": [str(i) for i in range(n)]})
    return df.sample(frac=1, random_state=1)  # no sort order, like SAP


def _parallel(tables, n=4, delay=0.002):
    c = FakeRFCConnector(tables, parallel=n)
    c._pool()
    for f in c.fakes:
        f.delay = delay
    return c


def _data_reads(fake):
    return [p for fm, p in fake.calls if fm == "RFC_READ_TABLE" and p.get("NO_DATA") != "X"]


def _same(a, b, keys):
    assert list(a.columns) == list(b.columns)
    pd.testing.assert_frame_equal(a.sort_values(keys).reset_index(drop=True),
                                  b.sort_values(keys).reset_index(drop=True))


def test_parallel_narrow_read_equals_serial_and_uses_every_connection():
    df = _mard(300)
    serial = FakeRFCConnector({"MARD": df}).read_table_full("MARD", MARD_COLS, MARD_KEYS, page_size=5)
    c = _parallel({"MARD": df})
    out = c.read_table_full("MARD", MARD_COLS, MARD_KEYS, page_size=5)
    _same(out, serial, MARD_KEYS)
    assert len(out) == 300 and not out.duplicated(MARD_KEYS).any()
    assert len(c.fakes) == 4 and all(_data_reads(f) for f in c.fakes)
    # pages are joined in key order, so the result order matches the serial read
    pd.testing.assert_frame_equal(out, serial)
    c.close()
    assert all(f.closed for f in c.fakes) and c._extra is None


def test_parallel_wide_read_equals_serial_with_three_groups():
    d = get_dictionary("ecc6")
    cols = [f for f in d.table("MARA").fields if f != "MANDT"]
    df = pd.DataFrame({c: [f"V{i}"[: d.field("MARA", c).length] for i in range(60)] for c in cols})
    df["MATNR"] = [f"{i:018d}" for i in range(60)]
    serial = FakeRFCConnector({"MARA": df}).read_table_full("MARA", cols, ["MATNR"], page_size=7)
    c = _parallel({"MARA": df})
    seen = []
    out = c.read_table_full("MARA", cols, ["MATNR"], page_size=7, on_progress=lambda *a: seen.append(a))
    _same(out, serial, ["MATNR"])
    groups = {len(p["FIELDS"]) for f in c.fakes for p in _data_reads(f)}
    assert len(groups) >= 3
    assert seen == sorted(seen, key=lambda a: (a[0], a[2]))  # monotonic: group, then rows within it
    assert {g for g, _, _ in seen} == set(range(seen[0][1]))


def test_out_of_memory_on_one_connection_halves_the_shared_page_size():
    df = _mard(10_000)
    serial = FakeRFCConnector({"MARD": df}).read_table_full("MARD", MARD_COLS, MARD_KEYS, page_size=4000)
    c = _parallel({"MARD": df}, delay=0.01)
    call = c.fakes[1].call

    def limited(fm, **p):
        if fm == "RFC_READ_TABLE" and p.get("ROWCOUNT", 0) > 1500:
            raise FakeRFCError("TSV_TNEW_PAGE_ALLOC_FAILED")
        return call(fm, **p)
    c.fakes[1].call = limited
    out = c.read_table_full("MARD", MARD_COLS, MARD_KEYS, page_size=4000)
    _same(out, serial, MARD_KEYS)
    assert any(p["ROWCOUNT"] == 1000 for f in c.fakes for p in _data_reads(f))


def test_error_on_one_connection_stops_the_read_with_the_serial_message():
    df = _mard(300)

    def boom(fm, **p):
        raise FakeRFCError("RFC_COMMUNICATION_FAILURE lost")
    s = FakeRFCConnector({"MARD": df})
    probe = s._conn.call
    s._conn.call = lambda fm, **p: probe(fm, **p) if p.get("NO_DATA") == "X" else boom(fm)
    with pytest.raises(SAPConnectorError) as serial_err:
        s.read_table_full("MARD", MARD_COLS, MARD_KEYS, page_size=5)
    full = FakeRFCConnector({"MARD": df})
    full.read_table_full("MARD", MARD_COLS, MARD_KEYS, page_size=5)
    serial_reads = len(_data_reads(full._conn))

    c = _parallel({"MARD": df})
    call = c.fakes[2].call
    c.fakes[2].call = lambda fm, **p: boom(fm) if fm == "RFC_READ_TABLE" and p.get("NO_DATA") != "X" \
        else call(fm, **p)
    with pytest.raises(SAPConnectorError) as err:
        c.read_table_full("MARD", MARD_COLS, MARD_KEYS, page_size=5)
    assert str(err.value) == str(serial_err.value)
    assert sum(len(_data_reads(f)) for f in c.fakes) < serial_reads / 2  # the others stopped


def test_row_cap_returns_the_same_lowest_keys_as_serial():
    df = _mard(300)
    for cap in (1, 37, 120):
        serial = FakeRFCConnector({"MARD": df}).read_table_full("MARD", MARD_COLS, MARD_KEYS, max_rows=cap,
                                                                   page_size=5)
        out = _parallel({"MARD": df}).read_table_full("MARD", MARD_COLS, MARD_KEYS, max_rows=cap, page_size=5)
        pd.testing.assert_frame_equal(out, serial)


def test_refused_extra_connection_reads_over_the_ones_that_opened(caplog):
    df = _mard(300)
    c = FakeRFCConnector({"MARD": df}, parallel=4)
    c._password = "s3cret"
    opened = c._open_extra

    def open_extra():
        if len(c.fakes) >= 2:
            raise RuntimeError("too many sessions for user X password s3cret")
        return opened()
    c._open_extra = open_extra
    with caplog.at_level(logging.WARNING, logger="meridian.sap.rfc"):
        out = c.read_table_full("MARD", MARD_COLS, MARD_KEYS, page_size=5)
    assert len(c._pool()) == 2
    assert "refused" in caplog.text and "s3cret" not in caplog.text
    _same(out, FakeRFCConnector({"MARD": df}).read_table_full("MARD", MARD_COLS, MARD_KEYS, page_size=5), MARD_KEYS)


def test_parallel_one_reads_over_the_primary_connection_only(monkeypatch):
    c = FakeRFCConnector({"MARD": _mard(60)}, parallel=1)
    c._open_extra = lambda: pytest.fail("opened an extra connection")
    out = c.read_table_full("MARD", MARD_COLS, MARD_KEYS, page_size=5)
    assert len(out) == 60 and c.fakes == [c._conn]
    monkeypatch.setenv("MERIDIAN_RFC_PARALLEL", "20")
    assert RFCConnector()._parallel == 8
    monkeypatch.setenv("MERIDIAN_RFC_PARALLEL", "1")
    assert RFCConnector()._parallel == 1
    monkeypatch.delenv("MERIDIAN_RFC_PARALLEL")
    assert RFCConnector()._parallel == 4
