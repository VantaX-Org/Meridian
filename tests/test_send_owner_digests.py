"""Determinism check for the weekly owner-digest task's text, without touching
the DB or the Celery task wrapper: seeded grouped rows (shape of OWNER_ISSUE_SQL,
aggregated in SQL per owner x severity) -> load_owner_aggregates -> build_owner_card
must match render_digest's output exactly."""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from api.services.insights_owners import build_owner_card, load_owner_aggregates, render_digest


def test_digest_matches_render_digest_for_seeded_issues():
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    # One still-open critical issue (10 days old) and one high issue resolved
    # yesterday (inside the 7-day baseline window) — same scenario the old
    # per-issue fixture covered, pre-aggregated the way OWNER_ISSUE_SQL now
    # returns it (one row per owner x severity).
    rows = [
        {
            "user_id": user_id, "owner": "P. Naidoo", "severity": "critical",
            "open_count": 1, "baseline_open_count": 1, "fixed_since_baseline": 0,
            "oldest_open_first_seen": now - timedelta(days=10),
        },
        {
            "user_id": user_id, "owner": "P. Naidoo", "severity": "high",
            "open_count": 0, "baseline_open_count": 1, "fixed_since_baseline": 1,
            "oldest_open_first_seen": None,
        },
    ]

    aggregates = load_owner_aggregates(rows)
    assert list(aggregates.keys()) == ["P. Naidoo"]
    agg = aggregates["P. Naidoo"]

    card = build_owner_card(
        "P. Naidoo", agg["score"], agg["delta"], agg["open_by_severity"],
        agg["fixed_since_baseline"], agg["oldest_item_age_days"],
    )

    assert card.digest == render_digest(
        "P. Naidoo", agg["score"], agg["delta"], agg["open_by_severity"],
        agg["fixed_since_baseline"], agg["oldest_item_age_days"],
    )
    assert agg["open_by_severity"] == {"critical": 1}
    assert agg["fixed_since_baseline"] == 1


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _FakeSession:
    """Stand-in for both the plain Session (tenant id listing) and
    tenant_session (per-tenant work), tracking which tenant did what so the
    test can assert isolation without a real database."""

    def __init__(self, calls, tenant_id=None, fail_for=frozenset()):
        self.calls = calls
        self.tenant_id = tenant_id
        self.fail_for = fail_for

    def __enter__(self):
        if self.tenant_id in self.fail_for:
            raise RuntimeError(f"boom for tenant {self.tenant_id}")
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, stmt, params=None):
        sql = str(stmt)
        if "FROM tenants" in sql:
            return _FakeResult([("t1",), ("t2",)])
        if "record_issues" in sql:
            self.calls.append(("query", self.tenant_id))
            return _FakeResult([])
        if "INSERT INTO notifications" in sql:
            self.calls.append(("insert", self.tenant_id))
            return _FakeResult([])
        return _FakeResult([])

    def commit(self):
        self.calls.append(("commit", self.tenant_id))


def test_send_owner_digests_skips_failing_tenant_and_continues(monkeypatch, caplog):
    """workers/tasks/send_owner_digests.py must not let one tenant's failure
    (RLS session error, bad data, whatever) stop the digest run for the rest
    of the tenants — it should log and move on."""
    import workers.tasks.send_owner_digests as digests_module

    calls: list[tuple] = []
    monkeypatch.setattr(digests_module, "get_sync_engine", lambda: object())
    monkeypatch.setattr(digests_module, "Session", lambda engine: _FakeSession(calls))
    monkeypatch.setattr(
        digests_module, "tenant_session",
        lambda engine, tenant_id: _FakeSession(calls, tenant_id=tenant_id, fail_for={"t1"}),
    )

    with caplog.at_level(logging.ERROR):
        digests_module.send_owner_digests()

    # t1 failed before doing any work; t2 still ran its query and committed.
    assert ("query", "t1") not in calls
    assert ("commit", "t1") not in calls
    assert ("query", "t2") in calls
    assert ("commit", "t2") in calls
    assert any("t1" in r.message for r in caplog.records)
