"""Golden dataset: the whole purchasing pipeline (shipped + generated rules,
active population, joins to vendor and material masters, live configuration)
on purchasing documents whose correct findings are known. Clean documents must
produce no finding at all — any failure on them is a false positive; each
seeded defect must be found exactly where it was put.

Clean documents (a senior MM consultant would sign them off):
  4500012001  NB  steel bar for stock + cost-centre consumables without material
  4500012002  NB  seal kits from a German supplier, EUR, released (release strategy)
  4500012003  UB  stock transport order 1000 → 1100: supplying plant, no vendor, no payment terms
  4500012004  NB  bearings, open; item 00020 deleted in the live PO (out of the population)
  4500011500  NB  delivered and invoiced long ago (completed: no longer "open")
  5500000101  LP  scheduling agreement signed 20 months ago, valid until next year
  4600000201  MK  cross-plant quantity contract signed two years ago, valid three years
One seeded defect each:
  4500012010  purchasing group blank                              PUR007  null
  4500012011  account assignment category Z not in T163K          PUR019  domain (live config)
  4500012012  negative net price (RFC "86.40-")                    PUR044  cross-field
  4500012013  open item on a vendor blocked for purchasing         XP2P005 cross-object (EKPO → LFA1)
  4500012015  open item on a material deleted at its plant         XP2P006 cross-object (EKPO → MARC)
  vendor 0000100050  phone 0000000000                              PH-LFA1-TELF1 generated (placeholder)
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
          elikz="", erekz="", wepos="X", repos="X", loekz="", ktmng="0.000") -> dict:
    return {"EBELN": ebeln, "EBELP": ebelp, "LOEKZ": loekz, "TXZ01": txz01, "MATNR": matnr, "WERKS": werks,
            "LGORT": "0001" if werks and not knttp else "", "MATKL": matkl, "MENGE": menge, "MEINS": meins,
            "BPRME": meins, "NETPR": netpr, "PEINH": "1", "NETWR": netwr, "PSTYP": pstyp, "KNTTP": knttp,
            "ELIKZ": elikz, "EREKZ": erekz, "WEPOS": wepos, "REPOS": repos, "KTMNG": ktmng}


def _frames() -> TableFrames:
    steel, metals, bearings, castings, umgeni = "0000100010", "0000100020", "0000100030", "0000100040", "0000100050"
    lfa1 = _table("LFA1", [
        {"LIFNR": steel, "NAME1": "Steelmet Distributors (Pty) Ltd", "NAME2": "", "SORTL": "STEELMET",
         "STRAS": "14 Electron Ave", "ORT01": "Isando", "PSTLZ": "1600", "LAND1": "ZA", "TELF1": "0119745500",
         "TELFX": "", "STCD1": "9301234567", "STCEG": "", "LFURL": "www.steelmet.co.za", "ERDAT": "20150310",
         "LOEVM": "", "SPERR": "", "SPERM": "", "KTOKK": "KRED", "ADRNR": "0000041001"},
        {"LIFNR": metals, "NAME1": "Rheintal Dichtungstechnik GmbH", "NAME2": "", "SORTL": "RHEINTAL",
         "STRAS": "Hafenstr. 21", "ORT01": "Mannheim", "PSTLZ": "68159", "LAND1": "DE", "TELF1": "+49 621 4390",
         "TELFX": "+49 621 4391", "STCD1": "", "STCEG": "DE813456789", "LFURL": "", "ERDAT": "20170622",
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
              loekz="L"),  # deleted item, never completed: out of the population
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
        _ekpo("4500011990", "00010", "Round bar 316L 50mm", bar, "1000", "", "300.000", "KG", "62.50",
              "18750.00", loekz="L"),
    ])
    return TableFrames({"EKKO": ekko, "EKPO": ekpo, "LFA1": lfa1, "LFM1": lfm1, "MARA": mara, "MAKT": makt,
                        "MARC": marc}, D, module="mm_purchasing")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    values = {"BSART": {"NB", "FO", "UB", "LP", "LPA", "MK", "WK", "AN"},
              "PSTYP": {"0", "1", "2", "3", "4", "5", "6", "7", "8", "9"},
              "KNTTP": {"A", "F", "K", "P", "U", "X"}}
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


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
    }, found
    # 4500011990 is flagged for deletion: out of header and item rules, counted; item 4500012004/00020 is
    # deleted in a live PO
    group = next(r for r in results if r.check_id == "PUR007")
    assert group.details["population_excluded"] == {"deleted": 1}
    matkl = next(r for r in results if r.check_id == "PUR020")
    assert matkl.details["population_excluded"] == {"deleted": 2}
