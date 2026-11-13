import asyncio

from api.routes import objects


def test_trend_reads_the_lineage_oldest_first_and_gives_the_previous_score():
    history = [{"mm": {"composite_score": 70}}, {"other": {}}, {"mm": {"composite_score": None}},
               {"mm": {"composite_score": 81.5}}]
    assert objects._trend_of(history, "mm") == {"trend": [70.0, 81.5], "previous_score": 70.0}
    assert objects._trend_of([{"mm": {"composite_score": 90}}], "mm") == {"trend": [90.0], "previous_score": None}
    assert objects._trend_of([], "mm") == {"trend": [], "previous_score": None}


def test_drift_counts_skip_rows_without_a_baseline_or_new_failures():
    row = {"baseline": {"version_id": None}, "drift": {"new_failing": 4}, "last_version_id": "v2"}
    assert asyncio.run(objects._drift_counts(None, row)) is None  # type: ignore[arg-type]
    row = {"baseline": {"version_id": "v1"}, "drift": {"new_failing": 0}, "last_version_id": "v2"}
    assert asyncio.run(objects._drift_counts(None, row)) is None  # type: ignore[arg-type]


def test_portfolio_publishes_the_new_filters_sorts_and_fields():
    from api.main import app

    spec = app.openapi()
    params = {x["name"] for x in spec["paths"]["/api/v1/objects/portfolio"]["get"]["parameters"]}
    assert {"system_id", "owner", "sort", "limit", "offset"} <= params
    row = spec["components"]["schemas"]["PortfolioRowOut"]["properties"]
    assert {"owner", "trend", "previous_score", "run_number", "new_issues", "regressed", "resolved", "freshness"} <= set(row)
    assert {"new_issues", "regressed", "resolved", "system_id"} <= set(objects._PORTFOLIO_SORTS)


def test_monitor_feed_reports_resolved_records_per_run(monkeypatch):
    from datetime import datetime, timezone
    from types import SimpleNamespace

    row = {"module": "material_master", "last_version_id": "v2", "last_run_at": datetime(2026, 11, 1, tzinfo=timezone.utc),
           "baseline": {"version_id": "v1"}}

    async def rows(*_a):
        return [row]

    async def drift(*_a):
        return {"totals": {"new": 2, "regressed": 0, "resolved": 7, "persisting": 0},
                "checks": [{"check_id": "MM1", "new": 2, "regressed": 0, "resolved": 7, "reason": "r"}]}

    async def rls(*_a):
        return None

    monkeypatch.setattr(objects.object_monitor, "for_current_state", rows)
    monkeypatch.setattr(objects, "_drift_counts", drift)
    monkeypatch.setattr(objects, "_rls", rls)
    out = asyncio.run(objects.monitor_feed(limit=50, offset=0, module=None, db=None, tenant=SimpleNamespace(id="t")))  # type: ignore[arg-type]
    assert out["resolved"] == {"v2": 7}
    assert [(i["check_id"], i["change"]) for i in out["items"]] == [("MM1", "new")]
