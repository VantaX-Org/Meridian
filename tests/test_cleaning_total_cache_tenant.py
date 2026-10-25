"""The cleaning queue's cached total is keyed by tenant: one tenant's count never answers another's request."""
from api.routes import cleaning


def test_total_cache_is_per_tenant():
    cleaning._TOTAL_CACHE.clear()
    where = "status = :status"
    cleaning._store_queue_total(where, {"tid": "tenant-a", "status": "detected"}, 42)
    assert cleaning._cached_queue_total(where, {"tid": "tenant-a", "status": "detected"}) == 42
    assert cleaning._cached_queue_total(where, {"tid": "tenant-b", "status": "detected"}) is None
