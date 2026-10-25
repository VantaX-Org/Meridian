"""GET /insights/exec names the run its per-run parts and exports come from (``latest_version_id``), also under
scope=current where ``version_id`` stays null. No database: the composed route functions are stubbed."""
import uuid
from typing import Any, Callable

import pytest

from api.deps import Tenant
from api.routes import insights


class _Db:
    async def run_sync(self, fn: Callable[[Any], Any]) -> Any:
        return fn(None)


def _stub(monkeypatch: pytest.MonkeyPatch, ids: list[str], newest: uuid.UUID | None) -> None:
    async def none(*_a: Any, **_k: Any) -> None:
        return None

    async def latest_ids(*_a: Any, **_k: Any) -> list[str]:
        return ids

    async def latest(*_a: Any, **_k: Any) -> uuid.UUID | None:
        return newest

    async def readiness(*_a: Any, **_k: Any) -> dict:
        return {"cells": []}

    async def impact(*_a: Any, **_k: Any) -> dict:
        return {"rows": []}

    async def owners(*_a: Any, **_k: Any) -> dict:
        return {"owners": []}

    async def proven(*_a: Any, **_k: Any) -> dict:
        return {"cost_by_l1": [], "currency": "EUR"}

    monkeypatch.setattr(insights, "_rls", none)
    monkeypatch.setattr(insights, "_latest_version_ids", latest_ids)
    monkeypatch.setattr(insights, "latest_run", latest)
    monkeypatch.setattr(insights, "get_readiness", readiness)
    monkeypatch.setattr(insights, "get_impact", impact)
    monkeypatch.setattr(insights, "get_owners", owners)
    monkeypatch.setattr(insights, "get_proven_cost", proven)
    monkeypatch.setattr(insights.agg, "current_overview", lambda s, tid, vids, mod: {
        "version_ids": vids, "dqs": {"composite": 84.0, "capped": True, "cap_reason": "MM140 critical"}})
    monkeypatch.setattr(insights, "_exec_dqs", lambda s, tid, vid: {"composite": 91.0, "capped": False})


TENANT = Tenant(uuid.uuid4(), "T", [])


@pytest.mark.anyio
async def test_current_scope_names_the_newest_run_for_exports(monkeypatch: pytest.MonkeyPatch) -> None:
    newest, older = uuid.uuid4(), uuid.uuid4()
    _stub(monkeypatch, [str(newest), str(older)], older)
    body = await insights.get_exec(None, "current", _Db(), TENANT)  # type: ignore[arg-type]
    assert body["version_id"] is None
    assert body["latest_version_id"] == str(newest)
    assert body["composite"] == 84.0 and body["cap"] == 84.0 and body["cap_reason"] == "MM140 critical"


@pytest.mark.anyio
async def test_run_scope_latest_is_the_run(monkeypatch: pytest.MonkeyPatch) -> None:
    run = uuid.uuid4()
    _stub(monkeypatch, [], None)
    body = await insights.get_exec(run, "run", _Db(), TENANT)  # type: ignore[arg-type]
    assert body["version_id"] == body["latest_version_id"] == str(run)
    assert body["composite"] == 91.0 and body["cap"] is None


@pytest.mark.anyio
async def test_no_run_has_no_latest(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, [], None)
    body = await insights.get_exec(None, "current", _Db(), TENANT)  # type: ignore[arg-type]
    assert body["version_id"] is None and body["latest_version_id"] is None and body["composite"] is None
