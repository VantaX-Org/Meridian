"""Extraction targets: validation, defaulting, auto-fill and its failure isolation. Synthetic ids only."""
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from api.services import extract_target as xt

SRC, PAIRED, OTHER_TGT, OTHER_SRC = "s-src", "s-paired", "s-tgt", "s-src2"
SYSTEMS = {SRC: {"role": "source"}, PAIRED: {"role": "source"}, OTHER_TGT: {"role": "target"}, OTHER_SRC: {"role": "source"}}
TEMPLATES = {"t-mat": {"module": "material_master", "name": "Mat v2"}, "t-cus": {"module": "customer_master", "name": "Cus"}}
LATEST = {"material_master": "t-mat", "customer_master": "t-cus"}


def choose(modules=("material_master",), system=None, templates=None, paired=PAIRED, systems=SYSTEMS, tpls=TEMPLATES):
    return xt.choose_target(SRC, paired, list(modules), system, templates, systems, tpls, LATEST)


def test_defaults_to_paired_system_and_latest_template():
    out = choose()
    assert out["target_system_id"] == PAIRED
    assert out["templates"] == [{"module": "material_master", "template_id": "t-mat", "template_name": "Mat v2", "status": "pending"}]


def test_explicit_target_role_system_and_template_accepted():
    out = choose(system=OTHER_TGT, templates={"material_master": "t-mat"})
    assert out["target_system_id"] == OTHER_TGT


def test_paired_system_allowed_even_when_source_role():
    assert choose(system=PAIRED)["target_system_id"] == PAIRED


def test_source_role_system_rejected():
    with pytest.raises(HTTPException) as e:
        choose(system=OTHER_SRC)
    assert e.value.status_code == 422 and "target role" in e.value.detail


def test_foreign_tenant_system_rejected():
    with pytest.raises(HTTPException) as e:
        choose(system="not-in-tenant")
    assert e.value.status_code == 422


def test_foreign_tenant_template_rejected():
    with pytest.raises(HTTPException) as e:
        choose(templates={"material_master": "other-tenant-template"})
    assert e.value.status_code == 422


def test_template_for_wrong_module_rejected():
    with pytest.raises(HTTPException) as e:
        choose(templates={"material_master": "t-cus"})
    assert e.value.status_code == 422 and "customer_master" in e.value.detail


def test_template_for_unrequested_module_rejected():
    with pytest.raises(HTTPException) as e:
        choose(templates={"customer_master": "t-cus"})
    assert e.value.status_code == 422 and "not among" in e.value.detail


def _session(row=(b"x", "t.xlsx")):
    s = MagicMock()
    s.execute.return_value.fetchone.return_value = ("Mat v2", 2, "t.xlsx", {"a": "b"}, b"xlsx-bytes")
    return s


def _target():
    return {"target_system_id": PAIRED, "templates": [{"module": "material_master", "template_id": "t-mat", "status": "pending"}]}


def test_autofill_success_marks_filled_audits_and_stores(monkeypatch):
    import api.routes.migration as mig
    from api.services import purge, storage
    uploads, audits = [], []
    monkeypatch.setattr(mig, "_export_workbook", lambda *a, **k: (b"filled", "xlsx", {"rows": 3}))
    monkeypatch.setattr(storage, "upload_file", lambda b, k, c, **kw: uploads.append(k))
    monkeypatch.setattr(purge, "write_audit_row", lambda *a, **k: audits.append(a[3]))
    s = _session()
    out = xt.autofill(s, "tenant", "ver-1", _target())
    e = out["templates"][0]
    assert e["status"] == "filled" and e["format"] == "xlsx" and e["summary"] == {"rows": 3}
    assert e["download_url"] == "/api/v1/versions/ver-1/extract-target/material_master/file"
    assert uploads == ["autofill/tenant/ver-1/material_master.xlsx"]
    assert audits == ["migration.template.autofill"]
    assert any("last_fill_version_id" in str(c.args[0]) for c in s.execute.call_args_list)


def test_autofill_failure_is_recorded_not_raised(monkeypatch):
    import api.routes.migration as mig

    def boom(*a, **k):
        raise HTTPException(422, "No mapped columns")
    monkeypatch.setattr(mig, "_export_workbook", boom)
    s = _session()
    out = xt.autofill(s, "tenant", "ver-1", _target())
    e = out["templates"][0]
    assert e["status"] == "failed" and "No mapped columns" in e["error"]
    s.rollback.assert_called()


def test_stale_fix_is_flagged_not_applied():
    import pandas as pd
    from api.services.fix_simulation import _patch_records
    df = pd.DataFrame({"T.KEY": ["1", "2"], "T.F": ["old", "newer-in-sap"]})
    stale: list = []
    out, n, _ = _patch_records(df, "T", "T.F", {"KEY=1": "fixed", "KEY=2": "fixed"}, ["KEY"],
                               {"KEY=1": "old", "KEY=2": "old"}, stale)
    assert n == 1 and list(out["T.F"]) == ["fixed", "newer-in-sap"]
    assert stale == [{"field": "T.F", "record_key": "KEY=2"}]
