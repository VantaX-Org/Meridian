"""Delta extraction: CDHDR names the changed vendors, only they are re-read and merged over the baseline."""

import pandas as pd

from sap.ddic import get_dictionary

from tests.sap.fake_rfc import FakeRFCConnector

_COLS = ["MANDANT", "OBJECTCLAS", "OBJECTID", "CHANGENR", "UDATE", "CHANGE_IND"]


def _mgr(fake):
    from api.services import connectivity_manager as cm

    class Mgr(cm.ConnectivityManager):
        def __init__(self):
            self.tenant_id, self.session = "t", None

        def _load_system(self, sid):
            return type("R", (), {"system_type": "ecc", "id": sid})()

        def _build_connection_params(self, row):
            return {"system_type": "ecc"}

        def _get_connector(self, system_type, params):
            return fake

    return Mgr()


def _lfa1(rows):
    return pd.DataFrame({"MANDT": ["100"] * len(rows), "LIFNR": [r[0] for r in rows], "NAME1": [r[1] for r in rows],
                         "KTOKK": ["KRED"] * len(rows), "LAND1": ["ZA"] * len(rows)})


def _baseline(monkeypatch):
    monkeypatch.setattr("api.services.source_design.dictionary_for", lambda s, sid, st=None: get_dictionary("ecc6"))
    before = {"LFA1": _lfa1([("V1", "A"), ("V2", "B"), ("V3", "C")])}
    frames, _ = _mgr(FakeRFCConnector(before)).extract("sys", ["accounts_payable"])
    return {t: f.rename(columns=lambda c: c.split(".", 1)[1]) for t, f in frames.items()}


def _cdhdr():
    return pd.DataFrame([["100", "KRED", "V2", "0000000011", "20261009", "U"],
                         ["100", "KRED", "V3", "0000000012", "20261009", "D"],
                         ["100", "KRED", "V4", "0000000013", "20261009", "I"],
                         ["100", "KRED", "V1", "0000000001", "20250101", "U"]], columns=_COLS)


def _names(frames):
    return frames["LFA1"].set_index("LFA1.LIFNR")["LFA1.NAME1"].to_dict()


def test_delta_rereads_changed_vendors_and_keeps_the_rest_from_the_baseline(monkeypatch):
    from api.services.connectivity_manager import DeltaRequest

    baseline = _baseline(monkeypatch)
    # V1's name drifted without a change document: the baseline value must survive (proves no full read)
    fake = FakeRFCConnector({"LFA1": _lfa1([("V1", "A-silent"), ("V2", "B2"), ("V4", "D")]), "CDHDR": _cdhdr()})
    frames, coverage = _mgr(fake).extract("sys", ["accounts_payable"], delta=DeltaRequest("20261008", baseline.get))

    assert _names(frames) == {"V1": "A", "V2": "B2", "V4": "D"}  # V2 updated, V3 deleted, V4 created
    cov = {c["table"]: c for c in coverage}
    # accounts_payable also plans KNA1 (DEBI class) for vendor/customer cross-checks: 0 changes there
    assert cov["CDHDR:delta"]["status"] == "delta" and cov["CDHDR:delta"]["changed"] == {"KRED": 3, "DEBI": 0}
    assert cov["LFA1"]["delta"]["changed"] == 3
    # extract() closes the connector (nulling _conn), so read calls via the surviving fakes list
    reads = [p for fm, p in fake.fakes[0].calls
             if fm == "RFC_READ_TABLE" and p["QUERY_TABLE"] == "LFA1" and p.get("NO_DATA") != "X"]
    assert reads and all("LIFNR IN" in " ".join(o["TEXT"] for o in p["OPTIONS"]) for p in reads)


def test_unreadable_cdhdr_falls_back_to_a_full_read(monkeypatch):
    from api.services.connectivity_manager import DeltaRequest

    baseline = _baseline(monkeypatch)
    fake = FakeRFCConnector({"LFA1": _lfa1([("V1", "A-silent"), ("V2", "B2"), ("V4", "D")])})  # no CDHDR: not authorised
    frames, coverage = _mgr(fake).extract("sys", ["accounts_payable"], delta=DeltaRequest("20261008", baseline.get))

    assert _names(frames) == {"V1": "A-silent", "V2": "B2", "V4": "D"}
    cov = {c["table"]: c for c in coverage}
    assert cov["CDHDR:delta"]["status"] == "delta_fallback" and "delta" not in cov["LFA1"]


def test_row_count_disagreement_rereads_the_table_in_full(monkeypatch):
    """V1 archived (no change document): the merge keeps it, SAP's count says 2, so LFA1 is read in full."""
    from api.services.connectivity_manager import DeltaRequest

    baseline = _baseline(monkeypatch)
    fake = FakeRFCConnector({"LFA1": _lfa1([("V2", "B2"), ("V4", "D")]), "CDHDR": _cdhdr()})
    frames, coverage = _mgr(fake).extract("sys", ["accounts_payable"], delta=DeltaRequest("20261008", baseline.get))

    assert _names(frames) == {"V2": "B2", "V4": "D"}
    assert "delta" not in {c["table"]: c for c in coverage}["LFA1"]


def test_missing_baseline_table_is_read_in_full(monkeypatch):
    from api.services.connectivity_manager import DeltaRequest

    _baseline(monkeypatch)
    fake = FakeRFCConnector({"LFA1": _lfa1([("V1", "A-silent"), ("V2", "B2"), ("V4", "D")]), "CDHDR": _cdhdr()})
    frames, _ = _mgr(fake).extract("sys", ["accounts_payable"], delta=DeltaRequest("20261008", lambda t: None))
    assert _names(frames) == {"V1": "A-silent", "V2": "B2", "V4": "D"}


def test_read_rows_reads_in_list_chunks_within_options_limits(monkeypatch):
    from sap.extraction_plan import in_lists

    monkeypatch.setattr("api.services.source_design.dictionary_for", lambda s, sid, st=None: get_dictionary("ecc6"))
    names = [f"USER{i:08d}" for i in range(150)]
    usr02 = pd.DataFrame({"MANDT": ["100"] * 150, "BNAME": names, "USTYP": ["A"] * 149 + ["B"]})
    fake = FakeRFCConnector({"USR02": usr02})
    out = _mgr(fake).read_rows("sys", "USR02", ["BNAME", "USTYP"], in_lists("BNAME", names))
    assert len(out) == 150 and list(out.columns) == ["BNAME", "USTYP"]
    assert out.set_index("BNAME")["USTYP"][names[-1]] == "B"
    assert _mgr(fake).read_rows("sys", "USR02", ["BNAME"], []).empty
