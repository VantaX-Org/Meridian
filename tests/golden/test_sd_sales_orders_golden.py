"""Golden dataset: the whole sales-order pipeline (shipped + generated rules, active
population, joins to the customer and material masters, ECC status tables, live
configuration) on orders whose correct findings are known. Clean orders must
produce no finding at all — any failure on them is a false positive; each seeded
defect must be found exactly where it was put."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")  # ECC: GBSTK / ABSTK / GBSTA live on VBUK / VBUP (exposed as VBAK / VBAP fields)


def _d(days_ago: int) -> str:
    """DATS relative to today, so open/old orders stay open/old whenever the test runs."""
    return (pd.Timestamp.now().normalize() - pd.Timedelta(days=days_ago)).strftime("%Y%m%d")


# Customers: K1 ZA trade customer, K2 German export customer, K3 customer under a central order block
# whose open order already carries a delivery block, KBLK order-blocked customer, KDEL flagged for deletion
K1, K2, K3, KBLK, KDEL = "0000300001", "0000300002", "0000300003", "0000300004", "0000300005"
# Materials (MATN1 internal format): M1/M2 active, M3 phased out (deleted after its last delivery),
# M4 active spare, M5 marked obsolete in its description only
M1, M2, M3, M4, M5 = (f"0000000000001002{i:02d}" for i in (31, 32, 33, 34, 35))

H = ["VBELN", "AUART", "VBTYP", "VKORG", "VTWEG", "SPART", "KUNNR", "WAERK", "NETWR", "BSTNK", "ERDAT", "ERNAM",
     "AEDAT", "VDATU", "LIFSK", "FAKSK", "GBSTK", "ABSTK"]
I = ["VBELN", "POSNR", "MATNR", "ARKTX", "PSTYV", "KWMENG", "VRKME", "NETWR", "WAERK", "WERKS", "ROUTE", "ABGRU",
     "ERDAT", "AEDAT", "GBSTA", "ABSTA"]

# clean orders
O1 = "0000012001"   # open standard order (TA) with a free-of-charge item (TANN, net value 0)
O2 = "0000012002"   # export order, completed two years ago
O3 = "0000012003"   # partly delivered: item 10 (M3) fully delivered and billed before M3 was flagged for deletion
O4 = "0000012004"   # partly rejected: item 20 rejected (reason 03 "too expensive"), its material since deleted
O5 = "0000012005"   # fully rejected order: every item carries a reason for rejection
O6 = "0000012006"   # returns order (RE)
O7 = "0000012007"   # open order of K3 — the order itself carries delivery block 01 since the customer was blocked
# seeded defects (one each)
D_VDATU, D_AUART, D_QTY, D_DELCUST, D_BLKCUST, D_OLD, D_REJ, D_AEDAT, D_DELMAT = (
    f"00000120{i}" for i in range(11, 20))

HEADERS = [
    # VBELN  AUART  VBTYP VKORG VTWEG SPART KUNNR WAERK NETWR BSTNK ERDAT ERNAM AEDAT VDATU LIFSK FAKSK GBSTK ABSTK
    [O1, "TA", "C", "1000", "10", "00", K1, "ZAR", "48750.00", "PO-45009812", _d(12), "SMOKOENA", _d(5), _d(-9),
     "", "", "A", "A"],
    [O2, "TA", "C", "1000", "10", "00", K2, "EUR", "18200.00", "4500771203", _d(730), "JVANWYK", _d(700), _d(700),
     "", "", "C", "A"],
    [O3, "TA", "C", "1000", "10", "00", K1, "ZAR", "96400.00", "PO-45009377", _d(60), "SMOKOENA", _d(8), _d(45),
     "", "", "B", "A"],
    [O4, "TA", "C", "1000", "10", "00", K1, "ZAR", "12300.00", "PO-45009590", _d(40), "SMOKOENA", _d(20), _d(30),
     "", "", "B", "B"],
    [O5, "TA", "C", "1000", "10", "00", K2, "EUR", "0.00", "4500772288", _d(90), "JVANWYK", _d(85), _d(70),
     "", "", "C", "C"],
    [O6, "RE", "H", "1000", "10", "00", K1, "ZAR", "4875.00", "RMA-2291", _d(6), "TDLAMINI", "", _d(-3),
     "", "", "A", "A"],
    [O7, "TA", "C", "1000", "10", "00", K3, "ZAR", "22100.00", "PO-77120", _d(25), "SMOKOENA", _d(4), _d(10),
     "01", "", "A", "A"],
    [D_VDATU, "TA", "C", "1000", "10", "00", K1, "ZAR", "7300.00", "PO-45009901", _d(3), "SMOKOENA", "", "",
     "", "", "A", "A"],
    [D_AUART, "ZXX1", "C", "1000", "10", "00", K1, "ZAR", "5100.00", "PO-45009902", _d(4), "SMOKOENA", "", _d(-7),
     "", "", "A", "A"],
    [D_QTY, "TA", "C", "1000", "10", "00", K1, "ZAR", "3900.00", "PO-45009903", _d(5), "SMOKOENA", "", _d(-6),
     "", "", "A", "A"],
    [D_DELCUST, "TA", "C", "1000", "10", "00", KDEL, "ZAR", "8800.00", "PO-31877", _d(50), "TDLAMINI", "", _d(20),
     "", "", "A", "A"],
    [D_BLKCUST, "TA", "C", "1000", "10", "00", KBLK, "ZAR", "15600.00", "PO-90211", _d(30), "TDLAMINI", "", _d(15),
     "", "", "A", "A"],
    [D_OLD, "TA", "C", "1000", "10", "00", K1, "ZAR", "61200.00", "PO-45006120", _d(520), "SMOKOENA", _d(400),
     _d(490), "", "", "B", "A"],
    [D_REJ, "TA", "C", "1000", "10", "00", K2, "EUR", "0.00", "4500773310", _d(70), "JVANWYK", _d(66), _d(50),
     "", "", "C", "C"],
    [D_AEDAT, "TA", "C", "1000", "10", "00", K1, "ZAR", "2600.00", "PO-45009905", _d(10), "SMOKOENA", _d(400),
     _d(-4), "", "", "A", "A"],
    [D_DELMAT, "TA", "C", "1000", "10", "00", K2, "EUR", "9400.00", "4500773599", _d(15), "JVANWYK", "", _d(-12),
     "", "", "A", "A"],
]


def _item(vbeln, posnr, matnr, arktx, kwmeng, netwr, waerk="ZAR", pstyv="TAN", abgru="", gbsta="A", absta="A",
          erdat=None, aedat=""):
    head = next(h for h in HEADERS if h[0] == vbeln)
    return [vbeln, posnr, matnr, arktx, pstyv, kwmeng, "ST", netwr, waerk, "1000", "R00010", abgru,
            erdat or head[10], aedat, gbsta, absta]


ITEMS = [
    _item(O1, "000010", M1, "Gate valve DN100 PN16 cast steel", "25.000", "48750.00", gbsta="A"),
    _item(O1, "000020", M4, "Valve gasket set DN100", "25.000", "0.00", pstyv="TANN", gbsta="A"),
    _item(O2, "000010", M2, "Butterfly valve DN200 PN10", "10.000", "18200.00", waerk="EUR", gbsta="C"),
    _item(O3, "000010", M3, "Gate valve DN150 PN16 (series 4)", "20.000", "61400.00", gbsta="C"),
    _item(O3, "000020", M1, "Gate valve DN100 PN16 cast steel", "18.000", "35000.00", gbsta="A"),
    _item(O4, "000010", M1, "Gate valve DN100 PN16 cast steel", "6.000", "12300.00", gbsta="C"),
    _item(O4, "000020", M3, "Gate valve DN150 PN16 (series 4)", "4.000", "12280.00", abgru="03", gbsta="C",
          absta="C"),
    _item(O5, "000010", M2, "Butterfly valve DN200 PN10", "8.000", "14560.00", waerk="EUR", abgru="03", gbsta="C",
          absta="C"),
    _item(O6, "000010", M1, "Gate valve DN100 PN16 cast steel", "2.500", "4875.00", pstyv="REN"),
    _item(O7, "000010", M2, "Butterfly valve DN200 PN10", "12.000", "22100.00"),
    _item(D_VDATU, "000010", M1, "Gate valve DN100 PN16 cast steel", "4.000", "7300.00"),
    _item(D_AUART, "000010", M2, "Butterfly valve DN200 PN10", "3.000", "5100.00"),
    _item(D_QTY, "000010", M1, "Gate valve DN100 PN16 cast steel", "-2.000", "3900.00"),
    _item(D_DELCUST, "000010", M2, "Butterfly valve DN200 PN10", "5.000", "8800.00"),
    _item(D_BLKCUST, "000010", M1, "Gate valve DN100 PN16 cast steel", "8.000", "15600.00"),
    _item(D_OLD, "000010", M1, "Gate valve DN100 PN16 cast steel", "30.000", "61200.00", gbsta="B"),
    # overall rejection status C, but item 20 has no reason for rejection
    _item(D_REJ, "000010", M2, "Butterfly valve DN200 PN10", "6.000", "10920.00", waerk="EUR", abgru="03",
          gbsta="C", absta="C"),
    _item(D_REJ, "000020", M4, "Valve gasket set DN100", "6.000", "540.00", waerk="EUR", gbsta="C", absta="C"),
    _item(D_AEDAT, "000010", M4, "Valve gasket set DN100", "40.000", "2600.00"),
    _item(D_DELMAT, "000010", M3, "Gate valve DN150 PN16 (series 4)", "3.000", "9400.00", waerk="EUR"),
]


def _frames() -> TableFrames:
    hdr = pd.DataFrame(HEADERS, columns=H)
    itm = pd.DataFrame(ITEMS, columns=I)
    vbak = hdr.drop(columns=["GBSTK", "ABSTK"]).add_prefix("VBAK.")
    vbuk = hdr[["VBELN", "GBSTK", "ABSTK"]].add_prefix("VBUK.")
    vbap = itm.drop(columns=["GBSTA", "ABSTA"]).add_prefix("VBAP.")
    vbup = itm[["VBELN", "POSNR", "GBSTA", "ABSTA"]].add_prefix("VBUP.")

    cust = [K1, K2, K3, KBLK, KDEL]
    kna1 = pd.DataFrame({
        "KNA1.KUNNR": cust,
        "KNA1.NAME1": ["Sasolburg Valve Services (Pty) Ltd", "Weber Antriebstechnik GmbH",
                       "Rustenburg Platinum Engineering (Pty) Ltd", "Highveld Pipe Supplies (Pty) Ltd",
                       "Witbank Fluid Controls CC"],
        "KNA1.NAME2": [""] * 5, "KNA1.NAME3": [""] * 5, "KNA1.NAME4": [""] * 5,
        "KNA1.PSON1": [""] * 5, "KNA1.PSON2": [""] * 5, "KNA1.PSON3": [""] * 5,
        "KNA1.STRAS": ["8 Fichardt Street", "Industriestraße 27", "14 Bosch Street", "77 Voortrekker Road",
                       "3 Mandela Street"],
        "KNA1.ORT01": ["Sasolburg", "Mannheim", "Rustenburg", "Witbank", "Emalahleni"],
        "KNA1.ORT02": [""] * 5, "KNA1.PFORT": [""] * 5, "KNA1.PSTL2": [""] * 5,
        "KNA1.PSTLZ": ["1947", "68219", "0299", "1035", "1034"],
        "KNA1.LAND1": ["ZA", "DE", "ZA", "ZA", "ZA"],
        "KNA1.STCD1": ["4230118876", "", "4510127793", "4680139904", "4170182235"],
        "KNA1.STCD2": [""] * 5, "KNA1.STCD3": [""] * 5, "KNA1.STCD4": [""] * 5,
        "KNA1.STCEG": ["", "DE287419653", "", "", ""],
        "KNA1.TELF1": ["0169734400", "+49 621 8774 0", "0145921100", "0136562000", "0136904400"],
        "KNA1.TELF2": [""] * 5, "KNA1.TELFX": [""] * 5, "KNA1.KNURL": [""] * 5,
        "KNA1.ERDAT": ["20180919", "20140310", "20160502", "20150811", "20100128"],
        "KNA1.LOEVM": ["", "", "", "", "X"],
        "KNA1.SPERR": ["", "", "", "", "X"],
        "KNA1.AUFSD": ["", "", "01", "01", ""],
        "KNA1.CASSD": [""] * 5,
        "KNA1.XCPDK": [""] * 5,
    })
    mara = pd.DataFrame({
        "MARA.MATNR": [M1, M2, M3, M4, M5], "MARA.MTART": ["FERT", "FERT", "FERT", "HAWA", "FERT"],
        "MARA.MEINS": ["ST"] * 5, "MARA.ERSDA": ["20150302", "20150302", "20120917", "20160714", "20110405"],
        "MARA.LAEDA": [_d(200), _d(150), _d(20), _d(300), _d(900)],
        "MARA.LVORM": ["", "", "X", "", ""], "MARA.MSTAE": ["", "", "", "", ""],
    })
    makt = pd.DataFrame({
        "MAKT.MATNR": [M1, M2, M3, M4, M5], "MAKT.SPRAS": ["E"] * 5,
        "MAKT.MAKTX": ["Gate valve DN100 PN16 cast steel", "Butterfly valve DN200 PN10",
                       "Gate valve DN150 PN16 (series 4)", "Valve gasket set DN100",
                       "OBSOLETE - globe valve DN50 PN40"],
    })
    return TableFrames({"VBAK": vbak, "VBUK": vbuk, "VBAP": vbap, "VBUP": vbup, "KNA1": kna1, "MARA": mara,
                        "MAKT": makt}, D, module="sd_sales_orders")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them (internal codes)."""
    values = {"AUART": {"TA", "SO", "FD", "KB", "KE", "RE", "G2", "L2", "CS", "AF", "AG"},
              "PSTYV": {"TAN", "TANN", "TATX", "TAS", "TAB", "TAD", "TAQ", "REN", "KBN", "KEN", "G2N", "L2N"},
              "LIFSK": {"01", "02", "03", "08", "10"}, "FAKSK": {"01", "02", "08"}}
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def test_sd_sales_orders_golden():
    static = yaml.safe_load(_find_module_yaml("sd_sales_orders").read_text())["rules"]
    results = run_checks("sd_sales_orders", _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate("sd_sales_orders", static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "SDSO010": {f"VBELN={D_VDATU}"},                         # requested delivery date missing
        "SDSO004": {f"VBELN={D_AUART}"},                         # order type ZXX1 is not in TVAK
        "SDSO035": {f"VBELN={D_QTY}|POSNR=000010"},              # negative order quantity on a standard order
        "XO2C001": {f"VBELN={D_DELCUST}"},                       # open order for a customer flagged for deletion
        "XO2C002": {f"VBELN={D_BLKCUST}"},                       # open, unblocked order for an order-blocked customer
        "SDSO034": {f"VBELN={D_OLD}"},                           # still open after 17 months
        "SDSO025": {f"VBELN={D_REJ}|POSNR=000020"},              # rejected order, item without a rejection reason
        "DO-VBAK": {f"VBELN={D_AEDAT}"},                         # changed before it was created
        "XO2C003": {f"VBELN={D_DELMAT}|POSNR=000010"},           # open item for a material flagged for deletion
        "ST-MARA": {f"MATNR={M5}"},                              # "OBSOLETE" in the description, no material status
    }, found
    # rejected items (reason for rejection set) are out of every item rule's population, counted
    deleted_mat = next(r for r in results if r.check_id == "XO2C003")
    assert deleted_mat.details["population_excluded"] == {"rejected": 3}   # O4/20 (deleted M3), O5/10, D_REJ/10
    route = next(r for r in results if r.check_id == "SDSO026")
    assert route.details["population_excluded"] == {"rejected": 3}         # O4/20, O5/10, D_REJ/10
