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


def test_no_entity_means_no_match():
    # the dependants' country-specific info would fill with the employee's own, so it stays unmapped
    assert cands("CSF Dependents", ["genericString1", "externalCode", "first-name"]) == {}


@pytest.mark.parametrize("sheet,col,table", [
    ("CSF Personal Info (Global Info)", "person-id-external", "PER_GLOBAL_INFO"),
    ("CSF Legal Entity", "externalCode", "FO_LEGAL_ENTITY_LOCAL"),
    ("CSF Job Classification", "externalCode", "FO_JOB_CLASS_LOCAL"),
])
def test_country_specific_sheet_reads_its_family(sheet, col, table):
    assert col in cands(sheet, [col]).get(table, {})


def test_friendly_headers_map_on_their_own_entity_only():
    hits = cands("Pay Range Data", ["Pay Range Code", "Min", "Mid", "Max", "Pay Grade", "Legal Entity"], "grid")
    got = {h: f.source for h, f in hits["FOPAYRANGE"].items()}
    assert got == {"Pay Range Code": "FOPayRange.externalCode", "Min": "FOPayRange.minimumPay",
                   "Mid": "FOPayRange.midPoint", "Max": "FOPayRange.maximumPay",
                   "Pay Grade": "FOPayRange.payGradeFlx", "Legal Entity": "FOPayRange.companyFlx"}
    # Min is a pay range alias: a location has no minimum pay, so the column stays unmapped there
    loc = cands("Location Values", ["Location Code", "Min", "Location Name", "Address Line 1", "Parent Legal Entity"], "grid")
    assert set(loc["FOLOCATION"]) == {"Location Code", "Location Name", "Address Line 1", "Parent Legal Entity"}
    cc = cands("Cost Centre Data", ["Cost Centre Code", "Parent Cost Centre", "Parent Legal Entity", "Custom Field 1"], "grid")
    assert {h: f.source for h, f in cc["FOCOSTCENTER"].items()} == {
        "Cost Centre Code": "FOCostCenter.externalCode", "Parent Cost Centre": "FOCostCenter.parent",
        "Parent Legal Entity": "FOCostCenter.cust_toLegalEntity.externalCode"}


def test_position_external_name_matches_default_value():
    assert cands("Position", ["code", "externalName"])["POSITION"]["externalName"].source == "Position.externalName_defaultValue"


def test_foundation_pay_component_grid_fills_from_the_component_definitions():
    hits = cands("Pay Component Values (US)", ["externalCode", "is-earning", "payComponentType", "LegalEntity.externalCode"], "grid")
    assert set(hits["FOPAYCOMPONENT"]) == {"externalCode", "is-earning", "payComponentType", "LegalEntity.externalCode"}


@pytest.mark.parametrize("sheet,col", [
    ("PersonInfo", "person-id-external"),
    ("PersonRelationshipInfo", "related-person-id-external"),
    ("BasicUserInfo", "USERID"),
])
def test_employee_template_sheets_resolve_to_their_entity(sheet, col):
    hits = cands(sheet, [col])
    assert any(col in h for h in hits.values()), hits


def test_a_navigation_id_matches_only_a_key_by_its_tail():
    hits = cands("PersonInfo", ["personInfo.person-id-external", "homeAddress.city"])
    assert any("personInfo.person-id-external" in h for h in hits.values())
    assert not any("homeAddress.city" in h for h in hits.values())


def test_operation_is_an_import_control_column_not_a_gap():
    assert "operation" in wb.IMPORT_CONTROL
    assert wb._norm("OPERATION") in wb.IMPORT_CONTROL


def test_job_info_takes_the_dated_job_history_over_employment():
    s = wb.Sheet("Job Info", "definition", [wb.Column(header=i, id=i) for i in
                 ["company", "department", "job-code", "position", "hireDate",
                  "payScaleArea", "payScaleType", "pay-grade", "payScaleLevel"]])
    m = wb._matched(s, D)
    assert {"EMPJOBHIST", "EMPEMPLOYMENT"} <= set(m)
    assert wb._pick(m, s, D) == "EMPJOBHIST"


def test_payment_info_worker_and_start_date_map_to_the_parent_keys():
    hits = cands("Payment Info", ["worker", "effectiveStartDate", "bank", "accountNumber"])
    got = {h: f.name for h, f in hits.get("PAYMENTINFO", {}).items()}
    assert got.get("worker") == "USERID" and got.get("effectiveStartDate") == "EFFECTIVE_DATE", got


def test_dependents_date_of_birth_is_the_dependants_own():
    hits = cands("Dependents", ["person-id-external", "related-person-id-external", "date-of-birth"])
    assert hits["DEPENDENT"]["date-of-birth"].name == "DEPENDENT_BIRTH"
