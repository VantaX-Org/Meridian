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
