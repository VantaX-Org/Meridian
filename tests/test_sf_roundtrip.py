"""Clean in Excel, upload back, re-score: marker, validation, edit reading and the bundle copy (synthetic data only)."""
import io

import pandas as pd
import pytest
from openpyxl import Workbook

from api.services import sf_roundtrip as rt


def _xlsx(sheets: dict, hidden_marker: list | None = None) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    if hidden_marker is not None:
        ws = wb.create_sheet(rt.MARKER)
        ws.append(["key", "value"])
        for r in hidden_marker:
            ws.append(r)
        ws.sheet_state = "hidden"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


MAPS = {"Job": {"table": "EmpJob", "map": {"User ID": "EmpJob.userId", "Title": "EmpJob.jobTitle", "Pay": "EmpJob.pay"}, "mapped": ["Pay"]}}


needs_calamine = pytest.mark.skipif(
    __import__("importlib.util").util.find_spec("python_calamine") is None, reason="python_calamine not installed")


@needs_calamine
def test_stamp_then_read_marker_and_sheets():
    plain = _xlsx({"Job": [["User ID", "Title", "Extra"], ["u1", "Engineer", "x"]]})
    got = rt.read_upload(rt.stamp_xlsx(plain, "11111111-1111-1111-1111-111111111111", "employee_central", MAPS), "t.xlsx")
    assert got["marker"]["version_id"] == "11111111-1111-1111-1111-111111111111"
    assert got["marker"]["module"] == "employee_central" and got["marker"]["map"]["Job"]["table"] == "EmpJob"
    assert [n for n, _ in got["sheets"]] == ["Job"]  # the marker sheet is not data


@pytest.mark.parametrize("name,data,why", [
    ("a.txt", b"x", "Excel"),
    ("a.xlsx", b"not a zip", "does not match"),
    ("a.csv", b"PK\x03\x04zzzz", "does not match"),
    ("a.xlsx", b"PK\x03\x04" + b"0" * (rt.MAX_UPLOAD_BYTES + 1), "25 MB"),
])
def test_trust_boundary_rejects(name, data, why):
    with pytest.raises(rt.RoundTripError, match=why):
        rt.read_upload(data, name)


@needs_calamine
def test_row_cap(monkeypatch):
    monkeypatch.setattr(rt, "MAX_EDIT_ROWS", 3)
    with pytest.raises(rt.RoundTripError, match="more than"):
        rt.read_upload(_xlsx({"S": [["a"]] * 5}), "t.xlsx")


@needs_calamine
def test_formula_is_never_evaluated():
    got = rt.read_upload(_xlsx({"S": [["a"], ["=1+1"]]}), "t.xlsx")
    assert got["sheets"][0][1][1][0] != "2"


def test_cleaning_edits_take_corrected_value_and_count_blanks():
    head = ["Table", "Record key", "Field", "Corrected value"]
    edits, blank = rt.cleaning_edits([("Records to clean", [head, ["T", "id=1", "f", "new"], ["T", "id=2", "f", ""]]), ("Other", [["x"]])])
    assert edits == [{"table": "T", "key": "id=1", "field": "f", "value": "new"}] and blank == 1
    with pytest.raises(rt.RoundTripError, match="missing"):
        rt.cleaning_edits([("Records to clean", [["Table"]])])


def test_template_edits_map_back_report_unmapped_and_skip_value_mapped():
    rows = [["User ID", "Title", "Pay", "Mystery"], ["u1", "Lead", "9", "q"], ["u2", "", "8", ""]]
    edits, rep = rt.template_edits([("Job", rows), ("Stray", [["a"]])], MAPS, lambda t: ["userId"])
    assert edits == [{"table": "EmpJob", "key": "userId=u1", "field": "jobTitle", "value": "Lead", "cell": True}]
    assert rep["unmapped"]["Job"] == ["Mystery"] and "Stray" in rep["skipped"]
    _, rep2 = rt.template_edits([("Job", [["Title"], ["x"]])], MAPS, lambda t: ["userId"])
    assert "key columns" in rep2["skipped"]["Job"]


class _Resp:
    def __init__(self, b):
        self.b = b

    def read(self):
        return self.b

    def close(self):
        pass


class _Client:
    def __init__(self, store):
        self.store = store

    def get_object(self, bucket, name):
        return _Resp(self.store[name])

    def copy_object(self, bucket, target, src):
        self.store[target] = self.store[src.object_name]


def test_apply_edits_writes_a_copy_and_counts(monkeypatch):
    from checks import base
    from api.services import storage

    df = pd.DataFrame({"userId": ["u1", "u2"], "jobTitle": ["Eng", "Ops"]})
    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    store = {"p/EmpJob.parquet": buf.getvalue(), "p/Other.parquet": b"keep"}
    monkeypatch.setattr(storage, "get_minio_client", lambda: _Client(store))
    monkeypatch.setattr(storage, "list_prefix", lambda b, p: [(n, 0) for n in store if n.startswith(p)])
    monkeypatch.setattr(storage, "upload_file", lambda b, n, d, c: store.__setitem__(n, d))
    k1 = base.record_keys(df, ["userId"])[0]
    dictionary = type("D", (), {"keys": lambda self, t: ["userId"]})()
    edits = [
        {"table": "EmpJob", "key": k1, "field": "jobTitle", "value": "Lead"},
        {"table": "EmpJob", "key": base.record_keys(df, ["userId"])[1], "field": "jobTitle", "value": "Ops"},
        {"table": "EmpJob", "key": "userId=zz", "field": "jobTitle", "value": "x"},
        {"table": "EmpJob", "key": k1, "field": "nope", "value": "x"},
        {"table": "Gone", "key": k1, "field": "f", "value": "x"},
    ]
    out = rt.apply_edits("p/", "n/", edits, dictionary)
    assert (out["applied"], out["unchanged"], out["unmatched_total"], out["no_field"], out["no_table"]) == (1, 1, 1, ["nope"], ["Gone"])
    assert pd.read_parquet(io.BytesIO(store["n/EmpJob.parquet"]))["jobTitle"].tolist() == ["Lead", "Ops"]
    assert store["n/Other.parquet"] == b"keep"  # untouched tables are copied
    assert pd.read_parquet(io.BytesIO(store["p/EmpJob.parquet"]))["jobTitle"].tolist() == ["Eng", "Ops"]  # parent unchanged


def test_field_name_strips_the_description_and_own_table_prefix():
    assert rt.field_name("MARA.MATKL (Material Group)", "MARA") == "MATKL"
    assert rt.field_name("MARC.WERKS (Plant)", "MARA") == "MARC.WERKS"
    assert rt.field_name("jobTitle", "EmpJob") == "jobTitle"


def test_clear_empties_a_field_in_both_kinds():
    head = ["Table", "Record key", "Field", "Corrected value"]
    edits, _ = rt.cleaning_edits([("Records to clean", [head, ["T", "id=1", "T.f (F)", "#clear"]])])
    assert edits == [{"table": "T", "key": "id=1", "field": "f", "value": ""}]
    t_edits, _ = rt.template_edits([("Job", [["User ID", "Title"], ["u1", "#CLEAR"]])], MAPS, lambda t: ["userId"])
    assert t_edits[0]["value"] == ""


def test_cleaning_notes_map_statuses_and_skip_rows_without_a_rule():
    head = ["Rule", "Table", "Record key", "Field", "Corrected value", "Status", "Owner", "Comment"]
    rows = [head, ["R1", "T", "id=1", "f", "", "Not an error", "", ""], ["R1", "T", "id=2", "f", "", "Open", "a", ""],
            ["", "T", "id=3", "f", "", "Fixed", "", ""], ["R2", "T", "id=4", "f", "", "", "", ""]]
    notes = rt.cleaning_notes([("Records to clean", rows)])
    assert [(n["key"], n["status"], n["owner"]) for n in notes] == [("id=1", "not_an_error", ""), ("id=2", "", "a")]
    assert rt.cleaning_notes([("Records to clean", [["Table", "Record key"], ["T", "id=1"]])]) == []


def test_two_objects_across_two_runs_build_on_each_other(monkeypatch):
    """Run 1 edits one object's table, run 2 another's on run 1's copy: both edits land, earlier copies stay."""
    from checks import base
    from api.services import storage

    def pq(df):
        b = io.BytesIO()
        df.to_parquet(b, index=False)
        return b.getvalue()

    mara = pd.DataFrame({"MARA.MATNR": ["M1", "M2"], "MARA.MATKL": ["A", "B"]})
    kna1 = pd.DataFrame({"KNA1.KUNNR": ["C1"], "KNA1.LAND1": ["XX"]})
    store = {"r0/MARA.parquet": pq(mara), "r0/KNA1.parquet": pq(kna1)}
    monkeypatch.setattr(storage, "get_minio_client", lambda: _Client(store))
    monkeypatch.setattr(storage, "list_prefix", lambda b, p: [(n, 0) for n in list(store) if n.startswith(p)])
    monkeypatch.setattr(storage, "upload_file", lambda b, n, d, c: store.__setitem__(n, d))
    keys = {"MARA": ["MATNR"], "KNA1": ["KUNNR"]}
    dictionary = type("D", (), {"keys": lambda self, t: keys[t]})()
    head = ["Table", "Record key", "Field", "Corrected value"]
    k_m = base.record_keys(mara, ["MARA.MATNR"])[0]
    k_c = base.record_keys(kna1, ["KNA1.KUNNR"])[0]

    e1, _ = rt.cleaning_edits([("Records to clean", [head, ["MARA", k_m, "MARA.MATKL (Material Group)", "Z"]])])
    assert rt.apply_edits("r0/", "r1/", e1, dictionary)["applied"] == 1
    e2, _ = rt.cleaning_edits([("Records to clean", [head, ["KNA1", k_c, "KNA1.LAND1 (Country)", "#CLEAR"]])])
    assert rt.apply_edits("r1/", "r2/", e2, dictionary)["applied"] == 1

    read = lambda n: pd.read_parquet(io.BytesIO(store[n]))  # noqa: E731
    assert read("r2/MARA.parquet")["MARA.MATKL"].tolist() == ["Z", "B"]
    assert read("r2/KNA1.parquet")["KNA1.LAND1"].tolist() == [""]
    assert read("r1/KNA1.parquet")["KNA1.LAND1"].tolist() == ["XX"]
    assert read("r0/MARA.parquet")["MARA.MATKL"].tolist() == ["A", "B"]
