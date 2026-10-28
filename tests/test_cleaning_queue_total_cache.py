"""The cleaning worklist total is cached, not recounted on every page.

The list query is an index scan that stops after one page; an exact COUNT(*) of the same
predicate walks every matching index entry instead — 1.59 M rows and ~380 ms on the
a pilot deployment, paid on every request purely to render "N of total". These are pure
unit tests of the cache, so they need no database (the batch-filter tests next to them do,
and are skipped without MERIDIAN_TEST_DB_URL).
"""

import pytest
def test_queue_total_is_cached_per_filter_and_expires(monkeypatch):
    """A page turn must not re-walk 1.59 M rows to redraw "N of total".

    The list query stops after one page; COUNT(*) does not. The exact count is held for
    _TOTAL_TTL_S per distinct filter, so paging reuses it and a mutation shows up at worst
    one TTL later.
    """
    from api.routes import cleaning as routes

    routes._TOTAL_CACHE.clear()
    where, params = "tenant_id = :tid AND status = :st", {"tid": "t", "st": "pending"}

    assert routes._cached_queue_total(where, params) is None      # nothing cached yet
    routes._store_queue_total(where, params, 1234)
    assert routes._cached_queue_total(where, params) == 1234      # reused

    # a different filter value is a different entry
    other = {"tid": "t", "st": "applied"}
    assert routes._cached_queue_total(where, other) is None

    # and it expires rather than going stale indefinitely
    import time
    monkeypatch.setattr(time, "monotonic", lambda: 1e9)
    assert routes._cached_queue_total(where, params) is None

    routes._TOTAL_CACHE.clear()


def test_queue_total_cache_is_bounded():
    """One entry per filter, but never unbounded growth."""
    from api.routes import cleaning as routes

    routes._TOTAL_CACHE.clear()
    for i in range(routes._TOTAL_CACHE_MAX + 10):
        routes._store_queue_total("tenant_id = :tid", {"tid": "t", "n": i}, i)
    assert len(routes._TOTAL_CACHE) <= routes._TOTAL_CACHE_MAX
    routes._TOTAL_CACHE.clear()
