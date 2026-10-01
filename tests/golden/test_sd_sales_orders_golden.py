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
KPST = "0000300006"   # customer under a central posting block (not deleted)
# Materials (MATN1 internal format): M1/M2 active, M3 phased out (deleted after its last delivery),
# M4 active spare, M5 marked obsolete in its description only
M1, M2, M3, M4, M5 = (f"0000000000001002{i:02d}" for i in (31, 32, 33, 34, 35))

H = ["VBELN", "AUART", "VBTYP", "VKORG", "VTWEG", "SPART", "KUNNR", "WAERK", "NETWR", "BSTNK", "ERDAT", "ERNAM",
     "AEDAT", "VDATU", "LIFSK", "FAKSK", "GBSTK", "ABSTK"]
I = ["VBELN", "POSNR", "MATNR", "ARKTX", "PSTYV", "KWMENG", "VRKME", "NETWR", "WAERK", "WERKS", "ROUTE", "ABGRU",
     "ERDAT", "AEDAT", "MEINS", "UMVKZ", "UMVKN", "BRGEW", "NTGEW", "GEWEI", "VOLUM", "VOLEH", "GBSTA", "ABSTA"]

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
D_CUR, D_STAT, D_UNIT, D_PSTBLK = (f"00000120{i}" for i in range(20, 24))

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
    [D_CUR, "TA", "C", "1000", "10", "00", K1, "ZAR", "7300.00", "PO-45009910", _d(7), "SMOKOENA", "", _d(-5),
     "", "", "A", "A"],
    # completed at header level although item 20 is only partly delivered
    [D_STAT, "TA", "C", "1000", "10", "00", K1, "ZAR", "16500.00", "PO-45009911", _d(35), "SMOKOENA", _d(9), _d(20),
     "", "", "C", "A"],
    [D_UNIT, "TA", "C", "1000", "10", "00", K1, "ZAR", "5200.00", "PO-45009912", _d(6), "SMOKOENA", "", _d(-8),
     "", "", "A", "A"],
    [D_PSTBLK, "TA", "C", "1000", "10", "00", KPST, "ZAR", "11400.00", "PO-6610", _d(18), "TDLAMINI", "", _d(3),
     "", "", "A", "A"],
]


def _item(vbeln, posnr, matnr, arktx, kwmeng, netwr, waerk="ZAR", pstyv="TAN", abgru="", gbsta="A", absta="A",
          erdat=None, aedat="", umvkz="1"):
    head = next(h for h in HEADERS if h[0] == vbeln)
    gross = f"{abs(float(kwmeng)) * 12.5:.3f}"   # 12.5 kg gross / 11.8 kg net per valve, no volume maintained
    net = f"{abs(float(kwmeng)) * 11.8:.3f}"
    return [vbeln, posnr, matnr, arktx, pstyv, kwmeng, "ST", netwr, waerk, "1000", "R00010", abgru,
            erdat or head[10], aedat, "ST", umvkz, "1", gross, net, "KG", "0.000", "", gbsta, absta]


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
    # item in USD on a ZAR order
    _item(D_CUR, "000010", M1, "Gate valve DN100 PN16 cast steel", "4.000", "7300.00", waerk="USD"),
    _item(D_STAT, "000010", M2, "Butterfly valve DN200 PN10", "5.000", "9100.00", gbsta="C"),
    _item(D_STAT, "000020", M1, "Gate valve DN100 PN16 cast steel", "4.000", "7400.00", gbsta="B"),
    # conversion numerator 0 from an interface: every quantity converts to zero base units
    _item(D_UNIT, "000010", M2, "Butterfly valve DN200 PN10", "3.000", "5200.00", umvkz="0"),
    _item(D_PSTBLK, "000010", M1, "Gate valve DN100 PN16 cast steel", "6.000", "11400.00"),
]


# Sales conditions (KAPPL V): KONH header, KONP item 01 carries the rate, the A table holds the key.
#   PR00 price (A304 material / A305 customer-material, with release status KFRST), K004 material
#   discount (A004), K005 customer-material discount (A005)
#   clean:  M1 list price 2025 ending 20251231 and 2026 from 20260101 (adjoining, no overlap); an
#           overlapping M1 record flagged for deletion (KONP.LOEVM_KO: out of the population); customer
#           prices; a price per 10 pieces; K004 / K005 discounts per piece
#   seeded: one defect each (see the expected findings in the test)
CONDITIONS = [
    # A table, KNUMH, KSCHL, customer, material, valid from, valid to, rate, KRECH, currency, unit, KPEIN, deleted
    ("A304", "0000520001", "PR00", "", M1, "20250101", "20251231", "1890.00", "C", "ZAR", "ST", "1", ""),
    ("A304", "0000520002", "PR00", "", M1, "20260101", "99991231", "1950.00", "C", "ZAR", "ST", "1", ""),
    ("A304", "0000520003", "PR00", "", M1, "20250701", "20260630", "1920.00", "C", "ZAR", "ST", "1", "X"),
    ("A304", "0000520004", "PR00", "", M4, "20240101", "99991231", "650.00", "C", "ZAR", "ST", "10", ""),
    ("A305", "0000520005", "PR00", K1, M1, "20260101", "99991231", "1850.00", "C", "ZAR", "ST", "1", ""),
    ("A305", "0000520006", "PR00", K2, M2, "20260101", "20261231", "1820.00", "C", "EUR", "ST", "1", ""),
    ("A004", "0000520007", "K004", "", M2, "20260101", "99991231", "25.00-", "C", "ZAR", "ST", "1", ""),
    ("A005", "0000520008", "K005", K1, M2, "20260101", "20261231", "40.00-", "C", "ZAR", "ST", "1", ""),
    # seeded defects
    ("A004", "0000520010", "K004", "", M4, "20260101", "99991231", "5.00-", "C", "ZAR", "ST", "1", ""),
    ("A004", "0000520011", "K004", "", M4, "20260601", "20261231", "6.00-", "C", "ZAR", "ST", "1", ""),  # 046
    ("A005", "0000520012", "K005", K3, M1, "20260101", "20261231", "50.00-", "C", "ZAR", "ST", "1", ""),
    ("A005", "0000520013", "K005", K3, M1, "20261001", "99991231", "60.00-", "C", "ZAR", "ST", "1", ""),  # 047
    ("A304", "0000520014", "PR00", "", M2, "20260101", "99991231", "1790.00", "C", "ZAR", "ST", "1", ""),
    ("A304", "0000520015", "PR00", "", M2, "20260401", "99991231", "1840.00", "C", "ZAR", "ST", "1", ""),  # 048
    ("A305", "0000520016", "PR00", K3, M2, "20250101", "20261231", "1760.00", "C", "ZAR", "ST", "1", ""),
    ("A305", "0000520017", "PR00", K3, M2, "20260301", "20270228", "1775.00", "C", "ZAR", "ST", "1", ""),  # 049
    ("A305", "0000520018", "PR00", K1, M4, "20260901", "20260831", "640.00", "C", "ZAR", "ST", "1", ""),  # 050
    ("A305", "0000520019", "PR00", K2, M4, "20260101", "99991231", "34.50", "C", "EUR", "ST", "0", ""),  # 051
    ("A305", "0000520020", "PR00", K3, M4, "20260101", "99991231", "655.00", "C", "ZAR", "", "1", ""),  # 052
    ("A305", "0000520021", "PR00", KPST, M1, "20260101", "99991231", "1900.00", "C", "", "ST", "1", ""),  # 053
    ("A305", "0000520022", "ZPR9", K1, M2, "20260101", "99991231", "1810.00", "C", "ZAR", "ST", "1", ""),  # 054
]


def _conditions() -> dict[str, pd.DataFrame]:
    konh, konp, atab = [], [], {"A004": [], "A005": [], "A304": [], "A305": []}
    for a, knumh, kschl, kunnr, matnr, datab, datbi, kbetr, krech, konwa, kmein, kpein, loevm in CONDITIONS:
        konh.append({"KONH.KNUMH": knumh, "KONH.ERNAM": "PRC_NZULU", "KONH.ERDAT": "20241120", "KONH.KVEWE": "A",
                     "KONH.KOTABNR": a[1:], "KONH.KAPPL": "V", "KONH.KSCHL": kschl, "KONH.DATAB": datab,
                     "KONH.DATBI": datbi})
        konp.append({"KONP.KNUMH": knumh, "KONP.KOPOS": "01", "KONP.KAPPL": "V", "KONP.KSCHL": kschl,
                     "KONP.KRECH": krech, "KONP.KBETR": kbetr, "KONP.KONWA": konwa, "KONP.KPEIN": kpein,
                     "KONP.KMEIN": kmein, "KONP.LOEVM_KO": loevm})
        row = {"KAPPL": "V", "KSCHL": kschl, "VKORG": "1000", "VTWEG": "10", "KUNNR": kunnr, "MATNR": matnr,
               "KFRST": "", "DATBI": datbi, "DATAB": datab, "KNUMH": knumh}
        if a in ("A004", "A304"):
            del row["KUNNR"]
        if a in ("A004", "A005"):
            del row["KFRST"]
        atab[a].append({f"{a}.{k}": v for k, v in row.items()})
    return {"KONH": pd.DataFrame(konh), "KONP": pd.DataFrame(konp), **{a: pd.DataFrame(r) for a, r in atab.items()}}


def _frames() -> TableFrames:
    hdr = pd.DataFrame(HEADERS, columns=H)
    itm = pd.DataFrame(ITEMS, columns=I)
    vbak = hdr.drop(columns=["GBSTK", "ABSTK"]).add_prefix("VBAK.")
    for c in ("ANGDT", "BNDDT", "GUEBG", "GUEEN"):   # sales orders: no quotation / contract validity
        vbak[f"VBAK.{c}"] = "00000000"
    vbuk = hdr[["VBELN", "GBSTK", "ABSTK"]].add_prefix("VBUK.")
    vbap = itm.drop(columns=["GBSTA", "ABSTA"]).add_prefix("VBAP.")
    vbup = itm[["VBELN", "POSNR", "GBSTA", "ABSTA"]].add_prefix("VBUP.")

    cust = [K1, K2, K3, KBLK, KDEL, KPST]
    kna1 = pd.DataFrame({
        "KNA1.KUNNR": cust,
        "KNA1.NAME1": ["Sasolburg Valve Services (Pty) Ltd", "Weber Antriebstechnik GmbH",
                       "Rustenburg Platinum Engineering (Pty) Ltd", "Highveld Pipe Supplies (Pty) Ltd",
                       "Witbank Fluid Controls CC", "Durban Process Pumps (Pty) Ltd"],
        "KNA1.NAME2": [""] * 6, "KNA1.NAME3": [""] * 6, "KNA1.NAME4": [""] * 6,
        "KNA1.PSON1": [""] * 6, "KNA1.PSON2": [""] * 6, "KNA1.PSON3": [""] * 6,
        "KNA1.STRAS": ["8 Fichardt Street", "Industriestraße 27", "14 Bosch Street", "77 Voortrekker Road",
                       "3 Mandela Street", "41 Umgeni Road"],
        "KNA1.ORT01": ["Sasolburg", "Mannheim", "Rustenburg", "Witbank", "Emalahleni", "Durban"],
        "KNA1.ORT02": [""] * 6, "KNA1.PFORT": [""] * 6, "KNA1.PSTL2": [""] * 6,
        "KNA1.PSTLZ": ["1947", "68219", "0299", "1035", "1034", "4001"],
        "KNA1.LAND1": ["ZA", "DE", "ZA", "ZA", "ZA", "ZA"],
        "KNA1.STCD1": ["4230118876", "", "4510127793", "4680139904", "4170182235", "4390151176"],
        "KNA1.STCD2": [""] * 6, "KNA1.STCD3": [""] * 6, "KNA1.STCD4": [""] * 6,
        "KNA1.STCEG": ["", "DE136695976", "", "", "", ""],
        "KNA1.TELF1": ["0169734400", "+49 621 8774 0", "0145921100", "0136562000", "0136904400", "0313098800"],
        "KNA1.TELF2": [""] * 6, "KNA1.TELFX": [""] * 6, "KNA1.KNURL": [""] * 6,
        "KNA1.ERDAT": ["20180919", "20140310", "20160502", "20150811", "20100128", "20170606"],
        "KNA1.LOEVM": ["", "", "", "", "X", ""],
        "KNA1.SPERR": ["", "", "", "", "X", "X"],
        "KNA1.AUFSD": ["", "", "01", "01", "", ""],
        "KNA1.CASSD": [""] * 6,
        "KNA1.XCPDK": [""] * 6,
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
                        "MAKT": makt, **_conditions()}, D, module="sd_sales_orders")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them (internal codes)."""
    values = {"AUART": {"TA", "SO", "FD", "KB", "KE", "RE", "G2", "L2", "CS", "AF", "AG"},
              "PSTYV": {"TAN", "TANN", "TATX", "TAS", "TAB", "TAD", "TAQ", "REN", "KBN", "KEN", "G2N", "L2N"},
              "LIFSK": {"01", "02", "03", "08", "10"}, "FAKSK": {"01", "02", "08"},
              "KSCHL": {"PR00", "PR01", "K004", "K005", "K007", "K020", "KF00", "HA00", "HB00", "RB00", "SKTO",
                        "MWST", "VPRS"}}                             # T685 (condition types)
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
        "SDSO036": {f"VBELN={D_CUR}|POSNR=000010"},              # USD item on a ZAR order
        "SDSO037": {f"VBELN={D_STAT}|POSNR=000020"},             # open item under a completed header
        "SDSO041": {f"VBELN={D_UNIT}|POSNR=000010"},             # sales-to-base unit numerator 0
        "SDSO045": {f"VBELN={D_PSTBLK}"},                        # open order, customer blocked for posting
        "ST-MARA": {f"MATNR={M5}"},                              # "OBSOLETE" in the description, no material status
        # overlapping validity for one condition key: the later of the two records is found
        "SDSO046": {f"KAPPL=V|KSCHL=K004|VKORG=1000|VTWEG=10|MATNR={M4}|DATBI=20261231"},
        "SDSO047": {f"KAPPL=V|KSCHL=K005|VKORG=1000|VTWEG=10|KUNNR={K3}|MATNR={M1}|DATBI=99991231"},
        "SDSO048": {f"KAPPL=V|KSCHL=PR00|VKORG=1000|VTWEG=10|MATNR={M2}|KFRST=|DATBI=99991231"},
        "SDSO049": {f"KAPPL=V|KSCHL=PR00|VKORG=1000|VTWEG=10|KUNNR={K3}|MATNR={M2}|KFRST=|DATBI=20270228"},
        "SDSO050": {"KNUMH=0000520018"},                         # valid 20260901 to 20260831
        "SDSO051": {"KNUMH=0000520019"},                         # price per 0 pieces
        "SDSO052": {"KNUMH=0000520020"},                         # quantity-based price without a unit
        "SDSO053": {"KNUMH=0000520021"},                         # price without a currency
        "SDSO054": {"KNUMH=0000520022"},                         # ZPR9 is not in T685
    }, found
    # rejected items (reason for rejection set) are out of every item rule's population, counted
    deleted_mat = next(r for r in results if r.check_id == "XO2C003")
    assert deleted_mat.details["population_excluded"] == {"rejected": 3}   # O4/20 (deleted M3), O5/10, D_REJ/10
    route = next(r for r in results if r.check_id == "SDSO026")
    assert route.details["population_excluded"] == {"rejected": 3}         # O4/20, O5/10, D_REJ/10
    # M1's 2025 and 2026 list prices adjoin (20251231 / 20260101): judged, no overlap; the record flagged for
    # deletion overlapping both is out of the population, counted
    price = next(r for r in results if r.check_id == "SDSO048")
    assert (price.total_count, price.details["population_excluded"]) == (5, {"deleted": 1})
    header = next(r for r in results if r.check_id == "SDSO054")
    assert (header.total_count, header.details["population_excluded"]) == (20, {"deleted": 1})
