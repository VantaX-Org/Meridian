"""GET /versions/compare: rules that fail in both runs are kept as "worse" / "better" when their failing
records moved materially (CHANGE_MIN_PERCENT of the earlier count and CHANGE_MIN_RECORDS records)."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from api.deps import Tenant
from api.routes import versions as routes
from api.routes.versions import CHANGE_MIN_PERCENT, CHANGE_MIN_RECORDS, change_kind
from db.schema import AnalysisVersion


@pytest.mark.parametrize(
    ("v1", "v2", "kind"),
    [
        (0, 5, "newly_failing"),
        (9, 0, "fixed"),
        (100, 50_000, "worse"),    # the case the comparison used to drop
        (5_000, 4_000, "better"),
        (100, 110, "worse"),       # exactly 10% and 10 records: both bounds hold
        (100, 109, None),          # 9 records: under the absolute minimum
        (2, 1, None),              # 50% but one record
        (100_000, 100_500, None),  # 500 records but 0.5%
        (0, 0, None),
        (7, 7, None),
    ],
)
def test_change_kind(v1: int, v2: int, kind: str | None) -> None:
    assert change_kind(v1, v2) == kind


def test_thresholds_are_documented_values() -> None:
    assert (CHANGE_MIN_PERCENT, CHANGE_MIN_RECORDS) == (10, 10)


def test_sql_keeps_material_moves_and_isolates_the_tenant() -> None:
    sql = routes._CHECK_CHANGES_SQL
    assert "f1.tenant_id = CAST(:tid AS uuid)" in sql and "f2.tenant_id = CAST(:tid AS uuid)" in sql
    assert ":min_records" in sql and ":min_percent" in sql
    assert "details->>'message'" in sql


class _Result:
    def __init__(self, one: Any = None, rows: list[Any] | None = None, scalars: list[Any] | None = None) -> None:
        self._one, self._rows, self._scalars = one, rows or [], scalars or []

    def fetchone(self) -> Any:
        return self._one

    def fetchall(self) -> list[Any]:
        return self._rows

    def scalars(self) -> list[Any]:
        return self._scalars


class _Db:
    """Answers compare_versions' queries in order: tenant, two scopes, the two versions, the check changes."""

    def __init__(self, versions: list[AnalysisVersion], rows: list[Any]) -> None:
        self.answers = [_Result(), _Result(one=("sys-1",)), _Result(one=("sys-1",)),
                        _Result(scalars=versions), _Result(rows=rows)]
        self.params: list[dict[str, Any]] = []

    async def execute(self, _stmt: Any, params: dict[str, Any] | None = None) -> _Result:
        self.params.append(params or {})
        return self.answers.pop(0)


def _version(vid: uuid.UUID, tid: uuid.UUID) -> AnalysisVersion:
    return AnalysisVersion(id=vid, tenant_id=tid, status="complete", label=None,
                           run_at=datetime(2026, 10, 1, tzinfo=timezone.utc), dqs_summary={}, metadata_={})


def _row(check_id: str, v1: int, v2: int) -> SimpleNamespace:
    return SimpleNamespace(check_id=check_id, module="material_master", severity="high",
                           message=f"{check_id} message", v1_affected=v1, v2_affected=v2)


def test_compare_groups_rows_into_four_change_sets() -> None:
    tid, a, b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db = _Db([_version(a, tid), _version(b, tid)],
             [_row("NEW", 0, 3), _row("FIX", 4, 0), _row("WORSE", 100, 50_000), _row("BETTER", 5_000, 4_000)])
    out = asyncio.run(routes.compare_versions(v2=str(b), v1=str(a), module=None, db=db,  # type: ignore[arg-type]
                                              tenant=Tenant(tid, "T", [])))
    checks = out["checks"]
    assert {k: [c["check_id"] for c in v] for k, v in checks.items()} == {
        "newly_failing": ["NEW"], "fixed": ["FIX"], "worse": ["WORSE"], "better": ["BETTER"]}
    assert checks["worse"][0] == {"check_id": "WORSE", "module": "material_master", "severity": "high",
                                  "message": "WORSE message", "v1_affected": 100, "v2_affected": 50_000}
    sql_params = db.params[-1]
    assert sql_params["tid"] == str(tid)
    assert (sql_params["min_records"], sql_params["min_percent"]) == (CHANGE_MIN_RECORDS, CHANGE_MIN_PERCENT)
