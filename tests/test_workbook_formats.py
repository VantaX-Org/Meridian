"""Every migration file format reads, refuses cleanly, fills by its own rules, and writes back in its own layout."""

import io
import zipfile
from pathlib import Path

import pandas as pd
import pytest
from openpyxl import Workbook as Book

from api.services.migration import workbook as wb
from api.services.migration import workbook_formats as wf
from checks.frames import TableFrames
from sap.ddic import get_dictionary

SS = "urn:schemas-microsoft-com:office:spreadsheet"


def xlsx(*sheets) -> bytes:
    book = Book()
    book.remove(book.active)
    for name, rows in sheets:
        ws = book.create_sheet(name)
        for row in rows:
            ws.append(row)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def spreadsheet_xml(*sheets) -> bytes:
    def row(cells):
        return "<Row>" + "".join(f'<Cell><Data ss:Type="String">{c}</Data></Cell>' for c in cells) + "</Row>"

    body = "".join(f'<Worksheet ss:Name="{n}"><Table ss:ExpandedRowCount="99">{"".join(map(row, rows))}</Table></Worksheet>'
                   for n, rows in sheets)
    return (f'<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="{SS}" xmlns:ss="{SS}">'
            f"{body}</Workbook>").encode()


def ods(rows) -> bytes:
    """The smallest OpenDocument spreadsheet a reader accepts."""
    cells = "".join("<table:table-row>" + "".join(
        f'<table:table-cell office:value-type="string"><text:p>{c}</text:p></table:table-cell>' for c in row)
        + "</table:table-row>" for row in rows)
    content = ('<?xml version="1.0" encoding="UTF-8"?><office:document-content '
               'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
               'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
               'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body>'
               f'<office:spreadsheet><table:table table:name="Data">{cells}</table:table></office:spreadsheet>'
               "</office:body></office:document-content>")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("mimetype", "application/vnd.oasis.opendocument.spreadsheet", zipfile.ZIP_STORED)
        z.writestr("content.xml", content)
        z.writestr("META-INF/manifest.xml", '<?xml version="1.0"?><manifest:manifest '
                   'xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>')
    return out.getvalue()


def archive(**files) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, data in files.items():
            z.writestr(name.replace("__", "."), data)
    return out.getvalue()


FIELD_LIST = ["Sheet Name", "Group Name", "Field Description", "Importance", "Type", "Length", "Decimal",
              "SAP Structure", "SAP Field"]


def cockpit() -> bytes:
    return spreadsheet_xml(
        ("Introduction", [["Read me"]]),
        ("Field List", [
            FIELD_LIST,
            ["Basic Data", "Key", "Material Number", "Mandatory for sheet", "Text", "40", "", "S_MARA", "MATNR"],
            ["", "Key", "Material Type", "Mandatory for sheet", "Text", "4", "", "S_MARA", "MTART"],
            ["", "Key", "Field Nobody Holds", "", "Text", "4", "", "S_MARA", "ZZNONE"],
            ["Plant Data", "Key", "Plant", "Mandatory for sheet", "Text", "4", "", "S_MARC", "WERKS"],
        ]),
        ("Basic Data Mandatory", [
            ["Material Number*", "Material Type*", "Field Nobody Holds"],
            ["MATNR", "MTART", "ZZNONE"],
        ]),
        ("Plant Data", [["Plant*"], ["WERKS"]]),
    )


def materials(**columns) -> TableFrames:
    data = {"MARA.MATNR": ["M1", "M2"], "MARA.MTART": ["ROH", "FERT"]} | columns
    return TableFrames({"MARA": pd.DataFrame(data)}, get_dictionary("s4hana"))


def people(columns: dict) -> TableFrames:
    return TableFrames({"EMPEMPLOYMENT": pd.DataFrame(columns)}, get_dictionary("s4hana"))


def sheet(book, name):
    return next(s for s in book.sheets if s.name == name)


# The formats


def grid_rows(data, name=""):
    return wf.read_source(data, name).sheets[0][1]


def test_reads_xlsx_with_format_named():
    source = wf.read_source(xlsx(("A", [["x", "y"], ["1", "2"]])), "a.xlsx")
    assert source.format == "xlsx" and [n for n, _ in source.sheets] == ["A"]


def test_reads_a_real_excel_97_file():  # synthetic content, written by xlwt, so the BIFF path is not only a mock
    source = wf.read_source(Path("tests/fixtures/legal_entity.xls").read_bytes(), "legal_entity.xls")
    assert source.format == "xls"
    assert source.sheets == [("Legal Entity", [("externalCode", "effectiveStatus"), ("C1", "A")])]


def test_reads_open_document():
    source = wf.read_source(ods([["x", "y"], ["1", "2"]]), "a.ods")
    assert source.format == "ods"
    assert [str(c) for c in source.sheets[0][1][1]][:2] == ["1", "2"]


def test_reads_spreadsheet_2003_xml_with_skipped_cells():
    text = (f'<?xml version="1.0"?><Workbook xmlns="{SS}" xmlns:ss="{SS}"><Worksheet ss:Name="A"><Table>'
            '<Row><Cell><Data ss:Type="String">a</Data></Cell>'
            '<Cell ss:Index="3"><Data ss:Type="String">c</Data></Cell></Row></Table></Worksheet></Workbook>').encode()
    source = wf.read_source(text, "a.xml")
    assert source.format == "xml2003"
    assert [c or "" for c in source.sheets[0][1][0]][:3] == ["a", "", "c"]


@pytest.mark.parametrize("delimiter", [",", ";", "\t", "|"])
def test_reads_each_delimiter(delimiter):
    text = f"id{delimiter}name\n1{delimiter}Ann\n".encode()
    source = wf.read_source(text, "load.csv")
    assert source.format == "delimited" and source.delimiter == delimiter
    assert [str(c) for c in source.sheets[0][1][1]] == ["1", "Ann"]


@pytest.mark.parametrize("encoding", ["utf-8", "utf-8-sig", "utf-16", "cp1252"])
def test_reads_each_encoding(encoding):
    source = wf.read_source("id,name\n1,José\n".encode(encoding), "load.csv")
    assert [str(c) for c in source.sheets[0][1][1]] == ["1", "José"]


def test_lsmw_tab_text_keeps_tabs_on_the_way_back():
    data = "MATNR\tMTART\nM0\tROH\n".encode()
    book = wb.parse_workbook(data, "materials.txt")
    tabs, report = wb.fill(book, materials())
    assert report["format"]["same"] is True and report["format"]["written_as"] == "txt"
    out, ext = wb.same_format(book, tabs, None)
    assert ext == "txt"
    assert out.decode().splitlines()[0] == "MATNR\tMTART" and "M1\tROH" in out.decode()


def test_zip_reads_each_member_and_names_what_it_skipped():
    data = archive(a__csv="MATNR,MTART\n", b__csv="id,name\n1,Ann\n", readme__pdf=b"%PDF")
    source = wf.read_source(data, "load.zip")
    assert source.format == "archive"
    assert {m.name for m in source.members} == {"a.csv", "b.csv"}
    assert source.skipped == ["readme.pdf"]


def test_zip_with_nothing_readable_is_refused():
    with pytest.raises(wf.WorkbookError, match="No workbook or load file"):
        wf.read_source(archive(readme__pdf=b"%PDF"), "load.zip")


@pytest.mark.parametrize("data,name", [(b"", "a.csv"), (b"", "a.xlsx")])
def test_empty_files_are_refused(data, name):
    with pytest.raises(wf.WorkbookError, match="empty"):
        wf.read_source(data, name)


def test_damaged_files_say_so_and_never_leak_a_parser_error():
    for data, name in [(b"PK\x03\x04broken", "a.xlsx"), (b"<Workbook", "a.xml"), (b"\xd0\xcf\x11\xe0broken", "a.xls")]:
        with pytest.raises(wf.WorkbookError) as e:
            wf.read_source(data, name)
        assert "Traceback" not in str(e.value) and str(e.value)


def test_xml_entity_expansion_is_refused():
    bomb = (b'<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]>'
            b'<Workbook xmlns="' + SS.encode() + b'"><Worksheet><Table><Row><Cell><Data>&b;</Data></Cell></Row>'
            b"</Table></Worksheet></Workbook>")
    with pytest.raises(wf.WorkbookError):
        wf.read_source(bomb, "a.xml")


# The S/4HANA Migration Cockpit


def test_cockpit_field_list_defines_the_sheets():
    book = wb.parse_workbook(cockpit(), "materials.xml")
    basic = sheet(book, "Basic Data Mandatory")
    assert [c.id for c in basic.columns] == ["MATNR", "MTART", "ZZNONE"]
    assert basic.required is True and sheet(book, "Plant Data").required is False
    assert [c.pos for c in basic.columns] == [0, 1, 2]
    assert basic.columns[0].mandatory and basic.columns[0].max_length == 40 and not basic.columns[2].mandatory


def test_cockpit_fills_only_real_fields_and_reports_the_rest():
    book = wb.parse_workbook(cockpit(), "materials.xml")
    tabs, report = wb.fill(book, materials())
    row = next(r for r in report["sheets"] if r["name"] == "Basic Data Mandatory")
    assert row["table"] == "MARA" and row["matched"] == 2 and row["ready"] == 2
    assert [u["id"] for u in row["unmapped"]] == ["ZZNONE"]
    assert report["summary"]["mandatory_sheets_empty"] == 0
    assert report["format"] == {"id": "xml2003", "same": True, "written_as": "xml", "skipped": []}


def test_empty_mandatory_cockpit_sheet_is_counted():
    book = wb.parse_workbook(cockpit(), "materials.xml")
    empty = TableFrames({"MARC": pd.DataFrame({"MARC.WERKS": ["1000"], "MARC.MATNR": ["M1"]})},
                        get_dictionary("s4hana"))
    _, report = wb.fill(book, empty)
    assert report["summary"]["mandatory_sheets_empty"] == 1


def test_cockpit_write_keeps_every_sheet_and_adds_rows_under_the_template():
    book = wb.parse_workbook(cockpit(), "materials.xml")
    tabs, _ = wb.fill(book, materials())
    out, ext = wb.same_format(book, tabs, None)
    assert ext == "xml"
    back = wf.read_source(out, "materials.xml")
    assert [n for n, _ in back.sheets] == ["Introduction", "Field List", "Basic Data Mandatory", "Plant Data"]
    rows = dict(back.sheets)["Basic Data Mandatory"]
    assert [list(r)[:2] for r in rows[2:]] == [["M1", "ROH"], ["M2", "FERT"]]
    assert b"mso-application" in out  # Excel still opens it as a spreadsheet
    assert out.count(b"ExpandedRowCount") == 3  # gone from the filled sheet: a stale count makes Excel refuse the file


def test_cockpit_values_are_escaped():
    book = wb.parse_workbook(cockpit(), "materials.xml")
    frames = TableFrames({"MARA": pd.DataFrame({"MARA.MATNR": ["A&B<C"], "MARA.MTART": ["ROH"]})},
                         get_dictionary("s4hana"))
    tabs, _ = wb.fill(book, frames)
    out, _ = wb.same_format(book, tabs, None)
    assert list(dict(wf.read_source(out, "m.xml").sheets)["Basic Data Mandatory"][2])[0] == "A&B<C"


def test_held_rows_travel_beside_the_load_file_never_inside_it():
    book = wb.parse_workbook(cockpit(), "materials.xml")
    long = TableFrames({"MARA": pd.DataFrame({"MARA.MATNR": ["M1", "M2"], "MARA.MTART": ["ROH", "TOOLONG"]})},
                       get_dictionary("s4hana"))
    tabs, report = wb.fill(book, long)
    assert report["format"]["written_as"] == "zip"
    out, ext = wb.same_format(book, tabs, b"sheet,record\n")
    assert ext == "zip"
    with zipfile.ZipFile(io.BytesIO(out)) as z:
        assert set(z.namelist()) == {"materials.xml", wf.HELD_BACK_FILE}
        assert b"TOOLONG" not in z.read("materials.xml")


# Same format, for the other layouts


def test_semicolon_cp1252_file_comes_back_the_same():
    data = "MATNR;MTART\r\nMat\u00e9riel;Type\r\n".encode("cp1252")  # plain ASCII would not show the code page
    book = wb.parse_workbook(data, "m.csv")
    tabs, _ = wb.fill(book, TableFrames(
        {"MARA": pd.DataFrame({"MARA.MATNR": ["Café"], "MARA.MTART": ["ROH"]})}, get_dictionary("s4hana")))
    out, _ = wb.same_format(book, tabs, None)
    assert out == "MATNR;MTART\r\nMat\u00e9riel;Type\r\nCaf\u00e9;ROH\r\n".encode("cp1252")


def test_a_name_outside_the_code_page_moves_the_file_to_utf8_rather_than_losing_it():
    book = wb.parse_workbook("MATNR;MTART\r\nMat\u00e9riel;Type\r\n".encode("cp1252"), "m.csv")
    tabs, _ = wb.fill(book, TableFrames(
        {"MARA": pd.DataFrame({"MARA.MATNR": ["東京"], "MARA.MTART": ["ROH"]})}, get_dictionary("s4hana")))
    out, _ = wb.same_format(book, tabs, None)
    assert "東京" in out.decode("utf-8-sig")


def test_xlsx_formula_text_stays_text():
    book = wb.parse_workbook(xlsx(("Load", [["MATNR", "MTART"]])), "m.xlsx")
    tabs, _ = wb.fill(book, TableFrames(
        {"MARA": pd.DataFrame({"MARA.MATNR": ["=1+1"], "MARA.MTART": ["ROH"]})}, get_dictionary("s4hana")))
    out, _ = wb.same_format(book, tabs, None)
    assert b"<f>" not in zipfile.ZipFile(io.BytesIO(out)).read("xl/worksheets/sheet1.xml")


def test_definition_sheets_have_no_same_format():
    head = ["", "", "System Field Id", "SF Label", "Type", "Max Length", "Visibility", "Mandatory", "Picklist"]
    book = wb.parse_workbook(xlsx(("Personal Info", [["T"], [], [], head,
                                                    ["", "", "first-name", "First", "STRING", 9, "Edit", "No", ""]])))
    frames = TableFrames({"PERINFO": pd.DataFrame({"PERINFO.PERSON_ID": ["P1"], "PERINFO.FIRSTNAME": ["Ann"]})},
                         get_dictionary("s4hana"))
    assert wb.fill(book, frames)[1]["format"]["same"] is False


# Value maps


def load_file():
    return wb.parse_workbook(b"MATNR,MTART\n", "m.csv")


def test_value_map_translates_and_counts():
    tabs, report = wb.fill(load_file(), materials(), {"MTART": {"ROH": "RAW"}})
    assert tabs["m"]["MTART"].tolist() == ["RAW", "FERT"]
    assert report["summary"]["mapped_values"] == 1 and report["summary"]["held"] == 0


def test_strict_map_holds_what_it_does_not_cover():
    tabs, report = wb.fill(load_file(), materials(), {"MTART": {"ROH": "RAW"}}, {"MTART"})
    assert tabs["m"]["MTART"].tolist() == ["RAW"]
    assert report["reasons"] == {"value_map": 1} and report["held"][0]["record"] == "MATNR=M2"


def test_map_runs_before_the_rules():
    book = wb.parse_workbook(b"MATNR,MTART\n", "m.csv")
    next(c for c in book.sheets[0].columns if c.id == "MTART").max_length = 3
    tabs, report = wb.fill(book, materials(), {"MTART": {"FERT": "FIN", "ROH": "RAW"}})
    assert report["summary"]["held"] == 0 and tabs["m"]["MTART"].tolist() == ["RAW", "FIN"]


def test_a_blank_is_not_a_map_failure():
    _, report = wb.fill(load_file(), materials(**{"MARA.MTART": ["ROH", ""]}), {"MTART": {"ROH": "RAW"}}, {"MTART"})
    assert report["summary"]["held"] == 0


# Country rules




@pytest.fixture
def job_sheet():
    head = ["", "", "System Field Id", "SF Label", "Type", "Max Length", "Visibility", "Mandatory", "Picklist", "Country"]
    return xlsx(("Employment Info at Hire", [["T"], [], [], head, [
        "", "", "startDate", "Start", "DATE", 0, "Edit", "Yes", "", "Brazil (BRA)"]]))


def test_country_mandatory_holds_only_that_country(job_sheet):
    frames = people({"EMPEMPLOYMENT.USERID": ["U1", "U2", "U3"], "EMPEMPLOYMENT.START_DATE": ["", "", "2020-01-01"],
                     "EMPEMPLOYMENT.COUNTRY_OF_COMPANY": ["BRA", "DEU", "BR"]})
    _, report = wb.fill(wb.parse_workbook(job_sheet), frames)
    assert report["reasons"] == {"mandatory_for_country": 1}
    assert [h["record"] for h in report["held"]] == ["USERID=U1"]


def test_country_rule_with_no_country_on_the_record_is_reported_not_guessed(job_sheet):
    frames = people({"EMPEMPLOYMENT.USERID": ["U1"], "EMPEMPLOYMENT.START_DATE": [""]})
    _, report = wb.fill(wb.parse_workbook(job_sheet), frames)
    assert report["reasons"] == {} and report["country_unchecked"][0]["id"] == "startDate"


def test_sap_zero_dates_count_as_blank(job_sheet):
    frames = people({"EMPEMPLOYMENT.USERID": ["U1"], "EMPEMPLOYMENT.START_DATE": ["00000000"],
                     "EMPEMPLOYMENT.COUNTRY_OF_COMPANY": ["BRA"]})
    _, report = wb.fill(wb.parse_workbook(job_sheet), frames)
    assert report["reasons"] == {"mandatory_for_country": 1}
