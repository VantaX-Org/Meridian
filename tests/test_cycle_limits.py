"""Clean cycle limits and reasons: CSV refusal, renamed sheets, row cap while reading, rejected rows with row numbers,
why nothing applied, and splitting a big cleaning workbook (synthetic data only)."""
import io
import uuid
import zipfile

import pytest

from api.services import cleaning_workbook as cw
from api.services import cycle_limits as cl
from api.services import sf_roundtrip as rt
from api.services import upload_checks as uc
from api.services.migration.workbook_formats import WorkbookError, read_source, too_many_rows
from tests.test_cleaning_workbook import RECS, RULES, _data
from tests.test_upload_roundtrip_route import HEAD, PARENT, _good, _post, _row, _xlsx, env  # noqa: F401


def _csv(rows):
    return ("\n".join(",".join(r) for r in rows) + "\n").encode()


def test_row_cap_is_checked_while_reading_csv_and_xlsx():
    rows = [["a", "b"]] + [[str(i), "x"] for i in range(20)]
    for data, name in ((_csv(rows), "big.csv"), (_xlsx({"S": rows}, version_id=None), "big.xlsx")):
        with pytest.raises(WorkbookError) as e:
            read_source(data, name, max_rows=5)
        assert str(e.value) == too_many_rows(5)
    assert read_source(_csv(rows), "ok.csv", max_rows=100).sheets


def test_cleaning_rows_saved_as_csv_are_refused():
    with pytest.raises(rt.RoundTripError) as e:
        rt.read_upload(_csv([HEAD, ["EmpJob", "userId=u1", "jobTitle", "Lead"]]), "clean.csv")
    assert str(e.value) == cl.CSV_CLEANING


def test_renamed_cleaning_sheet_is_found_by_its_header():
    data = _xlsx({"My fixes": [HEAD, ["EmpJob", "userId=u1", "jobTitle", "Lead"]]})
    assert rt.read_upload(data, "clean.xlsx")["marker"]["kind"] == "cleaning"


def test_cleaning_file_without_its_record_sheet_is_refused():
    data = _xlsx({"Other": [["a", "b"], ["1", "2"]]})
    with pytest.raises(rt.RoundTripError) as e:
        rt.read_upload(data, "clean.xlsx")
    assert cl.RECORD_SHEET in str(e.value)


def test_rename_by_header_restores_one_matching_sheet_only():
    maps = {"EmpJob": {"table": "EmpJob", "map": {"User": "EmpJob.userId", "Title": "EmpJob.jobTitle"}}}
    out = cl.rename_by_header([("Sheet1", [("User", "Title", "Note")]), ("Other", [("x",)])], maps)
    assert [n for n, _ in out] == ["EmpJob", "Other"]
    # a sheet already present under its own name is not claimed twice
    out = cl.rename_by_header([("EmpJob", [("User", "Title")]), ("Copy", [("User", "Title")])], maps)
    assert [n for n, _ in out] == ["EmpJob", "Copy"]


def test_rejected_rows_name_the_sheet_and_excel_row():
    sheets = [("Records to clean", [tuple(HEAD), ("EmpJob", "userId=u1", "jobTitle", "Lead"),
                                    ("Nope", "userId=u2", "jobTitle", "X"), ("EmpJob", "userId=u9", "jobTitle", "Y")])]
    edits = [{"table": "EmpJob", "key": "userId=u1", "field": "jobTitle"},
             {"table": "Nope", "key": "userId=u2", "field": "jobTitle"},
             {"table": "EmpJob", "key": "userId=u9", "field": "jobTitle"}]
    result = {"no_table": ["Nope"], "no_field": [], "unmatched": [edits[2]], "unmatched_total": 5}
    rows, total = cl.rejected_rows(sheets, "cleaning", None, lambda t: [], edits, result)
    assert total == 6
    assert [(r["sheet"], r["row"], r["table"]) for r in rows] == [("Records to clean", 3, "Nope"),
                                                                   ("Records to clean", 4, "EmpJob")]
    assert "no table Nope" in rows[0]["reason"] and "No record" in rows[1]["reason"]


def test_nothing_applied_says_why():
    assert cl.nothing_applied({"unchanged": 3}, 0, already=True)[0] == "already_applied"
    assert cl.nothing_applied({"unchanged": 3}, 0, already=False)[0] == "no_changes"
    assert cl.nothing_applied({"unchanged": 0, "conflicts_total": 2}, 0, already=True)[0] == "conflicts"
    reason, detail, fix = cl.nothing_applied({"unchanged": 0}, 4, already=False)
    assert reason == "no_match" and "4 rows" in detail and "rejected rows" in fix


def test_run_of_several_objects_needs_the_object_when_the_file_has_no_marker(env):  # noqa: F811
    env.db.row = _row(modules=("employee_central", "benefits"))
    r = _post(env, _good(version_id=None), parent_version_id=str(PARENT))
    d = r.json()["detail"]
    assert r.status_code == 422 and d["error"] == "module_required"
    assert d["modules"] == ["employee_central", "benefits"] and d["fix"]
    r = _post(env, _good(version_id=None), parent_version_id=str(PARENT), module="employee_central",
              confirm_warnings="true")
    assert r.status_code == 200, r.text
    r = _post(env, _good(version_id=None), parent_version_id=str(PARENT), module="payroll")
    assert r.status_code == 422 and r.json()["detail"]["error"] == "module_mismatch"


def test_nothing_applied_lists_rejected_rows(env, monkeypatch):  # noqa: F811
    # the pre-upload keys check (dry run) finds the record; the real apply then matches nothing
    real = rt.apply_edits
    monkeypatch.setattr(rt, "apply_edits", lambda *a, dry=False, **k: (
        {"applied": 1, "unchanged": 0, "unmatched": [], "unmatched_total": 0, "no_table": [], "no_field": [],
         "total": len(a[2])} if dry else real(*a, **k)))
    env.result.update(applied=0, unmatched=[{"table": "EmpJob", "key": "userId=u1", "field": "jobTitle"}],
                      unmatched_total=1)
    d = _post(env, _good(), confirm_warnings="true").json()["detail"]
    assert d["reason"] == "no_match" and d["rejected"] == 1
    assert d["unmatched_rows"][0]["row"] == 2 and d["unmatched_rows"][0]["sheet"] == "Records to clean"


def test_big_cleaning_workbook_comes_as_a_zip_of_parts(monkeypatch):
    data = {**_data(RECS), "run": {"id": str(uuid.uuid4()), "label": "Run 1", "status": "completed"},
            "tenant_name": "Tenant"}
    monkeypatch.setattr(cw, "load", lambda *a: data)
    monkeypatch.setattr(cw, "rule_meta", lambda m: RULES)
    monkeypatch.setattr(cw, "aletheia_plan_sheet", lambda *a: None)
    monkeypatch.setattr(cw, "PART_ROWS", 2)
    monkeypatch.setattr(cw, "MIN_PART_ROWS", 1)
    body, name = cw.build(None, "t", "v", "employee_central")
    assert name.endswith(".zip")
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        names = z.namelist()
        assert len(names) == 2 and names[0].endswith("-part-1-of-2.xlsx")
        assert all(rt.read_upload(z.read(n), n)["marker"]["kind"] == "cleaning" for n in names)
        for n in names:  # each part's fingerprint counts the records that part holds
            up = rt.read_upload(z.read(n), n)
            assert uc.check_rows(up["sheets"], up["marker"], "cleaning")["status"] == "pass", n
    monkeypatch.setattr(cw, "PART_ROWS", 50)
    assert cw.build(None, "t", "v", "employee_central")[1].endswith(".xlsx")
