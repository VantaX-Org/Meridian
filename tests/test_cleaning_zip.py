"""The bulk cleaning workbook ZIP: one file per run and object, refusals, licence check and the audit rows."""
import asyncio
import io
import uuid
import zipfile
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.routes import reports

V1, V2 = str(uuid.uuid4()), str(uuid.uuid4())


def _req(licensed=None):
    return SimpleNamespace(state=SimpleNamespace(licensed_modules=licensed))


@pytest.fixture
def stubbed(monkeypatch):
    audited: list[tuple[str, str]] = []

    async def no_rls(db, tenant):
        return None

    async def audit(request, tenant, kind, vid, module):
        audited.append((str(vid), module))

    monkeypatch.setattr(reports, "_rls", no_rls)
    monkeypatch.setattr(reports, "_audit_export", audit)
    monkeypatch.setattr(reports, "_modules", lambda: ["material_master", "customer_master"])
    monkeypatch.setattr(reports, "_cleaning_sync", lambda t, vid, m: (f"{m}-{vid}".encode(), f"{m}-cleaning.xlsx"))
    return audited


def _call(runs, licensed=None):
    tenant = SimpleNamespace(id=uuid.uuid4())
    return asyncio.run(reports.cleaning_zip(_req(licensed), runs=runs, db=None, tenant=tenant))


def test_zip_holds_one_workbook_per_pair_and_audits_each(stubbed):
    res = _call(f"{V1}:material_master,{V2}:customer_master,{V1}:material_master")
    assert res.media_type == "application/zip"
    assert "Cleaning workbooks" in res.headers["content-disposition"]
    names = zipfile.ZipFile(io.BytesIO(res.body)).namelist()
    assert sorted(names) == ["customer_master-cleaning.xlsx", "material_master-cleaning.xlsx"]
    assert stubbed == [(V1, "material_master"), (V2, "customer_master")]


def test_two_runs_of_one_object_keep_both_files(stubbed):
    res = _call(f"{V1}:material_master,{V2}:material_master")
    assert len(zipfile.ZipFile(io.BytesIO(res.body)).namelist()) == 2


@pytest.mark.parametrize("runs,code", [("", 422), ("nope:material_master", 422), (f"{V1}:no_such", 422)])
def test_bad_input_is_refused(stubbed, runs, code):
    with pytest.raises(HTTPException) as e:
        _call(runs)
    assert e.value.status_code == code


def test_unlicensed_object_is_refused(stubbed):
    with pytest.raises(HTTPException) as e:
        _call(f"{V1}:material_master,{V2}:customer_master", licensed=["material_master"])
    assert e.value.status_code == 402


def test_missing_run_refuses_the_bundle(stubbed, monkeypatch):
    monkeypatch.setattr(reports, "_cleaning_sync", lambda t, vid, m: None)
    with pytest.raises(HTTPException) as e:
        _call(f"{V1}:material_master")
    assert e.value.status_code == 404


def test_too_many_runs_is_refused(stubbed):
    runs = ",".join(f"{uuid.uuid4()}:material_master" for _ in range(reports._ZIP_MAX + 1))
    with pytest.raises(HTTPException) as e:
        _call(runs)
    assert e.value.status_code == 422


def test_oversized_bundle_is_refused(stubbed, monkeypatch):
    monkeypatch.setattr(reports, "_ZIP_MAX_BYTES", 10)
    with pytest.raises(HTTPException) as e:
        _call(f"{V1}:material_master,{V2}:customer_master")
    assert e.value.status_code == 413
