"""Field status from the source system's customizing → per-record rules."""

import pandas as pd

from checks.field_status_rules import extra_fields, generate
from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary
from sap.field_status_config import SEGMENTS, resolve, resolve_all

D = get_dictionary("ecc6")

# this system's field-selection metadata: definition "VGEN" controls LFA1, "VCC" controls LFB1
TMODO = [{"FAUNA": "VGEN", "MODIF": "001"}, {"FAUNA": "VGEN", "MODIF": "002"}, {"FAUNA": "VGEN", "MODIF": "045"},
         {"FAUNA": "VCC", "MODIF": "001"}, {"FAUNA": "VCC", "MODIF": "002"}]
TMODU = [{"FAUNA": "VGEN", "MODIF": "001", "TABNM": "LFA1", "FELDN": "STRAS", "KOART": "K"},
         {"FAUNA": "VGEN", "MODIF": "002", "TABNM": "LFA1", "FELDN": "TELF1", "KOART": "K"},
         {"FAUNA": "VGEN", "MODIF": "045", "TABNM": "LFA1", "FELDN": "STCD1", "KOART": "K"},  # in FAUS1
         {"FAUNA": "VCC", "MODIF": "001", "TABNM": "LFB1", "FELDN": "ZTERM", "KOART": "K"},
         {"FAUNA": "VCC", "MODIF": "002", "TABNM": "LFB1", "FELDN": "ZWELS", "KOART": "K"}]


def _t077k(general: str, general_2: str, company: str):
    return {"KTOKK": "KRED", "FAUSA": general, "FAUS1": general_2, "FAUS2": "", "FAUSF": company, "FAUSG": ""}


CONFIG = {"TMODO": TMODO, "TMODU": TMODU,
          "T077K": [_t077k("+-" + "." * 38, "...." + "+" + "." * 35, "+."),       # KRED: STRAS req, TELF1 sup, STCD1 req
                    {**_t077k("..", "", ".+"), "KTOKK": "LIEF"}]}                   # LIEF: ZWELS req


def test_resolves_definition_positions_and_statuses():
    res = {r.segment.id: r for r in resolve_all(CONFIG)}
    gen = res["vendor_general"]
    assert gen.fauna == "VGEN" and gen.positions[45] == ["LFA1.STCD1"]
    assert gen.groups["KRED"] == {"LFA1.STRAS": "required", "LFA1.TELF1": "suppressed", "LFA1.STCD1": "required"}
    assert res["vendor_company_code"].groups["LIEF"] == {"LFB1.ZWELS": "required"}


def test_ambiguous_definition_generates_nothing():
    tmodu = TMODU + [{"FAUNA": "VGEN2", "MODIF": "001", "TABNM": "LFA1", "FELDN": "NAME2", "KOART": "K"}]
    tmodo = TMODO + [{"FAUNA": "VGEN2", "MODIF": "001"}]
    seg = next(s for s in SEGMENTS if s.id == "vendor_general")
    r = resolve(seg, tmodo, tmodu, CONFIG["T077K"])
    assert r.fauna is None and "ambiguous" in r.reason
    assert generate([r], ["accounts_payable"]) == []


def test_generated_rules_evaluate_per_record_at_grain():
    rules = {r["id"]: r for r in generate(resolve_all(CONFIG), ["accounts_payable"])}
    assert set(rules) == {"FS-LFA1-STRAS-REQ", "FS-LFA1-TELF1-SUP", "FS-LFA1-STCD1-REQ", "FS-LFB1-ZTERM-REQ",
                          "FS-LFB1-ZWELS-REQ"}
    lfa1 = pd.DataFrame({"LFA1.LIFNR": ["1", "2", "3"], "LFA1.KTOKK": ["KRED", "KRED", "LIEF"],
                         "LFA1.STRAS": ["Main St", "", ""], "LFA1.TELF1": ["", "0115551234", "1"],
                         "LFA1.STCD1": ["X", "Y", ""]})
    lfb1 = pd.DataFrame({"LFB1.LIFNR": ["1", "3"], "LFB1.BUKRS": ["1000", "1000"],
                         "LFB1.ZTERM": ["", "0001"], "LFB1.ZWELS": ["T", ""]})
    frames = TableFrames({"LFA1": lfa1, "LFB1": lfb1}, D, module="accounts_payable")

    _, stras = run_rule(rules["FS-LFA1-STRAS-REQ"], frames)
    assert (stras.total_count, stras.failing_record_keys) == (2, ["LIFNR=2"])  # LIEF vendor 3 not in scope
    _, telf = run_rule(rules["FS-LFA1-TELF1-SUP"], frames)
    assert telf.failing_record_keys == ["LIFNR=2"] and telf.severity == "low"
    _, zwels = run_rule(rules["FS-LFB1-ZWELS-REQ"], frames)  # account group from LFA1, record at LFB1 grain
    assert zwels.grain == "LFB1" and zwels.failing_record_keys == ["LIFNR=3|BUKRS=1000"]
    _, zterm = run_rule(rules["FS-LFB1-ZTERM-REQ"], frames)
    assert zterm.failing_record_keys == ["LIFNR=1|BUKRS=1000"]


def test_extraction_reads_controlled_fields_and_group_source():
    ef = extra_fields(resolve_all(CONFIG))
    assert ef["LFA1"] == {"STRAS", "TELF1", "STCD1", "KTOKK"} and ef["LFB1"] == {"ZTERM", "ZWELS"}


def test_no_customizing_no_rules():
    assert resolve_all({}) == [] and resolve_all({"T077K": CONFIG["T077K"]}) == []


def test_material_field_selection_by_type_and_industry_sector():
    from checks.field_status_rules import generate_material
    from sap.field_status_config import resolve_material
    fausw = lambda **pos: "".join(pos.get(f"g{i}", ".") for i in range(1, 129))  # noqa: E731
    config = {
        "T130F": [{"FNAME": "MARA-BRGEW", "FGRUP": "005"}, {"FNAME": "MARA-EAN11", "FGRUP": "007"},
                  {"FNAME": "MARA-MATNR", "FGRUP": "001"}, {"FNAME": "RM03M-XYZ", "FGRUP": "009"}],
        "T130A": [{"FLREF": "FERT", "FAUSW": fausw(g5="+", g7="+")}, {"FLREF": "ROH", "FAUSW": fausw(g5="-")},
                  {"FLREF": "M", "FAUSW": fausw(g7="-")}, {"FLREF": "A", "FAUSW": fausw()}],
        "T134": [{"MTART": "FERT", "FLREF": "FERT"}, {"MTART": "ROH", "FLREF": "ROH"}],
        "T137": [{"MBRSH": "M", "FLREF": "M"}, {"MBRSH": "A", "FLREF": "A"}],
    }
    mat = resolve_material(config, D)
    # hide beats required: EAN required by FERT but hidden by industry sector M
    assert mat["MARA.EAN11"] == {"FERT|A": "required", "FERT|M": "suppressed", "ROH|M": "suppressed"}
    assert mat["MARA.BRGEW"]["FERT|M"] == "required" and mat["MARA.BRGEW"]["ROH|A"] == "suppressed"
    assert "MARA.MATNR" not in mat  # key fields are never generated
    rules = {r["id"]: r for r in generate_material(mat, ["material_master"])}
    mara = pd.DataFrame({"MARA.MATNR": ["1", "2", "3"], "MARA.MTART": ["FERT", "FERT", "ROH"],
                         "MARA.MBRSH": ["A", "M", "A"], "MARA.BRGEW": ["", "5", "2"], "MARA.EAN11": ["", "", ""]})
    f = TableFrames({"MARA": mara}, D, module="material_master")
    _, req = run_rule(rules["FS-MARA-BRGEW-REQ"], f)
    assert req.failing_record_keys == ["MATNR=1"] and req.total_count == 2
    _, sup = run_rule(rules["FS-MARA-BRGEW-SUP"], f)
    assert sup.failing_record_keys == ["MATNR=3"]
    _, ean = run_rule(rules["FS-MARA-EAN11-REQ"], f)
    assert ean.failing_record_keys == ["MATNR=1"] and ean.total_count == 1  # FERT|M is hidden, not required
    assert resolve_material({"T130F": config["T130F"]}, D) == {}  # nothing without the whole customizing


def test_fields_hidden_by_field_status_are_not_demanded_by_shipped_rules():
    from checks.field_status_rules import suppressed_fields
    hidden = suppressed_fields(resolve_all(CONFIG), {})
    assert hidden["LFA1.TELF1"] == (["LFA1.KTOKK"], {"KRED"})
    lfa1 = pd.DataFrame({"LFA1.LIFNR": ["1", "2"], "LFA1.KTOKK": ["KRED", "LIEF"], "LFA1.TELF1": ["", ""]})
    f = TableFrames({"LFA1": lfa1}, D, module="accounts_payable")
    rule = {"id": "AP022", "field": "LFA1.TELF1", "check_class": "null_check", "module": "accounts_payable"}
    _, r = run_rule(rule, f, None, hidden)
    assert r.failing_record_keys == ["LIFNR=2"] and r.details["population_excluded"] == {"hidden_by_field_status": 1}
    _, sup = run_rule(next(x for x in generate(resolve_all(CONFIG), ["accounts_payable"]) if x["id"] == "FS-LFA1-TELF1-SUP"),
                      f, None, hidden)
    assert sup.total_count == 1  # the field-status rule itself still sees the KRED record


def test_equipment_flagged_for_deletion_by_status_is_out_of_the_population():
    equi = pd.DataFrame({"EQUI.EQUNR": ["E1", "E2", "E3"], "EQUI.OBJNR": ["IE1", "IE2", "IE3"], "EQUI.HERST": ["", "", ""]})
    jest = pd.DataFrame({"JEST.OBJNR": ["IE1", "IE2", "IE2", "IE3"], "JEST.STAT": ["I0099", "I0076", "I0099", "I0076"],
                         "JEST.INACT": ["", "", "", "X"]})  # E3's deletion flag was reset (inactive)
    f = TableFrames({"EQUI": equi, "JEST": jest}, D, module="plant_maintenance")
    _, r = run_rule({"id": "X", "field": "EQUI.HERST", "check_class": "null_check", "module": "plant_maintenance"}, f)
    assert sorted(r.failing_record_keys) == ["EQUNR=E1", "EQUNR=E3"] and r.details["population_excluded"] == {"deleted": 1}


def test_missing_status_table_is_reported_not_silent():
    equi = pd.DataFrame({"EQUI.EQUNR": ["E1"], "EQUI.OBJNR": ["IE1"], "EQUI.HERST": [""]})
    f = TableFrames({"EQUI": equi}, D, module="fleet_management")
    _, r = run_rule({"id": "X", "field": "EQUI.HERST", "check_class": "null_check", "module": "fleet_management"}, f)
    assert r.details["population_excluded"] == {"unverified_deleted": 1}
