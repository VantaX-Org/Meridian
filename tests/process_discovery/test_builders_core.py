"""PTP, OTC and R2R builders against in-memory extraction frames (spec §2.2, §2.3, §9 wave 2)."""

from __future__ import annotations

import random
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

from api.services.process_discovery import builders
from api.services.process_discovery.builders import otc, ptp, r2r
from api.services.process_discovery.events import BuildContext, MemoryFrames, collect, make_context
from sap.process_definitions import reference_document

JNB = ZoneInfo("Africa/Johannesburg")
RUN = date(2026, 10, 11)


def cd(*docs: tuple) -> dict[str, pd.DataFrame]:
    """CDHDR + CDPOS from (class, objectid, changenr, change_ind, udate, utime, user, [(tab, tabkey, field, ind, new)])."""
    hdr, pos = [], []
    for cls, obj, nr, ind, udate, utime, user, items in docs:
        hdr.append({"OBJECTCLAS": cls, "OBJECTID": obj, "CHANGENR": nr, "USERNAME": user, "UDATE": udate,
                    "UTIME": utime, "TCODE": "", "CHANGE_IND": ind})
        for tab, key, fname, chng, new in items:
            pos.append({"OBJECTCLAS": cls, "OBJECTID": obj, "CHANGENR": nr, "TABNAME": tab, "TABKEY": key,
                        "FNAME": fname, "CHNGIND": chng, "VALUE_NEW": new})
    return {"CDHDR": pd.DataFrame(hdr), "CDPOS": pd.DataFrame(pos)}


def df(*records: dict) -> pd.DataFrame:
    return pd.DataFrame(list(records))


def ptp_tables() -> dict[str, pd.DataFrame]:
    po, k10, k20 = "4500000001", "1004500000001" + "00010", "1004500000001" + "00020"
    return {
        "EKKO": df({"EBELN": po, "AEDAT": "20260105", "ERNAM": "BUYER1", "BSART": "NB", "BUKRS": "1000",
                    "EKORG": "1000", "LIFNR": "V1"}),
        "EKPO": df({"EBELN": po, "EBELP": "00010", "BANFN": "0010000001", "BNFPO": "00010", "WERKS": "1000"},
                   {"EBELN": po, "EBELP": "00020", "BANFN": "", "BNFPO": "", "WERKS": "1000"}),
        "EBAN": df({"BANFN": "0010000001", "BNFPO": "00010", "ERDAT": "20260102", "ERNAM": "REQ1"}),
        **cd(("BANF", "0010000001", "0000000001", "U", "20260103", "090000", "MGR1",
              [("EBAN", "100001000000100010", "FRGZU", "U", "X")]),
             ("EINKBELEG", po, "0000000002", "U", "20260106", "080000", "MGR1",
              [("EKKO", "100" + po, "FRGZU", "U", "X")]),
             ("EINKBELEG", po, "0000000003", "U", "20260106", "081500", "BUYER1",
              [("EKKO", "100" + po, "ZTERM", "U", "0001"), ("EKPO", k10, "MENGE", "U", "12"),
               ("EKPO", k10, "NETPR", "U", "9.50"), ("EKET", k10 + "0001", "EINDT", "U", "20260120"),
               ("EKPO", k20, "LOEKZ", "U", "L")]),
             ("KRED", "V1", "0000000004", "I", "20251201", "100000", "MD1", [("LFA1", "100V1", "KEY", "I", "")]),
             ("KRED", "V1", "0000000005", "U", "20251202", "100000", "MD1",
              [("LFA1", "100V1", "NAME1", "U", "Acme"), ("LFB1", "100V11000", "ZTERM", "U", "0002"),
               ("LFBK", "100V1ZA", "BANKN", "U", "123")])),
        "EKBE": df(
            # One GR document for both items; item 10 repeats it (account-assignment line).
            {"EBELN": po, "EBELP": "00010", "VGABE": "1", "GJAHR": "2026", "BELNR": "5000000001", "BWART": "101",
             "SHKZG": "S", "CPUDT": "20260110", "CPUTM": "101500", "ERNAM": "BATCH"},
            {"EBELN": po, "EBELP": "00010", "VGABE": "1", "GJAHR": "2026", "BELNR": "5000000001", "BWART": "101",
             "SHKZG": "S", "CPUDT": "20260110", "CPUTM": "101500", "ERNAM": "BATCH"},
            {"EBELN": po, "EBELP": "00020", "VGABE": "1", "GJAHR": "2026", "BELNR": "5000000001", "BWART": "101",
             "SHKZG": "S", "CPUDT": "20260110", "CPUTM": "101500", "ERNAM": "BATCH"},
            {"EBELN": po, "EBELP": "00020", "VGABE": "1", "GJAHR": "2026", "BELNR": "5000000002", "BWART": "102",
             "SHKZG": "H", "CPUDT": "20260111", "CPUTM": "000000", "ERNAM": "WH1"},
            {"EBELN": po, "EBELP": "00010", "VGABE": "2", "GJAHR": "2026", "BELNR": "5105600001", "BWART": "",
             "SHKZG": "S", "CPUDT": "20260112", "CPUTM": "080000", "ERNAM": "AP1"},
            {"EBELN": po, "EBELP": "00010", "VGABE": "2", "GJAHR": "2026", "BELNR": "5105600002", "BWART": "",
             "SHKZG": "H", "CPUDT": "20260113", "CPUTM": "080000", "ERNAM": "AP1"}),
        "RBKP": df({"BELNR": "5105600001", "GJAHR": "2026", "CPUDT": "20260112", "CPUTM": "080000", "USNAM": "AP1",
                    "ZLSPR": "A", "RBSTAT": "5"}),
        "BKPF": df({"BUKRS": "1000", "BELNR": "5100000001", "GJAHR": "2026", "AWTYP": "RMRP",
                    "AWKEY": "51056000012026"}),
        "BSAK": df({"BUKRS": "1000", "BELNR": "5100000001", "GJAHR": "2026", "AUGDT": "20260201",
                    "AUGBL": "1500000001"}),
        "USR02": df({"BNAME": "BUYER1", "USTYP": "A"}, {"BNAME": "BATCH", "USTYP": "B"}),
    }


def otc_tables() -> dict[str, pd.DataFrame]:
    so, key = "0000000100", "1000000000100000010"
    return {
        "VBAK": df({"VBELN": so, "AUART": "TA", "VKORG": "1000", "VTWEG": "10", "SPART": "00"}),
        "VBAP": df({"VBELN": so, "POSNR": "000010", "ERDAT": "20260105", "ERZET": "093000", "ERNAM": "CSR1",
                    "PSTYV": "TAN", "WERKS": "1000"}),
        **cd(("VERKBELEG", so, "0000000011", "U", "20260105", "100000", "CSR1",
              [("VBAK", "100" + so, "LIFSK", "U", "01"), ("VBAK", "100" + so, "FAKSK", "U", "02"),
               ("VBAK", "100" + so, "BSTKD", "U", "PO-77"), ("VBAP", key, "NETWR", "U", "100.00"),
               ("VBEP", key + "0001", "EDATU", "U", "20260109"), ("VBAP", key, "KWMENG", "U", "5")]),
             ("VERKBELEG", so, "0000000012", "U", "20260105", "120000", "CRED1",
              [("VBAK", "100" + so, "LIFSK", "U", ""), ("VBAP", key, "ABGRU", "U", "")]),
             ("DEBI", "C1", "0000000021", "I", "20251201", "080000", "MD1", []),
             ("DEBI", "C1", "0000000022", "U", "20251203", "080000", "MD1",
              [("KNA1", "100C1", "NAME1", "U", "Acme"), ("KNB1", "100C11000", "AKONT", "U", "140000"),
               ("KNKK", "100C10001", "KLIMK", "U", "5000")])),
        "LIKP": df({"VBELN": "0080000001", "ERDAT": "20260106", "ERZET": "100000", "ERNAM": "WH1", "LFART": "LF",
                    "WADAT_IST": "20260107"}),
        "LIPS": df({"VBELN": "0080000001", "POSNR": "000010", "VGBEL": so, "VGPOS": "000010"}),
        "VBRK": df({"VBELN": "0090000001", "ERDAT": "20260108", "ERZET": "110000", "ERNAM": "BILL1", "FKART": "F2",
                    "BUKRS": "1000", "BELNR": "0100000001", "GJAHR": "2026", "FKSTO": "", "SFAKN": ""},
                   {"VBELN": "0090000002", "ERDAT": "20260109", "ERZET": "110000", "ERNAM": "BILL1", "FKART": "S1",
                    "BUKRS": "1000", "BELNR": "0100000002", "GJAHR": "2026", "FKSTO": "", "SFAKN": "0090000001"}),
        "VBRP": df({"VBELN": "0090000001", "POSNR": "000010", "AUBEL": so, "AUPOS": "000010"},
                   {"VBELN": "0090000002", "POSNR": "000010", "AUBEL": so, "AUPOS": "000010"}),
        "BSAD": df({"BUKRS": "1000", "BELNR": "0100000001", "GJAHR": "2026", "AUGDT": "20260201",
                    "AUGBL": "1400000001"}),
    }


def r2r_tables() -> dict[str, pd.DataFrame]:
    def doc(belnr, tcode, cpudt, bstat="", stblg="", user="GL1", blart="SA"):
        return {"BUKRS": "1000", "BELNR": belnr, "GJAHR": "2026", "BLART": blart, "BSTAT": bstat, "CPUDT": cpudt,
                "CPUTM": "090000", "USNAM": user, "TCODE": tcode, "STBLG": stblg, "STJAH": "2026" if stblg else "",
                "AWTYP": "BKPF"}
    return {
        "BKPF": df(doc("0100000010", "FB50", "20260110", stblg="0100000011"),
                   doc("0100000011", "FB08", "20260115", stblg="0100000010"),
                   doc("0100000012", "ABZON", "20260111", blart="AA"),
                   doc("0100000013", "AFAB", "20260131", user="BATCH", blart="AF"),
                   doc("0100000014", "FBV1", "20260112", bstat="V"),
                   {**doc("0100000015", "FB50", "20240101"), "GJAHR": "2024"}),
        "BSAS": df({"BUKRS": "1000", "BELNR": "0100000010", "GJAHR": "2026", "AUGDT": "20260120",
                    "AUGBL": "0100000099"}),
        **cd(("SACH", "0000400000", "0000000031", "I", "20251101", "080000", "FI1", []),
             ("SACH", "0000400000", "0000000032", "U", "20251102", "080000", "FI1",
              [("SKB1", "10010000000400000", "FSTAG", "U", "G001"), ("SKAT", "100E0000400000", "TXT50", "U", "x")]),
             ("ANLA", "100000001", "0000000041", "I", "20251101", "080000", "AA1", []),
             ("ANLA", "100000001", "0000000042", "U", "20251105", "080000", "AA1",
              [("ANLZ", "x", "KOSTL", "U", "1000"), ("ANLB", "y", "AFASL", "U", "LINA")]),
             ("KOSTL", "0001K1", "0000000051", "I", "20251101", "080000", "CO1", []),
             ("KOSTL", "0001K1", "0000000052", "U", "20251110", "080000", "CO1", [("CSKS", "k", "VERAK", "U", "z")]),
             ("KSTAR", "0001400000", "0000000061", "I", "20251101", "080000", "CO1", [])),
        "AUFK": df({"AUFNR": "000000700001", "AUTYP": "01", "AUART": "0100", "ERDAT": "20260201",
                    "ERFZEIT": "081500", "ERNAM": "CO1", "BUKRS": "1000"},
                   {"AUFNR": "000001000001", "AUTYP": "10", "AUART": "PP01", "ERDAT": "20260201",
                    "ERFZEIT": "081500", "ERNAM": "PP1", "BUKRS": "1000"}),
        "USR02": df({"BNAME": "BATCH", "USTYP": "B"}, {"BNAME": "GL1", "USTYP": "A"}),
    }


FIXTURES = {"PTP": ptp_tables, "OTC": otc_tables, "R2R": r2r_tables}


def run(l1: str, tables: dict[str, pd.DataFrame]):
    frames = MemoryFrames(tables)
    return collect(builders.builder(l1).build, frames, make_context(frames, "t1", "ecc", RUN))


def by(events, activity, case=None):
    return [e for e in events if e.activity == activity and (case is None or e.case_id == case)]


@pytest.mark.parametrize("l1", sorted(FIXTURES))
def test_every_mapping_row_fires(l1):
    fired = {e.activity for e in run(l1, FIXTURES[l1]())}
    expected = {m.key for m in builders.builder(l1).MAPPING if "<" not in m.key}
    assert expected <= fired, expected - fired


@pytest.mark.parametrize("l1", sorted(FIXTURES))
def test_rerun_and_row_order_are_deterministic(l1):
    first = run(l1, FIXTURES[l1]())
    shuffled = {k: v.sample(frac=1, random_state=random.Random(7).randint(0, 999)) for k, v in FIXTURES[l1]().items()}
    assert run(l1, FIXTURES[l1]()) == first
    assert run(l1, shuffled) == first


@pytest.mark.parametrize("l1", sorted(FIXTURES))
def test_seq_is_mapping_order_and_ids_exist(l1):
    doc = reference_document()
    l4_ids = {l4.id for l4 in doc.all_l4()}
    l5_ids = {a.id for l4 in doc.all_l4() for a in l4.activities}
    mod = builders.builder(l1)
    order = {m.key: m.order for m in mod.MAPPING}
    for e in run(l1, FIXTURES[l1]()):
        assert e.seq == order.get(e.activity, order.get("POST_<TCODE>")), e
        if "-DSC-" in e.l5_id:
            continue
        if "-X_" in e.l5_id:
            assert e.l5_id.split("-X_")[0] in l4_ids, e.l5_id
        else:
            assert e.l5_id in l5_ids, e.l5_id
    for m in mod.MAPPING:
        assert m.l5_id.startswith(l1 + "-")


def test_ptp_timestamps_resources_and_automation():
    ev = run("PTP", ptp_tables())
    (po,) = by(ev, "CREATE_PO_ITEM", "4500000001/00010")
    assert (po.ts, po.ts_precision, po.resource, po.automated) == (datetime(2026, 1, 5, tzinfo=JNB), "day",
                                                                   "BUYER1", False)
    assert dict(po.org) == {"BUKRS": "1000", "EKORG": "1000", "WERKS": "1000"} and po.doc_type == "NB"
    (gr,) = by(ev, "GOODS_RECEIPT", "4500000001/00010")
    assert (gr.ts, gr.ts_precision, gr.automated) == (datetime(2026, 1, 10, 10, 15, tzinfo=JNB), "second", True)
    (rev,) = by(ev, "REVERSE_GR")
    assert rev.ts_precision == "day"  # CPUTM 000000
    (rel,) = by(ev, "RELEASE_PR")
    assert rel.case_id == "4500000001/00010" and dict(rel.attributes)["FRGZU"] == "X"
    assert {e.case_id for e in by(ev, "RELEASE_PO")} == {"4500000001/00010", "4500000001/00020"}
    (inv,) = by(ev, "INVOICE_RECEIPT")
    assert inv.object_refs == (("RBKP", "5105600001/2026"), ("BKPF", "1000/5100000001/2026"))
    (pay,) = by(ev, "CLEAR_INVOICE")
    assert (pay.ts, pay.ts_precision) == (datetime(2026, 2, 1, tzinfo=JNB), "day")
    assert by(ev, "DELETE_PO_ITEM")[0].case_id == "4500000001/00020"
    assert {e.activity for e in ev if e.case_type == "vendor"} == {
        "CREATE_VENDOR", "CHANGE_VENDOR_GENERAL", "CHANGE_VENDOR_COMPANY", "CHANGE_VENDOR_BANK"}


def test_ptp_shared_goods_receipt_lands_in_both_cases_once():
    grs = by(run("PTP", ptp_tables()), "GOODS_RECEIPT")
    assert sorted(e.case_id for e in grs) == ["4500000001/00010", "4500000001/00020"]
    assert {e.object_refs for e in grs} == {(("MBLNR", "5000000001/2026"),)}


def test_otc_blocks_billing_and_cancellation():
    ev = run("OTC", otc_tables())
    case = "0000000100/000010"
    assert [dict(e.attributes)["LIFSK"] for e in by(ev, "SET_DELIVERY_BLOCK", case)] == ["01"]
    assert len(by(ev, "REMOVE_DELIVERY_BLOCK", case)) == 1
    (gi,) = by(ev, "GOODS_ISSUE", case)
    assert (gi.ts_precision, gi.object_refs) == ("day", (("LIPS", "0080000001/000010"),))
    (inv,) = by(ev, "CREATE_INVOICE", case)
    assert inv.object_refs == (("VBRP", "0090000001/000010"), ("BKPF", "1000/0100000001/2026"))
    assert dict(inv.org)["BUKRS"] == "1000" and "BUKRS" not in dict(by(ev, "CREATE_SO_ITEM")[0].org)
    (cancel,) = by(ev, "CANCEL_INVOICE", case)
    assert cancel.object_refs == (("VBRP", "0090000002/000010"),)
    (clr,) = by(ev, "CLEAR_PAYMENT", case)
    assert clr.object_refs[-1] == ("AUGBL", "1400000001")
    assert [e.activity for e in ev if e.case_id == case][0] == "CREATE_SO_ITEM"


def test_r2r_postings_reversal_window_and_master_data():
    ev = run("R2R", r2r_tables())
    assert by(ev, "POST_GL_DOC")[0].l5_id == "R2R-GL-FB50-01"
    (fb08,) = by(ev, "POST_FB08")
    assert fb08.l5_id == "R2R-DSC-POST_FB08-01" and fb08.case_id == "1000/0100000011/2026"
    (rev,) = by(ev, "REVERSE_DOC")
    assert rev.case_id == "1000/0100000010/2026" and rev.ts == datetime(2026, 1, 15, 9, tzinfo=JNB)
    assert by(ev, "POST_DEPRECIATION")[0].automated is True
    assert by(ev, "PARK_DOC")[0].case_id == "1000/0100000014/2026"
    assert not [e for e in ev if e.case_id.endswith("/2024")]  # before run_date - 365
    (aufk,) = by(ev, "CREATE_INTERNAL_ORDER")
    assert aufk.case_id == "000000700001" and aufk.case_type == "internal_order"
    assert {e.case_type for e in ev} == {"fi_doc", "gl_account", "asset", "cost_center", "cost_element",
                                         "internal_order"}


def test_r2r_window_from_overrides_default():
    frames = MemoryFrames(r2r_tables())
    ctx = BuildContext("t1", "ecc", RUN, window_from=date(2026, 1, 12))
    ev = collect(r2r.build, frames, ctx)
    assert {e.case_id for e in ev if e.case_type == "fi_doc"} == {
        "1000/0100000011/2026", "1000/0100000013/2026", "1000/0100000014/2026"}


@pytest.mark.parametrize("bad", ["00000000", ""])
def test_null_dates_drop_the_event(bad):
    t = r2r_tables()
    t["BKPF"] = t["BKPF"].assign(CPUDT=bad)
    assert not [e for e in run("R2R", t) if e.case_type == "fi_doc"]
    t = ptp_tables()
    t["EKKO"] = t["EKKO"].assign(AEDAT=bad)
    assert not by(run("PTP", t), "CREATE_PO_ITEM")


def _dup(t, name, **diff):
    """Append a second row for the first key of ``name`` that differs in ``diff``."""
    t[name] = pd.concat([t[name], t[name].iloc[[0]].assign(**diff)], ignore_index=True)


@pytest.mark.parametrize("seed", range(6))
def test_duplicate_keys_give_identical_output_for_any_row_order(seed):
    def tables(l1):
        t = FIXTURES[l1]()
        if l1 == "R2R":
            _dup(t, "BKPF", USNAM="GL9", TCODE="FB01")
            _dup(t, "BSAS", AUGDT="20260101", AUGBL="0100000001")
        elif l1 == "PTP":
            _dup(t, "EKPO", WERKS="2000")
            _dup(t, "RBKP", USNAM="ZZ9")
            _dup(t, "BSAK", AUGDT="20260301", AUGBL="1500000009")
        else:
            _dup(t, "VBAP", WERKS="2000")
            _dup(t, "LIKP", ERNAM="ZZ9")
            _dup(t, "VBRK", ERNAM="ZZ9")
            _dup(t, "BSAD", AUGDT="20260301", AUGBL="1400000009")
        return t

    for l1 in FIXTURES:
        base = tables(l1)
        first = run(l1, base)
        shuffled = {k: v.sample(frac=1, random_state=seed) for k, v in base.items()}
        assert run(l1, shuffled) == first


def test_missing_tables_yield_no_events():
    for mod in (ptp, otc, r2r):
        assert collect(mod.build, MemoryFrames({}), BuildContext("t1", "ecc", RUN)) == []
