"""Determinism check for the weekly owner-digest task's text, without touching
the DB or the Celery task wrapper: seeded grouped rows (shape of OWNER_ISSUE_SQL,
aggregated in SQL per owner x severity) -> load_owner_aggregates -> build_owner_card
must match render_digest's output exactly."""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

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


def test_owner_with_only_resolved_items_gets_no_digest(monkeypatch):
    """An owner whose every assigned item is resolved has nothing to digest; the
    on-demand route reads a zero count as 'no open items' for that owner."""
    from types import SimpleNamespace

    import workers.tasks.send_owner_digests as digests_module

    class _Session(_FakeSession):
        def execute(self, stmt, params=None):
            if "record_issues" in str(stmt):
                self.calls.append(("query", self.tenant_id))
                return _FakeResult([SimpleNamespace(_mapping=r) for r in (
                    {"user_id": str(uuid.uuid4()), "owner": "Ana", "severity": "high",
                     "open_count": 0, "baseline_open_count": 1, "fixed_since_baseline": 1,
                     "oldest_open_first_seen": None},
                    {"user_id": str(uuid.uuid4()), "owner": "Ben", "severity": "high",
                     "open_count": 2, "baseline_open_count": 2, "fixed_since_baseline": 0,
                     "oldest_open_first_seen": datetime.now(timezone.utc)},
                )])
            return super().execute(stmt, params)

    calls: list[tuple] = []
    monkeypatch.setattr(digests_module, "tenant_session", lambda engine, tid: _Session(calls, tenant_id=tid))
    assert digests_module.send_digests_for_tenant(object(), "t1", owner="Ana") == 0
    assert digests_module.send_digests_for_tenant(object(), "t1") == 1
    assert calls.count(("insert", "t1")) == 1


# ── the beat task defers to the personal digest ───────────────────────────────

def _owner_rows(*names):
    return [SimpleNamespace(_mapping={
        "user_id": str(uuid.uuid4()), "owner": n, "severity": "high", "open_count": 1,
        "baseline_open_count": 1, "fixed_since_baseline": 0,
        "oldest_open_first_seen": datetime.now(timezone.utc)}) for n in names]


class _PreferenceSession(_FakeSession):
    """Owners Ana, Ben and Cy have open items; the users table answers the digest-preference
    query with the names of those who set one."""

    def __init__(self, calls, tenant_id=None, with_preference=()):
        super().__init__(calls, tenant_id)
        self.with_preference = [n.lower() for n in with_preference]
        self.inserted_for: list[str] = []

    def execute(self, stmt, params=None):
        sql = str(stmt)
        if "FROM tenants" in sql:
            return _FakeResult([("t1",)])
        if "record_issues" in sql:
            self.calls.append(("query", self.tenant_id))
            return _FakeResult(_owner_rows("Ana", "Ben", "Cy"))
        if "FROM users" in sql and "'digest'" in sql:
            assert "is_active" in sql and "lower(name)" in sql and "'off'" in sql
            self.calls.append(("preferences", self.tenant_id))
            return _FakeResult([(n,) for n in self.with_preference])
        if "INSERT INTO notifications" in sql:
            self.inserted_for.append(params["body"].split("'")[0])
        return super().execute(stmt, params)


def _beat(monkeypatch, session):
    import workers.tasks.send_owner_digests as digests_module

    monkeypatch.setattr(digests_module, "get_sync_engine", lambda: object())
    monkeypatch.setattr(digests_module, "Session", lambda engine: session)
    monkeypatch.setattr(digests_module, "tenant_session", lambda engine, tid: session)
    digests_module.send_owner_digests()


def test_beat_skips_owner_whose_user_turned_the_digest_off(monkeypatch):
    s = _PreferenceSession([], "t1", with_preference=["ana"])
    _beat(monkeypatch, s)
    assert s.inserted_for == ["Ben", "Cy"], "off: nothing from the owner digest either"


def test_beat_skips_owner_whose_user_chose_weekly_so_only_the_personal_digest_arrives(monkeypatch):
    s = _PreferenceSession([], "t1", with_preference=["BEN"])  # matched case-insensitively
    _beat(monkeypatch, s)
    assert s.inserted_for == ["Ana", "Cy"], "weekly: the personal digest serves Ben, the owner task skips him"


def test_beat_keeps_the_legacy_digest_for_owners_without_a_preference(monkeypatch):
    s = _PreferenceSession([], "t1", with_preference=[])
    _beat(monkeypatch, s)
    assert s.inserted_for == ["Ana", "Ben", "Cy"]
    assert ("preferences", "t1") in s.calls


def test_on_demand_route_sends_regardless_of_preference(monkeypatch):
    import workers.tasks.send_owner_digests as digests_module

    s = _PreferenceSession([], "t1", with_preference=["ana", "ben", "cy"])
    monkeypatch.setattr(digests_module, "tenant_session", lambda engine, tid: s)
    assert digests_module.send_digests_for_tenant(object(), "t1") == 3
    assert digests_module.send_digests_for_tenant(object(), "t1", owner="Ana") == 1
    assert ("preferences", "t1") not in s.calls, "the explicit route does not consult the preference"


def test_preference_lookup_failure_keeps_every_legacy_digest(monkeypatch, caplog):
    import workers.tasks.send_owner_digests as digests_module

    class _Broken(_PreferenceSession):
        def execute(self, stmt, params=None):
            if "FROM users" in str(stmt) and "'digest'" in str(stmt):
                raise RuntimeError("column preferences does not exist")
            return super().execute(stmt, params)

        def rollback(self):
            self.calls.append(("rollback", self.tenant_id))

    s = _Broken([], "t1")
    monkeypatch.setattr(digests_module, "tenant_session", lambda engine, tid: s)
    with caplog.at_level(logging.WARNING):
        assert digests_module.send_digests_for_tenant(object(), "t1", honour_preference=True) == 3
    assert ("rollback", "t1") in s.calls
