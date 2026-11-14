"""Clean-cycle upload integrity: value hygiene, edit integrity and atomic apply (synthetic data only)."""
import datetime as dt
import io
import pathlib
import uuid

import pandas as pd
import pytest
from openpyxl import Workbook

from api.services import sf_roundtrip as rt
from tests.test_upload_roundtrip_route import HEAD, NEW, TID, _post, _xlsx, env  # noqa: F401 - env is a fixture

ROOT = pathlib.Path(__file__).resolve().parent.parent
needs_calamine = pytest.mark.skipif(
    __import__("importlib.util").util.find_spec("python_calamine") is None, reason="python_calamine not installed")


def _sheet(*rows):
    return [("Records to clean", [HEAD, *rows])]


# --- A: value hygiene -------------------------------------------------------------------------------------------

@pytest.mark.parametrize("value", ["#N/A", "#ref!", "=SUM(A1:A2)", "@cmd", "+1+cmd|' /C calc'!A0", "1.23457E+17"])
def test_unsafe_corrected_values_are_refused_with_their_row(value):
    with pytest.raises(rt.InvalidValues) as e:
        rt.cleaning_edits(_sheet(["T", "id=1", "f", "ok"], ["T", "id=2", "f", value]))
    assert [r["row"] for r in e.value.rows] == [3] and e.value.rows[0]["field"] == "f"


def test_plain_values_pass_including_negative_numbers_and_apostrophe_guard():
    edits, _ = rt.cleaning_edits(_sheet(["T", "id=1", "f", "-12.5"], ["T", "id=2", "f", "'=not a formula"]))
    assert [e["value"] for e in edits] == ["-12.5", "=not a formula"]


def test_long_numbers_and_dates_read_from_cells():
    assert rt._text(123456789012345678) == "1.23456789012346E+17"
    assert rt.cell_problem(rt._text(123456789012345678))
    assert rt._text(12345678901234) == "12345678901234"
    assert rt._text(dt.datetime(2026, 3, 4)) == "2026-03-04"


@needs_calamine
def test_long_number_typed_into_a_number_cell_is_refused_end_to_end():
    wb = Workbook()
    ws = wb.active
    ws.title = "Records to clean"
    ws.append(HEAD)
    ws.append(["T", "id=1", "f", 123456789012345678])
    out = io.BytesIO()
    wb.save(out)
    sheets = rt.read_upload(out.getvalue(), "t.xlsx")["sheets"]
    with pytest.raises(rt.InvalidValues):
        rt.cleaning_edits(sheets)


@pytest.mark.parametrize("value,ftype,length,old,alpha,want", [
    ("2026-03-04", "DATS", 8, "", False, "20260304"),
    ("2026-03-04 00:00:00", "DATS", 8, "", False, "20260304"),
    ("2026-03-04 00:00:00", "DATE", 0, "", False, "2026-03-04"),
    ("2026-03-04 10:30:00", "DATETIME", 0, "", False, "2026-03-04T10:30:00"),
    ("2026-03-04 00:00:00", None, 0, "20250101", False, "20260304"),  # shape of the stored value decides
    ("10:30", "TIMS", 6, "", False, "103000"),
    ("42", "NUMC", 8, "", False, "00000042"),
    ("42", "CHAR", 10, "", True, "0000000042"),  # ALPHA conversion exit
    ("42", None, 0, "000017", False, "000042"),  # Excel dropped the zeros the run's value had
    ("42", "CHAR", 10, "17", False, "42"),
])
def test_normalise_writes_the_field_format(value, ftype, length, old, alpha, want):
    assert rt.normalise(value, ftype, length, old, alpha) == want


# --- B: edit integrity ------------------------------------------------------------------------------------------

def test_key_field_edit_is_refused():
    with pytest.raises(rt.InvalidValues) as e:
        rt.cleaning_edits(_sheet(["EmpJob", "userId=u1", "userId", "u2"]), lambda t: ["userId"])
    assert e.value.rows[0]["row"] == 2 and "key field" in e.value.rows[0]["reason"]


def test_same_cell_twice_with_different_values_names_both_rows():
    with pytest.raises(rt.InvalidValues) as e:
        rt.cleaning_edits(_sheet(["T", "id=1", "f", "a"], ["T", "id=2", "f", "x"], ["T", "id=1", "f", "b"]))
    assert "rows 2, 4" in e.value.rows[0]["reason"]


def test_same_cell_twice_with_the_same_value_is_one_edit():
    edits, _ = rt.cleaning_edits(_sheet(["T", "id=1", "f", "a"], ["T", "id=1", "f", "a"]))
    assert len(edits) == 1


def test_template_duplicate_record_rows_are_refused():
    maps = {"Job": {"table": "EmpJob", "map": {"User ID": "EmpJob.userId", "Title": "EmpJob.jobTitle"}, "mapped": []}}
    rows = [["User ID", "Title"], ["u1", "Lead"], ["u1", "Ops"]]
    with pytest.raises(rt.InvalidValues) as e:
        rt.template_edits([("Job", rows)], maps, lambda t: ["userId"])
    assert "rows 2, 3" in e.value.rows[0]["reason"]


# --- C: apply -----------------------------------------------------------------------------------------------------

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

    def remove_object(self, bucket, name):
        del self.store[name]


@pytest.fixture
def bucket(monkeypatch):
    from api.services import storage

    store: dict = {}
    monkeypatch.setattr(storage, "get_minio_client", lambda: _Client(store))
    monkeypatch.setattr(storage, "list_prefix", lambda b, p: [(n, 0) for n in list(store) if n.startswith(p)])
    monkeypatch.setattr(storage, "upload_file", lambda b, n, d, c: store.__setitem__(n, d))
    return store


def _put(store, name, df):
    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    store[name] = buf.getvalue()


def _read(store, name):
    return pd.read_parquet(io.BytesIO(store[name]))


class _Dict:
    def __init__(self, fields=None):
        self.fields = fields or {}

    def keys(self, table):
        return ["id"]

    def field(self, table, name):
        return self.fields.get(name)


def _key(df, i):
    from checks import base

    return base.record_keys(df, ["id"])[i]


def test_conflict_cells_keep_the_other_uploads_value(bucket):
    df = pd.DataFrame({"id": ["1", "2"], "f": ["a", "b"]})
    _put(bucket, "p/T.parquet", df)
    k1, k2 = _key(df, 0), _key(df, 1)
    edits = [{"table": "T", "key": k1, "field": "f", "value": "x"}, {"table": "T", "key": k2, "field": "f", "value": "b"}]
    out = rt.apply_edits("p/", "n/", edits, _Dict(), frozenset({("T", k1, "f"), ("T", k2, "f")}))
    assert (out["applied"], out["unchanged"], out["conflicts_total"]) == (0, 1, 1)
    assert out["conflicts"][0] == {"table": "T", "key": k1, "field": "f", "value": "x", "current": "a"}
    assert _read(bucket, "n/T.parquet")["f"].tolist() == ["a", "b"]


def test_column_types_survive_the_edit(bucket):
    df = pd.DataFrame({"id": ["1", "2"], "n": [1, 2], "x": [1.5, 2.5], "d": pd.to_datetime(["2025-01-01", "2025-01-02"]),
                       "s": ["a", "b"]})
    _put(bucket, "p/T.parquet", df)
    k = _key(df, 0)
    edits = [{"table": "T", "key": k, "field": f, "value": v}
             for f, v in (("n", "7"), ("x", "3.25"), ("d", "2026-03-04"), ("s", "z"))]
    out = rt.apply_edits("p/", "n/", edits, _Dict())
    got = _read(bucket, "n/T.parquet")
    assert out["applied"] == 4
    assert got["n"].dtype.kind == "i" and got["n"].tolist() == [7, 2]
    assert got["x"].dtype.kind == "f" and got["x"].tolist() == [3.25, 2.5]
    assert got["d"].dtype.kind == "M" and got["d"].iloc[0] == pd.Timestamp("2026-03-04")
    assert got["s"].tolist() == ["z", "b"]


def test_dats_and_numc_fields_get_their_sap_format(bucket):
    df = pd.DataFrame({"id": ["1"], "dat": ["20250101"], "num": ["00000017"]})
    _put(bucket, "p/T.parquet", df)
    fields = {"dat": type("F", (), {"type": "DATS", "length": 8, "conversion_exit": None})(),
              "num": type("F", (), {"type": "NUMC", "length": 8, "conversion_exit": None})()}
    k = _key(df, 0)
    rt.apply_edits("p/", "n/", [{"table": "T", "key": k, "field": "dat", "value": "2026-03-04"},
                                {"table": "T", "key": k, "field": "num", "value": "42"}], _Dict(fields))
    got = _read(bucket, "n/T.parquet")
    assert (got["dat"].iloc[0], got["num"].iloc[0]) == ("20260304", "00000042")


def test_drop_staging_removes_only_the_copy(bucket):
    bucket.update({"n/T.parquet": b"x", "n/U.parquet": b"y", "p/T.parquet": b"z"})
    rt.drop_staging("n/")
    assert list(bucket) == ["p/T.parquet"]


# --- route --------------------------------------------------------------------------------------------------------

def test_route_refuses_invalid_values_with_rows(env):  # noqa: F811
    r = _post(env, _xlsx({"Records to clean": [HEAD, ["EmpJob", "userId=u1", "jobTitle", "#N/A"]]}))
    assert r.status_code == 422, r.text
    d = r.json()["detail"]
    assert d["error"] == "invalid_values" and d["total"] == 1 and d["rows"][0]["row"] == 2
    assert env.applied_with == []


def test_route_passes_cells_changed_since_export_as_conflicts(env):  # noqa: F811
    from tests.test_upload_roundtrip_route import PARENT

    tip = uuid.uuid4()
    env.db.tip = (tip, {"dataset_path": "staging/x/tip/", "cleaned_overlay": {"base_version_id": str(PARENT)}})
    env.db.cells[str(tip)] = [("EmpJob", "userId=u1", "jobTitle")]
    env.result["conflicts"] = [{"table": "EmpJob", "key": "userId=u1", "field": "jobTitle", "value": "Lead", "current": "Ops"}]
    env.result["conflicts_total"] = 1
    r = _post(env, _xlsx({"Records to clean": [HEAD, ["EmpJob", "userId=u1", "jobTitle", "Lead"],
                                               ["EmpJob", "userId=u2", "jobTitle", "Ops"]]}))
    assert r.status_code == 200, r.text
    assert env.conflicts[0] == frozenset({("EmpJob", "userId=u1", "jobTitle")})
    assert r.json()["conflicts_total"] == 1


def test_route_saves_every_cell_in_chunks_before_one_commit(env):  # noqa: F811
    env.result["edited"] = [{"table": "EmpJob", "key": f"userId=u{i}", "field": "jobTitle"} for i in range(6000)]
    r = _post(env, _xlsx({"Records to clean": [HEAD, ["EmpJob", "userId=u1", "jobTitle", "Lead"]]}))
    assert r.status_code == 200, r.text
    inserts = [p for s, p in env.db.calls if s.startswith("INSERT INTO roundtrip_edits")]
    assert [len(p["k"]) for p in inserts] == [5000, 1000]
    assert all(p["v"] == str(NEW) and p["t"] == TID for p in inserts)
    assert env.meta.get("cleaned_overlay", {}).get("edits") is None


# --- static -------------------------------------------------------------------------------------------------------

def test_migration_169_and_monitor_read_the_cells_table():
    mig = (ROOT / "db/migrations/versions/169_roundtrip_edits.py").read_text()
    assert 'revision: str = "169"' in mig and '= "166"' in mig and "FORCE ROW LEVEL SECURITY" in mig
    from api.services import monitor

    assert "roundtrip_edits" in monitor._FIX_NOT_IN_SOURCE_SQL
