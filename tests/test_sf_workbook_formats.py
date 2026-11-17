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


def test_country_rows_keep_their_own_picklist():
    head = ("Country", "Field ID", "SF Label", "Type", "Max Length", "Visibility", "Mandatory", "Picklist")
    rows = [head,
            ("Botswana (BWA)", "address7", "District", "PICKLIST", 256, "Edit", "No", "District_BWA"),
            ("South Africa (ZAF)", "address7", "District", "PICKLIST", 256, "Edit", "Yes", "District_ZAF"),
            ("Namibia (NAM)", "address7", "District", "STRING", 256, "Edit", "No", "")]
    head_map = {wb._norm(c): i for i, c in enumerate(head)}
    sheet = wb._definition("Addresses", rows, 0, head_map[wb._norm("Field ID")])
    (col,) = sheet.columns
    assert col.picklist == ""  # no one list holds for every country
    assert col.country_picklists["BWA"] == "District_BWA" and col.country_picklists["ZAF"] == "District_ZAF"
    assert col.country_picklists["NAM"] == ""
    assert "ZAF" in col.country_mandatory and "BWA" not in col.country_mandatory
    assert bad(col, ["anything"]) == {}  # the static check no longer applies one country's list to all rows


@pytest.mark.parametrize("value,allowed,want", [
    ("Home", {"home", "business"}, "home"),
    ("1", {"01", "02"}, "01"),
    ("1611_R", {"R", "S"}, "R"),
    ("zz", {"R", "S"}, "zz"),        # no match: left alone
    ("a", {"A", "a2"}, "A"),
    ("x", {"X", "x"}, "x"),          # already allowed: untouched
])
def test_snap_to_picklist(value, allowed, want):
    assert wb.snap_to_picklist(pd.Series([value], dtype="object"), allowed).iloc[0] == want


def test_snap_refuses_ambiguous_match():
    assert wb.snap_to_picklist(pd.Series(["ab"], dtype="object"), {"AB", "Ab"}).iloc[0] == "ab"


def test_boolean_length_and_word_numeric():
    assert bad(C("BOOLEAN", max_length=1), ["true", "false"]) == {}
    assert bad(C("DOUBLE", id="payComponentType"), ["Amount", "Percentage"]) == {}


def test_primary_first_tolerates_duplicate_columns():
    from api.services.connectivity_manager import _primary_first
    df = pd.DataFrame([["false", "a"], ["true", "b"]], columns=["P.IS_PRIMARY", "P.IS_PRIMARY"])
    assert list(_primary_first(df, "P.IS_PRIMARY").iloc[:, 1]) == ["b", "a"]
