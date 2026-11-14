"""POST /systems/{id}/versions/{v}/split-scope: preview the smaller scopes of a capped run, then start them."""

import uuid

import pytest
from fastapi import HTTPException

import api.routes.system_objects as so
import sap.ddic
from api.deps import Tenant


class _Row:
    def __init__(self, label, metadata):
        self.label, self.metadata = label, metadata


class _Res:
    def __init__(self, row=None, scalar=None):
        self._row, self._scalar = row, scalar

    def scalar(self):
        return self._scalar

    def first(self):
        return self._row


class _DB:
    def __init__(self, row):
        self.row = row

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "system_type" in sql:
            return _Res(scalar="ecc")
        if "analysis_versions" in sql:
            return _Res(row=self.row)
        return _Res()


class _Dict:
    def field(self, table, name):
        return name if (table, name) == ("MARC", "WERKS") else None


_META = {"system_id": "s", "modules": ["material_master"], "scope": {"plants": ["P1", "P2", "P3", "P4"]},
         "coverage": [{"table": "MARC", "status": "live", "rows": 100, "source_rows": 180, "truncated": True},
                      {"table": "MARA", "status": "live", "rows": 50}]}


@pytest.fixture(autouse=True)
def _dict(monkeypatch):
    monkeypatch.setattr(sap.ddic, "dictionary_for_system", lambda st: _Dict())


async def _call(row, start=False):
    return await so.split_capped_scope(uuid.uuid4(), uuid.uuid4(), so.SplitScopeBody(start=start), request=None,
                                       db=_DB(row), tenant=Tenant(uuid.uuid4(), "T", []))


@pytest.mark.asyncio
async def test_preview_answers_scopes_and_starts_nothing(monkeypatch):
    started = []
    monkeypatch.setattr(so, "start_download", lambda *a, **k: started.append(a))
    out = await _call(_Row("Weekly", _META))
    assert out["split_by"] == "plants" and out["tables"] == ["MARC"]
    assert out["scopes"] == [{"plants": ["P1", "P2"]}, {"plants": ["P3", "P4"]}]
    assert "downloads" not in out and not started


@pytest.mark.asyncio
async def test_start_queues_one_analysed_download_per_scope(monkeypatch):
    bodies = []

    async def fake(system_id, body, request, db, tenant):
        bodies.append(body)
        return {"version_id": str(len(bodies))}

    monkeypatch.setattr(so, "start_download", fake)
    out = await _call(_Row("Weekly", _META), start=True)
    assert [d["version_id"] for d in out["downloads"]] == ["1", "2"]
    assert [b.scope for b in bodies] == out["scopes"]
    assert all(b.analyse and b.objects == ["material_master"] for b in bodies)
    assert bodies[0].label == "Weekly (1 of 2)"


@pytest.mark.asyncio
async def test_unsplittable_scope_is_422_with_reason():
    meta = {**_META, "scope": {}}
    with pytest.raises(HTTPException) as e:
        await _call(_Row(None, meta))
    assert e.value.status_code == 422 and "two or more plants" in e.value.detail


@pytest.mark.asyncio
async def test_unknown_run_is_404():
    with pytest.raises(HTTPException) as e:
        await _call(None)
    assert e.value.status_code == 404
