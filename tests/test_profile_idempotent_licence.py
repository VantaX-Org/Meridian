"""Sync profile create is idempotent on (system, domain), and profile create, resume and the setup object list all
follow the licence: an unlicensed domain is refused (402) and shown as not licensed."""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import api.routes.system_objects as system_objects
import api.routes.systems as systems
from api.deps import Tenant

TENANT = Tenant(uuid.uuid4(), "Acme", [])
SID = str(uuid.uuid4())
PID = str(uuid.uuid4())
PROFILE_ROW = (PID, SID, "material_master", ["MARA"], None, True, None, None, "full")


def _req(licensed):
    return SimpleNamespace(state=SimpleNamespace(licensed_modules=licensed))


class _Result:
    def __init__(self, scalar=None, row=None):
        self._scalar, self._row = scalar, row

    def scalar(self):
        return self._scalar

    def fetchone(self):
        return self._row

    def fetchall(self):
        return []


class _DB:
    """Answers the existing-profile lookup with `existing` and the profile read-back with PROFILE_ROW."""

    def __init__(self, existing=None):
        self.existing = existing
        self.calls: list[str] = []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append(sql)
        if "SELECT id FROM sync_profiles" in sql:
            return _Result(scalar=self.existing)
        if "SELECT domain FROM sync_profiles" in sql:
            return _Result(scalar="material_master")
        return _Result(row=PROFILE_ROW)

    async def commit(self):
        pass


def _body(domain="material_master"):
    return systems.CreateSyncProfileRequest(system_id=SID, domain=domain, tables=["MARA"])


@pytest.mark.asyncio
async def test_create_returns_the_existing_profile_without_scheduling_again(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("create_schedule must not run when the profile exists")

    monkeypatch.setattr(systems.run_schedules, "create_schedule", boom)
    db = _DB(existing=PID)
    out = await systems.create_sync_profile(SID, _body(), _req(None), db=db, tenant=TENANT, role="admin")
    assert out.id == PID and out.domain == "material_master"


@pytest.mark.asyncio
async def test_create_schedules_when_no_profile_exists(monkeypatch):
    made = []

    async def create(db, tid, **k):
        made.append(k["domain"])
        return SimpleNamespace(id=PID)

    monkeypatch.setattr(systems.run_schedules, "create_schedule", create)
    monkeypatch.setattr(systems.attention, "invalidate", lambda tid: None)
    out = await systems.create_sync_profile(SID, _body(), _req(["material_master"]), db=_DB(), tenant=TENANT,
                                            role="admin")
    assert made == ["material_master"] and out.id == PID


@pytest.mark.asyncio
async def test_create_on_an_unlicensed_domain_is_402_before_any_query():
    db = _DB()
    with pytest.raises(HTTPException) as exc:
        await systems.create_sync_profile(SID, _body("customer_master"), _req(["material_master"]), db=db,
                                          tenant=TENANT, role="admin")
    assert exc.value.status_code == 402
    assert db.calls == []


@pytest.mark.asyncio
async def test_resuming_an_unlicensed_profile_is_402_but_pausing_is_allowed(monkeypatch):
    async def update(db, tid, pid, changes, system_id=None):
        return SimpleNamespace(id=PID)

    monkeypatch.setattr(systems.run_schedules, "update_schedule", update)
    monkeypatch.setattr(systems.attention, "invalidate", lambda tid: None)
    req = _req(["customer_master"])
    with pytest.raises(HTTPException) as exc:
        await systems.update_sync_profile(SID, PID, systems.UpdateSyncProfileRequest(active=True), req, db=_DB(),
                                          tenant=TENANT, role="admin")
    assert exc.value.status_code == 402
    out = await systems.update_sync_profile(SID, PID, systems.UpdateSyncProfileRequest(active=False), req, db=_DB(),
                                            tenant=TENANT, role="admin")
    assert out.id == PID


@pytest.mark.asyncio
@pytest.mark.parametrize("licensed,expect", [(None, [True, True]), (["*"], [True, True]),
                                             (["material_master"], [True, False])])
async def test_setup_object_list_marks_licensed(monkeypatch, licensed, expect):
    async def noop(*a, **k):
        return "S4"

    monkeypatch.setattr(system_objects, "_rls", noop)
    monkeypatch.setattr(system_objects, "_system_type", noop)
    monkeypatch.setattr(system_objects, "_catalogue",
                        lambda *a: [{"object": "material_master"}, {"object": "customer_master"}])
    import sap.extraction_registry as reg
    monkeypatch.setattr(reg, "preview_sources", lambda st: [])
    out = await system_objects.list_objects(uuid.UUID(SID), _req(licensed), db=_DB(), tenant=TENANT)
    assert [o["licensed"] for o in out["objects"]] == expect
