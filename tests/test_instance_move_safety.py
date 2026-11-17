"""Instance move safety: same-system refusal, the migration target flag and the dry-run default."""

import inspect

from api.services.migration import instance_move as im

BASE = "https://sf.example.test"


def test_same_host_different_company_id_is_allowed():
    a = {"id": "a", "base_url": BASE, "company_id": "toyco1"}
    b = {"id": "b", "base_url": BASE + "/", "company_id": "toyco2", "migration_target": True}
    assert not im.same_system(a, b)
    assert im.check_safety(a, b, dry_run=False) is None


def test_same_host_same_company_id_is_refused():
    a = {"id": "a", "base_url": BASE, "company_id": "toyco1"}
    b = {"id": "b", "base_url": BASE.upper(), "company_id": "TOYCO1", "migration_target": True}
    assert im.same_system(a, b)
    assert "same system" in im.check_safety(a, b, dry_run=True)
    assert "same system" in im.check_safety(a, b, dry_run=False)


def test_same_id_is_refused():
    assert im.same_system({"id": "x", "base_url": BASE}, {"id": "x", "base_url": "https://other.example.test"})


def test_rfc_compares_host_client_sysnr():
    a = {"id": "a", "host": "sap.example.test", "client": "100", "sysnr": "00"}
    assert im.same_system(a, {**a, "id": "b"})
    assert not im.same_system(a, {**a, "id": "b", "client": "200"})


def test_unflagged_target_refused_live_but_allowed_dry():
    a = {"id": "a", "base_url": BASE, "company_id": "toyco1"}
    b = {"id": "b", "base_url": BASE, "company_id": "toyco2"}
    assert "migration target" in im.check_safety(a, b, dry_run=False)
    assert im.check_safety(a, b, dry_run=True) is None


def test_load_defaults_to_dry_run():
    assert inspect.signature(im.load).parameters["dry_run"].default is True
