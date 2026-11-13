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


def test_feed_rows_carry_severity_owner_and_the_runs_resolved_total():
    row = {"module": "mm", "last_version_id": "v2", "last_run_at": None, "baseline": {"version_id": "v1"}}
    res = {"totals": {"resolved": 7}, "checks": [
        {"check_id": "A", "new": 3, "regressed": 1, "reason": "data"},
        {"check_id": "B", "new": 0, "regressed": 0, "reason": "data"}]}
    items, resolved = objects._feed_rows(row, res, {"A": "high"}, "Ada")
    assert resolved == 7
    assert [(i["check_id"], i["change"], i["records"], i["severity"], i["owner"]) for i in items] == [
        ("A", "new", 3, "high", "Ada"), ("A", "regressed", 1, "high", "Ada")]
    assert objects._feed_rows(row, res, {}, None)[0][0]["severity"] is None


def test_feed_publishes_severity_owner_and_runs():
    from api.main import app

    schemas = app.openapi()["components"]["schemas"]
    assert {"severity", "owner"} <= set(schemas["FeedItemOut"]["properties"])
    assert {"version_id", "resolved"} <= set(schemas["FeedRunOut"]["properties"])
    assert "runs" in schemas["FeedOut"]["properties"]
