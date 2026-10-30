"""ODP extraction through RODPS_REPL_ODP_GET_DETAIL / OPEN / FETCH / CLOSE (sap/odp.py), on a fake SAP."""
from __future__ import annotations

import pandas as pd
import pytest

from sap.base import SAPConnectorError
from sap.odp import FN_CLOSE, FN_DETAIL, FN_FETCH, FN_OPEN, ODPReader
from tests.sap.fake_odp import INTERFACES, ODPConnection, ODPState, Provider
from tests.sap.fake_rfc import FakeRFCConnector

MAT_FIELDS = [("MATNR", 18, True), ("MTART", 4, False), ("MATKL", 9, False), ("MEINS", 3, False)]


def _materials(n: int) -> pd.DataFrame:
    return pd.DataFrame({"MATNR": [f"{i:018d}" for i in range(n)], "MTART": ["FERT"] * n,
                         "MATKL": [f"G{i % 3}" for i in range(n)], "MEINS": ["EA"] * n})


def _connector(state: ODPState):
    c = FakeRFCConnector({})
    c._conn = ODPConnection({}, state)
    return c, c._conn


def test_multi_package_full_extraction_returns_the_table_reader_shape():
    state = ODPState(providers={("SAPI", "0MATERIAL_ATTR"): Provider(MAT_FIELDS, _materials(5), package_rows=2)})
    c, conn = _connector(state)
    seen = []
    r = c.odp_reader().read("SAPI", "0MATERIAL_ATTR", on_package=lambda p, rows: seen.append((p, rows)))
    assert r.packages == 3 and seen == [(1, 2), (2, 4), (3, 5)]
    assert list(r.frame.columns) == ["MATNR", "MTART", "MATKL", "MEINS"]
    assert r.frame["MATNR"].tolist() == [f"{i:018d}" for i in range(5)]
    assert all(isinstance(v, str) for v in r.frame.to_numpy().ravel())
    # GET_DETAIL, OPEN, three FETCHes, CLOSE: in that order, full mode, and the pointer is released
    assert conn.odp_calls() == [FN_DETAIL, FN_OPEN, FN_FETCH, FN_FETCH, FN_FETCH, FN_CLOSE]
    opened = next(p for fm, p in conn.calls if fm == FN_OPEN)
    assert opened["I_EXTRACTION_MODE"] == "F" and opened["I_CONTEXT"] == "SAPI" and opened["I_ODPNAME"] == "0MATERIAL_ATTR"
    assert state.closed == ["P0001"]


def test_character_rows_are_split_by_the_field_lengths():
    rows = _materials(3).assign(MATKL=["A1", "", "C3"])
    state = ODPState(providers={("SAPI", "0MATERIAL_ATTR"): Provider(MAT_FIELDS, rows, package_rows=10, character=True)})
    c, _ = _connector(state)
    df = c.odp_reader().read("SAPI", "0MATERIAL_ATTR", wanted=["MATNR", "MATKL"]).frame
    assert list(df.columns) == ["MATNR", "MATKL"]
    assert df["MATKL"].tolist() == ["A1", "", "C3"]


def test_an_empty_provider_reads_no_rows_and_still_closes():
    state = ODPState(providers={("ABAP_CDS", "IPRODUCT"): Provider(MAT_FIELDS, _materials(0))})
    c, conn = _connector(state)
    r = c.odp_reader().read("ABAP_CDS", "IPRODUCT")
    assert r.frame.empty and list(r.frame.columns) == ["MATNR", "MTART", "MATKL", "MEINS"]
    assert conn.odp_calls()[-1] == FN_CLOSE and state.closed


def test_a_missing_function_fails_with_one_clear_sentence_before_anything_is_opened():
    state = ODPState(providers={("SAPI", "0MATERIAL_ATTR"): Provider(MAT_FIELDS, _materials(2))}, missing={FN_OPEN})
    c, conn = _connector(state)
    assert c.odp_reader().available() is False
    with pytest.raises(SAPConnectorError, match="RODPS_REPL_ODP_OPEN is not available on this system"):
        c.odp_reader().read("SAPI", "0MATERIAL_ATTR")
    assert FN_OPEN not in conn.odp_calls()


def test_a_renamed_parameter_is_refused_rather_than_guessed():
    ifaces = dict(INTERFACES)
    ifaces[FN_OPEN] = [x if x[0] != "I_EXTRACTION_MODE" else ("I_MODE", "I", False) for x in INTERFACES[FN_OPEN]]
    state = ODPState(providers={("SAPI", "0MATERIAL_ATTR"): Provider(MAT_FIELDS, _materials(2))}, interfaces=ifaces)
    c, conn = _connector(state)
    with pytest.raises(SAPConnectorError, match="has no parameter I_EXTRACTION_MODE for the extraction mode"):
        c.odp_reader().read("SAPI", "0MATERIAL_ATTR")
    assert FN_OPEN not in conn.odp_calls()


def test_an_unfilled_mandatory_parameter_is_named():
    ifaces = dict(INTERFACES)
    ifaces[FN_OPEN] = INTERFACES[FN_OPEN] + [("I_REQUIRED_EXTRA", "I", False)]
    state = ODPState(providers={("SAPI", "0MATERIAL_ATTR"): Provider(MAT_FIELDS, _materials(2))}, interfaces=ifaces)
    c, _ = _connector(state)
    with pytest.raises(SAPConnectorError, match="needs I_REQUIRED_EXTRA"):
        c.odp_reader().read("SAPI", "0MATERIAL_ATTR")


def test_optional_parameters_absent_on_this_release_are_not_sent():
    ifaces = {fn: [x for x in params if x[0] not in ("I_MAXPACKAGESIZE", "I_SUBSCRIBER_PROCESS")]
              for fn, params in INTERFACES.items()}
    state = ODPState(providers={("SAPI", "0MATERIAL_ATTR"): Provider(MAT_FIELDS, _materials(3))}, interfaces=ifaces)
    c, conn = _connector(state)
    assert len(c.odp_reader().read("SAPI", "0MATERIAL_ATTR").frame) == 3
    assert all("I_MAXPACKAGESIZE" not in p for fm, p in conn.calls if fm in (FN_OPEN, FN_FETCH))


def test_binary_packages_are_refused_and_the_pointer_is_closed():
    state = ODPState(providers={("SAPI", "0MATERIAL_ATTR"): Provider(MAT_FIELDS, _materials(2), binary=True)})
    c, _ = _connector(state)
    with pytest.raises(SAPConnectorError, match="binary format"):
        c.odp_reader().read("SAPI", "0MATERIAL_ATTR")
    assert state.closed == ["P0001"]


def test_row_cap_stops_fetching_and_marks_the_read_truncated():
    state = ODPState(providers={("SAPI", "0MATERIAL_ATTR"): Provider(MAT_FIELDS, _materials(9), package_rows=2)})
    c, conn = _connector(state)
    r = c.odp_reader().read("SAPI", "0MATERIAL_ATTR", max_rows=3)
    assert r.truncated and len(r.frame) == 3 and conn.odp_calls().count(FN_FETCH) == 2
    assert state.closed


def test_unknown_context_and_unreleased_provider():
    state = ODPState(providers={("SAPI", "0EMPTY_ATTR"): Provider([], _materials(0))})
    c, _ = _connector(state)
    with pytest.raises(SAPConnectorError, match="context"):
        c.odp_reader().read("BW", "0MATERIAL_ATTR")
    with pytest.raises(SAPConnectorError, match="returned no fields"):
        c.odp_reader().read("SAPI", "0EMPTY_ATTR")


def test_the_reader_needs_a_connection():
    from sap.rfc import RFCConnector
    with pytest.raises(SAPConnectorError, match="before connect"):
        RFCConnector().odp_reader()


def test_available_when_all_four_functions_exist():
    c, _ = _connector(ODPState())
    assert c.odp_reader().available() is True
    assert ODPReader(lambda fm, **p: (_ for _ in ()).throw(SAPConnectorError("NO_AUTHORITY"))).available() is False
