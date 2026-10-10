"""GET /versions/{id}/findings/{check_id}/root-cause: tenant set first, stored row or not_computed."""

import asyncio
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.routes.versions import finding_root_cause


class _Res:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class _DB:
    def __init__(self, rows):
        self.rows, self.calls = list(rows), []

    async def execute(self, stmt, params=None):
        self.calls.append((str(stmt), params or {}))
        return _Res(self.rows.pop(0))


TENANT = SimpleNamespace(id=uuid.uuid4())
VID = uuid.uuid4()


def test_returns_the_stored_root_cause_with_tenant_set_first():
    stored = SimpleNamespace(_mapping={"status": "computed", "field": "MARC.DISMM", "analysed": 4, "total": 4,
                                       "origins": [{"origin": "interface", "username": "BATCH_IF01", "tcode": "MM02",
                                                    "records": 2, "share": 50.0}],
                                       "summary": "50% …", "detail": ""})
    db = _DB([None, ("sys",), stored])
    out = asyncio.run(finding_root_cause(VID, "MMTEST", db=db, tenant=TENANT))
    assert "set_config('app.tenant_id'" in db.calls[0][0] and db.calls[0][1] == {"tid": str(TENANT.id)}
    assert db.calls[2][1]["tid"] == str(TENANT.id)
    assert out["status"] == "computed" and out["origins"][0]["username"] == "BATCH_IF01"
    assert out["version_id"] == str(VID) and out["check_id"] == "MMTEST"


def test_not_computed_until_the_task_ran():
    out = asyncio.run(finding_root_cause(VID, "MMTEST", db=_DB([None, ("sys",), None]), tenant=TENANT))
    assert out["status"] == "not_computed" and out["origins"] == []


def test_unknown_version_is_404():
    with pytest.raises(HTTPException) as e:
        asyncio.run(finding_root_cause(VID, "MMTEST", db=_DB([None, None]), tenant=TENANT))
    assert e.value.status_code == 404
