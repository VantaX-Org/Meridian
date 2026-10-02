"""RFC reading, live DDIC discovery and rules-driven extraction against a fake SAP."""

import pandas as pd
import pytest

from sap import ddic_reader
from sap.ddic import get_dictionary
from sap.extraction_plan import plan_modules, read_order, via_filters
from sap.rfc import where_options

from tests.sap.fake_rfc import FakeRFCConnector


def _mara(n):
    return pd.DataFrame({"MANDT": ["100"] * n, "MATNR": [f"{i:018d}" for i in range(n)], "MTART": ["FERT"] * n,
                         "MATKL": ["001"] * n, "MEINS": ["EA"] * n, "BISMT": ["OLD"] * n})


def test_where_lines_never_exceed_72_chars_and_keep_literals():
    opts = where_options("MATNR IN ('" + "','".join(f"{i:018d}" for i in range(40)) + "') AND LVORM = ' '")
    assert all(len(o["TEXT"]) <= 72 for o in opts)
    assert "' '" in " ".join(o["TEXT"] for o in opts)


def test_read_table_full_pages_and_splits_wide_tables():
    # MARA with ~200 fields exceeds 512 bytes; paging at 7 rows over 20 rows
    d = get_dictionary("ecc6")
    cols = [f for f in d.table("MARA").fields if f != "MANDT"]
    df = pd.DataFrame({c: [f"V{i}"[: d.field("MARA", c).length] for i in range(20)] for c in cols})
    df["MATNR"] = [f"{i:018d}" for i in range(20)]
    conn = FakeRFCConnector({"MARA": df})
    out = conn.read_table_full("MARA", cols, ["MATNR"], page_size=7)
    assert len(out) == 20 and set(out.columns) == set(cols)
    groups = {tuple(p["FIELDS"]) and len(p["FIELDS"]) for fm, p in conn._conn.calls
              if fm == "RFC_READ_TABLE" and p.get("NO_DATA") != "X"}
    assert len(groups) > 1  # split into several column groups
    assert out.set_index("MATNR").loc["000000000000000003", "BISMT"] == "V3"[: d.field("MARA", "BISMT").length]


def test_live_snapshot_reads_dictionary_and_customer_tables():
    tadir = pd.DataFrame({"PGMID": ["R3TR", "R3TR"], "OBJECT": ["TABL", "TABL"], "OBJ_NAME": ["ZMM_EXT", "LFA1"]})
    dd02l = pd.DataFrame({"TABNAME": ["ZMM_EXT", "LFA1"], "AS4LOCAL": ["A", "A"], "TABCLASS": ["TRANSP", "TRANSP"],
                          "CONTFLAG": ["A", "A"]})
    dd02t = pd.DataFrame({"TABNAME": ["LFA1"], "DDLANGUAGE": ["E"], "AS4LOCAL": ["A"], "DDTEXT": ["Vendor Master"]})
    cvers = pd.DataFrame({"COMPONENT": ["SAP_APPL"], "RELEASE": ["618"], "EXTRELEASE": ["0012"]})
    empty = {t: pd.DataFrame(columns=cols) for t, cols in {
        "DD05S": ["TABNAME", "FIELDNAME", "FORTABLE", "FORKEY", "CHECKTABLE", "CHECKFIELD", "PRIMPOS", "AS4LOCAL"],
        "DD07L": ["DOMNAME", "VALPOS", "DOMVALUE_L", "DOMVALUE_H", "AS4LOCAL"]}.items()}
    conn = FakeRFCConnector({"TADIR": tadir, "DD02L": dd02l, "DD02T": dd02t, "CVERS": cvers, **empty})
    snap = ddic_reader.snapshot(conn, ["LFA1"])
    assert snap["system_info"]["product"] == "ecc6"
    assert snap["customer_tables"] == ["ZMM_EXT"]
    assert snap["tables"]["LFA1"]["description"] == "Vendor Master"
    assert any(f["name"] == "LIFNR" and f["key"] for f in snap["tables"]["LFA1"]["fields"])
    assert {s["table"]: s["status"] for s in snap["status"]}["ZMM_EXT"] == "not_found"  # not in fake DDIC


def test_plan_reads_children_by_parent_keys():
    plans = plan_modules(["mm_purchasing"], get_dictionary("ecc6"))
    order = read_order(plans)
    assert order.index("EKKO") < order.index("EKPO") and plans["EKPO"].via == "EKKO"
    parent = pd.DataFrame({"EBELN": [f"45{i:08d}" for i in range(130)]})
    wheres = via_filters("EKPO", "EKKO", parent)
    assert len(wheres) == 3 and all(len(o["TEXT"]) <= 72 for w in wheres for o in where_options(w))


def test_extract_end_to_end_evaluates_at_grain(monkeypatch):
    """Vendors across two company codes: vendor rules once per vendor, bank rules via LFBK."""
    from api.services import connectivity_manager as cm
    from checks.frames import TableFrames
    from checks.runner import run_checks

    lfa1 = pd.DataFrame({"MANDT": ["100"] * 3, "LIFNR": ["V1", "V2", "V3"], "NAME1": ["A", "", "C"],
                         "KTOKK": ["KRED", "KRED", "ZZZZ"], "LAND1": ["ZA"] * 3, "ADRNR": ["1", "2", "3"]})
    lfb1 = pd.DataFrame({"MANDT": ["100"] * 4, "LIFNR": ["V1", "V1", "V2", "V3"], "BUKRS": ["1000", "2000", "1000", "1000"],
                         "AKONT": ["160000", "", "160000", "160000"], "ZWELS": ["T", "T", "C", "T"], "ZTERM": ["0001"] * 4})
    lfbk = pd.DataFrame({"MANDT": ["100"], "LIFNR": ["V1"], "BANKS": ["ZA"], "BANKL": ["250655"], "BANKN": ["123"],
                         "BKONT": [""], "BVTYP": [""]})
    tables = {"LFA1": lfa1, "LFB1": lfb1, "LFBK": lfbk}
    fake = FakeRFCConnector(tables)

    class Mgr(cm.ConnectivityManager):
        def __init__(self):
            self.tenant_id = "t"
            self.session = None

        def _load_system(self, sid):
            return type("R", (), {"system_type": "ecc", "id": sid})()

        def _build_connection_params(self, row):
            return {"system_type": "ecc"}

        def _get_connector(self, system_type, params):
            return fake

    monkeypatch.setattr("api.services.source_design.dictionary_for", lambda s, sid, st=None: get_dictionary("ecc6"))
    frames, coverage = Mgr().extract("sys", ["accounts_payable"])
    status = {c["table"]: c["status"] for c in coverage}
    assert status["LFA1"] == status["LFB1"] == status["LFBK"] == "live"
    assert "LFA1.LIFNR" in frames["LFA1"].columns

    results = {r.check_id: r for r in run_checks("accounts_payable", TableFrames(frames, get_dictionary("ecc6")), "t")}
    name = next(r for r in results.values() if r.field == "LFA1.NAME1" and r.dimension == "completeness")
    assert (name.total_count, name.affected_count, name.grain) == (3, 1, "LFA1")
    ap039 = results.get("AP039")  # bank required for electronic payment (ZWELS contains T)
    assert ap039 is not None and ap039.grain == "LFB1"
    assert set(ap039.failing_record_keys) == {"LIFNR=V3|BUKRS=1000"}  # V1 has LFBK, V2 pays by cheque


def test_extraction_reconciles_row_counts_with_sap(monkeypatch):
    """An unfiltered read must return SAP's own COUNT(*); a shortfall marks the table incomplete."""
    from api.services import connectivity_manager as cm

    lfa1 = pd.DataFrame({"MANDT": ["100"] * 2, "LIFNR": ["V1", "V2"], "NAME1": ["A", "B"], "KTOKK": ["KRED"] * 2})
    lfb1 = pd.DataFrame({"MANDT": ["100"], "LIFNR": ["V1"], "BUKRS": ["1000"], "AKONT": ["160000"]})
    fake = FakeRFCConnector({"LFA1": lfa1, "LFB1": lfb1})
    fake._conn.extra_rows["LFA1"] = 1  # SAP holds 3 vendors, the read returned 2

    class Mgr(cm.ConnectivityManager):
        def __init__(self):
            self.tenant_id, self.session = "t", None

        def _load_system(self, sid):
            return type("R", (), {"system_type": "ecc", "id": sid})()

        def _build_connection_params(self, row):
            return {"system_type": "ecc"}

        def _get_connector(self, system_type, params):
            return fake

    monkeypatch.setattr("api.services.source_design.dictionary_for", lambda s, sid, st=None: get_dictionary("ecc6"))
    reports = []
    _, coverage = Mgr().extract("sys", ["accounts_payable"], progress=lambda t, d, n: reports.append((t, d, n)))
    cov = {c["table"]: c for c in coverage}
    assert cov["LFA1"]["source_rows"] == 3 and cov["LFA1"]["complete"] is False
    assert cov["LFB1"]["source_rows"] == 1 and cov["LFB1"]["complete"] is True

    # progress: the plan first (all queued, SAP's counts as the expected rows), one report per
    # table as it starts, and the final state after the last table
    first, last = reports[0], reports[-1]
    assert {t["table"] for t in first[0]} >= {"LFA1", "LFB1"} and all(t["status"] == "queued" for t in first[0])
    assert {t["table"]: t["expected"] for t in first[0]}["LFA1"] == 3 and first[1] == 0
    assert any(any(t["status"] == "running" for t in r[0]) for r in reports[1:-1])
    done = {t["table"]: t for t in last[0]}
    assert done["LFA1"]["status"] == "live" and done["LFA1"]["rows"] == 2 and last[1] == 3  # 2 + 1 rows read
    assert len(reports) == len(first[0]) + 2


def test_payroll_totals_through_the_customer_function():
    from api.services.connectivity_manager import ConnectivityManager

    rgdir = pd.DataFrame({"PERNR": ["00001001", "00001001", "00001002"], "SEQNR": ["00001", "00002", "00001"]})
    conn = FakeRFCConnector({})
    df, entry = ConnectivityManager._payroll_totals(conn, rgdir)
    assert df is None and entry["status"] == "not_installed" and "docs/payroll-rfc.md" in entry["detail"]

    def fm(fm, **p):  # the installed function: one employee the RFC user may not read
        if fm != "Z_MERIDIAN_PAYROLL_TOTALS":
            raise AssertionError(fm)
        rows = [{"PERNR": r["PERNR"], "SEQNR": r["SEQNR"], "FPPER": "202601", "INPER": "202601", "PAYDT": "20260125",
                 "LGART": "/560", "BETRG": 15000.5, "ANZHL": 0, "WAERS": "ZAR"}
                for r in p["IT_RESULTS"] if r["PERNR"] == "00001001"]
        return {"ET_TOTALS": rows, "EV_SKIPPED": 1}

    conn._conn.call = fm
    df, entry = ConnectivityManager._payroll_totals(conn, rgdir)
    assert len(df) == 2 and df["BETRG"].tolist() == ["15000.5", "15000.5"]
    assert entry == {"table": "ZMERIDIAN_PAYRT", "purpose": "data", "status": "live", "rows": 2, "results": 3,
                     "unauthorised": 1, "complete": False}
