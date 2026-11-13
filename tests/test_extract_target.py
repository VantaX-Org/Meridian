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


def test_empty_template_id_opts_module_out_of_default():
    assert choose(templates={"material_master": ""})["templates"] == []


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


def test_stale_compare_ignores_whitespace_and_number_formatting():
    import pandas as pd
    from api.services.fix_simulation import _patch_records
    df = pd.DataFrame({"T.KEY": ["1", "2", "3"], "T.F": [" 1,000.00 ", "10.0", "abc"]})
    stale: list = []
    out, n, _ = _patch_records(df, "T", "T.F", {"KEY=1": "x", "KEY=2": "y", "KEY=3": "z"}, ["KEY"],
                               {"KEY=1": "1000", "KEY=2": "10", "KEY=3": "abd"}, stale)
    assert n == 2 and list(out["T.F"]) == ["x", "y", "abc"]
    assert stale == [{"field": "T.F", "record_key": "KEY=3"}]


def test_autofill_skips_delta_run_without_exporting(monkeypatch):
    import api.routes.migration as mig

    def boom(*a, **k):
        raise AssertionError("must not export partial data")
    monkeypatch.setattr(mig, "_export_workbook", boom)
    out = xt.autofill(_session(), "tenant", "ver-1", _target(), delta=True)
    e = out["templates"][0]
    assert e["status"] == "skipped" and e["error"] == "delta run; refill from full version"


def test_extract_succeeds_when_autofill_raises(monkeypatch):
    import contextlib

    import pandas as pd
    from api.services import connectivity_manager, source_design, storage, suppression
    from workers.tasks import run_extraction as re_

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = None
    monkeypatch.setattr(re_, "get_sync_engine", lambda: object())
    monkeypatch.setattr(re_, "tenant_session", lambda e, t: contextlib.nullcontext(session))
    monkeypatch.setattr(re_, "wait_for_config", lambda *a, **k: "loaded")
    monkeypatch.setattr(re_, "_mark_modules", lambda *a, **k: None)
    monkeypatch.setattr(re_, "_store_profiles", lambda *a, **k: None)
    monkeypatch.setattr(re_, "_profile", lambda *a, **k: ("MARA", {}, []))
    monkeypatch.setattr(re_, "_touch_system_lock", lambda *a, **k: None)
    monkeypatch.setattr("api.services.task_progress.publish_progress", lambda *a, **k: None)
    monkeypatch.setattr(storage, "upload_file", lambda *a, **k: None)
    monkeypatch.setattr("sap.rfc.require_memory", lambda *a, **k: None)
    monkeypatch.setattr(suppression, "filter_frame", lambda t, df: (df, 0))
    monkeypatch.setattr(suppression, "record_dropped", lambda *a, **k: None)
    monkeypatch.setattr(source_design, "dictionary_for", lambda *a, **k: None)
    monkeypatch.setattr(re_.jobs, "get_job", lambda *a, **k: {})
    monkeypatch.setattr(re_.jobs, "update_job", lambda *a, **k: None)
    finished = []
    monkeypatch.setattr(re_.jobs, "finish_job", lambda *a, **k: finished.append((a, k)))

    class FakeManager:
        def __init__(self, *a, **k):
            pass

        def extract(self, system_id, modules, scope=None, progress=None, sink=None, delta=None):
            cov = {"table": "MARA", "status": "live", "modules": ["material_master"], "purpose": "data"}
            sink("MARA", pd.DataFrame({"MARA.MATNR": ["1"]}), cov)
            return {}, [cov]
    monkeypatch.setattr(connectivity_manager, "ConnectivityManager", FakeManager)

    def boom(*a, **k):
        raise RuntimeError("fill exploded")
    monkeypatch.setattr(xt, "autofill", boom)

    target = {"target_system_id": PAIRED, "templates": [{"module": "material_master", "template_id": "t", "status": "pending"}]}
    out = re_._extract(MagicMock(), "tenant", "sys", ["material_master"], False, "data", None, False, "lbl", "ver-1",
                       False, None, extract_target=target)
    assert out["status"] == "success" and out["version_id"] == "ver-1"
    assert finished and finished[0][1].get("error") is None
