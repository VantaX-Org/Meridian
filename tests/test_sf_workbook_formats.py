"""Every workbook field type is checked deterministically; each problem names the column and says why."""
import pandas as pd
import pytest

from api.services.migration import workbook as wb

PICK = {"gender": {"F", "M"}}


def bad(col, values, picks=PICK):
    """Reason codes that fire, with the number of rows each flags."""
    out = {}
    for mask, reason in wb._problems(col, pd.Series(values, dtype="object"), picks):
        if mask.sum():
            out[reason] = int(mask.sum())
    return out


def C(type="", **kw):
    return wb.Column(header="x", id=kw.pop("id", "x"), type=type, **kw)


@pytest.mark.parametrize("type,good,wrong,reason", [
    ("DATE", ["2020-01-31", "31/01/2020", "2020-01-31 00:00:00"], ["not a date", "2020-13-45"], "bad_date"),
    ("BOOLEAN", ["true", "FALSE", "Yes", "n", "0", "1"], ["maybe", "2"], "bad_boolean"),
    ("LONG", ["5", "-7", "+3", "12.0", " 9 "], ["1.5", "abc", "1,000", "9223372036854775808", "1e3"], "bad_whole_number"),
    ("DOUBLE", ["1.5", "-2", "3e2", "0"], ["x", "1,5", "inf", "nan1"], "bad_number"),
    ("DECIMAL", ["10.25", "7"], ["ten", "1.2.3"], "bad_number"),
    ("NUMBER", ["10.25", "7"], ["ten"], "bad_number"),
])
def test_typed_columns(type, good, wrong, reason):
    assert bad(C(type), good) == {}
    assert bad(C(type), wrong) == {reason: len(wrong)}


def test_blank_cells_are_not_type_errors():
    for t in ["DATE", "BOOLEAN", "LONG", "DOUBLE", "DECIMAL", "NUMBER", "PICKLIST", "ENUM", "STRING", ""]:
        assert bad(C(t), ["", None, "  "]) == {}


@pytest.mark.parametrize("type", ["PICKLIST", "ENUM", "STRING", ""])
def test_picklist_binds_whatever_the_type(type):
    col = C(type, picklist="Gender")
    assert bad(col, ["F", "M"]) == {}
    assert bad(col, ["F", "X"]) == {"not_in_picklist": 1}


def test_unknown_picklist_cannot_be_checked():
    assert bad(C("PICKLIST", picklist="NOPE"), ["anything"]) == {}


@pytest.mark.parametrize("type", ["STRING", "PICKLIST", "GO", "USER", "COUNTRY", ""])
def test_length_applies_to_every_type(type):
    col = C(type, max_length=3)
    assert bad(col, ["abc", ""]) == {}
    assert bad(col, ["abcd"]) == {"too_long": 1}


def test_mandatory_and_country_scope():
    assert bad(C("STRING", mandatory=True), ["a", "", None]) == {"mandatory": 2}
    assert bad(C("STRING", mandatory=True, country="FRA"), ["", None]) == {}  # mandatory for that country only


@pytest.mark.parametrize("id", ["externalCode", "userId", "personIdExternal", "person-id-external", "zip-code", "code"])
def test_identifier_format(id):
    col = C("STRING", id=id)
    assert bad(col, ["A1"]) == {}
    assert bad(col, [" A1", "A1 ", "A\t1"]) == {"bad_id": 3}


def test_other_columns_are_not_id_checked():
    assert bad(C("STRING", id="description"), [" padded "]) == {}


def test_problem_text_names_column_and_reason_from_the_definition():
    col = wb.Column("end-date", "end-date", label="End Date", type="DATE", max_length=10, picklist="Gender")
    assert wb.explain(col, "bad_date") == "Column end-date (End Date) holds a value that is not a date."
    assert "10 characters" in wb.explain(col, "too_long")
    assert "picklist Gender" in wb.explain(col, "not_in_picklist")
    assert "type DATE" not in wb.explain(col, "bad_date")
    for reason in wb._WHY:
        assert wb.explain(col, reason).startswith("Column end-date")


def test_held_rows_carry_the_detail():
    import tests.test_migration_workbook as m
    _, report = wb.fill(wb.parse_workbook(m.sample()), m.frames())
    assert report["held"] and all(h["detail"].startswith(f"Column {h['field']}") for h in report["held"])
