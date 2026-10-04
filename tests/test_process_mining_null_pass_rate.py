"""A NULL findings.pass_rate (check never ran) must stay None, not 0%."""

import uuid
from types import SimpleNamespace

import pytest

from api.routes.process_mining import get_mining_graph


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _FakeDB:
    async def execute(self, stmt, params=None):
        if "FROM findings" in str(stmt):
            # check_id, pass_rate, affected_count, severity, message, module
            return _Result([("AP018", None, 0, "low", "", "accounts_payable")])
        return _Result([])


@pytest.mark.asyncio
async def test_null_pass_rate_is_none_and_not_red():
    resp = await get_mining_graph(
        "v1", "accounts_payable", db=_FakeDB(), tenant=SimpleNamespace(id=uuid.uuid4())
    )
    assert resp.activities
    assert all(a.avg_pass_rate is None for a in resp.activities)
    assert all(a.step_status != "red" for a in resp.activities)
