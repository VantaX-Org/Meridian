"""Inbox exception tasks carry what they are about (frontend inbox titles them by check and object).

GET /stewardship copies each exception task's title, check id and object from its exception and linked finding,
so the frontend never shows a bare "Exception" with Object "Not named" when the exceptions list is out of reach.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from api.routes.stewardship import (QueueItemOut, _exception_sources, apply_exception_sources,
                                    exception_source_module)


def _item(item_type: str = "exception", source_id: str = "e1") -> QueueItemOut:
    return QueueItemOut(id="q1", tenant_id="t", item_type=item_type, source_id=source_id, domain="unknown",
                        priority=1, status="open", created_at="", updated_at="")


def test_module_prefers_linked_finding_then_signal_then_custom_category():
    assert exception_source_module("material_master", {"modules": ["fi_gl"]}, "sap_signal", "x") == "material_master"
    assert exception_source_module(None, {"modules": ["", "fi_gl"]}, "sap_signal", "x") == "fi_gl"
    assert exception_source_module(None, None, "custom_business", "business_partner") == "business_partner"
    assert exception_source_module(None, {"modules": "fi_gl"}, "sap_signal", "Financial") is None
    assert exception_source_module(None, None, "sap_signal", "Financial") is None


def test_apply_sources_names_exception_tasks_only():
    exc, merge = _item(), _item("merge_decision", "e1")
    apply_exception_sources([exc, merge], {"e1": {"title": " Blank material group ", "check_id": "MM045", "module": "material_master"}})
    assert (exc.source_title, exc.source_check_id, exc.source_module) == ("Blank material group", "MM045", "material_master")
    assert merge.source_title is None and merge.source_module is None


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _Db:
    def __init__(self, rows=None, fail=False):
        self.rows, self.fail, self.params = rows or [], fail, None

    @asynccontextmanager
    async def begin_nested(self):
        yield

    async def execute(self, _sql, params):
        self.params = params
        if self.fail:
            raise RuntimeError("relation does not exist")
        return _Result(self.rows)


def test_exception_sources_reads_title_check_and_object_scoped_to_tenant():
    db = _Db([("e1", "Blank group", "custom_business", "material_master", None, None, None),
              ("e2", "Signal", "sap_signal", "Financial", {"modules": ["fi_gl"]}, "FI001", "fi_gl")])
    out = asyncio.run(_exception_sources(db, "tenant-1", ["e1", "e2"]))  # type: ignore[arg-type]
    assert db.params == {"tid": "tenant-1", "ids": ["e1", "e2"]}
    assert out["e1"] == {"title": "Blank group", "check_id": None, "module": "material_master"}
    assert out["e2"] == {"title": "Signal", "check_id": "FI001", "module": "fi_gl"}


def test_exception_sources_never_breaks_the_list():
    assert asyncio.run(_exception_sources(_Db(fail=True), "t", ["e1"])) == {}  # type: ignore[arg-type]
    assert asyncio.run(_exception_sources(_Db(), "t", [])) == {}  # type: ignore[arg-type]
