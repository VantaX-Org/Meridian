from datetime import date

import pandas as pd

from api.services import proven_cost as pc
from checks.frames import TableFrames


def _tf(**t: pd.DataFrame) -> TableFrames:
    return TableFrames(dict(t))


def _po_frames() -> TableFrames:
    ekko = pd.DataFrame({"EBELN": ["P1", "P2", "P3", "P4"], "LIFNR": ["V1"] * 4, "WAERS": ["ZAR"] * 4})
    ekpo = pd.DataFrame({"EBELN": ["P1", "P2", "P3", "P4"], "EBELP": ["10"] * 4, "MATNR": ["M1", "M2", "M3", "M4"],
                         "WERKS": ["W"] * 4, "NETWR": [1000.0, 500.0, 70.0, 300.0]})
    eket = pd.DataFrame({"EBELN": ["P1", "P2", "P3", "P4"], "EBELP": ["10"] * 4, "ETENR": ["1"] * 4,
                         "EINDT": ["20260101", "20260101", "20260101", "20260101"]})
    ekbe = pd.DataFrame({"EBELN": ["P1", "P2", "P4"], "EBELP": ["10", "10", "10"], "VGABE": ["1", "1", "1"],
                         "BUDAT": ["20260115", "20251230", "20260110"]})
    marc = pd.DataFrame({"MATNR": ["M1", "M2", "M3", "M4"], "WERKS": ["W"] * 4, "PLIFZ": [0, 5, 5, 5]})
    eina = pd.DataFrame({"INFNR": ["I1", "I2", "I3", "I4"], "MATNR": ["M1", "M2", "M3", "M4"], "LIFNR": ["V1"] * 4})
    eine = pd.DataFrame({"INFNR": ["I1", "I2", "I4"], "APLFZ": [3, 3, 3]})
    return _tf(EKKO=ekko, EKPO=ekpo, EKET=eket, EKBE=ekbe, MARC=marc, EINA=eina, EINE=eine)


def test_late_po_requires_master_defect():
    r = pc.late_pos(_po_frames(), today=date(2026, 3, 1))
    keys = {i["doc_key"] for i in r.items}
    # P1 late + PLIFZ=0; P2 on time; P3 never received, overdue, EINE missing; P4 late but healthy master
    assert keys == {"EBELN=P1|EBELP=10", "EBELN=P3|EBELP=10"}
    assert r.amount == 1070.0 and r.by_currency == {"ZAR": 1070.0} and r.documents == 2
    p1 = next(i for i in r.items if i["doc_key"].startswith("EBELN=P1"))
    assert p1["master_key"] == "MATNR=M1|WERKS=W" and "14 days late" in p1["detail"] and "PLIFZ" in p1["detail"]
    # P4 is late but has healthy master data (PLIFZ > 0 and EINE exists), so it should be excluded
    assert not any(i["doc_key"].startswith("EBELN=P4") for i in r.items)
    assert 300.0 not in [i["amount"] for i in r.items]


def test_late_po_missing_tables_returns_zero():
    r = pc.late_pos(_tf(), today=date(2026, 3, 1))
    assert r.amount == 0 and r.items == []


def test_grir_variance_only_with_marm_defect():
    ekko = pd.DataFrame({"EBELN": ["P1", "P2"], "WAERS": ["ZAR", "ZAR"], "LIFNR": ["V", "V"]})
    ekpo = pd.DataFrame({"EBELN": ["P1", "P2"], "EBELP": ["10", "10"], "MATNR": ["M1", "M2"],
                         "WERKS": ["W", "W"], "MEINS": ["BOX", "BOX"], "BPRME": ["BOX", "BOX"], "NETWR": [0, 0]})
    mara = pd.DataFrame({"MATNR": ["M1", "M2"], "MEINS": ["EA", "EA"]})
    marm = pd.DataFrame({"MATNR": ["M2"], "MEINH": ["BOX"], "UMREZ": [12], "UMREN": [1]})
    ekbe = pd.DataFrame({"EBELN": ["P1", "P2"], "EBELP": ["10", "10"], "VGABE": ["1", "1"],
                         "DMBTR": [100.0, 100.0], "SHKZG": ["S", "S"]})
    rseg = pd.DataFrame({"EBELN": ["P1", "P2"], "EBELP": ["10", "10"], "WRBTR": [1200.0, 130.0]})
    r = pc.grir_uom_variance(_tf(EKKO=ekko, EKPO=ekpo, MARA=mara, MARM=marm, EKBE=ekbe, RSEG=rseg))
    assert [i["doc_key"] for i in r.items] == ["EBELN=P1|EBELP=10"]
    assert r.amount == 1100.0 and "no MARM BOX" in r.items[0]["detail"]


def test_grir_variance_with_bprme_and_meins_units():
    ekko = pd.DataFrame({"EBELN": ["P1"], "WAERS": ["ZAR"], "LIFNR": ["V"]})
    # BPRME = EA (base unit), MEINS = BOX (not base unit, no MARM row)
    ekpo = pd.DataFrame({"EBELN": ["P1"], "EBELP": ["10"], "MATNR": ["M1"],
                         "WERKS": ["W"], "MEINS": ["BOX"], "BPRME": ["EA"], "NETWR": [0]})
    mara = pd.DataFrame({"MATNR": ["M1"], "MEINS": ["EA"]})
    # No MARM row for BOX
    marm = pd.DataFrame({"MATNR": [], "MEINH": [], "UMREZ": [], "UMREN": []})
    ekbe = pd.DataFrame({"EBELN": ["P1"], "EBELP": ["10"], "VGABE": ["1"],
                         "DMBTR": [100.0], "SHKZG": ["S"]})
    rseg = pd.DataFrame({"EBELN": ["P1"], "EBELP": ["10"], "WRBTR": [1200.0]})
    r = pc.grir_uom_variance(_tf(EKKO=ekko, EKPO=ekpo, MARA=mara, MARM=marm, EKBE=ekbe, RSEG=rseg))
    assert [i["doc_key"] for i in r.items] == ["EBELN=P1|EBELP=10"]
    assert "no MARM BOX" in r.items[0]["detail"]


def test_blocked_sales_needs_customer_defect():
    vbak = pd.DataFrame({"VBELN": ["S1", "S2", "S3"], "KUNNR": ["C1", "C2", "C3"], "VKORG": ["O"] * 3,
                         "VTWEG": ["D"] * 3, "SPART": ["X"] * 3, "NETWR": [900.0, 50.0, 10.0],
                         "WAERK": ["ZAR"] * 3, "LIFSK": ["01", "", "01"], "FAKSK": ["", "", ""]})
    vbuk = pd.DataFrame({"VBELN": ["S1", "S2", "S3"], "CMGST": ["", "B", ""]})
    knvv = pd.DataFrame({"KUNNR": ["C1", "C3"], "VKORG": ["O", "O"], "VTWEG": ["D", "D"], "SPART": ["X", "X"],
                         "AUFSD": ["", ""], "LIFSD": ["01", ""]})
    kna1 = pd.DataFrame({"KUNNR": ["C1", "C2", "C3"], "AUFSD": ["", "", ""], "LIFSD": ["", "", ""]})
    r = pc.blocked_sales(_tf(VBAK=vbak, VBUK=vbuk, KNVV=knvv, KNA1=kna1))
    assert {i["doc_key"] for i in r.items} == {"VBELN=S1", "VBELN=S2"}  # S2: no KNVV; S3: master clean
    assert r.amount == 950.0


def test_blocked_sales_duplicate_knvv_not_double_counted():
    vbak = pd.DataFrame({"VBELN": ["S1"], "KUNNR": ["C1"], "VKORG": ["O"],
                         "VTWEG": ["D"], "SPART": ["X"], "NETWR": [900.0],
                         "WAERK": ["ZAR"], "LIFSK": [""], "FAKSK": [""]})
    vbuk = pd.DataFrame({"VBELN": ["S1"], "CMGST": ["B"]})
    knvv = pd.DataFrame({"KUNNR": ["C1", "C1"], "VKORG": ["O", "O"], "VTWEG": ["D", "D"],
                         "SPART": ["X", "X"], "AUFSD": ["01", "01"], "LIFSD": ["", ""]})
    kna1 = pd.DataFrame({"KUNNR": ["C1"], "AUFSD": [""], "LIFSD": [""]})
    r = pc.blocked_sales(_tf(VBAK=vbak, VBUK=vbuk, KNVV=knvv, KNA1=kna1))
    assert r.amount == 900.0
    assert len(r.items) == 1
    assert r.documents == 1


def test_blocked_sales_partial_vbuk_falls_back_to_vbak():
    vbak = pd.DataFrame({"VBELN": ["S1", "S2"], "KUNNR": ["C1", "C1"], "VKORG": ["O", "O"],
                         "VTWEG": ["D", "D"], "SPART": ["X", "X"], "NETWR": [100.0, 50.0],
                         "WAERK": ["ZAR", "ZAR"], "LIFSK": ["", ""], "FAKSK": ["", ""],
                         "CMGST": ["B", ""]})
    vbuk = pd.DataFrame({"VBELN": ["S2"], "CMGST": [""]})
    knvv = pd.DataFrame({"KUNNR": [], "VKORG": [], "VTWEG": [], "SPART": [],
                         "AUFSD": [], "LIFSD": []})
    kna1 = pd.DataFrame({"KUNNR": ["C1"], "AUFSD": [""], "LIFSD": [""]})
    r = pc.blocked_sales(_tf(VBAK=vbak, VBUK=vbuk, KNVV=knvv, KNA1=kna1))
    # S1 has CMGST="B" in VBAK; S2 has no VBUK row, so falls back to VBAK's CMGST=""
    # S1 is credit-blocked with no KNVV for its sales area, so counted. S2 not blocked.
    assert {i["doc_key"] for i in r.items} == {"VBELN=S1"}
    assert r.amount == 100.0


def test_blocked_sales_cmgst_fallback_with_nondefault_index():
    vbak = pd.DataFrame({"VBELN": ["S1", "S2"], "KUNNR": ["C1", "C1"], "VKORG": ["O", "O"],
                         "VTWEG": ["D", "D"], "SPART": ["X", "X"], "NETWR": [100.0, 50.0],
                         "WAERK": ["ZAR", "ZAR"], "LIFSK": ["", ""], "FAKSK": ["", ""],
                         "CMGST": ["B", ""]}, index=[10, 20])
    vbuk = pd.DataFrame({"VBELN": ["S2"], "CMGST": [""]})
    knvv = pd.DataFrame({"KUNNR": [], "VKORG": [], "VTWEG": [], "SPART": [],
                         "AUFSD": [], "LIFSD": []})
    kna1 = pd.DataFrame({"KUNNR": ["C1"], "AUFSD": [""], "LIFSD": [""]})
    r = pc.blocked_sales(_tf(VBAK=vbak, VBUK=vbuk, KNVV=knvv, KNA1=kna1))
    # S1 (at index 10) has CMGST="B" in VBAK; S2 (at index 20) has no VBUK row
    # S1 fallback must work despite non-default index
    assert {i["doc_key"] for i in r.items} == {"VBELN=S1"}
    assert r.amount == 100.0


def test_vendor_clusters_union_find() -> None:
    c = pc.vendor_clusters([("LIFNR=0000000100", "200"), ("200", "300"), ("400", "500")])
    assert c["100"] == c["200"] == c["300"] and c["400"] == c["500"] and c["100"] != c["400"]


def test_duplicate_payment_across_cluster() -> None:
    bsak = pd.DataFrame({"BUKRS": ["1"] * 4, "LIFNR": ["100", "200", "100", "300"],
                         "BELNR": ["B1", "B2", "B3", "B4"], "XBLNR": ["INV-9", "inv 9", "INV-1", "INV-9"],
                         "WRBTR": [5000.0, 5000.0, 10.0, 5000.0], "WAERS": ["ZAR"] * 4,
                         "SHKZG": ["S"] * 4, "BLDAT": ["20260101"] * 4})
    r = pc.duplicate_payments(_tf(BSAK=bsak), pc.vendor_clusters([("100", "200")]))
    assert r.amount == 5000.0 and r.documents == 1
    assert r.items[0]["master_key"] == "LIFNR=100,200"  # 300 is not in the cluster, so excluded


def test_duplicate_payment_single_vendor_no_cluster() -> None:
    bsak = pd.DataFrame({"BUKRS": ["1"] * 2, "LIFNR": ["700", "700"],
                         "BELNR": ["B1", "B2"], "XBLNR": ["INV-X", "INV-X"],
                         "WRBTR": [1200.0, 1200.0], "WAERS": ["ZAR"] * 2,
                         "SHKZG": ["S"] * 2, "BLDAT": ["20260101"] * 2, "GJAHR": ["2025", "2025"]})
    r = pc.duplicate_payments(_tf(BSAK=bsak), {})
    assert r.amount == 1200.0 and r.documents == 1
    assert r.items[0]["master_key"] == "LIFNR=700"


def test_duplicate_payment_gjahr_separates_documents() -> None:
    bsak = pd.DataFrame({"BUKRS": ["1"] * 2, "LIFNR": ["100", "100"],
                         "BELNR": ["1400000001", "1400000001"], "XBLNR": ["INV-9", "INV-9"],
                         "WRBTR": [5000.0, 5000.0], "WAERS": ["ZAR"] * 2,
                         "SHKZG": ["S"] * 2, "BLDAT": ["20260101", "20260101"], "GJAHR": ["2025", "2026"]})
    r = pc.duplicate_payments(_tf(BSAK=bsak), pc.vendor_clusters([]))
    assert r.amount == 5000.0 and r.documents == 1
    assert r.items[0]["master_key"] == "LIFNR=100"


def test_duplicate_payment_reversed_payments_excluded() -> None:
    bsak = pd.DataFrame({"BUKRS": ["1"] * 2, "LIFNR": ["100", "100"],
                         "BELNR": ["B1", "B2"], "XBLNR": ["INV-X", "INV-X"],
                         "WRBTR": [5000.0, -5000.0], "WAERS": ["ZAR"] * 2,
                         "SHKZG": ["S"] * 2, "BLDAT": ["20260101", "20260101"], "GJAHR": ["2025", "2025"]})
    r = pc.duplicate_payments(_tf(BSAK=bsak), {})
    assert r.amount == 0 and r.items == []


def test_attribute_matches_on_overlapping_fields():
    items = [pc.CostItem(doc_key="EBELN=P1|EBELP=10", master_key="MATNR=M1|WERKS=W", amount=1, detail=""),
             pc.CostItem(doc_key="BUKRS=1|BELNR=B1,B2", master_key="LIFNR=100,200", amount=1, detail="")]
    failing = {"MM140": {"MATNR=M1|WERKS=W"}, "MM001": {"MATNR=M1"}, "MM002": {"MATNR=M2"},
               "S4-CVI-LFA1": {"LIFNR=0000000200"}, "X": {"BUKRS=1"}}
    out = pc.attribute(items, failing)
    assert out["EBELN=P1|EBELP=10"] == ["MM001", "MM140"]
    assert out["BUKRS=1|BELNR=B1,B2"] == ["S4-CVI-LFA1"]


def test_compute_runs_all_four_metrics():
    rows = pc.compute(_po_frames(), date(2026, 3, 1), {}, {"MM140": {"MATNR=M1|WERKS=W"}})
    assert [r["metric"] for r in rows] == ["late_po", "grir_uom_variance", "blocked_sales", "duplicate_payment"]
    assert rows[0]["check_ids"] == ["MM140"] and rows[0]["items"][0]["check_ids"] in (["MM140"], [])
