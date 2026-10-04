"""Golden dataset: the whole production-planning pipeline (shipped + generated rules,
grain resolution MAST → STKO and STKO → STPO, active population, live configuration)
on BOMs, routings, work centres and MRP views whose correct findings are known.
Clean records must produce no finding at all — any failure on them is a false
positive; each seeded defect must be found exactly where it was put.

Data is in SAP internal format as RFC delivers it: MATNR / IDNRK as 18-digit
MATN1, STLNR as 8-digit NUMCV, quantities as QUAN text with a decimal point
("1.000"), units as internal codes (ST, not PC), initial dates 00000000, the
standard routing lot-size range 0 – 99,999,999.

Seeded defects for the operation and work-centre rules: routing 50000001 operation 0030 has no
control key (PP044), rate routing 60000001 operation 0020 has base quantity 0 (PP045), work
centre PACK-01 is valid to a date before it is valid from (PP048)."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
MODULE = "production_planning"


def _m(n: int) -> str:
    return f"{n:018d}"                        # MATNR / IDNRK, MATN1 internal form


def _bom(n: int) -> str:
    return f"{n:08d}"                          # STLNR


def _frames() -> TableFrames:
    # ── material ↔ BOM links (MAST) and BOM headers (STKO) ─────────────────
    # B101 pump assembly; B102 motor-pump set with a 2nd alternative for large lots; B103 costing BOM;
    # B104 base quantity missing (defect).
    mast = pd.DataFrame({
        "MAST.MATNR": [_m(100100), _m(100110), _m(100110), _m(100100), _m(100120)],
        "MAST.WERKS": ["ZA01"] * 5,
        "MAST.STLAN": ["1", "1", "1", "6", "1"],
        "MAST.STLNR": [_bom(101), _bom(102), _bom(102), _bom(103), _bom(104)],
        "MAST.STLAL": ["01", "01", "02", "01", "01"],
        "MAST.LOSVN": ["0.000", "0.000", "100.000", "0.000", "0.000"],
        "MAST.LOSBS": ["99999999.000", "99.000", "99999999.000", "99999999.000", "99999999.000"],
        "MAST.ANDAT": ["20190415", "20200310", "20210618", "20190502", "20220905"],
        "MAST.AEDAT": ["00000000", "20210618", "00000000", "00000000", "00000000"],
    })
    stko = pd.DataFrame({
        "STKO.STLTY": ["M"] * 5,
        "STKO.STLNR": [_bom(101), _bom(102), _bom(102), _bom(103), _bom(104)],
        "STKO.STLAL": ["01", "01", "02", "01", "01"],
        "STKO.STKOZ": ["00000001", "00000002", "00000003", "00000004", "00000005"],
        "STKO.DATUV": ["20190415", "20200310", "20210618", "20190502", "20220905"],
        "STKO.ANDAT": ["20190415", "20200310", "20210618", "20190502", "20220905"],
        "STKO.AEDAT": ["20230811", "00000000", "00000000", "00000000", "00000000"],
        "STKO.BMEIN": ["ST"] * 5,
        "STKO.BMENG": ["1.000", "1.000", "10.000", "1.000", ""],
        "STKO.STLST": ["01", "01", "01", "01", "01"],
        "STKO.STKTX": ["Pump assembly CP-100", "Motor-pump set MP-110", "Motor-pump set MP-110 (lot >= 100)",
                       "Pump assembly CP-100 costing", "Pump skid PS-120"],
        "STKO.LOEKZ": [""] * 5,
        "STKO.LKENZ": [""] * 5,
    })
    # ── BOM items (STPO): every SAP item category a production BOM uses ────
    items = [
        # STLNR, STLKN, POSNR, POSTP, IDNRK, MENGE, MEINS, POTX1, extra
        (101, 1, "0010", "L", _m(100300), "1.000", "ST", "", {}),            # pump casing
        (101, 2, "0020", "L", _m(100310), "8.000", "ST", "", {}),            # bolts
        (101, 3, "0030", "R", _m(100320), "2.000", "ST", "", {"ROMS1": "250.000", "ROMEI": "MM"}),  # gasket cut
        (101, 4, "0040", "T", "", "0.000", "", "Torque casing bolts to 45 Nm", {}),
        (101, 5, "0050", "D", "", "0.000", "", "", {"DOKAR": "DRW", "DOKNR": f"{10021:025d}",
                                                   "DOKVR": "00", "DOKTL": "000"}),
        (101, 6, "0060", "N", "", "1.000", "ST", "Mechanical seal set, supplier spec MS-45",
         {"MATKL": "PUMPSPARE", "EKGRP": "P01", "PREIS": "1250.00", "SAKTO": "0000510000"}),
        (102, 1, "0010", "L", _m(100100), "1.000", "ST", "", {}),
        (102, 2, "0020", "L", _m(100330), "1.000", "ST", "", {}),
        (102, 3, "0030", "L", _m(100340), "0.750", "KG", "", {}),            # grease, kg per set
        (103, 1, "0010", "L", _m(100300), "1.000", "ST", "", {}),
        (104, 1, "0010", "L", _m(100110), "1.000", "ST", "", {}),
        (104, 2, "0020", "R", "", "3.000", "ST", "", {"ROMS1": "1200.000", "ROMEI": "MM"}),  # defect: no material
        (104, 3, "0030", "L", _m(100350), "4.000", "", "", {}),              # defect: no unit
    ]
    stpo = pd.DataFrame([{
        "STPO.STLTY": "M", "STPO.STLNR": _bom(b), "STPO.STLKN": f"{k:08d}", "STPO.STPOZ": f"{b * 100 + k:08d}",
        "STPO.POSNR": pos, "STPO.POSTP": cat, "STPO.IDNRK": comp, "STPO.MENGE": qty, "STPO.MEINS": uom,
        "STPO.POTX1": txt, "STPO.DATUV": "20190415", "STPO.ANDAT": "20190415",
        "STPO.AEDAT": "00000000", "STPO.LKENZ": "", "STPO.REKRS": "", **{f"STPO.{f}": v for f, v in extra.items()},
    } for b, k, pos, cat, comp, qty, uom, txt, extra in items]).fillna("")
    # ── routings / recipes (PLKO) ──────────────────────────────────────────
    # N1 routing (two header versions under engineering change), N1 alt. 02 for large lots,
    # R1 rate routing, 2 master recipe; then one defect each, and a routing flagged for deletion.
    plko = pd.DataFrame({
        "PLKO.PLNTY": ["N", "N", "N", "R", "2", "N", "N", "N", "N", "N"],
        "PLKO.PLNNR": ["50000001", "50000001", "50000001", "60000001", "70000001", "50000005", "50000006",
                       "50000007", "50000008", "50000009"],
        "PLKO.PLNAL": ["01", "01", "02", "01", "01", "01", "01", "01", "01", "01"],
        "PLKO.ZAEHL": ["00000001", "00000004", "00000002", "00000001", "00000001", "00000001", "00000001",
                       "00000001", "00000001", "00000001"],
        "PLKO.DATUV": ["20190415", "20230811", "20210618", "20200105", "20210301", "20220905", "20221011",
                       "20230120", "20230315", "20180101"],
        "PLKO.AENNR": ["", "500000000123", "", "", "", "", "", "", "", ""],
        "PLKO.LOEKZ": ["", "", "", "", "", "", "", "", "", "X"],
        "PLKO.ANDAT": ["20190415", "20230811", "20210618", "20200105", "20210301", "20220905", "20221011",
                       "20230120", "20230315", "20180101"],
        "PLKO.AEDAT": ["20230811", "00000000", "00000000", "20220707", "00000000", "00000000", "00000000",
                       "00000000", "20220315", "20210402"],  # PLNNR 50000008: changed before created
        "PLKO.VERWE": ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
        "PLKO.WERKS": ["ZA01"] * 10,
        "PLKO.STATU": ["4", "4", "4", "4", "4", "4", "4", "9", "4", "4"],  # 50000007: status not in T412
        "PLKO.PLNME": ["ST", "ST", "ST", "ST", "KG", "ST", "ST", "ST", "ST", "ST"],
        "PLKO.LOSVN": ["0.000", "0.000", "100.000", "0.000", "0.000", "0.000", "500.000", "0.000", "0.000",
                       "0.000"],
        "PLKO.LOSBS": ["99999999.000", "99999999.000", "99999999.000", "99999999.000", "99999999.000",
                       "99999999.000", "100.000", "99999999.000", "99999999.000", "99999999.000"],  # 50000006
        "PLKO.KTEXT": ["Pump assembly CP-100", "Pump assembly CP-100", "Pump assembly CP-100 (large lots)",
                       "Motor-pump set MP-110 line", "Grease blend GB-2", "", "Pump skid PS-120",
                       "Impeller machining", "Seal kit assembly", ""],  # 50000005: no description
    })
    # ── work centres (CRHD) and MRP views (MARC) ───────────────────────────
    crhd = pd.DataFrame({  # ASSY-03 is flagged for deletion; PACK-01 valid to a date before it is valid from (defect)
        "CRHD.OBJTY": ["A"] * 5,
        "CRHD.OBJID": ["10000011", "10000012", "10000013", "10000014", "10000015"],
        "CRHD.ARBPL": ["ASSY-01", "ASSY-02", "MACH-01", "ASSY-03", "PACK-01"],
        "CRHD.WERKS": ["ZA01"] * 5,
        "CRHD.VERWE": ["0001", "0001", "0001", "0001", "0001"],
        "CRHD.PLANV": ["009"] * 5,
        "CRHD.VGWTS": ["SAP1"] * 5,
        "CRHD.BEGDA": ["20180101"] * 4 + ["20240101"],
        "CRHD.ENDDA": ["99991231"] * 4 + ["20231231"],
        "CRHD.LVORM": ["", "", "", "X", ""],
        "CRHD.AEDAT_GRND": ["20220110", "00000000", "20230404", "20190301", "00000000"],
        "CRHD.AEDAT_VORA": ["20220110", "00000000", "00000000", "00000000", "00000000"],
        "CRHD.AEDAT_TERM": ["20220110", "20180105", "20180105", "20180105", "00000000"],
        "CRHD.AEDAT_TECH": ["00000000"] * 5,
    })
    # ── operations (PLPO): routing N1, rate routing R1 and recipe 2 ──────────
    # 50000001 op 0030 has no control key (defect); 60000001 op 0020 has base quantity 0 (defect)
    ops = [
        # PLNTY, PLNNR, PLNKN, VORNR, STEUS, LTXA1, MEINH, BMSCH, (VGW01, VGE01), (VGW02, VGE02), (VGW03, VGE03)
        ("N", "50000001", 1, "0010", "PP01", "Assemble casing", "ST", "1.000", ("15", "MIN"), ("6", "MIN"), ("6", "MIN")),
        ("N", "50000001", 2, "0020", "PP01", "Fit impeller and seal", "ST", "1.000", ("10", "MIN"), ("8", "MIN"),
         ("8", "MIN")),
        ("N", "50000001", 3, "0030", "", "Pressure test", "ST", "1.000", ("0", ""), ("12", "MIN"), ("12", "MIN")),
        ("N", "50000001", 4, "0040", "PP02", "External painting", "ST", "1.000", ("0", ""), ("0", ""), ("0", "")),
        ("R", "60000001", 1, "0010", "PP01", "Line assembly", "ST", "10.000", ("30", "MIN"), ("1", "H"), ("1", "H")),
        ("R", "60000001", 2, "0020", "PP01", "Line test", "ST", "0.000", ("0", ""), ("20", "MIN"), ("20", "MIN")),
        ("2", "70000001", 1, "0010", "PI01", "Blend base oil and thickener", "KG", "100.000", ("20", "MIN"),
         ("2", "H"), ("1", "H")),
    ]
    plpo = pd.DataFrame([{
        "PLPO.PLNTY": t, "PLPO.PLNNR": n, "PLPO.PLNKN": f"{k:08d}", "PLPO.ZAEHL": "00000001",
        "PLPO.DATUV": "20190415", "PLPO.LOEKZ": "", "PLPO.ANDAT": "20190415", "PLPO.AEDAT": "00000000",
        "PLPO.VORNR": v, "PLPO.STEUS": st, "PLPO.WERKS": "ZA01", "PLPO.LTXA1": tx, "PLPO.MEINH": u,
        "PLPO.UMREZ": "1", "PLPO.UMREN": "1", "PLPO.BMSCH": b,
        "PLPO.VGW01": w1[0], "PLPO.VGE01": w1[1], "PLPO.VGW02": w2[0], "PLPO.VGE02": w2[1],
        "PLPO.VGW03": w3[0], "PLPO.VGE03": w3[1],
    } for t, n, k, v, st, tx, u, b, w1, w2, w3 in ops])
    marc = pd.DataFrame({  # 100360 is a consumable outside MRP (ND) — no MRP controller, rightly
        "MARC.MATNR": [_m(100100), _m(100110), _m(100120), _m(100300), _m(100360), _m(100370), _m(100380)],
        "MARC.WERKS": ["ZA01"] * 7,
        "MARC.DISMM": ["PD", "PD", "PD", "VB", "ND", "PD", "PD"],
        "MARC.DISPO": ["P01", "P01", "P02", "001", "", "p01", "P09"],   # 100370: lowercase controller
        "MARC.BESKZ": ["E", "E", "E", "F", "F", "F", "F"],
        "MARC.LVORM": ["", "", "", "", "", "", "X"],                   # 100380 flagged for deletion
    })
    return TableFrames({"MAST": mast, "STKO": stko, "STPO": stpo, "PLKO": plko, "PLPO": plpo, "CRHD": crhd,
                        "MARC": marc},
                       D, module=MODULE)


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    values = {"STATU": {"1", "2", "3", "4"}, "PLKO.VERWE": {"1", "2", "3", "4", "5", "6", "9"},
              "STLAN": {"1", "2", "3", "4", "5", "6"}, "STLST": {"01", "02"},
              "POSTP": {"L", "N", "R", "T", "D", "K", "I"}, "CRHD.VERWE": {"0001", "0007", "0008"},
              "STEUS": {"PP01", "PP02", "PP03", "PI01", "PI02"}, "PLANV": {"001", "009"}, "VGWTS": {"SAP1", "SAP2"}}
    out = {}
    for r in rules:
        v = values.get(r.get("field")) or values.get(r["field"].split(".")[1])
        if r.get("check_class") in ("referential_check", "domain_value_check") and v:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = v
    return out


def _plko(plnnr: str, plnty: str = "N", plnal: str = "01", zaehl: str = "00000001") -> str:
    return f"PLNTY={plnty}|PLNNR={plnnr}|PLNAL={plnal}|ZAEHL={zaehl}"


def _stpo(bom: int, stlkn: int) -> str:
    return f"STLTY=M|STLNR={_bom(bom)}|STLKN={stlkn:08d}|STPOZ={bom * 100 + stlkn:08d}"


def test_production_planning_golden():
    static = yaml.safe_load(_find_module_yaml(MODULE).read_text())["rules"]
    results = run_checks(MODULE, _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate(MODULE, static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "PP003": {_plko("50000005")},                          # routing without description
        "PP019": {_plko("50000006")},                          # lot size from 500 > to 100
        "PP005": {_plko("50000007")},                          # status 9 is not in T412
        "DO-PLKO": {_plko("50000008")},                        # changed before it was created
        "PP012": {f"MATNR={_m(100120)}|WERKS=ZA01|STLAN=1|STLNR={_bom(104)}|STLAL=01"},  # no base quantity
        "PP013": {_stpo(104, 2)},                              # variable-size item without component
        "PP015": {_stpo(104, 3)},                              # stock item without unit of measure
        "PP029": {f"MATNR={_m(100370)}|WERKS=ZA01"},           # lowercase MRP controller
        "PP044": {"PLNTY=N|PLNNR=50000001|PLNKN=00000003|ZAEHL=00000001"},  # operation without control key
        "PP045": {"PLNTY=R|PLNNR=60000001|PLNKN=00000002|ZAEHL=00000001"},  # operation base quantity 0
        "PP048": {"OBJTY=A|OBJID=10000015"},                   # work centre valid to before valid from
        "PP201": {"OBJTY=A|OBJID=10000015"},                   # the same work centre expired at the end of 2023
    }, found
    # routing 50000009 (no description either) and work centre ASSY-03 are flagged for deletion,
    # material 100380 is flagged for deletion at plant ZA01: out of the population, counted
    for rid, total in (("PP003", 9), ("PP001", 9), ("PP017", 4), ("PP018", 4), ("PP029", 5)):
        r = next(x for x in results if x.check_id == rid)
        assert r.details["population_excluded"] == {"deleted": 1}, rid
        assert r.total_count == total, rid
