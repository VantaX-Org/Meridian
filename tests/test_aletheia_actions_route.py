"""The Aletheia band's merge and assign actions over the route: review pairs and owners are loaded from the
existing match & merge queue and data_owners, passed to the band, and acting records them in aletheia_actions.
No database: the session is a stub that answers the route's statements."""
import uuid
from typing import Any, Callable

import pytest
from pydantic import ValidationError

from api.deps import Tenant
from api.routes import insights

TENANT = Tenant(uuid.uuid4(), "T", [])


class _Db:
    def __init__(self, rows: list[list[tuple]] | None = None) -> None:
        self.rows: list[list[tuple]] = list(rows or [])
        self.sql: list[str] = []
        self.params: list[dict] = []
        self.committed = False

    async def run_sync(self, fn: Callable[[Any], Any]) -> Any:
        return fn(None)

    async def execute(self, stmt: Any, params: dict | None = None) -> list[tuple]:
        self.sql.append(str(stmt))
        self.params.append(params or {})
        return self.rows.pop(0) if self.rows else []

    async def commit(self) -> None:
        self.committed = True


async def _none(*_a: Any, **_k: Any) -> None:
    return None


async def _ids(*_a: Any, **_k: Any) -> list[str]:
    return ["v1"]


@pytest.mark.parametrize("action", ["merge", "assign"])
@pytest.mark.anyio
async def test_acting_records_merge_and_assign(monkeypatch: pytest.MonkeyPatch, action: str) -> None:
    from api.services import aletheia_found
    monkeypatch.setattr(insights, "_rls", _none)
    monkeypatch.setattr(insights, "_latest_version_ids", _ids)
    monkeypatch.setattr(aletheia_found, "baseline", lambda s, tid, ids, m, c: {
        "version_id": "v1", "score_before": 71.5, "affected_before": 120})
    db = _Db()
    body = insights.ActedBody(module="material_master", check_id="MM168", action=action)  # type: ignore[arg-type]
    out = await insights.mark_acted(body, db, TENANT)  # type: ignore[arg-type]
    assert out["action"] == action and out["affected_before"] == 120
    assert "INSERT INTO aletheia_actions" in db.sql[0] and db.params[0]["a"] == action
    assert db.params[0]["t"] == str(TENANT.id) and db.committed


def test_unknown_action_is_refused() -> None:
    with pytest.raises(ValidationError):
        insights.ActedBody(module="material_master", check_id="MM168", action="delete")  # type: ignore[arg-type]


@pytest.mark.anyio
async def test_band_gets_review_pairs_and_owners(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services import aletheia_found
    seen: dict = {}

    async def tunable(*_a: Any) -> dict:
        return {}

    def build(s: Any, tid: str, ids: list, module: Any, tun: dict, dupes: dict, owned: set) -> dict:
        seen.update(dupes=dupes, owned=owned)
        return {"acted": []}

    monkeypatch.setattr(insights, "_rls", _none)
    monkeypatch.setattr(insights, "_latest_version_ids", _ids)
    monkeypatch.setattr(insights, "_tunable", tunable)
    monkeypatch.setattr(aletheia_found, "build", build)
    db = _Db([[("material_master", 14)], [("MM003",), ("sd_customer_master",)]])
    await insights.get_findings(None, db, TENANT)  # type: ignore[arg-type]
    assert seen == {"dupes": {"material_master": 14}, "owned": {"MM003", "sd_customer_master"}}
    assert "match_scores" in db.sql[0] and "band = 'review'" in db.sql[0]
    assert db.params[0]["tid"] == str(TENANT.id) and db.params[0]["inc"] is False
    assert "data_owners" in db.sql[1] and db.params[1]["t"] == str(TENANT.id)
