from datetime import date

import pandas as pd

from api.services import proven_cost as pc
from checks.frames import TableFrames


def _tf(**t: pd.DataFrame) -> TableFrames:
    return TableFrames(dict(t))


def _po_frames() -> TableFrames:
    ekko = pd.DataFrame({"EBELN": ["P1", "P2", "P3"], "LIFNR": ["V1"] * 3, "WAERS": ["ZAR"] * 3})
    ekpo = pd.DataFrame({"EBELN": ["P1", "P2", "P3"], "EBELP": ["10"] * 3, "MATNR": ["M1", "M2", "M3"],
                         "WERKS": ["W"] * 3, "NETWR": [1000.0, 500.0, 70.0]})
    eket = pd.DataFrame({"EBELN": ["P1", "P2", "P3"], "EBELP": ["10"] * 3, "ETENR": ["1"] * 3,
                         "EINDT": ["20260101", "20260101", "20260101"]})
    ekbe = pd.DataFrame({"EBELN": ["P1", "P2"], "EBELP": ["10", "10"], "VGABE": ["1", "1"],
                         "BUDAT": ["20260115", "20251230"]})
    marc = pd.DataFrame({"MATNR": ["M1", "M2", "M3"], "WERKS": ["W"] * 3, "PLIFZ": [0, 5, 5]})
    eina = pd.DataFrame({"INFNR": ["I1", "I2", "I3"], "MATNR": ["M1", "M2", "M3"], "LIFNR": ["V1"] * 3})
    eine = pd.DataFrame({"INFNR": ["I1", "I2"], "APLFZ": [3, 3]})
    return _tf(EKKO=ekko, EKPO=ekpo, EKET=eket, EKBE=ekbe, MARC=marc, EINA=eina, EINE=eine)


def test_late_po_requires_master_defect():
    r = pc.late_pos(_po_frames(), today=date(2026, 3, 1))
    keys = {i["doc_key"] for i in r.items}
    # P1 late + PLIFZ=0; P2 on time; P3 never received, overdue, EINE missing
    assert keys == {"EBELN=P1|EBELP=10", "EBELN=P3|EBELP=10"}
    assert r.amount == 1070.0 and r.by_currency == {"ZAR": 1070.0} and r.documents == 2
    p1 = next(i for i in r.items if i["doc_key"].startswith("EBELN=P1"))
    assert p1["master_key"] == "MATNR=M1|WERKS=W" and "14 days late" in p1["detail"] and "PLIFZ" in p1["detail"]


def test_late_po_missing_tables_returns_zero():
    r = pc.late_pos(_tf(), today=date(2026, 3, 1))
    assert r.amount == 0 and r.items == []
