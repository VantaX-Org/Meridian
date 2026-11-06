"""New foundation sheets resolve to their entities; sheets with no entity stay unmatched."""
import pytest

from api.services.migration import workbook as wb
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def cands(name, ids, kind="definition"):
    s = wb.Sheet(name, kind, [wb.Column(header=i, id=i) for i in ids])
    return wb._candidates(s, D)


@pytest.mark.parametrize("sheet,col,table", [
    ("Pay Grade Values", "externalCode", "FOPAYGRADE"),
    ("Pay Grade Values", "paygradeLevel", "FOPAYGRADE"),
    ("Pay Group Values", "payrollVendorId", "FOPAYGROUP"),
    ("Frequency Values", "externalCode", "FOFREQUENCY"),
    ("Job Function Values", "effectiveStatus", "FOJOBFUNCTION"),
    ("Geozone Values", "externalCode", "FOGEOZONE"),
    ("Location Group Values", "externalCode", "FOLOCATIONGROUP"),
    ("Pay Component Group Values", "showOnCompUI", "FOPAYCOMPONENTGROUP"),
    ("Pay Scale Type Values (US)", "payScaleType", "FOPAYSCALETYPE"),
    ("Pay Scale Area Values (DE)", "payScaleArea", "FOPAYSCALEAREA"),
    ("Pay Range Data", "frequencyCode", "FOPAYRANGE"),
    ("CSF Corporate Address", "zip-code", "FOCORPORATEADDRESSDEFLT"),
    ("Social Accounts", "im-id", "PERSOCIALACCOUNT"),
])
def test_new_sheet_resolves(sheet, col, table):
    assert table in cands(sheet, [col])


def test_pay_scale_localised_name_matches_its_base_property():
    assert "FOPAYSCALETYPE" in cands("Pay Scale Type Values (US)", ["externalName.en_US"], "grid")


@pytest.mark.parametrize("sheet", [
    "CSF Personal Info (Global Info)",  # per-country generic slots, entity not established
    "CSF Dependents", "Contingent Worker", "CSF Legal Entity", "CSF Job Classification",
])
def test_no_entity_means_no_match(sheet):
    assert cands(sheet, ["genericString1", "externalCode", "first-name"]) == {}


def test_friendly_headers_do_not_false_match():
    hits = cands("Pay Range Data", ["Pay Range Code", "Min", "Max", "Pay Grade"], "grid")
    assert set(hits["FOPAYRANGE"]) == {"Pay Range Code"}  # the code alias only; Min, Max, Pay Grade stay unmatched


def test_foundation_pay_component_grid_stays_unfilled():
    assert cands("Pay Component Values (US)", ["externalCode"], "grid") == {}
