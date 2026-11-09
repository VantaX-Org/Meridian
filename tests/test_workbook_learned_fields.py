"""A target workbook column the dictionary lacks is learned for the system, then extracted and filled."""
from api.services.migration import workbook as wb
from api.services.source_design import with_learned
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def book(name, ids, kind="grid"):
    return wb.Workbook([wb.Sheet(name, kind, [wb.Column(header=i, id=i) for i in ids])], {}, None)


def test_unmatched_plain_property_is_learned_on_the_entitys_home_table():
    learned = wb.learn(book("Frequency Values", ["externalCode", "annualizationFactorX", "cust-thing", "a.b"]), D)
    assert learned == {"FOFREQUENCY": {"ANNUALIZATION_FACTOR_X": "FOFrequency.annualizationFactorX"}}


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
