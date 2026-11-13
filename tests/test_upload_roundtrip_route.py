"""POST /api/v1/upload/roundtrip: the SuccessFactors clean-in-Excel upload-back route (synthetic data only).

The database, bucket and queue are faked; the real file reading (api/services/sf_roundtrip.py) and the
route's own checks run. A live Postgres is not needed."""
import contextlib
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
from api.services import upload_checks as uc

TID = uuid.uuid4()
PARENT = uuid.uuid4()
NEW = uuid.uuid4()
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

pytestmark = pytest.mark.skipif(
    __import__("importlib.util").util.find_spec("python_calamine") is None, reason="python_calamine not installed")

HEAD = ["Table", "Record key", "Field", "Corrected value"]


def _xlsx(sheets: dict, version_id=PARENT, module="employee_central", fp=True, extra=None) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    if version_id:
        ws = wb.create_sheet(rt.MARKER)
        ws.append(["key", "value"])
        recs = sheets.get("Records to clean")
        if fp and recs:  # the fingerprint a real download carries
            extra = {**uc.fingerprint("cleaning", str(TID), None, recs[0], len(recs) - 1), **(extra or {})}
        for r in rt.marker_rows(str(version_id), module, "cleaning", None, extra):
            ws.append([r["key"], r["value"]])
        ws.sheet_state = "hidden"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _good(**kw) -> bytes:
    return _xlsx({"Records to clean": [HEAD, ["EmpJob", "userId=u1", "jobTitle", "Lead"],
                                       ["EmpJob", "userId=u2", "jobTitle", ""]]}, **kw)


class _Result:
    rowcount = 0

    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _DB:
    def __init__(self, row):
        self.row, self.calls, self.newer, self.tip = row, [], None, None

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append((sql, params))
        if "run_at > (SELECT run_at" in sql:  # _NEWER_RUN_SQL
            return _Result(self.newer)
        if "metadata->>'source' = 'roundtrip'" in sql:  # _TIP_SQL
            return _Result(self.tip)
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

    def apply_edits(parent, prefix, edits, dictionary, dry=False):
        if dry:
            return {**state.result, "total": len(edits)}
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
    monkeypatch.setattr(upload, "_base_lock", lambda base: contextlib.nullcontext())

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
    assert env.meta["roundtrip"] == {"parent_version_id": str(PARENT), "base_version_id": str(PARENT),
                                     "kind": "cleaning", "edits": 1, "module": "employee_central"}


def test_the_cleaned_copy_is_built_under_the_base_run_lock(env, monkeypatch):
    """Two uploads of one extraction must not both read the same tip: the read through the commit is locked."""
    seen = []

    @contextlib.asynccontextmanager
    async def lock(base):
        seen.append(("enter", base, len(env.applied_with)))
        yield
        seen.append(("exit", base, len(env.applied_with)))

    monkeypatch.setattr(upload, "_base_lock", lock)
    assert _post(env, _good()).status_code == 200
    assert seen == [("enter", str(PARENT), 0), ("exit", str(PARENT), 1)]


def test_file_from_another_run_than_the_one_chosen_is_refused(env):
    r = _post(env, _good(), parent_version_id=str(uuid.uuid4()))
    assert r.status_code == 422 and r.json()["detail"]["error"] == "parent_mismatch"
    assert env.applied_with == [] and env.db.calls == []


def test_file_from_a_run_a_newer_extraction_replaced_is_refused(env):
    latest = uuid.uuid4()
    env.db.newer = (latest, None)
    r = _post(env, _good())
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "stale_run" and r.json()["detail"]["latest_version_id"] == str(latest)
    assert env.applied_with == []


def test_edits_build_on_the_newest_cleaned_copy_of_the_same_extraction(env):
    """A second object's upload lands on the cleaned copy the first made, so both objects' edits accumulate."""
    tip = uuid.uuid4()
    env.db.tip = (tip, {"dataset_path": "staging/x/tip/", "cleaned_overlay": {
        "base_version_id": str(PARENT), "modules": ["compensation"],
        "edits": [{"table": "EmpCompensation", "key": "userId=u9", "field": "payGroup"}]}})
    env.result["edited"] = [{"table": "EmpJob", "key": "userId=u1", "field": "jobTitle"}]
    r = _post(env, _good())
    assert r.status_code == 200, r.text
    assert r.json()["parent_version_id"] == str(tip)
    assert env.applied_with[0][0] == "staging/x/tip/"
    assert env.meta["roundtrip"]["parent_version_id"] == str(tip)
    assert env.meta["roundtrip"]["base_version_id"] == str(PARENT)
    update = next(p for sql, p in env.db.calls if sql.startswith("UPDATE analysis_versions SET parent_version_id"))
    overlay = __import__("json").loads(update["o"])
    assert overlay["modules"] == ["compensation", "employee_central"] and len(overlay["edits"]) == 2


def test_status_and_comment_only_file_saves_notes_without_a_new_run(env):
    rows = [["Rule", "Table", "Record key", "Field", "Corrected value", "Status", "Owner", "Comment"],
            ["EC_001", "EmpJob", "userId=u1", "jobTitle", "", "In progress", "Data team", "Checking with HR"]]
    r = _post(env, _xlsx({"Records to clean": rows}))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "notes_saved" and r.json()["version_id"] == str(PARENT)
    assert env.applied_with == [] and env.enqueued == []
    assert any("in_progress" in str(p) for _, p in env.db.calls)


def test_parent_comes_from_the_form_when_the_file_has_no_marker(env):
    r = _post(env, _good(version_id=None), parent_version_id=str(PARENT))
    assert r.status_code == 422 and r.json()["detail"]["error"] == "confirm_required"  # no fingerprint: a warning
    r = _post(env, _good(version_id=None), parent_version_id=str(PARENT), confirm_warnings="true")
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
    assert r.status_code == 422 and r.json()["detail"]["error"] == "checks_failed"  # the keys check stops it first
    assert {c["id"]: c["status"] for c in r.json()["detail"]["checks"]}["keys"] == "fail"
    assert env.enqueued == []


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


def _checks(env, data, **form):
    r = env.client.post("/api/v1/upload/roundtrip/check", files={"file": ("c.xlsx", data, XLSX)}, data=form,
                        headers={"X-User-Role": "analyst"})
    assert r.status_code == 200, r.text
    return r.json(), {c["id"]: c for c in r.json()["checks"]}


def test_check_endpoint_lists_every_check_and_changes_nothing(env):
    body, by = _checks(env, _good())
    assert body["verdict"] == "pass" and list(by) == list(uc.CHECK_IDS)
    assert env.applied_with == [] and env.enqueued == [] and env.audits == []


def test_check_run_other_run_object_or_tenant_fails(env):
    r = env.client.post("/api/v1/upload/roundtrip/check", files={"file": ("c.xlsx", _good(), XLSX)},
                        data={"parent_version_id": str(uuid.uuid4())}, headers={"X-User-Role": "analyst"})
    assert r.status_code == 422  # parent_mismatch is raised before the checks
    _, by = _checks(env, _good(extra={"tenant": str(uuid.uuid4())}))
    assert by["fingerprint"]["status"] == "fail"
    r = env.client.post("/api/v1/upload/roundtrip/check", files={"file": ("c.xlsx", _good(module="benefits"), XLSX)},
                        headers={"X-User-Role": "analyst"})
    assert r.status_code == 422 and r.json()["detail"]["error"] == "module_mismatch"


def test_check_older_template_version_fails(env):
    _, by = _checks(env, _good(extra={"template_version": "0"}))
    assert by["template"]["status"] == "fail"
    _, by = _checks(env, _good(extra={"template_version": ""}))
    assert by["template"]["status"] == "warn"


def test_check_renamed_or_extra_column_fails(env):
    head = ["Table", "Record key", "Field", "Corrected value"]
    ok = [head, ["EmpJob", "userId=u1", "jobTitle", "Lead"]]
    renamed = _xlsx({"Records to clean": [["Table", "Record key", "Field", "Fixed value"], ok[1]]}, fp=False,
                    extra=uc.fingerprint("cleaning", str(TID), None, head, 1))
    r = env.client.post("/api/v1/upload/roundtrip/check", files={"file": ("c.xlsx", renamed, XLSX)},
                        headers={"X-User-Role": "analyst"})
    assert r.status_code == 422 and "Corrected value" in str(r.json()["detail"])  # refused while reading
    extra_col = _xlsx({"Records to clean": [head + ["Extra"], ok[1] + [""]]}, fp=False,
                      extra=uc.fingerprint("cleaning", str(TID), None, head, 1))
    _, by = _checks(env, extra_col)
    assert by["columns"]["status"] == "fail"


def test_check_added_or_removed_rows_fail(env):
    head = ["Table", "Record key", "Field", "Corrected value"]
    rows = [head, ["EmpJob", "userId=u1", "jobTitle", "Lead"], ["EmpJob", "userId=u2", "jobTitle", ""]]
    fp = uc.fingerprint("cleaning", str(TID), None, head, 3)  # the download had three records
    _, by = _checks(env, _xlsx({"Records to clean": rows}, fp=False, extra=fp))
    assert by["rows"]["status"] == "fail"


def test_check_unknown_keys_fail_or_warn(env):
    env.result.update(unmatched=[{}], unmatched_total=1)
    _, by = _checks(env, _good())
    assert by["keys"]["status"] == "fail"  # one edit, none found
    head = ["Table", "Record key", "Field", "Corrected value"]
    two = _xlsx({"Records to clean": [head, ["EmpJob", "userId=u1", "jobTitle", "Lead"],
                                      ["EmpJob", "userId=u2", "jobTitle", "Boss"]]})
    _, by = _checks(env, two)
    assert by["keys"]["status"] == "warn"


def test_check_formula_values_fail_and_numbers_pass(env):
    head = ["Table", "Record key", "Field", "Corrected value"]
    bad = _xlsx({"Records to clean": [head, ["EmpJob", "userId=u1", "jobTitle", "@SUM(A1)"],
                                      ["EmpJob", "userId=u2", "jobTitle", "-5"]]})
    body, by = _checks(env, bad)
    assert by["formulas"]["status"] == "fail" and "1 value" in by["formulas"]["detail"]
    assert "SUM" not in str(body)  # never echo a cell value
    assert not uc.unsafe("-5") and uc.unsafe("@SUM(A1)") and uc.unsafe("+cmd") and uc.unsafe("-cmd|x")


def test_confirm_required_for_warnings_and_failures_block(env):
    r = _post(env, _good(extra={"template_version": ""}))
    assert r.status_code == 422 and r.json()["detail"]["error"] == "confirm_required"
    assert _post(env, _good(extra={"template_version": ""}), confirm_warnings="true").status_code == 200
    r = _post(env, _good(extra={"template_version": "0"}), confirm_warnings="true")  # confirm never overrides a fail
    assert r.status_code == 422 and r.json()["detail"]["error"] == "checks_failed"
