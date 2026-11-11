"""A target workbook column the dictionary lacks is learned for the system, then extracted and filled."""
from api.services.migration import workbook as wb
from api.services.source_design import with_learned
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def book(name, ids, kind="grid"):
    return wb.Workbook([wb.Sheet(name, kind, [wb.Column(header=i, id=i) for i in ids])], {}, None)


def test_unmatched_plain_property_is_learned_on_the_entitys_home_table():
    learned = wb.learn(book("Frequency Values", ["externalCode", "annualizationFactorX", "cust-thing", "name.en_US", "a/b"]), D)
    assert learned == {"FOFREQUENCY": {"ANNUALIZATION_FACTOR_X": "FOFrequency.annualizationFactorX",
                                       "CUST_THING": "FOFrequency.custThing"}}


def test_matched_columns_and_unknown_sheets_teach_nothing():
    assert wb.learn(book("Frequency Values", ["externalCode"]), D) == {}
    assert wb.learn(book("Some Unknown Sheet", ["fooBar", "bazQux"]), D) == {}


def test_learned_field_makes_the_column_match_next_time():
    b = book("Frequency Values", ["externalCode", "annualizationFactorX"])
    learned_d = with_learned(D, wb.learn(b, D))
    f = learned_d.field("FOFREQUENCY", "ANNUALIZATION_FACTOR_X")
    assert f.source == "FOFrequency.annualizationFactorX" and f.provenance == "workbook"
    assert "annualizationFactorX" in wb._candidates(b.sheets[0], learned_d)["FOFREQUENCY"]
    assert D.field("FOFREQUENCY", "ANNUALIZATION_FACTOR_X") is None  # the shared dictionary is untouched
    assert wb.learn(b, learned_d) == {}


def test_learned_field_the_tenant_did_not_return_is_reported_missing_not_waiting():
    from api.routes.migration import _learned_pending, _mark_learned

    learned_d = with_learned(D, {"FOFREQUENCY": {"ANNUALIZATION_FACTOR_X": "FOFrequency.annualizationFactorX",
                                                 "SENIORITY_X": "FOFrequency.seniorityX"}})
    meta = {"coverage": [{"table": "FOFREQUENCY←FOFrequency", "status": "partial",
                          "unavailable_fields": ["SENIORITY_X"]}]}
    pending = _learned_pending(meta, learned_d)
    assert pending == {"annualizationFactorX": False, "seniorityX": True}
    report = {"sheets": [{"unmapped": [{"id": "annualizationFactorX"}, {"id": "seniorityX"}, {"id": "cust-x"}]}]}
    assert _mark_learned(report, pending) == (1, 1)
    cols = report["sheets"][0]["unmapped"]
    assert [(c["learned"], c["not_in_system"]) for c in cols] == [(True, False), (False, True), (False, False)]


def test_navigation_is_learned_as_nav_prop_and_control_ids_never():
    b = book("Frequency Values", ["externalCode", "homeAddress.zip-code", "operation", "annualizationFactorX"])
    learned = wb.learn(b, D)
    assert learned == {"FOFREQUENCY": {"ANNUALIZATION_FACTOR_X": "FOFrequency.annualizationFactorX",
                                       "HOME_ADDRESS_ZIP_CODE": "FOFrequency.homeAddress.zipCode"}}
    # the learned navigation fills its column next time
    assert "homeAddress.zip-code" in wb._candidates(b.sheets[0], with_learned(D, learned))["FOFREQUENCY"]


def test_resolver_reads_a_learned_navigation_through_expand():
    from sap.successfactors import resolve_property
    navs = {"homeAddress": {"city", "zipCode"}}
    assert resolve_property("homeAddress.zipCode", {"userId"}, navs) == "homeAddress.zipCode"
    assert resolve_property("homeAddress.nope", {"userId"}, navs) is None


def _without_entity(entity):
    from dataclasses import replace
    return replace(D, tables={k: t for k, t in D.tables.items()
                              if not any((f.source or "").startswith(f"{entity}.") for f in t.fields.values())})


def test_entity_no_table_reads_gets_a_table_of_its_own():
    d = _without_entity("FOFrequency")
    b = book("Frequency Values", ["externalCode", "annualizationFactor"])
    learned = wb.learn(b, d)
    assert learned == {"FOFREQUENCY": {"EXTERNAL_CODE": "FOFrequency.externalCode",
                                       "ANNUALIZATION_FACTOR": "FOFrequency.annualizationFactor"}}
    t = with_learned(d, learned).tables["FOFREQUENCY"]
    assert t.provenance == "canonical:successfactors-workbook" and t.keys == ("EXTERNAL_CODE",)
    assert t.description == "FOFrequency" and all(f.provenance == "workbook" for f in t.fields.values())
    assert wb.learn(b, with_learned(d, learned)) == {}


def test_learned_known_field_is_marked_workbook_and_absent_sap_table_is_skipped():
    known = next(iter(D.tables["MARA"].fields))
    d = with_learned(D, {"MARA": {known: f"MARA.{known}"}, "ZZTAB": {"ZZFOO": "ZZTAB.ZZFOO"}})
    assert d.field("MARA", known).provenance == "workbook"
    assert "ZZTAB" not in d.tables  # an SAP table waits for its DDIC definition
