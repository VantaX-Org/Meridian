"""Load-audit batches 2, 4-7: cleansed fill scoped to its source system (T8), wave delete and sign-off integrity,
the wave load-order gate (V1, V2), template module guard (T5), SuccessFactors history guards (S3, S4) and system
delete safety (G3). Synthetic data only, no database."""
import asyncio
import uuid
from datetime import date
from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi import HTTPException

from api.routes import migration as mig
from api.routes import systems
from api.services.migration import workbook as wb
from api.services.migration.load_plan import Edge, Evidence, LoadPlan, PlanObject, Prerequisite
from api.services.wave_gate import dependency_check
from checks.frames import TableFrames
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
TID = uuid.uuid4()


class Result:
    def __init__(self, rows=(), scalar=None):
        self._rows, self._scalar = list(rows), scalar

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def first(self):
        return self.fetchone()

    def scalar(self):
        return self._scalar


class FakeDB:
    """Answers each execute in turn by the first matching SQL fragment; records every statement."""

    def __init__(self, answers):
        self.answers, self.sql, self.committed, self.rolled_back = answers, [], False, False

    async def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append((q, params))
        return next((r for frag, r in self.answers if frag in q), Result())

    async def commit(self):
        self.committed = True

    async def rollback(self):
        self.rolled_back = True


# T8 ---------------------------------------------------------------------------------------------------------------

def test_approved_fixes_are_scoped_to_the_runs_source_system():
    seen = []

    class S:
        def execute(self, stmt, params=None):
            seen.append((str(stmt), params))
            return Result(rows=[("KNA1.NAME1", "KUNNR=1000", "New name")], scalar="remediation_items")

    out = mig._approved_fixes(S(), ["customer_master"], "sys-a")
    assert out == [{"field": "KNA1.NAME1", "record_key": "KUNNR=1000", "new_value": "New name"}]
    sql, params = seen[-1]
    assert "i.scope = :scope" in sql and params["scope"] == "sys-a"
    mig._approved_fixes(S(), ["customer_master"], None)
    assert seen[-1][1]["scope"] == "upload"


# V1, V2 -----------------------------------------------------------------------------------------------------------

def _plan():
    ev = [Evidence(field="KNVV.KUNNR", text="Customer", check_table="KNA1", required=True)]
    return LoadPlan(
        objects=[PlanObject(module="sales_orders", anchor="VBAK", anchor_text="Orders",
                            prerequisites=[Prerequisite(table="tvak", text="Order types", kind="configuration",
                                                        fields=["VBAK.AUART"])])],
        edges=[Edge(before="customer_master", after="sales_orders", kind="required", evidence=ev),
               Edge(before="material_master", after="sales_orders", kind="reference", evidence=[])],
        unknown=[])


def test_dependency_gate_blocks_a_missing_predecessor_and_prerequisite():
    out = dependency_check(_plan(), ["sales_orders"], loaded=[], target_config={"TVKO"})
    assert not out["passed"] and out["actual"] == 2
    kinds = {i["kind"]: i for i in out["items"]}
    assert kinds["predecessor"]["needs"] == "customer_master" and kinds["predecessor"]["fields"] == ["KNVV.KUNNR"]
    assert kinds["prerequisite"]["needs"] == "tvak"  # matched upper-cased against the target's config tables


def test_dependency_gate_passes_when_the_predecessor_is_loaded_or_in_the_wave():
    assert dependency_check(_plan(), ["sales_orders"], loaded=["customer_master"], target_config={"TVAK"})["passed"]
    assert dependency_check(_plan(), ["sales_orders", "customer_master"], [], {"TVAK"})["passed"]


def test_dependency_gate_never_passes_an_unchecked_prerequisite_silently():
    out = dependency_check(_plan(), ["sales_orders", "customer_master"], [], None)
    assert out["passed"] and out["unchecked"] == ["tvak"] and "not checked" in out["detail"]


def test_signoff_refusal_lists_load_order_blockers_on_a_go_wave():
    deps = dependency_check(_plan(), ["sales_orders"], [], {"TVAK"})
    out = mig.signoff_refusal({"verdict": "go", "threshold": 85.0, "objects": [], "dependencies": deps})
    assert "load order" in out["detail"]
    assert [(r["kind"], r["needs"]) for r in out["reasons"]] == [("predecessor", "customer_master")]


# Wave sign-off and delete -----------------------------------------------------------------------------------------

def _wave(**kw):
    base = {"id": uuid.uuid4(), "name": "Wave 1", "stage": "build", "signed_off_at": None, "signed_off_by": None}
    row = {**base, **kw}
    return SimpleNamespace(**row, _mapping=row)


def _signoff(monkeypatch, db, uid, cockpit=None):
    import api.services.migration.cockpit as ck

    async def noop(*a, **k):
        return None

    async def wave(*a, **k):
        return _wave()

    async def cock(*a, **k):
        return cockpit or {"verdict": "go", "score": 99.0, "run_id": "run-1", "dependencies": {"passed": True}}

    monkeypatch.setattr(mig, "_set_rls", noop)
    monkeypatch.setattr(mig, "_load_wave", wave)
    monkeypatch.setattr(ck, "load_cockpit", cock)
    monkeypatch.setattr(mig, "current_user_id", lambda r: uid)
    req = SimpleNamespace(url=SimpleNamespace(path="/x"))
    return asyncio.run(mig.signoff_wave(uuid.uuid4(), req, db, SimpleNamespace(id=TID), "admin"))


def test_signoff_is_four_eyes(monkeypatch):
    db = FakeDB([("requested_by", Result(scalar="user-1"))])
    with pytest.raises(HTTPException) as e:
        _signoff(monkeypatch, db, "user-1")
    assert e.value.status_code == 403 and not db.committed


def test_concurrent_signoff_gets_409(monkeypatch):
    db = FakeDB([("requested_by", Result(scalar="user-1")), ("UPDATE migration_waves", Result())])
    with pytest.raises(HTTPException) as e:
        _signoff(monkeypatch, db, "user-2")
    assert e.value.status_code == 409 and db.rolled_back and not db.committed


def test_signoff_refuses_a_failed_load_order(monkeypatch):
    with pytest.raises(HTTPException) as e:
        _signoff(monkeypatch, FakeDB([]), "user-2", {"verdict": "go", "run_id": None, "objects": [],
                                                      "dependencies": {"passed": False, "items": []}})
    assert e.value.status_code == 409


def _delete(monkeypatch, db, w):
    async def noop(*a, **k):
        return None

    async def wave(*a, **k):
        return w

    monkeypatch.setattr(mig, "_set_rls", noop)
    monkeypatch.setattr(mig, "_load_wave", wave)
    req = SimpleNamespace(url=SimpleNamespace(path="/x"), method="DELETE", client=None, headers={})
    return asyncio.run(mig.delete_wave(uuid.uuid4(), req, db, SimpleNamespace(id=TID), "admin"))


def test_a_signed_wave_cannot_be_deleted(monkeypatch):
    db = FakeDB([])
    with pytest.raises(HTTPException) as e:
        _delete(monkeypatch, db, _wave(signed_off_at=pd.Timestamp("2026-01-01")))
    assert e.value.status_code == 409 and not any("DELETE" in q for q, _ in db.sql)


def test_a_wave_with_a_signed_certificate_cannot_be_deleted(monkeypatch):
    db = FakeDB([("wave_certificates", Result(rows=[(1,)]))])
    with pytest.raises(HTTPException) as e:
        _delete(monkeypatch, db, _wave())
    assert e.value.status_code == 409 and not any("DELETE" in q for q, _ in db.sql)


def test_wave_delete_is_audited(monkeypatch):
    calls = []

    async def audit(*a, **k):
        calls.append(a)

    monkeypatch.setattr(mig, "write_audit", audit)
    db = FakeDB([])
    _delete(monkeypatch, db, _wave())
    assert db.committed and calls and calls[0][3:5] == ("delete", "migration_wave")


# T5 ---------------------------------------------------------------------------------------------------------------

def test_an_hr_template_under_the_material_master_is_refused():
    cov = {"sheets": [{"table": "PA0001", "matched": 9}, {"table": "MARA", "matched": 1}]}
    msg = mig.template_module_mismatch(cov, "material_master")
    assert msg and "PA0001" in msg
    assert mig.template_module_mismatch({"sheets": [{"table": "MARA", "matched": 9}]}, "material_master") is None


# S3, S4 -----------------------------------------------------------------------------------------------------------

def _job_book():
    return wb.Workbook(sheets=[wb.Sheet("Job Info", "grid", [wb.Column(header=i, id=i) for i in
                                                            ["user-id", "start-date", "seq-number", "jobTitle"]])],
                       picklists={})


def _job_frames(rows):
    cols = ["EMPJOBHIST.USERID", "EMPJOBHIST.START_DATE", "EMPJOBHIST.SEQ_NUMBER", "EMPJOBHIST.JOB_TITLE"]
    return TableFrames({"EMPJOBHIST": pd.DataFrame(rows, columns=cols)}, D)


def test_a_duplicate_effective_record_is_held():
    tabs, rep = wb.fill(_job_book(), _job_frames([["u1", "2024-01-01", "1", "T1"], ["u1", "2024-01-01", "1", "T2"],
                                                  ["u1", "2024-01-01", "2", "T3"]]))
    assert rep["reasons"].get("duplicate_effective_record") == 1
    held = [h for h in rep["held"] if h["reason"] == "duplicate_effective_record"]
    assert len(held) == 1 and "duplicate effective record" in held[0]["detail"].lower()
    assert rep["sheets"][0]["ready"] == 2


def test_a_start_date_only_incremental_load_is_flagged():
    _, rep = wb.fill(_job_book(), _job_frames([["u1", "2024-01-01", "1", "T1"]]), load_mode="incremental",
                     since=date(2023, 1, 1))
    assert rep["summary"]["start_date_only"] == ["Job Info"]
    _, full = wb.fill(_job_book(), _job_frames([["u1", "2024-01-01", "1", "T1"]]))
    assert full["summary"]["start_date_only"] == []


# G3 ---------------------------------------------------------------------------------------------------------------

def _delete_system(db):
    req = SimpleNamespace(url=SimpleNamespace(path="/x"), method="DELETE", client=None, headers={})
    return asyncio.run(systems.delete_system("sys-1", req, db, SimpleNamespace(id=TID), "admin"))


def test_a_system_in_use_is_not_deleted_and_names_what_holds_it():
    db = FakeDB([("FROM sap_systems", Result(rows=[("sys-1", "ECC", "sap_ecc")])),
                 ("FROM migration_runs", Result(rows=[("run-1",)])),
                 ("FROM migration_waves", Result(rows=[("Wave 1",)])),
                 ("FROM analysis_versions", Result(rows=[("ver-1",)]))])
    with pytest.raises(HTTPException) as e:
        _delete_system(db)
    assert e.value.status_code == 409
    d = e.value.detail
    assert d["runs"] == ["run-1"] and d["waves"] == ["Wave 1"] and d["active_jobs"] == ["ver-1"]
    assert not any(q.startswith("DELETE") for q, _ in db.sql) and not db.committed


def test_an_unused_system_is_deleted_and_audited(monkeypatch):
    import api.services.rbac as rbac
    calls = []

    async def audit(*a, **k):
        calls.append(a)

    monkeypatch.setattr(rbac, "write_audit", audit)
    db = FakeDB([("FROM sap_systems", Result(rows=[("sys-1", "ECC", "sap_ecc")]))])
    assert _delete_system(db) == {"status": "deleted"}
    assert db.committed and calls[0][3:6] == ("delete", "sap_system", "sys-1")
