"""Golden dataset: the whole plant-maintenance pipeline (shipped + generated rules,
grain resolution EQUI → EQUZ → ILOA and IFLOT → ILOA, active population) on
technical objects whose correct findings are known. Clean equipment, functional
locations and work centres must produce no finding at all — any failure on them
is a false positive; each seeded defect must be found exactly where it was put.

Data is in SAP internal format as RFC delivers it: EQUNR / ILOAN / KOSTL
zero-padded (ALPHA), work-centre object IDs as NUMC 8, dates as YYYYMMDD,
initial dates as 00000000, the current EQUZ time segment at DATBI 99991231,
system statuses as JEST I-codes with INACT blank for the active ones."""

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
MODULE = "plant_maintenance"


def _eq(n: int) -> str:
    return f"{10000000 + n:018d}"            # EQUNR, ALPHA-converted (18 digits)


def _iloan(n: int) -> str:
    return f"{100000 + n:012d}"              # ILOAN, internal location number


def _frames() -> TableFrames:
    # E1-E4 clean (installed pumps, motor, compressor, a stores-held spare motor);
    # E5-E9 each carry exactly one defect.
    n = list(range(1, 10))
    eq = [_eq(i) for i in n]
    equi = pd.DataFrame({
        "EQUI.EQUNR": eq,
        "EQUI.ERDAT": ["20180312", "20180312", "20190805", "20210114", "20180312", "20190805", "20200220",
                       "20220601", "20230110"],
        "EQUI.AEDAT": ["20240115", "20230907", "00000000", "20220303", "20240115", "20230907", "20240802",
                       "20210601", "20231122"],               # E8: changed a year before it was created
        "EQUI.EQTYP": ["M"] * 9,
        "EQUI.EQART": ["PUMP", "PUMP", "MOTOR", "MOTOR", "PUMP", "COMPR", "PUMP", "MOTOR", "COMPR"],
        "EQUI.INBDT": ["20180401", "20180401", "20190901", "20210301", "20180401", "20190901", "20200301",
                       "20220701", "20230201"],
        "EQUI.ANSDT": ["20180215", "20180215", "20190710", "20201210", "20180215", "20190710", "20200115",
                       "20220510", "20221215"],
        "EQUI.ANSWT": ["185000.00", "185000.00", "96500.00", "96500.00", "185000.00", "742000.00", "212000.00",
                       "98400.00", "755000.00"],
        "EQUI.WAERS": ["ZAR"] * 9,
        "EQUI.HERST": ["KSB", "KSB", "WEG", "WEG", "KSB", "Atlas Copco", "Grundfos", "WEG", "Atlas Copco"],
        "EQUI.HERLD": ["DE", "DE", "BR", "BR", "DE", "BE", "DK", "BR", "BE"],
        "EQUI.TYPBZ": ["Etanorm 125-250", "Etanorm 125-250", "W22 IE3 75kW", "W22 IE3 75kW", "Etanorm 125-250",
                       "GA 90 VSD+", "NB 80-200", "W22 IE3 75kW", "GA 90 VSD+"],
        "EQUI.SERGE": ["9971123401", "9971123402", "1032456781", "1032456799", "9971123405", "API123456",
                       "98765432P1", "1032456802", "API123498"],
        "EQUI.BAUJJ": ["2017", "2017", "2019", "2020", "17", "2019", "2019", "2022", "2022"],  # E5: 2-digit year
        "EQUI.BAUMM": ["11", "11", "05", "10", "11", "04", "12", "03", "09"],
        "EQUI.OBJNR": [f"IE{e}" for e in eq],
        "EQUI.LVORM": [""] * 9,
    })
    eqkt = pd.DataFrame({  # E9 has no text row at all; E1 also has a German text (English wins)
        "EQKT.EQUNR": eq[:8] + [eq[0]],
        "EQKT.SPRAS": ["E"] * 8 + ["D"],
        "EQKT.EQKTX": ["Cooling water pump P-101A", "Cooling water pump P-101B", "Mill drive motor M-201",
                       "Spare motor 75kW (rotable)", "Boiler feed pump P-301",
                       "Air compressor C-01 Tel: 011 555 1234",    # E6: phone number in the description
                       "Process water pump P-401",
                       "Conveyor drive motor M-501", "Kühlwasserpumpe P-101A"],
    })
    equz = pd.DataFrame({  # one current time segment per equipment, plus E1's history segment
        "EQUZ.EQUNR": eq + [eq[0]],
        "EQUZ.DATBI": ["99991231"] * 9 + ["20200630"],
        "EQUZ.EQLFN": ["002"] + ["001"] * 8 + ["001"],
        "EQUZ.DATAB": ["20200701", "20180401", "20190901", "20210301", "20180401", "20190901", "20200301",
                       "20220701", "20230201", "20180401"],
        "EQUZ.ERDAT": ["20200701", "20180312", "20190805", "20210114", "20180312", "20190805", "20200220",
                       "20220601", "20230110", "20180312"],
        "EQUZ.AEDAT": ["00000000", "20230907", "00000000", "20220303", "20240115", "20230907", "20240802",
                       "00000000", "20231122", "20200701"],
        "EQUZ.IWERK": ["ZA01"] * 10,
        "EQUZ.GEWRK": ["10000045", "10000045", "10000046", "10000046", "10000045", "10000047", "10000045",
                       "10000046", "10000047", "10000045"],
        "EQUZ.TIDNR": ["P-101A", "P-101B", "M-201", "SP-M-75-01", "P-301", "C-01", "P-401", "M-501", "C-02",
                       "P-101A"],
        "EQUZ.ILOAN": [_iloan(i) for i in n] + [_iloan(90)],
        "EQUZ.HEQUI": [""] * 10,
    })
    # location/account assignment of each equipment's current segment (E4 sits in the stores area).
    # The last row is E1's closed segment (to 30.06.2020): received into stores, not yet installed —
    # cost centre and ABC indicator came with installation at ZA01-PRD-L01 (inherited from the FL).
    iloa_eq = pd.DataFrame({
        "ILOA.ILOAN": [_iloan(i) for i in n] + [_iloan(90)],
        "ILOA.TPLNR": ["ZA01-PRD-L01", "ZA01-PRD-L01", "ZA01-PRD-L02", "ZA01-STR", "ZA01-UTL-BLR",
                       "ZA01-UTL-AIR", "ZA01-PRD-L02", "ZA01-PRD-L01", "ZA01-UTL-AIR", ""],
        "ILOA.ABCKZ": ["A", "A", "A", "C", "A", "B", "B", "B", "B", ""],
        "ILOA.SWERK": ["ZA01"] * 10,
        "ILOA.KOKRS": ["1000"] * 10,
        "ILOA.KOSTL": ["0000410100", "0000410100", "0000410200", "0000410900", "0000420100", "0000420200",
                       "", "0000410100", "0000420200", ""],      # E7: no cost centre
        "ILOA.BUKRS": ["1000"] * 10,
        "ILOA.GSBER": ["9900"] * 10,
    })
    fl = ["ZA01", "ZA01-PRD", "ZA01-PRD-L01", "ZA01-PRD-L02", "ZA01-UTL", "ZA01-UTL-AIR", "ZA01-UTL-BLR",
          "ZA01-STR", "ZA01-WSH"]
    fl_iloan = [_iloan(200 + i) for i in range(len(fl))]
    iflot = pd.DataFrame({
        "IFLOT.TPLNR": fl,
        "IFLOT.TPLMA": ["", "ZA01", "ZA01-PRD", "ZA01-PRD", "ZA01", "ZA01-UTL", "ZA01-UTL", "ZA01", "ZA01"],
        "IFLOT.TPLKZ": ["ZA-PM"] * 9,
        "IFLOT.FLTYP": ["M"] * 9,
        "IFLOT.ERDAT": ["20180301"] * 8 + ["20240510"],
        "IFLOT.AEDAT": ["20230115", "00000000", "20220920", "00000000", "00000000", "00000000", "20210704",
                        "00000000", "00000000"],
        "IFLOT.IWERK": ["ZA01"] * 8 + [""],                     # FL9: workshop without planning plant
        "IFLOT.LGWID": ["10000045", "10000045", "10000045", "10000046", "10000047", "10000047", "10000047",
                        "10000046", "10000045"],
        "IFLOT.ILOAN": fl_iloan,
        "IFLOT.OBJNR": [f"IF{i:020d}" for i in range(1, 10)],
        "IFLOT.LVORM": [""] * 9,
    })
    iloa_fl = pd.DataFrame({
        "ILOA.ILOAN": fl_iloan,
        "ILOA.TPLNR": fl,
        "ILOA.ABCKZ": ["A", "A", "A", "A", "B", "B", "A", "C", "C"],
        "ILOA.SWERK": ["ZA01"] * 9,
        "ILOA.KOKRS": ["1000"] * 9,
        "ILOA.KOSTL": ["0000410000", "0000410000", "0000410100", "0000410200", "0000420000", "0000420200",
                       "0000420100", "0000410900", "0000430000"],
        "ILOA.BUKRS": ["1000"] * 9,
        "ILOA.GSBER": ["9900"] * 9,
    })
    iflotx = pd.DataFrame({
        "IFLOTX.TPLNR": fl,
        "IFLOTX.SPRAS": ["E"] * 9,
        "IFLOTX.PLTXT": ["Johannesburg plant", "Production area", "Milling line 1", "Milling line 2",
                         "Utilities", "Compressed air system", "Steam / boiler house", "Maintenance stores",
                         "Central workshop"],
    })
    # system status: installed (INST I0100) active, available (AVLB I0099) superseded — E4 is an
    # uninstalled spare, available in stores
    jest_rows = []
    for i, e in enumerate(eq, start=1):
        if i == 4:
            jest_rows.append((f"IE{e}", "I0099", ""))
        else:
            jest_rows += [(f"IE{e}", "I0099", "X"), (f"IE{e}", "I0100", "")]
    jest = pd.DataFrame(jest_rows, columns=["JEST.OBJNR", "JEST.STAT", "JEST.INACT"])
    crhd = pd.DataFrame({  # W4 is flagged for deletion (retired workshop shift)
        "CRHD.OBJTY": ["A"] * 4,
        "CRHD.OBJID": ["10000045", "10000046", "10000047", "10000048"],
        "CRHD.ARBPL": ["MECH-01", "ELEC-01", "UTIL-01", "MECH-02"],
        "CRHD.WERKS": ["ZA01", "ZA01", "ZA01", ""],
        "CRHD.VERWE": ["0005"] * 4,
        "CRHD.BEGDA": ["20180101"] * 4,
        "CRHD.ENDDA": ["99991231"] * 4,
        "CRHD.LVORM": ["", "", "", "X"],
        "CRHD.AEDAT_GRND": ["20220110", "00000000", "20230404", "20190301"],
        "CRHD.AEDAT_VORA": ["00000000"] * 4,
        "CRHD.AEDAT_TERM": ["20220110", "20180105", "20180105", "20180105"],
        "CRHD.AEDAT_TECH": ["00000000"] * 4,
    })
    iloa = pd.concat([iloa_eq, iloa_fl], ignore_index=True)
    return TableFrames({"EQUI": equi, "EQKT": eqkt, "EQUZ": equz, "ILOA": iloa, "IFLOT": iflot,
                        "IFLOTX": iflotx, "JEST": jest, "CRHD": crhd}, D, module=MODULE)


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them (PM rules carry no value lists)."""
    values: dict[str, set[str]] = {"EQTYP": {"M", "P", "Q", "S"}, "FLTYP": {"M", "A"}, "ABCKZ": {"A", "B", "C"}}
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def test_plant_maintenance_golden():
    static = yaml.safe_load(_find_module_yaml(MODULE).read_text())["rules"]
    results = run_checks(MODULE, _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate(MODULE, static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "PM035": {f"EQUNR={_eq(5)}"},                  # construction year "17"
        "VP-EQKT-EQKTX": {f"EQUNR={_eq(6)}"},          # telephone number in the equipment description
        "PM015": {f"EQUNR={_eq(7)}"},                  # installed equipment without a cost centre
        "DO-EQUI": {f"EQUNR={_eq(8)}"},                # changed before it was created
        "PM004": {f"EQUNR={_eq(9)}"},                  # no equipment description in any language read
        "PM009": {"TPLNR=ZA01-WSH"},                   # functional location without planning plant
    }, found
    # the retired work centre W4 (no plant any more) is flagged for deletion: out of the population, counted
    for rid in ("PM021", "PM022"):
        wc = next(r for r in results if r.check_id == rid)
        assert wc.details["population_excluded"] == {"deleted": 1}, rid
        assert wc.total_count == 3, rid


def test_measuring_range_in_equipment_description_is_not_a_phone_number():
    """Weighing and process instruments are named by their measuring range: 'Load cell 0-500 kg' and
    'Lime dosing pump pH 9.5-10.5' are correct EQKTX texts, not a telephone number in the wrong field."""
    frames = _frames()
    eqkt = frames.frames["EQKT"].copy()
    eqkt.loc[eqkt["EQKT.EQUNR"].eq(_eq(2)) & eqkt["EQKT.SPRAS"].eq("E"), "EQKT.EQKTX"] = "Load cell 0-500 kg"
    eqkt.loc[eqkt["EQKT.EQUNR"].eq(_eq(3)) & eqkt["EQKT.SPRAS"].eq("E"), "EQKT.EQKTX"] = "Lime dosing pump pH 9.5-10.5"
    frames = TableFrames({**frames.frames, "EQKT": eqkt}, D, module=MODULE)
    static = yaml.safe_load(_find_module_yaml(MODULE).read_text())["rules"]
    results = run_checks(MODULE, frames, "t", reference_values=_live_config(static),
                         extra_rules=generate(MODULE, static, D))
    vp = next(r for r in results if r.check_id == "VP-EQKT-EQKTX")
    assert set(vp.failing_record_keys or []) == {f"EQUNR={_eq(6)}"}, vp.failing_record_keys
