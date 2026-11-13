"""Read truthfulness (edge-extract batch B): an empty scope is not a failed read, and capped tables are flagged."""
from workers.tasks.run_extraction import scope_is_empty, truncated_tables


def _c(table, status="live", rows=0, purpose="data", **kw):
    return {"table": table, "status": status, "rows": rows, "purpose": purpose, **kw}


def test_all_live_zero_rows_is_empty_scope():
    assert scope_is_empty([_c("MARA"), _c("MARC")])


def test_config_tables_do_not_count_toward_scope():
    assert scope_is_empty([_c("MARA"), _c("T001W", rows=40, purpose="config")])


def test_failed_or_missing_table_is_not_empty_scope():
    assert not scope_is_empty([_c("MARA"), _c("MARC", status="failed")])
    assert not scope_is_empty([_c("MARA", status="not_in_system")])


def test_no_data_tables_is_not_empty_scope():
    assert not scope_is_empty([])
    assert not scope_is_empty([_c("T001W", purpose="config")])


def test_rows_read_is_not_empty_scope():
    assert not scope_is_empty([_c("MARA", rows=5)])


def test_truncated_tables_lists_capped_live_tables_only():
    cov = [
        _c("MARA", rows=100, truncated=True),
        _c("MARC", rows=80, truncated_slices=[{"plant": "1000"}]),
        _c("MARD", rows=10),
        _c("MBEW", status="failed", truncated=True),
    ]
    assert truncated_tables(cov) == ["MARA", "MARC"]
