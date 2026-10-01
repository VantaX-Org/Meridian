"""Golden dataset: the whole purchasing pipeline (shipped + generated rules,
active population, joins to vendor and material masters, live configuration)
on purchasing documents whose correct findings are known. Clean documents must
produce no finding at all — any failure on them is a false positive; each
seeded defect must be found exactly where it was put.

Clean documents (a senior MM consultant would sign them off):
  4500012001  NB  steel bar for stock + cost-centre consumables without material
  4500012002  NB  seal kits from a German supplier, EUR, released (release strategy)
  4500012003  UB  stock transport order 1000 → 1100: supplying plant, no vendor, no payment terms
  4500012004  NB  bearings, open; item 00020 deleted in the live PO (out of the population) after its
                  goods receipt was reversed (102): its GR/IR nets to zero
  4500011500  NB  delivered and invoiced long ago (completed: no longer "open"); PO history nets a return
                  delivery (122, SHKZG H) and its replacement: received 100 = invoiced 100; a freight
                  subsequent debit (VGABE 3) is not an invoiced quantity
  5500000101  LP  scheduling agreement signed 20 months ago, valid until next year
  4600000201  MK  cross-plant quantity contract signed two years ago, valid three years
One seeded defect each:
  4500012010  purchasing group blank                              PUR007  null
  4500012011  account assignment category Z not in T163K          PUR019  domain (live config)
  4500012012  negative net price (RFC "86.40-")                    PUR044  cross-field
  4500012013  open item on a vendor blocked for purchasing         XP2P005 cross-object (EKPO → LFA1)
  4500012015  open item on a material deleted at its plant         XP2P006 cross-object (EKPO → MARC)
  vendor 0000100050  phone 0000000000                              PH-LFA1-TELF1 generated (placeholder)
  4500012016  GR-based invoice verification without goods receipt  PUR057  indicator combination
  4600000202  contract valid to a date before it is valid from      PUR048  date range
  4500012017  open item, vendor blocked in purchasing org (LFM1)    PUR063  cross-object (EKPO → LFM1)
  info record 5300000003 / 1000  price unit 0                       PUR080  cross-field (EINE)
  source list 300010 / 1000 / 00002  valid to before valid from     PUR084  date range (EORD)
  4500011510  final invoice for 80 of 100 received                     PUR117  aggregate (EKBE GR vs IR)
  4500011511  delivery complete at 380 kg, 400 kg invoiced            PUR118  aggregate (EKBE GR vs IR)
  4500012004/00030  deleted after its goods receipt, never invoiced   PUR119  aggregate (EKBE GR vs IR)
Logistics invoices (RBKP), clean: an invoice and the credit memo returning it under the same reference
(a credit memo is no duplicate invoice), an invoice reversed (MR8M) and entered again; seeded:
  5105600310 / 5105600311  'RD-2026/0815' and 'RD 2026 0815', EUR 3 260.15  PUR120  uniqueness (alnum)
  5105600312  invoice dated ten days after it was posted               PUR121  cross-field
  5105600313  reversal document without its fiscal year               PUR122  cross-field
Purchasing conditions (KONH / KONP / A017 / A018, KAPPL M), clean: PB00 prices with adjoining validity
(20251231 → 20260101), an overlapping record flagged for deletion (KONP.LOEVM_KO, out of the population),
a price per 100 pieces with a percentage discount and a fixed freight as supplements (KOPOS 02/03); seeded:
  A017 bearings / 1000 / 1000  two open-ended records overlap          PUR123  interval
  A018 bar / steel              2024–2026 record overlaps 2026–9999    PUR124  interval
  0000412014  valid to before valid from                              PUR125  cross-field
  0000412015  quantity-based price with pricing unit 0                PUR126  cross-field
  0000412016  quantity-based price without a condition unit           PUR127  cross-field
  0000412017  amount without a currency                               PUR128  cross-field
  0000412018  condition type ZPB9 not in T685                         PUR129  referential (live config)
Population:
  4500011990  PO flagged for deletion (LOEKZ L) — and incomplete: excluded, counted
"""

from datetime import date, timedelta

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def _ago(days: int) -> str:
    return (date.today() - timedelta(days=days)).strftime("%Y%m%d")  # DATS


def _m(n: int) -> str:
    return f"{n:018d}"  # MATN1 internal format


def _table(name: str, rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame([{f"{name}.{k}": v for k, v in r.items()} for r in rows])


def _ekko(ebeln, bsart, lifnr, waers, zterm, bedat, bstyp="F", inco1="FCA", inco2="Johannesburg", ekgrp="001",
          reswk="", frggr="", frgsx="", frgke="", frgzu="", kdatb="", kdate="", loekz="") -> dict:
    return {"EBELN": ebeln, "BUKRS": "1000", "BSTYP": bstyp, "BSART": bsart, "LOEKZ": loekz, "AEDAT": bedat,
            "ERNAM": "BUY_TMOKOENA", "LIFNR": lifnr, "ZTERM": zterm, "EKORG": "1000", "EKGRP": ekgrp,
            "WAERS": waers, "BEDAT": bedat, "INCO1": inco1, "INCO2": inco2 if inco1 else "", "RESWK": reswk,
            "FRGGR": frggr, "FRGSX": frgsx, "FRGKE": frgke, "FRGZU": frgzu, "STCEG": "", "KDATB": kdatb,
            "KDATE": kdate}


def _ekpo(ebeln, ebelp, txz01, matnr, werks, matkl, menge, meins, netpr, netwr, pstyp="0", knttp="",
          elikz="", erekz="", wepos="X", repos="X", loekz="", ktmng="0.000", webre="") -> dict:
    return {"EBELN": ebeln, "EBELP": ebelp, "LOEKZ": loekz, "TXZ01": txz01, "MATNR": matnr, "WERKS": werks,
            "LGORT": "0001" if werks and not knttp else "", "MATKL": matkl, "MENGE": menge, "MEINS": meins,
            "BPRME": meins, "NETPR": netpr, "PEINH": "1", "NETWR": netwr, "PSTYP": pstyp, "KNTTP": knttp,
            "ELIKZ": elikz, "EREKZ": erekz, "WEPOS": wepos, "REPOS": repos, "KTMNG": ktmng, "WEBRE": webre,
            "LMEIN": meins, "UMREZ": "1", "UMREN": "1", "BPUMZ": "1", "BPUMN": "1"}


def _frames() -> TableFrames:
    steel, metals, bearings, castings, umgeni = "0000100010", "0000100020", "0000100030", "0000100040", "0000100050"
    lfa1 = _table("LFA1", [
        {"LIFNR": steel, "NAME1": "Steelmet Distributors (Pty) Ltd", "NAME2": "", "SORTL": "STEELMET",
         "STRAS": "14 Electron Ave", "ORT01": "Isando", "PSTLZ": "1600", "LAND1": "ZA", "TELF1": "0119745500",
         "TELFX": "", "STCD1": "9301234567", "STCEG": "", "LFURL": "www.steelmet.co.za", "ERDAT": "20150310",
         "LOEVM": "", "SPERR": "", "SPERM": "", "KTOKK": "KRED", "ADRNR": "0000041001"},
        {"LIFNR": metals, "NAME1": "Rheintal Dichtungstechnik GmbH", "NAME2": "", "SORTL": "RHEINTAL",
         "STRAS": "Hafenstr. 21", "ORT01": "Mannheim", "PSTLZ": "68159", "LAND1": "DE", "TELF1": "+49 621 4390",
         "TELFX": "+49 621 4391", "STCD1": "", "STCEG": "DE136695976", "LFURL": "", "ERDAT": "20170622",
         "LOEVM": "", "SPERR": "", "SPERM": "", "KTOKK": "KRED", "ADRNR": "0000041002"},
        {"LIFNR": bearings, "NAME1": "Highveld Bearing Supplies (Pty) Ltd", "NAME2": "", "SORTL": "HIGHVELD",
         "STRAS": "7 Bessemer St", "ORT01": "Germiston", "PSTLZ": "1401", "LAND1": "ZA", "TELF1": "0118251200",
         "TELFX": "", "STCD1": "9187654321", "STCEG": "", "LFURL": "", "ERDAT": "20180905",
         "LOEVM": "", "SPERR": "", "SPERM": "", "KTOKK": "KRED", "ADRNR": "0000041003"},
        # blocked for purchasing after a quality dispute — an open PO is still on it (seeded defect)
        {"LIFNR": castings, "NAME1": "Karoo Castings CC", "NAME2": "", "SORTL": "KAROO",
         "STRAS": "3 Foundry Rd", "ORT01": "Vereeniging", "PSTLZ": "1930", "LAND1": "ZA", "TELF1": "0164553300",
         "TELFX": "", "STCD1": "9055512345", "STCEG": "", "LFURL": "", "ERDAT": "20190114",
         "LOEVM": "", "SPERR": "", "SPERM": "X", "KTOKK": "KRED", "ADRNR": "0000041004"},
        # placeholder phone number (seeded defect)
        {"LIFNR": umgeni, "NAME1": "Umgeni Engineering Supplies", "NAME2": "", "SORTL": "UMGENI",
         "STRAS": "88 Umgeni Rd", "ORT01": "Durban", "PSTLZ": "4001", "LAND1": "ZA", "TELF1": "0000000000",
         "TELFX": "", "STCD1": "9244467890", "STCEG": "", "LFURL": "", "ERDAT": "20210301",
         "LOEVM": "", "SPERR": "", "SPERM": "", "KTOKK": "KRED", "ADRNR": "0000041005"},
    ])
    for f in ("NAME3", "NAME4", "ORT02", "PSTL2", "PFACH", "PFORT", "TELF2", "STCD2", "STCD3", "STCD4"):
        lfa1[f"LFA1.{f}"] = ""  # read by the generated rules; not used by these vendors
    lfm1 = _table("LFM1", [
        {"LIFNR": v, "EKORG": "1000", "ERDAT": e, "ERNAM": "MDM_JNAIDOO", "SPERM": "", "LOEVM": "", "WAERS": w,
         "ZTERM": z, "INCO1": "FCA", "INCO2": c, "WEBRE": "X"}
        for v, e, w, z, c in [(steel, "20150310", "ZAR", "0001", "Johannesburg"),
                              (metals, "20170622", "EUR", "0002", "Mannheim"),
                              (bearings, "20180905", "ZAR", "0001", "Germiston"),
                              (castings, "20190114", "ZAR", "0001", "Vereeniging"),
                              (umgeni, "20210301", "ZAR", "0001", "Durban")]
    ])
    lfm1.loc[lfm1["LFM1.LIFNR"] == umgeni, "LFM1.SPERM"] = "X"
    bar, seal, bearing, pump, plate = _m(300010), _m(400200), _m(500075), _m(100100), _m(300040)
    mara = _table("MARA", [
        {"MATNR": m, "MTART": t, "MATKL": g, "MEINS": u, "ERSDA": "20190312", "LAEDA": "20240611", "LVORM": "",
         "MSTAE": ""}
        for m, t, g, u in [(bar, "ROH", "STEEL", "KG"), (seal, "HAWA", "SEALS", "ST"),
                           (bearing, "ERSA", "BEARINGS", "ST"), (pump, "FERT", "PUMPS", "ST"),
                           (plate, "ROH", "STEEL", "KG")]
    ])
    makt = _table("MAKT", [{"MATNR": m, "SPRAS": "E", "MAKTX": t} for m, t in [
        (bar, "Round bar 316L 50mm"), (seal, "Mechanical seal kit MG1 35mm"),
        (bearing, "Deep groove ball bearing 6205-2RSH"), (pump, "Centrifugal pump CP-200 stainless"),
        (plate, "Plate 316L 12mm")]])
    marc = _table("MARC", [{"MATNR": m, "WERKS": w, "LVORM": x} for m, w, x in [
        (bar, "1000", ""), (seal, "1000", ""), (bearing, "1000", ""), (pump, "1000", ""), (pump, "1100", ""),
        (plate, "1000", "X"),  # plant 1000 stopped stocking the 12 mm plate — an open PO item remains
    ]])

    recent, older = _ago(12), _ago(40)
    ekko = _table("EKKO", [
        _ekko("4500012001", "NB", steel, "ZAR", "0001", recent),
        _ekko("4500012002", "NB", metals, "EUR", "0002", older, inco2="Mannheim",
              frggr="01", frgsx="Z1", frgke="R", frgzu="XX"),
        _ekko("4500012003", "UB", "", "ZAR", "", recent, inco1="", reswk="1000"),
        _ekko("4500012004", "NB", bearings, "ZAR", "0001", recent, inco2="Germiston"),
        _ekko("4500011500", "NB", bearings, "ZAR", "0001", _ago(500), inco2="Germiston"),
        _ekko("5500000101", "LP", steel, "ZAR", "0001", _ago(600), bstyp="L", kdatb=_ago(600), kdate=_ago(-365)),
        _ekko("4600000201", "MK", bearings, "ZAR", "0001", _ago(730), bstyp="K", inco2="Germiston",
              kdatb=_ago(730), kdate=_ago(-365)),
        # seeded defects — one each
        _ekko("4500012010", "NB", steel, "ZAR", "0001", recent, ekgrp=""),
        _ekko("4500012011", "NB", metals, "EUR", "0002", recent, inco2="Mannheim"),
        _ekko("4500012012", "NB", bearings, "ZAR", "0001", recent, inco2="Germiston"),
        _ekko("4500012013", "NB", castings, "ZAR", "0001", older, inco2="Vereeniging"),
        _ekko("4500012015", "NB", steel, "ZAR", "0001", older),
        _ekko("4500012016", "NB", steel, "ZAR", "0001", recent),
        _ekko("4600000202", "MK", bearings, "ZAR", "0001", _ago(30), bstyp="K", inco2="Germiston",
              kdatb=_ago(30), kdate=_ago(60)),
        _ekko("4500012017", "NB", umgeni, "ZAR", "0001", recent, inco2="Durban"),
        _ekko("4500011510", "NB", bearings, "ZAR", "0001", _ago(200), inco2="Germiston"),
        _ekko("4500011511", "NB", steel, "ZAR", "0001", _ago(90)),
        # flagged for deletion — and incomplete (no purchasing group): out of the population
        _ekko("4500011990", "NB", steel, "ZAR", "0001", older, ekgrp="", loekz="L"),
    ])
    ekpo = _table("EKPO", [
        _ekpo("4500012001", "00010", "Round bar 316L 50mm", bar, "1000", "STEEL", "500.000", "KG", "62.50",
              "31250.00"),
        _ekpo("4500012001", "00020", "Safety gloves nitrile size 9", "", "1000", "SAFETY", "200.000", "PAA",
              "18.90", "3780.00", knttp="K"),
        _ekpo("4500012002", "00010", "Mechanical seal kit MG1 35mm", seal, "1000", "SEALS", "40.000", "ST",
              "68.50", "2740.00"),
        _ekpo("4500012003", "00010", "Centrifugal pump CP-200 stainless", pump, "1100", "PUMPS", "4.000", "ST",
              "18450.00", "73800.00", pstyp="7", repos=""),
        _ekpo("4500012004", "00010", "Deep groove ball bearing 6205-2RSH", bearing, "1000", "BEARINGS",
              "100.000", "ST", "86.40", "8640.00"),
        _ekpo("4500012004", "00020", "", bearing, "1000", "", "50.000", "ST", "86.40", "4320.00",
              loekz="L"),  # goods receipt reversed, then deleted: out of the population
        _ekpo("4500012004", "00030", "Deep groove ball bearing 6205-2RSH", bearing, "1000", "BEARINGS",
              "30.000", "ST", "86.40", "2592.00", loekz="L"),  # deleted after its goods receipt, never invoiced
        _ekpo("4500011500", "00010", "Deep groove ball bearing 6205-2RSH", bearing, "1000", "BEARINGS",
              "100.000", "ST", "84.10", "8410.00", elikz="X", erekz="X"),
        _ekpo("5500000101", "00010", "Round bar 316L 50mm", bar, "1000", "STEEL", "12000.000", "KG", "61.00",
              "732000.00", ktmng="12000.000"),
        _ekpo("4600000201", "00010", "Deep groove ball bearing 6205-2RSH", bearing, "", "BEARINGS", "0.000",
              "ST", "82.00", "164000.00", ktmng="2000.000"),  # cross-plant contract: no plant
        _ekpo("4500012010", "00010", "Round bar 316L 50mm", bar, "1000", "STEEL", "250.000", "KG", "62.50",
              "15625.00"),
        _ekpo("4500012011", "00010", "Mechanical seal kit MG1 35mm", seal, "1000", "SEALS", "10.000", "ST",
              "68.50", "685.00", knttp="Z"),
        _ekpo("4500012012", "00010", "Deep groove ball bearing 6205-2RSH", bearing, "1000", "BEARINGS",
              "20.000", "ST", "86.40-", "1728.00-"),
        _ekpo("4500012013", "00010", "Impeller casting CP-300", "", "1000", "CASTINGS", "12.000", "ST",
              "2150.00", "25800.00", knttp="F"),
        _ekpo("4500012015", "00010", "Plate 316L 12mm", plate, "1000", "STEEL", "800.000", "KG", "71.20",
              "56960.00"),
        _ekpo("4500012016", "00010", "Round bar 316L 50mm", bar, "1000", "STEEL", "400.000", "KG", "62.50",
              "25000.00", wepos="", webre="X"),  # GR-based IV without goods receipt
        _ekpo("4600000202", "00010", "Deep groove ball bearing 6205-2RSH", bearing, "", "BEARINGS", "0.000",
              "ST", "81.50", "81500.00", ktmng="1000.000"),  # contract valid to before valid from
        _ekpo("4500012017", "00010", "Mechanical seal kit MG1 35mm", seal, "1000", "SEALS", "20.000", "ST",
              "69.00", "1380.00"),  # open, vendor blocked in purchasing org 1000
        _ekpo("4500011990", "00010", "Round bar 316L 50mm", bar, "1000", "", "300.000", "KG", "62.50",
              "18750.00", loekz="L"),
        _ekpo("4500011510", "00010", "Deep groove ball bearing 6205-2RSH", bearing, "1000", "BEARINGS",
              "100.000", "ST", "85.20", "8520.00", elikz="X", erekz="X"),  # final invoice for 80 of 100
        _ekpo("4500011511", "00010", "Round bar 316L 50mm", bar, "1000", "STEEL", "400.000", "KG", "62.50",
              "25000.00", elikz="X"),  # delivery completed at 380 kg, invoiced 400 kg
    ])
    # purchasing info records: 5300000003 / 1000 has price unit 0 (defect)
    eina = _table("EINA", [
        {"INFNR": i, "MATNR": m, "MATKL": g, "LIFNR": v, "LOEKZ": "", "ERDAT": "20200115", "ERNAM": "BUY_TMOKOENA",
         "TXZ01": "", "MEINS": u, "LMEIN": u, "UMREZ": "1", "UMREN": "1", "IDNLF": idn, "LIFAB": "", "LIFBI": ""}
        for i, m, g, v, u, idn in [("5300000001", bar, "STEEL", steel, "KG", "SM-316L-50"),
                                   ("5300000002", seal, "SEALS", metals, "ST", "MG1-35-G60"),
                                   ("5300000003", bearing, "BEARINGS", bearings, "ST", "6205-2RSH-C3")]
    ])
    eine = _table("EINE", [
        {"INFNR": i, "EKORG": "1000", "ESOKZ": "0", "WERKS": "", "LOEKZ": "", "ERDAT": "20200115",
         "ERNAM": "BUY_TMOKOENA", "EKGRP": "001", "WAERS": w, "MINBM": "0.000", "NORBM": "1.000", "APLFZ": d,
         "NETPR": p, "PEINH": pe, "BPRME": u, "BPUMZ": "1", "BPUMN": "1", "BSTMA": "0.000", "INCO1": "FCA",
         "INCO2": c, "MWSKZ": "V1"}
        for i, w, d, p, pe, u, c in [("5300000001", "ZAR", "21", "62.50", "1", "KG", "Johannesburg"),
                                     ("5300000002", "EUR", "28", "68.50", "1", "ST", "Mannheim"),
                                     ("5300000003", "ZAR", "10", "86.40", "0", "ST", "Germiston")]
    ])
    # source list: bar 1000 has a record valid to a date before it is valid from (defect)
    eord = _table("EORD", [
        {"MATNR": m, "WERKS": "1000", "ZEORD": z, "ERDAT": "20200115", "ERNAM": "BUY_TMOKOENA", "VDATU": f,
         "BDATU": t, "LIFNR": v, "FLIFN": fx, "EBELN": a, "EBELP": ap, "FEBEL": "", "RESWK": "", "NOTKZ": "",
         "EKORG": "1000", "AUTET": "1"}
        for m, z, f, t, v, fx, a, ap in [(seal, "00001", "20200115", "99991231", metals, "X", "", "00000"),
                                         (bar, "00001", "20200115", "99991231", steel, "", "5500000101", "00010"),
                                         (bearing, "00001", "20200115", "99991231", bearings, "X", "", "00000"),
                                         (bar, "00002", "20250101", "20241231", umgeni, "", "", "00000")]
    ])
    # PO history: goods receipts (VGABE 1, BEWTP E), invoices (VGABE 2, BEWTP Q), subsequent debits (VGABE 3);
    # SHKZG S adds, H subtracts (return delivery 122, GR reversal 102, credit memo)
    def hist(ebeln, ebelp, vgabe, belnr, buzei, bwart, menge, shkzg, days, dmbtr, matnr):
        return {"EBELN": ebeln, "EBELP": ebelp, "ZEKKN": "00", "VGABE": vgabe, "GJAHR": _ago(days)[:4],
                "BELNR": belnr, "BUZEI": buzei, "BEWTP": {"1": "E", "2": "Q", "3": "N"}[vgabe], "BWART": bwart,
                "BUDAT": _ago(days), "MENGE": menge, "DMBTR": dmbtr, "WRBTR": dmbtr, "WAERS": "ZAR",
                "SHKZG": shkzg, "MATNR": matnr, "WERKS": "1000", "CPUDT": _ago(days), "ERNAM": "WH_SNDLOVU"}
    ekbe = _table("EKBE", [
        # completed: 100 received, 10 returned damaged, 10 replaced; 100 invoiced; freight subsequent debit
        hist("4500011500", "00010", "1", "5000081001", "0001", "101", "100.000", "S", 480, "8410.00", bearing),
        hist("4500011500", "00010", "1", "5000081044", "0001", "122", "10.000", "H", 476, "841.00", bearing),
        hist("4500011500", "00010", "1", "5000081090", "0001", "101", "10.000", "S", 470, "841.00", bearing),
        hist("4500011500", "00010", "2", "5105600101", "0001", "", "100.000", "S", 465, "8410.00", bearing),
        hist("4500011500", "00010", "3", "5105600140", "0001", "", "100.000", "S", 450, "350.00", bearing),
        # open, partly received and invoiced: neither delivery-complete nor finally invoiced
        hist("4500012001", "00010", "1", "5000093002", "0001", "101", "300.000", "S", 8, "18750.00", bar),
        hist("4500012001", "00010", "2", "5105600220", "0001", "", "200.000", "S", 3, "12500.00", bar),
        # deleted item whose goods receipt was reversed (102) before deletion: nothing left on GR/IR
        hist("4500012004", "00020", "1", "5000093011", "0001", "101", "50.000", "S", 10, "4320.00", bearing),
        hist("4500012004", "00020", "1", "5000093015", "0001", "102", "50.000", "H", 9, "4320.00", bearing),
        # seeded defects
        hist("4500011510", "00010", "1", "5000088020", "0001", "101", "100.000", "S", 190, "8520.00", bearing),
        hist("4500011510", "00010", "2", "5105600160", "0001", "", "80.000", "S", 180, "6816.00", bearing),
        hist("4500011511", "00010", "1", "5000091230", "0001", "101", "380.000", "S", 80, "23750.00", bar),
        hist("4500011511", "00010", "2", "5105600190", "0001", "", "400.000", "S", 75, "25000.00", bar),
        hist("4500012004", "00030", "1", "5000093012", "0001", "101", "30.000", "S", 10, "2592.00", bearing),
    ])
    # logistics invoices (MIRO): RBSTAT 5 posted; XRECH X invoice, blank credit memo; STBLG/STJAH reversal
    def inv(belnr, lifnr, xblnr, rmwwr, waers="ZAR", xrech="X", bldat=None, budat=None, stblg="", stjah="",
            rbstat="5"):
        return {"BELNR": belnr, "GJAHR": "2026", "BLART": "RE", "BLDAT": bldat or "20260910",
                "BUDAT": budat or "20260914", "USNAM": "AP_LMOLOI", "TCODE": "MIRO", "VGART": "RD", "XBLNR": xblnr,
                "BUKRS": "1000", "LIFNR": lifnr, "WAERS": waers, "RMWWR": rmwwr, "ZTERM": "0001", "XRECH": xrech,
                "STBLG": stblg, "STJAH": stjah, "IVTYP": "", "RBSTAT": rbstat}
    rbkp = _table("RBKP", [
        inv("5105600301", steel, "SM-INV-44120", "35937.50"),
        # credit memo returning the whole of SM-INV-44120 under the same reference: not a duplicate invoice
        inv("5105600302", steel, "SM-INV-44120", "35937.50", xrech=""),
        # entered with the wrong tax code, reversed (MR8M) and entered again: one live invoice
        inv("5105600303", bearings, "HB/26/1187", "9936.00", stblg="5105600304", stjah="2026"),
        inv("5105600304", bearings, "HB/26/1187", "9936.00", xrech="", stblg="5105600303", stjah="2026",
            budat="20260915"),
        inv("5105600305", bearings, "HB/26/1187", "9936.00", budat="20260915"),
        inv("5105600306", metals, "RD-2026/0790", "3150.40", waers="EUR", bldat="20260914"),  # dated = posted
        # seeded defects
        inv("5105600310", metals, "RD-2026/0815", "3260.15", waers="EUR"),             # PUR120
        inv("5105600311", metals, "RD 2026 0815", "3260.15", waers="EUR", budat="20260921"),  # PUR120
        inv("5105600312", steel, "SM-INV-44388", "18400.00", bldat="20260924"),       # PUR121
        inv("5105600313", bearings, "HB/26/1201", "4320.00", stblg="5105600314"),     # PUR122
    ])
    # purchasing conditions (KAPPL M): PB00 gross price in info records, per plant (A017) or not (A018);
    # info-record supplements (discount RA01, freight FRB1) are further KONP items of the same record
    def cond(knumh, kschl, datab, datbi, kbetr, krech="C", konwa="ZAR", kpein="1", kmein="ST", loevm=""):
        konh = {"KNUMH": knumh, "ERNAM": "BUY_TMOKOENA", "ERDAT": "20231115", "KVEWE": "A",
                "KOTABNR": "017", "KAPPL": "M", "KSCHL": kschl, "DATAB": datab, "DATBI": datbi}
        konp = {"KNUMH": knumh, "KOPOS": "01", "KAPPL": "M", "KSCHL": kschl, "KRECH": krech, "KBETR": kbetr,
                "KONWA": konwa, "KPEIN": kpein, "KMEIN": kmein, "LOEVM_KO": loevm}
        return konh, konp
    conds = [  # (A table, vendor, material, plant, record)
        ("A017", steel, bar, "1000", cond("0000412001", "PB00", "20240101", "20251231", "59.80", kmein="KG")),
        ("A017", steel, bar, "1000", cond("0000412002", "PB00", "20260101", "99991231", "62.50", kmein="KG")),
        # overlapping both, but flagged for deletion: pricing ignores it
        ("A017", steel, bar, "1000", cond("0000412003", "PB00", "20250601", "20261231", "61.00", kmein="KG",
                                          loevm="X")),
        ("A018", metals, seal, "", cond("0000412004", "PB00", "20200115", "99991231", "68.50", konwa="EUR")),
        ("A018", bearings, bearing, "", cond("0000412005", "PB00", "20240101", "99991231", "8640.00",
                                             kpein="100")),
        # seeded defects
        ("A017", bearings, bearing, "1000", cond("0000412010", "PB00", "20250101", "99991231", "86.40")),
        ("A017", bearings, bearing, "1000", cond("0000412011", "PB00", "20260301", "99991231", "84.90")),  # PUR123
        ("A018", steel, bar, "", cond("0000412012", "PB00", "20240101", "20261231", "61.40", kmein="KG")),
        ("A018", steel, bar, "", cond("0000412013", "PB00", "20260601", "99991231", "62.10", kmein="KG")),  # PUR124
        ("A018", umgeni, seal, "", cond("0000412014", "PB00", "20260901", "20260831", "69.00")),           # PUR125
        ("A018", umgeni, bearing, "", cond("0000412015", "PB00", "20260101", "99991231", "87.00", kpein="0")),  # 126
        ("A018", umgeni, pump, "", cond("0000412016", "PB00", "20260101", "99991231", "18450.00", kmein="")),  # 127
        ("A018", umgeni, plate, "", cond("0000412017", "PB00", "20260101", "99991231", "71.20", konwa="",
                                         kmein="KG")),                                                      # 128
        ("A018", castings, bearing, "", cond("0000412018", "ZPB9", "20260101", "99991231", "85.00")),      # 129
    ]
    konh = _table("KONH", [{**c[0], "KOTABNR": a[1:]} for a, _, _, _, c in conds])
    konp = _table("KONP", [c[1] for *_, c in conds] + [
        # supplements of 0000412005: 2% discount and a fixed freight amount — KOPOS 01 carries the price
        {"KNUMH": "0000412005", "KOPOS": "02", "KAPPL": "M", "KSCHL": "RA01", "KRECH": "A", "KBETR": "20.000-",
         "KONWA": "%", "KPEIN": "0", "KMEIN": "", "LOEVM_KO": ""},
        {"KNUMH": "0000412005", "KOPOS": "03", "KAPPL": "M", "KSCHL": "FRB1", "KRECH": "B", "KBETR": "150.00",
         "KONWA": "ZAR", "KPEIN": "0", "KMEIN": "", "LOEVM_KO": ""},
    ])
    key = lambda a, v, m, w, c: {"KAPPL": "M", "KSCHL": c[0]["KSCHL"], "LIFNR": v, "MATNR": m, "EKORG": "1000",
                                 **({"WERKS": w} if a == "A017" else {}), "ESOKZ": "0", "DATBI": c[0]["DATBI"],
                                 "DATAB": c[0]["DATAB"], "KNUMH": c[0]["KNUMH"]}
    a017 = _table("A017", [key(*x) for x in conds if x[0] == "A017"])
    a018 = _table("A018", [key(*x) for x in conds if x[0] == "A018"])
    return TableFrames({"EKKO": ekko, "EKPO": ekpo, "LFA1": lfa1, "LFM1": lfm1, "MARA": mara, "MAKT": makt,
                        "MARC": marc, "EINA": eina, "EINE": eine, "EORD": eord, "EKBE": ekbe, "RBKP": rbkp,
                        "KONH": konh, "KONP": konp, "A017": a017, "A018": a018}, D, module="mm_purchasing")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    values = {"BSART": {"NB", "FO", "UB", "LP", "LPA", "MK", "WK", "AN"},
              "PSTYP": {"0", "1", "2", "3", "4", "5", "6", "7", "8", "9"},
              "KNTTP": {"A", "F", "K", "P", "U", "X"},
              "KSCHL": {"PB00", "PBXX", "RA00", "RA01", "RB00", "RC00", "FRA1", "FRB1", "FRC1", "SKTO", "NAVS"}}
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def _hist(ebeln: str, ebelp: str, belnr: str, days: int) -> str:
    """EKBE key of a goods-receipt line posted ``days`` ago (material document year)."""
    return f"EBELN={ebeln}|EBELP={ebelp}|ZEKKN=00|VGABE=1|GJAHR={_ago(days)[:4]}|BELNR={belnr}|BUZEI=0001"


def test_mm_purchasing_golden():
    static = yaml.safe_load(_find_module_yaml("mm_purchasing").read_text())["rules"]
    results = run_checks("mm_purchasing", _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate("mm_purchasing", static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "PUR007": {"EBELN=4500012010"},                          # purchasing group missing
        "PUR019": {"EBELN=4500012011|EBELP=00010"},              # account assignment Z not configured (T163K)
        "PUR044": {"EBELN=4500012012|EBELP=00010"},              # net price -86.40
        "XP2P005": {"EBELN=4500012013|EBELP=00010"},             # open item, vendor blocked for purchasing
        "XP2P006": {"EBELN=4500012015|EBELP=00010"},             # open item, material deleted at plant 1000
        "PH-LFA1-TELF1": {"LIFNR=0000100050"},                   # 0000000000 as the phone number
        "PUR057": {"EBELN=4500012016|EBELP=00010"},              # GR-based IV set, no goods receipt expected
        "PUR048": {"EBELN=4600000202"},                          # contract valid to before valid from
        "PUR063": {"EBELN=4500012017|EBELP=00010"},              # open item, vendor blocked in purchasing org
        "PUR080": {"INFNR=5300000003|EKORG=1000|ESOKZ=0|WERKS="},  # info record price unit 0
        "PUR084": {"MATNR=000000000000300010|WERKS=1000|ZEORD=00002"},  # source valid to before valid from
        # GR/IR per PO item: the group's first history line carries the result
        "PUR117": {_hist("4500011510", "00010", "5000088020", 190)},  # final invoice, 100 received / 80 invoiced
        "PUR118": {_hist("4500011511", "00010", "5000091230", 80)},  # delivery complete, 380 received / 400 invoiced
        "PUR119": {_hist("4500012004", "00030", "5000093012", 10)},  # deleted with 30 received, nothing invoiced
        "PUR120": {"BELNR=5105600310|GJAHR=2026", "BELNR=5105600311|GJAHR=2026"},  # one invoice posted twice
        "PUR121": {"BELNR=5105600312|GJAHR=2026"},               # dated after it was posted
        "PUR122": {"BELNR=5105600313|GJAHR=2026"},               # reversal without its fiscal year
        # the later of two overlapping records is the one found
        "PUR123": {"KAPPL=M|KSCHL=PB00|LIFNR=0000100030|MATNR=000000000000500075|EKORG=1000|WERKS=1000|ESOKZ=0"
                   "|DATBI=99991231"},
        "PUR124": {"KAPPL=M|KSCHL=PB00|LIFNR=0000100010|MATNR=000000000000300010|EKORG=1000|ESOKZ=0"
                   "|DATBI=99991231"},
        "PUR125": {"KNUMH=0000412014"},                          # valid 20260901 to 20260831
        "PUR126": {"KNUMH=0000412015"},                          # quantity-based rate, pricing unit 0
        "PUR127": {"KNUMH=0000412016"},                          # quantity-based rate, no unit
        "PUR128": {"KNUMH=0000412017"},                          # rate without a currency
        "PUR129": {"KNUMH=0000412018"},                          # ZPB9 is not in T685
    }, found
    # 4500011990 is flagged for deletion: out of header and item rules, counted; items 4500012004/00020 and
    # /00030 are deleted in a live PO
    group = next(r for r in results if r.check_id == "PUR007")
    assert group.details["population_excluded"] == {"deleted": 1}
    matkl = next(r for r in results if r.check_id == "PUR020")
    assert matkl.details["population_excluded"] == {"deleted": 3}
    # GR/IR scope: finally invoiced items (4500011500, 4500011510); delivery-complete items (those two and
    # 4500011511); deleted items with history (4500012004/00020 nets to zero, /00030 does not)
    assert {c: next(r for r in results if r.check_id == c).total_count for c in ("PUR117", "PUR118", "PUR119")} \
        == {"PUR117": 2, "PUR118": 3, "PUR119": 2}
    # duplicate scope: posted invoices not reversed — credit memos and the reversed original are not compared
    assert next(r for r in results if r.check_id == "PUR120").total_count == 6
    # the record flagged for deletion overlaps both clean A017 records but is not judged, and is counted
    overlap = next(r for r in results if r.check_id == "PUR123")
    assert overlap.details["population_excluded"] == {"deleted": 1}
    assert next(r for r in results if r.check_id == "PUR129").details["population_excluded"] == {"deleted": 1}
