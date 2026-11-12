"""Template library: blank templates per module, hand column maps and coverage. Synthetic data only."""
import io

import pandas as pd
import pytest
from fastapi import HTTPException
from openpyxl import load_workbook

from api.services.fix_simulation import apply_fixes
from api.services.migration import workbook as wb
from api.services.migration.export import to_xlsx
from checks.frames import TableFrames
from checks.runner import module_rules
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
CSV = b"MARA-MATNR,MARA-MTART,Legacy group\n"  # a blank template: the header row only


@pytest.mark.parametrize("module", ["material_master", "business_partner", "fi_gl", "asset_accounting"])
def test_blank_template_parses_back_fully_matched(module):
    tabs = wb.blank_template(D, module_rules(module), {})
    listing = tabs["Field List"]
    assert len(listing) and set(listing["Importance"]) <= {"Mandatory", "Optional"}
    for _, row in listing.iterrows():  # every listed field is a dictionary field, never invented
        assert D.resolve(f"{row['SAP Structure']}.{row['SAP Field']}") is not None
    cov = wb.coverage(wb.parse_workbook(to_xlsx(tabs, sanitize_formulas=True), "blank.xlsx"), D)
    assert cov["columns"] == len(listing) and cov["matched"] == cov["columns"]


def test_employee_central_blank_template_uses_the_sf_layout_and_covers_every_field():
    rules = module_rules("employee_central")
    tabs = wb.blank_template(D, rules, {})
    assert "Field List" not in tabs and "EmpJob" in tabs and "EmpJob Values (EMPJOBHIST)" in tabs
    assert all(len(name) <= 31 and "*" not in name for name in tabs)  # Excel tab names
    book = wb.parse_workbook(to_xlsx(tabs, sanitize_formulas=True), "blank.xlsx")
    cov = wb.coverage(book, D)
    assert cov["columns"] and cov["matched"] == cov["columns"]
    wanted = {r["field"] for r in rules if isinstance(r.get("field"), str) and D.resolve(r["field"]) is not None}
    wanted |= {f"{t}.{k}" for t in {w.split(".")[0] for w in wanted} for k in D.tables[t].keys}
    resolved = set()
    for sheet in book.sheets:  # each grid loads the table it names, so every rule field and key lands somewhere
        options = wb._candidates(sheet, D)
        table = max(options, key=lambda t: (len(options[t]), t == wb._named_table(sheet)), default=None)
        resolved |= {f.qualified for f in options.get(table, {}).values()}
    assert wanted and wanted <= resolved


def test_blank_template_carries_rule_values_and_required_keys():
    tabs = wb.blank_template(D, module_rules("material_master"), {})
    mara = tabs["Field List"].set_index(["SAP Structure", "SAP Field"])
    assert mara.loc[("MARA", "MATNR"), "Importance"] == "Mandatory"
    assert "M" in mara.loc[("MARA", "MBRSH"), "Allowed values"].split(", ")  # MM006 lists the industry sectors
    sheet = load_workbook(io.BytesIO(to_xlsx(tabs)), read_only=True)["MARA"]
    ids, labels = list(sheet.iter_rows(max_row=2, values_only=True))
    assert "MATNR" in ids and labels[ids.index("MATNR")] == D.resolve("MARA.MATNR").description


def test_blank_template_uses_target_check_table_values():
    rules = [{"field": "MARA.MTART", "check_class": "null_check"}]
    ref = D.resolve("MARA.MTART").check_ref
    tabs = wb.blank_template(D, rules, {ref: {"ZFRT", "ZHAW"}})
    row = tabs["Field List"].set_index("SAP Field").loc["MTART"]
    assert row["Allowed values"] == "ZFRT, ZHAW" and row["Check table"] == ref and row["Importance"] == "Mandatory"


def test_blank_template_skips_fields_the_dictionary_lacks():
    tabs = wb.blank_template(D, [{"field": "MARA.NOT_A_FIELD"}, {"field": "NOTATABLE.X"}], {})
    assert list(tabs) == ["Field List"] and tabs["Field List"].empty


def test_column_map_resolves_an_unmatched_column_and_fills_it():
    book = wb.parse_workbook(CSV, "materials.csv")
    assert wb.coverage(book, D)["sheets"][0]["unmapped"][0]["header"] == "Legacy group"
    wb.apply_column_map(book, {"materials::Legacy group": "MARA.MATKL", "other::Legacy group": "MARA.MATNR"})
    assert book.sheets[0].mapped == {"Legacy group": "MARA.MATKL"}
    cov = wb.coverage(book, D)
    assert cov["matched"] == 3 and not cov["sheets"][0]["unmapped"]
    frames = TableFrames({"MARA": pd.DataFrame({"MARA.MATNR": ["M-001"], "MARA.MTART": ["FERT"],
                                                 "MARA.MATKL": ["G1"]})}, D)
    tabs, report = wb.fill(book, frames)
    assert tabs["materials"]["Legacy group"].tolist() == ["G1"]


def test_column_map_to_an_unknown_field_is_ignored():
    book = wb.parse_workbook(CSV, "materials.csv")
    wb.apply_column_map(book, {"materials::Legacy group": "MARA.NOT_A_FIELD", "materials::Missing": "MARA.MATKL"})
    assert wb.coverage(book, D)["matched"] == 2
    assert "Missing" not in book.sheets[0].mapped


def test_approved_cleansing_reaches_the_filled_template():
    book = wb.parse_workbook(CSV, "materials.csv")
    frames = TableFrames({"MARA": pd.DataFrame({"MARA.MATNR": ["M-001"], "MARA.MTART": ["fert"]})}, D)
    fixed, stats = apply_fixes(frames, None, [{"field": "MARA.MTART", "record_key": "MATNR=M-001", "new_value": "FERT"}])
    assert stats["cells_changed"] == 1
    tabs, _ = wb.fill(book, fixed)
    assert tabs["materials"]["MARA-MTART"].tolist() == ["FERT"]


@pytest.mark.parametrize("module", ["../etc", "Material_Master", "no_such_module"])
def test_template_routes_refuse_unknown_modules(module):
    from api.routes.migration import _module_rules

    with pytest.raises(HTTPException) as e:
        _module_rules(module)
    assert e.value.status_code == 404
