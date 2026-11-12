"""POST /api/v1/upload/roundtrip: the SuccessFactors clean-in-Excel upload-back route (synthetic data only).

The database, bucket and queue are faked; the real file reading (api/services/sf_roundtrip.py) and the
route's own checks run. A live Postgres is not needed."""
import io
import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook

from api.deps import Tenant, get_db, get_tenant
from api.routes import upload
from api.services import sf_roundtrip as rt

TID = uuid.uuid4()
PARENT = uuid.uuid4()
NEW = uuid.uuid4()
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

pytestmark = pytest.mark.skipif(
    __import__("importlib.util").util.find_spec("python_calamine") is None, reason="python_calamine not installed")

HEAD = ["Table", "Record key", "Field", "Corrected value"]


def _xlsx(sheets: dict, version_id=PARENT, module="employee_central") -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    if version_id:
        ws = wb.create_sheet(rt.MARKER)
        ws.append(["key", "value"])
        for r in rt.marker_rows(str(version_id), module, "cleaning"):
            ws.append([r["key"], r["value"]])
        ws.sheet_state = "hidden"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _good(**kw) -> bytes:
    return _xlsx({"Records to clean": [HEAD, ["EmpJob", "userId=u1", "jobTitle", "Lead"],
                                       ["EmpJob", "userId=u2", "jobTitle", ""]]}, **kw)


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _DB:
    def __init__(self, row):
        self.row, self.calls = row, []

    async def execute(self, stmt, params=None):
        self.calls.append((" ".join(str(stmt).split()), params))
        return _Result(self.row)

    async def commit(self):
        pass


def _row(status="complete", modules=("employee_central",), path="staging/x/parent/"):
    return (status, "Run 1", {"modules": list(modules), "dataset_path": path})


@pytest.fixture
def env(monkeypatch):
    """A client for the route plus the recorders. ``env.db.row`` is the parent run row; ``env.result`` the apply counts."""
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    state = SimpleNamespace(db=_DB(_row()), result={"applied": 1, "unchanged": 0, "unmatched": [], "unmatched_total": 0,
                                                     "no_table": [], "no_field": []},
                            applied_with=[], failed=[], audits=[], enqueued=[])

    async def create_version(db, tenant_id, meta, label=None):
        state.meta = meta
        return SimpleNamespace(id=NEW)

    async def mark_failed(db, tenant_id, vid, reason):
        state.failed.append(reason)

    async def write_audit(db, tenant_id, request, action, *a):
        state.audits.append(action)

    async def enqueue(db, tenant_id, vid, prefix, **kw):
        state.enqueued.append(prefix)
        return "job-1"

    def apply_edits(parent, prefix, edits, dictionary):
        state.applied_with.append((parent, prefix, edits))
        return dict(state.result)

    from db.queries import versions
    from api.services import rbac
    monkeypatch.setattr(versions, "create_version", create_version)
    monkeypatch.setattr(versions, "mark_version_failed", mark_failed)
    monkeypatch.setattr(rbac, "write_audit", write_audit)
    monkeypatch.setattr(rt, "apply_edits", apply_edits)
    monkeypatch.setattr(upload, "_enqueue_checks", enqueue)
    monkeypatch.setattr(upload, "_dictionary", lambda t, s: None)
    monkeypatch.setattr(upload.jobs, "start_job", lambda *a, **k: None)

    app = FastAPI()
    app.include_router(upload.router)

    async def _db():
        yield state.db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    state.client = TestClient(app)
    return state


def _post(env, data, name="clean.xlsx", role="analyst", **form):
    return env.client.post("/api/v1/upload/roundtrip", files={"file": (name, data, XLSX)}, data=form,
                           headers={"X-User-Role": role})


def test_happy_path_returns_applied_counts_and_queues_a_rerun(env):
    r = _post(env, _good())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version_id"] == str(NEW) and body["parent_version_id"] == str(PARENT)
    assert (body["kind"], body["applied"], body["unchanged"], body["unmatched"]) == ("cleaning", 1, 0, 0)
    assert body["job_id"] == "job-1" and body["status"] == "pending"
    # the blank corrected value is not an edit; the filled one is, with the run's bundle as the source
    parent, prefix, edits = env.applied_with[0]
    assert parent == "staging/x/parent/" and prefix == f"staging/{TID}/{NEW}/"
    assert edits == [{"table": "EmpJob", "key": "userId=u1", "field": "jobTitle", "value": "Lead"}]
    assert env.enqueued == [prefix] and env.audits == ["upload.roundtrip"]
    assert env.meta["roundtrip"] == {"parent_version_id": str(PARENT), "kind": "cleaning", "edits": 1}


def test_parent_comes_from_the_form_when_the_file_has_no_marker(env):
    r = _post(env, _good(version_id=None), parent_version_id=str(PARENT))
    assert r.status_code == 200 and r.json()["parent_version_id"] == str(PARENT)
    r = _post(env, _good(version_id=None))
    assert r.status_code == 422 and r.json()["detail"]["error"] == "parent_required"


@pytest.mark.parametrize("name,data,why", [
    ("clean.txt", b"hello", "Excel"),
    ("clean.xlsx", b"this is not a zip", "does not match"),
    ("clean.csv", b"PK\x03\x04junk", "does not match"),
])
def test_wrong_file_type_or_magic_bytes_rejected(env, name, data, why):
    r = _post(env, data, name=name)
    assert r.status_code == 422 and why in r.json()["detail"]
    assert env.applied_with == [] and env.db.calls == []  # rejected before any database work


def test_missing_required_columns_are_reported(env):
    r = _post(env, _xlsx({"Records to clean": [["Table", "Record key", "Field"], ["EmpJob", "userId=u1", "jobTitle"]]}))
    assert r.status_code == 422
    assert "Corrected value" in r.json()["detail"] and "missing" in r.json()["detail"]
    assert env.applied_with == []


def test_file_with_no_filled_corrections_is_refused(env):
    r = _post(env, _xlsx({"Records to clean": [HEAD, ["EmpJob", "userId=u1", "jobTitle", ""]]}))
    assert r.status_code == 422 and "no edits" in r.json()["detail"]


def test_nothing_matching_marks_the_new_run_failed(env):
    env.result.update(applied=0, unmatched=[{"table": "EmpJob"}], unmatched_total=1)
    r = _post(env, _good())
    assert r.status_code == 422 and r.json()["detail"]["error"] == "nothing_applied"
    assert env.failed and env.enqueued == []


def test_run_that_has_not_finished_or_is_not_an_extraction_is_refused(env):
    env.db.row = _row(status="running")
    assert _post(env, _good()).status_code == 409
    env.db.row = _row(path="uploads/file.parquet")
    assert _post(env, _good()).status_code == 422


def test_file_from_another_object_than_the_run_is_refused(env):
    env.db.row = _row(modules=("benefits",))
    r = _post(env, _good())
    assert r.status_code == 422 and r.json()["detail"]["error"] == "module_mismatch"


@pytest.mark.parametrize("role", ["viewer", "auditor", "approver"])
def test_roles_without_upload_are_denied(env, role):
    r = _post(env, _good(), role=role)
    assert r.status_code == 403
    assert env.applied_with == [] and env.db.calls == []


def test_the_parent_run_is_looked_up_for_this_tenant_only(env):
    """Another tenant's run id answers 404: the lookup is scoped by tenant_id and the tenant context is set first."""
    env.db.row = None
    r = _post(env, _good())
    assert r.status_code == 404 and env.applied_with == []
    config, select = env.db.calls[0], env.db.calls[1]
    assert "set_config('app.tenant_id'" in config[0] and config[1] == {"t": str(TID)}
    assert "tenant_id = :t" in select[0] and select[1] == {"v": str(PARENT), "t": TID}
