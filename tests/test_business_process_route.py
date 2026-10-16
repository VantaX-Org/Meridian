"""GET /business-process/{run}/{module} for an object with no SPRO registry entry: no 500.

An object with a process definition still gets its document (config notes empty); one without
gets the empty list the process page reads as "no process definition", plus a reason.
"""

import uuid
from types import SimpleNamespace

import pytest

from api.routes import business_process as bp


class _Res:
    def fetchall(self):
        return []


class _FakeDB:
    async def execute(self, stmt, params=None):
        return _Res()


@pytest.fixture(autouse=True)
def _upload_run(monkeypatch):
    async def live(db, version_id):
        return "ecc", {}
    monkeypatch.setattr("api.services.source_design.live_config_for_version", live)


async def _get(module: str) -> dict:
    return await bp.get_business_process(str(uuid.uuid4()), module, None, db=_FakeDB(),
                                         tenant=SimpleNamespace(id=uuid.uuid4()))


@pytest.mark.asyncio
async def test_object_outside_the_spro_registry_still_gets_its_process():
    from sap.spro_tables import SPRO_REGISTRY
    assert "controlling" not in SPRO_REGISTRY
    out = await _get("controlling")
    assert out["processes"] and "reason" not in out


@pytest.mark.asyncio
async def test_object_without_a_process_definition_is_an_empty_list_with_a_reason():
    out = await _get("grc_compliance")
    assert out["processes"] == [] and out["reason"] == "no_process_definition"
