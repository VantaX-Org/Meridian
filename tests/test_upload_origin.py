"""An upload is a hand-made file: attaching it to a system needs trigger_sync or manage_systems at that
system (not just upload), and its values carry origin "upload" so they never rank as that trusted system
nor make it a golden write-back target."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pandas as pd
import pytest
from fastapi import HTTPException

from api.services import rbac
from api.services.survivorship import FieldContribution, apply_trusted_source, matches_source
from tests.test_upload_path import _client, _post, _SystemsDB

WHEN = datetime(2026, 1, 1, tzinfo=timezone.utc)
PRD = str(uuid.uuid4())


def test_attaching_an_upload_to_a_system_needs_trigger_sync_or_manage_systems(monkeypatch):
    sid = str(uuid.uuid4())
    monkeypatch.setitem(rbac.PERMISSIONS, "analyst", {"view", "upload"})  # upload only
    c, stored, created = _client(monkeypatch, _SystemsDB(sid))
    c.headers.update({"X-User-Role": "analyst"})
    r = _post(c, system_id=sid)
    assert r.status_code == 403, r.text
    assert stored == [] and created == []
    assert _post(c).status_code == 200  # an unattached upload still needs only upload

    monkeypatch.setitem(rbac.PERMISSIONS, "analyst", {"view", "upload", "trigger_sync"})
    assert _post(c, system_id=sid).status_code == 200


def test_attach_check_is_scoped_to_that_system(monkeypatch):
    import api.routes.upload as routes

    seen: list[tuple[str, rbac.Scope]] = []

    async def fake_scope(request, db, tenant, action, scope):
        seen.append((action, scope))
        raise HTTPException(status_code=403, detail="forbidden")

    monkeypatch.setattr(routes, "require_scope", fake_scope)
    sid = str(uuid.uuid4())
    c, _, created = _client(monkeypatch, _SystemsDB(sid))
    assert _post(c, system_id=sid).status_code == 403
    assert seen == [("trigger_sync", rbac.Scope(uuid.UUID(sid))), ("manage_systems", rbac.Scope(uuid.UUID(sid)))]
    assert created == []


def test_uploaded_value_never_ranks_as_its_attached_system():
    up = FieldContribution("Forged", "upload:aaaa1111", WHEN, system_id=PRD, system_name="PRD", origin="upload")
    real = FieldContribution("Real", "upload:bbbb2222", WHEN, system_id=str(uuid.uuid4()), system_name="S4P")
    assert not matches_source(up, [PRD, "PRD"])
    assert matches_source(up, "upload:aaaa1111")  # an explicit file label still matches
    assert apply_trusted_source([up, real], [[PRD, "PRD"], "S4P"]).value == "Real"
    assert apply_trusted_source([up], [[PRD, "PRD"]]) is None


def test_build_task_tags_upload_rows_and_the_entry_keeps_it():
    from api.services.golden_record_engine import contribution_from_entry, system_tags
    from workers.tasks.build_golden_records import _rows_to_incoming

    df = pd.DataFrame([{"PARTNER": "1", "NAME_ORG1": "Acme"}])
    assert _rows_to_incoming(df, "upload:aaaa1111", PRD, "PRD", "upload")[0]["origin"] == "upload"
    assert "origin" not in _rows_to_incoming(df, "upload:aaaa1111", PRD, "PRD")[0]
    entry = {"value": "Acme", "source_system": "upload:aaaa1111", **system_tags(PRD, "PRD", "upload")}
    assert entry["origin"] == "upload"
    assert contribution_from_entry(entry).origin == "upload"


@pytest.mark.asyncio
async def test_writeback_targets_skip_uploaded_values():
    from api.services.golden_writeback import resolve_targets

    calls: list[str] = []

    class _R:
        def fetchone(self):
            return None

    class _DB:
        async def execute(self, stmt, params=None):
            calls.append(" ".join(str(stmt).split()))
            return _R()

    contribs = {"NAME_ORG1": {"value": "x", "source_system": "upload:aaaa1111", "origin": "upload",
                              "source_system_id": PRD}}
    assert await resolve_targets(_DB(), str(uuid.uuid4()), contribs) == ([], [])
    assert calls == []
    await resolve_targets(_DB(), str(uuid.uuid4()), {"F": {"value": "x", "source_system": "upload:aaaa1111"}})
    assert "metadata->>'upload_path' IS NOT NULL" in calls[0]
