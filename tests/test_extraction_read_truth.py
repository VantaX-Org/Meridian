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


# --- split scope: a capped run is split into smaller scopes, each a download of its own -----------------

import pytest  # noqa: E402

from sap.extraction_plan import split_scope  # noqa: E402


class _Dict:
    """Synthetic dictionary: table -> fields it carries."""

    def __init__(self, fields: dict[str, set[str]]):
        self._f = fields

    def field(self, table: str, name: str):
        return name if name in self._f.get(table, set()) else None


_D = _Dict({"MARC": {"MATNR", "WERKS"}, "MARA": {"MATNR"}, "BKPF": {"BUKRS", "BELNR"}, "BSEG": {"BUKRS"}})


def test_split_plants_by_total_to_read_ratio():
    scope = {"plants": ["P1", "P2", "P3", "P4", "P5", "P6"]}
    key, parts = split_scope(scope, [_c("MARC", rows=100, source_rows=250, truncated=True)], _D)
    assert key == "plants"
    assert parts == [{"plants": ["P1", "P2"]}, {"plants": ["P3", "P4"]}, {"plants": ["P5", "P6"]}]


def test_split_without_total_halves_and_keeps_other_keys():
    scope = {"plants": ["P1", "P2", "P3"], "exclude_deleted": True}
    key, parts = split_scope(scope, [_c("MARC", rows=100, truncated=True)], _D)
    assert key == "plants" and len(parts) == 2
    assert sorted(p for s in parts for p in s["plants"]) == ["P1", "P2", "P3"]
    assert all(s["exclude_deleted"] for s in parts)


def test_split_never_more_parts_than_values():
    key, parts = split_scope({"plants": ["P1", "P2"]}, [_c("MARC", rows=10, source_rows=1000, truncated=True)], _D)
    assert len(parts) == 2


def test_split_dates_for_windowed_tables_covers_range_without_gaps():
    scope = {"company_codes": ["C1"], "date_from": "2026-01-01", "date_to": "2026-03-31"}
    capped = [_c("BKPF", rows=100, source_rows=300, truncated=True), _c("BSEG", rows=100, truncated=True)]
    key, parts = split_scope(scope, capped, _D)
    assert key == "dates" and len(parts) == 3
    assert parts[0]["date_from"] == "2026-01-01" and parts[-1]["date_to"] == "2026-03-31"
    from datetime import date, timedelta
    for a, b in zip(parts, parts[1:]):
        assert date.fromisoformat(b["date_from"]) - date.fromisoformat(a["date_to"]) == timedelta(days=1)
    assert all(p["company_codes"] == ["C1"] for p in parts)


def test_org_split_skipped_when_a_capped_table_lacks_the_field():
    # MARA has no plant, so splitting plants would read MARA in full each time: refuse and say what helps
    with pytest.raises(ValueError, match="cannot be split") as e:
        split_scope({"plants": ["P1", "P2"]}, [_c("MARA", rows=10, truncated=True)], _D)
    assert "higher row cap" in str(e.value)


def test_no_split_names_what_to_add():
    with pytest.raises(ValueError, match="two or more company codes"):
        split_scope({}, [_c("BKPF", rows=10, truncated=True)], _D)


def test_nothing_capped_is_an_error():
    with pytest.raises(ValueError, match="nothing to split"):
        split_scope({}, [], _D)
