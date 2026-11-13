"""The licence as workers apply it (api/middleware/licence.licensed_modules_of): a run that a schedule, a sync,
a drift alert or a write-back starts checks the same entitlement as a run a user starts by hand."""

from __future__ import annotations

import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import api.middleware.licence as lic


@pytest.fixture
def manifest(monkeypatch):
    """Set the cached licence manifest a worker reads (fresh, so no revalidation)."""
    monkeypatch.setattr(lic.settings, "licence_key", "k")
    monkeypatch.setitem(lic._cache, "expires_at", time.time() + 60)

    def put(m: dict) -> None:
        monkeypatch.setitem(lic._cache, "response", m)
    return put


def test_licensed_modules_follow_the_manifest(manifest, monkeypatch):
    manifest({"valid": True, "enabled_modules": ["material_master", "employee_central"]})
    assert lic.licensed_modules_of(["material_master", "fi_gl", "employee_central"]) == \
        ["material_master", "employee_central"]
    manifest({"valid": True, "enabled_modules": [], "modules": ["fi_gl"]})  # legacy field
    assert lic.licensed_modules_of(["material_master", "fi_gl"]) == ["fi_gl"]
    manifest({"valid": True, "enabled_modules": ["*"]})
    assert lic.licensed_modules_of(["material_master", "fi_gl"]) == ["material_master", "fi_gl"]
    manifest({"valid": False, "enabled_modules": ["*"]})
    assert lic.licensed_modules_of(["material_master"]) == []
    manifest({"valid": True})
    assert lic.licensed_modules_of(["material_master"]) == []
    monkeypatch.setattr(lic.settings, "licence_key", None)
    monkeypatch.setattr(lic.settings, "env", "development")
    assert lic.licensed_modules_of(["material_master"]) == ["material_master"]  # development bypass


def test_an_expired_cache_revalidates_and_a_cutoff_licenses_nothing(manifest, monkeypatch):
    monkeypatch.setitem(lic._cache, "expires_at", time.time() - 1)

    async def cutoff():
        return None, "cutoff"
    monkeypatch.setattr(lic, "revalidate", cutoff)
    assert lic.licensed_modules_of(["material_master"]) == []

    async def fresh():
        return {"valid": True, "enabled_modules": ["material_master"]}, "valid"
    monkeypatch.setattr(lic, "revalidate", fresh)
    assert lic.licensed_modules_of(["material_master", "fi_gl"]) == ["material_master"]


def test_run_cleaning_skips_an_unlicensed_object():
    from workers.tasks.run_cleaning import run_cleaning

    with patch("api.middleware.licence.licensed_modules_of", return_value=[]), \
            patch("workers.dataset.load_dataset") as load:
        out = run_cleaning.run("v1", "t1", "material_master", "/data/x.parquet")
    assert out["skipped"] == "not licensed" and out["candidates"] == 0
    load.assert_not_called()


def test_run_extraction_refuses_when_no_module_is_licensed_and_drops_the_unlicensed_ones():
    from workers.tasks import run_extraction as mod

    with patch("api.middleware.licence.licensed_modules_of", return_value=[]), \
            patch.object(mod.jobs, "finish_job") as finish, patch.object(mod, "_acquire_system_lock") as lock:
        out = mod.run_extraction.run("t1", "s1", ["fi_gl"], version_id="v1")
    assert out["status"] == "not_licensed"
    lock.assert_not_called()  # refused before it holds the system or opens a SAP session
    assert finish.call_args.args[:3] == ("t1", "dl-v1", "failed")

    with patch("api.middleware.licence.licensed_modules_of", side_effect=lambda ms: [m for m in ms if m != "fi_gl"]), \
            patch.object(mod, "_acquire_version_lock", return_value=True), \
            patch.object(mod, "_acquire_system_lock", return_value=True), \
            patch.object(mod, "_release_system_lock"), patch.object(mod, "_extract", return_value={}) as extract:
        mod.run_extraction.run("t1", "s1", ["material_master", "fi_gl"], version_id="v1")
    assert extract.call_args.args[3] == ["material_master"]

    with patch("api.middleware.licence.licensed_modules_of", return_value=[]) as held, \
            patch.object(mod, "_acquire_version_lock", return_value=True), \
            patch.object(mod, "_acquire_system_lock", return_value=True), \
            patch.object(mod, "_release_system_lock"), patch.object(mod, "_extract", return_value={}) as extract:
        mod.run_extraction.run("t1", "s1", ["PTP"], version_id="v1", purpose="process_discovery")
    held.assert_not_called()  # a discovery download is licence-checked by its L1 before it is queued
    extract.assert_called_once()


def test_sync_scheduler_skips_an_unlicensed_profile_but_moves_its_schedule_on():
    from workers import scheduler

    rows = [("p-licensed", "0 2 * * *", None, ["material_master"], "material_master"),
            ("p-dropped", "0 2 * * *", None, None, "fi_gl")]
    session = MagicMock()
    session.__enter__.return_value = session
    session.execute.return_value.fetchall.return_value = rows
    with patch.object(scheduler, "get_sync_engine"), patch.object(scheduler, "Session", return_value=session), \
            patch.object(scheduler, "_get_tenants", return_value=[{"id": "t1"}]), \
            patch.object(scheduler, "_set_rls"), \
            patch("api.middleware.licence.licensed_modules_of",
                  side_effect=lambda ms: [m for m in ms if m == "material_master"]), \
            patch("workers.tasks.run_sync.run_sync.delay") as delay:
        scheduler.sync_profile_scheduler.run()
    delay.assert_called_once_with("p-licensed", "t1", trigger="scheduled")
    moved = [c.args[1]["pid"] for c in session.execute.call_args_list
             if "UPDATE sync_profiles SET next_run_at" in str(c.args[0])]
    assert moved == ["p-licensed", "p-dropped"]


def test_process_schedule_skips_an_l1_whose_modules_are_unlicensed():
    from workers.tasks import process_schedules as mod

    session = MagicMock()
    session.execute.return_value.first.return_value = SimpleNamespace(system_type="ecc", timezone=None)
    session.execute.return_value.one_or_none.return_value = SimpleNamespace(system_type="ecc", timezone=None)
    with patch("api.middleware.licence.licensed_modules_of", return_value=[]), \
            patch.object(mod, "_redis_client") as redis:
        assert mod.start_run(session, "t1", {"id": "sch1", "system_id": "s1", "l1": "PTP"}) is None
    redis.assert_not_called()  # skipped before it takes a lock or queues a job


def test_destination_projection_runs_only_licensed_target_packs():
    import pandas as pd

    from checks.frames import TableFrames
    from sap.ddic import get_dictionary
    from tests.test_migration_dest_score import _passing, _project

    mara = pd.DataFrame({"MARA.MATNR": ["000000000000100001", "pump-housing_x"], "MARA.MTART": ["ROH", "HALB"]})
    frames = TableFrames({"MARA": mara}, get_dictionary("ecc6"), module="material_master")
    src = [_passing("material_master", "SRC-MTART", "MARA.MTART", 2)]
    full = _project("material_master", frames, ["MARA"], src)
    assert full["packs_unlicensed"] == []
    with patch("api.middleware.licence.licensed_modules_of", return_value=[]):
        narrowed = _project("material_master", frames, ["MARA"], src)
    assert narrowed["packs_unlicensed"] == ["business_partner", "s4_readiness", "s4hc_master_data"]
    assert narrowed["rules_target"] == 0
