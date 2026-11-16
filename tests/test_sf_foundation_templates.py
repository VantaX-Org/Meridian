"""SuccessFactors import templates in load order: foundation objects, Position, Job, then the other modules.
Synthetic data only, no tenant."""
import pandas as pd

from api.services.migration import workbook as wb
from api.services.migration.export import LOAD_ORDER_TAB, load_order, load_sequence
from api.services.migration.load_plan import EC_LOAD_ORDER
from sap.ddic import get_dictionary
from sap.extraction_registry import get_extraction_targets

D = get_dictionary("s4hana")  # every release dictionary carries the canonical SuccessFactors tables


def test_blank_sf_templates_follow_load_order():
    tabs = wb.sf_load_templates(D, {})
    names = list(tabs)
    assert names[:2] == [wb.INSTRUCTIONS_TAB, LOAD_ORDER_TAB]
    at = names.index
    assert at("FOCompany") < at("FOPayGrade") < at("FOJobCode") < at("Position") < at("EmpEmployment") < at("EmpJob")
    assert at("EmpJob") < at("EmpCompensation") < at("Goal")
    assert at("FOCompany Values") < at("FOJobCode Values") < at("Position Values") < at("EmpEmployment Values")
    # the pay component template carries its own property ids, not the technical TABLE-FIELD grid
    assert "externalCode" in tabs["FOPayComponent Values"].columns and "SAP FOPAYCOMPONENT Data" not in tabs

    index = tabs[LOAD_ORDER_TAB].set_index("Table")
    assert list(index["Order"]) == list(range(1, len(index) + 1))
    assert index.loc["FOCOMPANY", "Step"] < index.loc["COMPINFO", "Step"] < index.loc["GOALPLAN", "Step"]
    assert "FOPAYGRADE" in index.loc["FOJOBCODE", "Load after"].split(", ")
    assert {"FOCOMPANY", "FOJOBCODE", "FOEVENTREASON"} <= set(index.loc["EMPJOBHIST", "Load after"].split(", "))
    assert "EMPEMPLOYMENT" in index.loc["COMPINFO", "Load after"].split(", ")


def test_ec_tables_load_after_their_check_tables():
    pos = {t: i for i, t in enumerate(EC_LOAD_ORDER)}
    accepted = {("FOPAYCOMPONENT", "FOPAYCOMPONENTGROUP")}  # each checks the other; components load first
    late = {(t, (f.check_table or "").upper()) for t in EC_LOAD_ORDER if D.table(t)
            for f in D.table(t).fields.values() if pos.get((f.check_table or "").upper(), -1) > pos[t]}
    assert late == accepted


def test_run_export_index_names_each_table_in_order():
    tables = {"COMPINFO": pd.DataFrame(), "EMPEMPLOYMENT": pd.DataFrame(), "FOCOMPANY": pd.DataFrame()}
    ordered = load_order(tables, ["employee_central", "compensation"], D)
    assert list(ordered) == ["FOCOMPANY", "EMPEMPLOYMENT", "COMPINFO"]
    index = load_sequence(list(ordered), ["employee_central", "compensation"], D)
    assert list(index["Table"]) == list(ordered)
    assert list(index["Object"]) == ["employee_central", "employee_central", "compensation"]
    assert index.set_index("Table").loc["EMPEMPLOYMENT", "Load after"] == "FOCOMPANY"


def test_new_foundation_targets_read_canonical_fields():
    targets = {t.source: t for t in get_extraction_targets("successfactors", "employee_central")}
    for entity in ("FOJobFunction", "FOGeozone", "FOPayRange", "FOFrequency", "FOPayComponent",
                   "FOPayComponentGroup", "FOJobCode", "FOLocation", "FOEventReason", "Position"):
        target = targets[entity]
        canonical = D.table(entity.upper())
        for prop in target.fields:
            column = target.rename_map.get(prop)
            if column:  # every renamed property lands on a real canonical column
                assert column in canonical.fields, (entity, prop, column)
    assert {"isFulltimeEmployee", "employeeClass", "regularTemporary"} <= set(targets["FOJobCode"].fields)
    assert {"multipleIncumbentsAllowed", "incumbent", "parentPosition/code"} <= set(targets["Position"].fields)
