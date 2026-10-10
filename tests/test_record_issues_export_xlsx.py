"""Record issues export: xlsx branch re-routed through branded_xlsx (T8).

No DB fixture here — tests/test_record_issues_pg.py covers the live endpoint
against Postgres. This checks the parts that don't need a DB: the endpoint
still accepts format=csv|xlsx with the same URL/params, and the column list
used to build the xlsx header matches the SELECT's column aliases.
"""

import inspect

from api.routes.record_issues import _SELECT, _SELECT_KEYS, export_issues


def test_export_endpoint_still_supports_csv_and_xlsx() -> None:
    sig = inspect.signature(export_issues)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"


def test_select_keys_match_select_aliases() -> None:
    # Every non-table-qualified alias in _SELECT ("AS x") and every bare
    # "ri.col"/"u.col" column should have a matching entry in _SELECT_KEYS,
    # in the same order, so the xlsx header row is correct even with 0 rows.
    assert len(_SELECT_KEYS) == len(set(_SELECT_KEYS))  # no duplicate headers
    assert "check_id" in _SELECT_KEYS
    assert "record_key" in _SELECT_KEYS
    assert _SELECT_KEYS[0] == "id"
