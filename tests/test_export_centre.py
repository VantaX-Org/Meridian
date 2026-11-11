"""Export centre: parameter validation, the csv/json/xlsx builders, the worker's idempotency and the
server folder delivery. The database is a stub: each dataset's query is replaced by fixed rows."""

from __future__ import annotations

import dataclasses
import io
import json
import uuid

import openpyxl
import pytest

from api.services import export_centre as ec
from api.services import report_history as rh
from workers.tasks import export_centre as task
from workers.tasks import report_schedules as rs

TID = str(uuid.uuid4())
ROWS = [
    {"object": "Material master", "module": "material_master", "check_id": "MM_001", "severity": "high",
     "message": "=HYPERLINK(\"http://x\")", "field": "MATKL", "field_description": "Material group",
     "affected_count": 3, "run_label": "Run A"},
    {"object": "Customer master", "module": "customer_master", "check_id": "KN_002", "severity": "low",
     "message": "Name empty", "field": "NAME1", "field_description": "Name", "affected_count": 1,
     "run_label": "Run B"},
]


class _Session:
    def __init__(self, scalar=None, first=None):
        self._scalar, self._first, self.commits = scalar, first, 0

    def execute(self, *a, **k):
        return self

    def scalar(self):
        return self._scalar

    def first(self):
        return self._first

    def commit(self):
        self.commits += 1


@pytest.fixture
def findings(monkeypatch):
    ds = dataclasses.replace(ec.DATASETS["findings"], query=lambda s, t, p: [dict(r) for r in ROWS])
    monkeypatch.setitem(ec.DATASETS, "findings", ds)
    return ds


def test_clean_params_refuses_unknowns_and_keeps_only_applicable_filters():
    with pytest.raises(ec.ExportError):
        ec.clean_params("nope", {})
    with pytest.raises(ec.ExportError):
        ec.clean_params("findings", {"format": "docx"})
    with pytest.raises(ec.ExportError):
        ec.clean_params("findings", {"split": "planet"})
    with pytest.raises(ec.ExportError):
        ec.clean_params("audit_log", {"format": "pdf"})  # no pdf report for the audit log
    with pytest.raises(ec.ExportError):
        ec.clean_params("rule_catalogue", {"format": "pdf"})  # one object only
    p = ec.clean_params("findings", {"columns": ["check_id", "bogus"], "severity": ["high", "x"], "module": "material_master"})
    assert p["columns"] == ["check_id"] and p["severity"] == ["high"] and p["module"] == "material_master"
    every = ec.clean_params("findings", {})
    assert every["columns"] == [c.key for c in ec.DATASETS["findings"].columns] and every["format"] == "xlsx"


def test_every_code_column_has_a_description_beside_it():
    for name, ds in ec.DATASETS.items():
        keys = [c.key for c in ds.columns]
        if "field" in keys:
            assert "field_description" in keys, name
        if "module" in keys:
            assert "object" in keys, name


def test_every_dataset_is_a_schedulable_report_kind():
    for name in ec.DATASETS:
        t = rh.REPORT_TYPES[f"export_{name}"]
        assert t.schedulable and not t.needs_run
    assert {d["id"] for d in ec.options()} == set(ec.DATASETS)


def test_csv_guards_formulas_and_honours_the_column_choice(findings):
    gen = ec.build(_Session(), TID, "findings", {"format": "csv", "columns": ["check_id", "message"]})
    text = gen.data.decode("utf-8-sig")
    lines = text.strip().splitlines()
    assert lines[0] == "Check,Check description"
    assert "'=HYPERLINK" in lines[1] and gen.file_name.endswith(".csv") and gen.content_type == "text/csv"


def test_json_carries_filters_and_rows(findings):
    gen = ec.build(_Session(), TID, "findings", {"format": "json", "columns": ["check_id", "affected_count"]})
    body = json.loads(gen.data)
    assert body["dataset"] == "findings" and body["truncated"] is False
    assert body["rows"] == [{"check_id": "MM_001", "affected_count": 3}, {"check_id": "KN_002", "affected_count": 1}]


def test_xlsx_splits_one_sheet_per_object(findings):
    gen = ec.build(_Session(scalar="Tenant"), TID, "findings", {"format": "xlsx", "split": "module"})
    wb = openpyxl.load_workbook(io.BytesIO(gen.data))
    assert {"Material master", "Customer master"} <= set(wb.sheetnames)


def test_worker_reuses_the_file_a_job_already_made(monkeypatch):
    built = []
    monkeypatch.setattr(ec, "build", lambda *a, **k: built.append(1))
    res = task.export_once(_Session(first=("file-1",)), TID, "job-1", "findings", {})
    assert res["report_file_id"] == "file-1" and res["reused"] and not built


def test_worker_builds_stores_and_tags_the_job(monkeypatch, findings):
    stored = {}
    monkeypatch.setattr(task, "update_job", lambda *a, **k: None)
    monkeypatch.setattr(rh, "store_report_file", lambda s, t, **kw: stored.update(kw) or "file-2")
    s = _Session(first=None)
    res = task.export_once(s, TID, "job-2", "findings", {"format": "csv"}, "user-1", "a@example.com")
    assert res["report_file_id"] == "file-2" and stored["params"]["job_id"] == "job-2"
    assert stored["kind"] == "export_findings" and s.commits == 1


def test_save_to_folder_stays_inside_the_tenant_folder(tmp_path):
    gen = rh.Generated(b"a,b\n", "../../escape.csv", "text/csv", None)
    note = rs.save_to_folder(TID, gen, base=str(tmp_path))
    assert (tmp_path / TID / "escape.csv").read_bytes() == b"a,b\n" and "escape.csv" in note
    assert "not configured" in rs.save_to_folder(TID, gen, base="")
