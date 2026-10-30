"""PC-1: the selectable table reader of sap/rfc.py (RFC_READ_TABLE, /BODS/RFC_READ_TABLE2, BBP_RFC_READ_TABLE).

A fake connection serves /BODS/RFC_READ_TABLE2 with its 30,000-byte work area and OUT_TABLE export, and
BBP_RFC_READ_TABLE with RFC_READ_TABLE's interface; the DataFrame is the same whichever reader is used.
"""
from __future__ import annotations

import pandas as pd
import pytest

from sap.base import SAPConnectorError
from sap.ddic import get_dictionary
from sap.rfc import BBP_READ_TABLE, BODS_READ_TABLE, READ_TABLE

from tests.sap.fake_rfc import FakeConnection, FakeRFCConnector, FakeRFCError


class ReaderConnection(FakeConnection):
    """A fake SAP that also has the alternative readers (``available``) and RFC_FUNCTION_SEARCH."""

    def __init__(self, tables, available=(BODS_READ_TABLE, BBP_READ_TABLE), search_allowed=True):
        super().__init__(tables)
        self.available, self.search_allowed = set(available), search_allowed

    def _call(self, fm: str, **p):
        if fm == "RFC_FUNCTION_SEARCH":
            self.calls.append((fm, p))
            if not self.search_allowed:
                raise FakeRFCError("NO_AUTHORITY S_RFC")
            return {"FUNCTIONS": [{"FUNCNAME": p["FUNCNAME"]}] if p["FUNCNAME"] in self.available else []}
        if fm == BBP_READ_TABLE and fm in self.available:
            self.calls.append((fm, p))
            return self._read(**p)
        if fm == BODS_READ_TABLE and fm in self.available:
            self.calls.append((fm, p))
            return self._bods(**p)
        return super()._call(fm, **p)

    def _bods(self, QUERY_TABLE, FIELDS=(), OPTIONS=(), ROWCOUNT=0, ROWSKIPS=0, NO_DATA="", **_):
        names = [f["FIELDNAME"] for f in FIELDS]
        widths = [self._width(QUERY_TABLE, n) for n in names]
        if sum(widths) > 30000:
            raise FakeRFCError("DATA_BUFFER_EXCEEDED")
        # the base reader's rows without its 512-byte limit
        r = self._read_wide(QUERY_TABLE, FIELDS, OPTIONS, ROWCOUNT, ROWSKIPS, NO_DATA)
        out = "TBLOUT2048" if sum(widths) <= 2048 else "TBLOUT30000"
        return {"FIELDS": r["FIELDS"], "OUT_TABLE": out, out: r["DATA"], "TBLOUT512": []}

    def _read_wide(self, table, FIELDS, OPTIONS, ROWCOUNT, ROWSKIPS, NO_DATA):
        from tests.sap.fake_rfc import _filter

        df = self.tables[table]
        names = [f["FIELDNAME"] for f in FIELDS]
        widths = [self._width(table, n) for n in names]
        meta, off = [], 0
        for n, w in zip(names, widths):
            meta.append({"FIELDNAME": n, "OFFSET": off, "LENGTH": w, "TYPE": "C"})
            off += w
        if NO_DATA == "X":
            return {"FIELDS": meta, "DATA": []}
        sel = _filter(df, " ".join(o["TEXT"] for o in OPTIONS)).iloc[ROWSKIPS:]
        if ROWCOUNT:
            sel = sel.iloc[:ROWCOUNT]
        data = [{"WA": "".join(str(r.get(n, "") or "").ljust(w)[:w] for n, w in zip(names, widths))}
                for r in sel.to_dict(orient="records")]
        return {"FIELDS": meta, "DATA": data}


def _wide_mara(n: int = 12) -> tuple[pd.DataFrame, list[str]]:
    d = get_dictionary("ecc6")
    cols = [f for f in d.table("MARA").fields if f != "MANDT"]
    df = pd.DataFrame({c: [f"V{i}"[: d.field("MARA", c).length] for i in range(n)] for c in cols})
    df["MATNR"] = [f"{i:018d}" for i in range(n)]
    return df, cols


def _connector(conn: FakeConnection, setting: str):
    c = FakeRFCConnector({})
    c._conn = conn
    c._read_setting = setting
    c._resolve_read_function()
    return c


def _reads(conn, fm):
    return [p for f, p in conn.calls if f == fm and p.get("NO_DATA") != "X"]


def test_auto_prefers_the_bods_reader_and_reads_a_wide_table_in_one_group():
    df, cols = _wide_mara()
    conn = ReaderConnection({"MARA": df})
    c = _connector(conn, "auto")
    assert c.read_function == BODS_READ_TABLE
    out = c.read_table_full("MARA", cols, ["MATNR"], page_size=50)
    assert len(out) == 12 and set(out.columns) == set(cols)
    assert len({len(p["FIELDS"]) for p in _reads(conn, BODS_READ_TABLE)}) == 1  # no column groups
    assert _reads(conn, READ_TABLE) == []

    # the same DataFrame as RFC_READ_TABLE in column groups
    plain = FakeRFCConnector({"MARA": df}).read_table_full("MARA", cols, ["MATNR"], page_size=50)
    pd.testing.assert_frame_equal(out.sort_values("MATNR").reset_index(drop=True)[sorted(cols)],
                                  plain.sort_values("MATNR").reset_index(drop=True)[sorted(cols)])


def test_auto_falls_back_to_bbp_then_rfc_read_table():
    df, _ = _wide_mara(3)
    assert _connector(ReaderConnection({"MARA": df}, available=(BBP_READ_TABLE,)), "auto").read_function == BBP_READ_TABLE
    assert _connector(ReaderConnection({"MARA": df}, available=()), "auto").read_function == READ_TABLE
    # not authorised for RFC_FUNCTION_SEARCH: the default reader, no error
    assert _connector(ReaderConnection({"MARA": df}, search_allowed=False), "auto").read_function == READ_TABLE


def test_an_explicit_setting_is_used_without_probing():
    df, _ = _wide_mara(3)
    conn = ReaderConnection({"MARA": df})
    c = _connector(conn, BBP_READ_TABLE)
    assert c.read_function == BBP_READ_TABLE and not [f for f, _ in conn.calls if f == "RFC_FUNCTION_SEARCH"]
    out = c.read_table("MARA", ["MATNR", "MATKL"])
    assert list(out["MATNR"]) == list(df["MATNR"]) and _reads(conn, BBP_READ_TABLE)


def test_the_default_stays_rfc_read_table(monkeypatch):
    monkeypatch.delenv("MERIDIAN_RFC_READ_FUNCTION", raising=False)
    df, _ = _wide_mara(2)
    assert _connector(ReaderConnection({"MARA": df}), "").read_function == READ_TABLE
    monkeypatch.setenv("MERIDIAN_RFC_READ_FUNCTION", "auto")
    assert _connector(ReaderConnection({"MARA": df}), "").read_function == BODS_READ_TABLE


def test_an_unknown_reader_is_refused():
    with pytest.raises(SAPConnectorError, match="read_function"):
        _connector(ReaderConnection({}), "Z_READ_ANYTHING")
