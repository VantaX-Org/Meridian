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


@pytest.mark.asyncio
async def test_a_passing_or_errored_critical_rule_does_not_colour_its_field_red():
    """The route passes details->>'error' through, so an errored check is not read as failing."""
    class _Rows:
        def __init__(self, rows):
            self.rows = rows

        def fetchall(self):
            return self.rows

    class _DB:
        async def execute(self, stmt, params=None):
            if "FROM findings" in str(stmt):
                return _Rows([("AP018", 100.0, 0, "critical", "ok", "accounts_payable", None),
                              ("AP019", 0.0, 7, "high", "x", "accounts_payable", "column missing")])
            return _Rows([])

    out = await bp.get_business_process(str(uuid.uuid4()), "accounts_payable", None, db=_DB(),
                                        tenant=SimpleNamespace(id=uuid.uuid4()))
    fields = [f for l1 in out["processes"] for l2 in l1["l2_groups"] for l3 in l2["l3_processes"]
              for l4 in l3["l4_subprocesses"] for a in l4["activities"] for f in a["fields"]]
    ours = [f for f in fields if f["check_id"] in ("AP018", "AP019")]
    assert ours and all(f["dq_status"] == "green" for f in ours)
