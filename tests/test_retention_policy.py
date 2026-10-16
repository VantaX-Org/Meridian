"""Retention policy: loading, and which versions it selects (fake session, no DB)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from api.services.retention import (
    DRY_RUN_DAYS, OLDEST_NIGHTLY_DRY_RUN_SQL, RetentionPolicy, enforcement, load_policy, oldest_dry_run,
    select_expired_versions,
)

NOW = datetime(2026, 10, 15, 2, 30, tzinfo=timezone.utc)
TENANT = str(uuid.uuid4())


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._rows[0][0] if self._rows else None


class _Session:
    """Answers the two queries the service makes: the policy and the version list."""

    def __init__(self, versions, retention=None):
        self.versions = versions
        self.retention = retention
        self.sql: list[str] = []

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.sql.append(sql)
        if sql.startswith("SELECT retention"):
            return _Result([(self.retention,)])
        if sql.strip().startswith("SELECT min(created_at) FROM purge_log"):
            return _Result([(None,)])
        if sql.startswith("SELECT id, label, run_at, metadata, status"):
            rows = sorted(self.versions, key=lambda r: r[2], reverse=True)
            return _Result(rows)
        raise AssertionError(sql)


def _v(days_ago: int, system=None, archived=True, baseline=False, label=None):
    meta = {}
    if system:
        meta["system_id"] = system
    if archived:
        meta["archived"] = True
    if baseline:
        meta["baseline"] = True
    return (uuid.uuid4(), label or f"run-{days_ago}", NOW - timedelta(days=days_ago), meta, "complete")


def test_load_policy_defaults_and_ignores_unknown_keys():
    assert load_policy(_Session([], None), TENANT) == RetentionPolicy()
    p = load_policy(_Session([], {"versions_days": 90, "keep_latest_per_system": 2, "stale": 1}), TENANT)
    assert p.versions_days == 90 and p.keep_latest_per_system == 2 and p.reports_days is None
    # the PUT stamp lives in the same document and is not a policy field
    p = load_policy(_Session([], {"versions_days": 30, "updated_at": "2026-10-15T00:00:00+00:00"}), TENANT)
    assert p.versions_days == 30 and "updated_at" not in p.model_dump()


def test_oldest_dry_run_counts_nightly_rows_under_the_current_policy_only():
    s = _Session([])
    assert oldest_dry_run(s, TENANT) is None
    sql = " ".join(s.sql[-1].split())
    assert "source = 'nightly'" in sql and "dry_run = true" in sql
    assert "created_at > COALESCE( (SELECT NULLIF(retention->>'updated_at', '')::timestamptz FROM tenants" in sql
    assert sql == " ".join(OLDEST_NIGHTLY_DRY_RUN_SQL.split())


def test_no_versions_days_selects_nothing():
    s = _Session([_v(400), _v(500)])
    assert select_expired_versions(s, TENANT, RetentionPolicy(), NOW) == []


def test_selects_archived_versions_past_the_cutoff_oldest_first():
    old1, old2, oldest, fresh = _v(400), _v(500), _v(600), _v(10)
    s = _Session([old1, fresh, old2, oldest])  # the newest upload (fresh) is kept, the rest are candidates
    got = select_expired_versions(s, TENANT, RetentionPolicy(versions_days=365), NOW)
    assert [g.id for g in got] == [str(oldest[0]), str(old2[0]), str(old1[0])]
    assert got[0].run_at < got[1].run_at < got[2].run_at
    assert all(g.system_id == "upload" for g in got)


def test_unarchived_versions_are_never_selected():
    s = _Session([_v(400, archived=False), _v(10)])
    assert select_expired_versions(s, TENANT, RetentionPolicy(versions_days=30), NOW) == []


def test_baseline_is_protected_unless_keep_baseline_is_off():
    base = _v(800, system="sys-1", baseline=True)
    s = _Session([base, _v(700, system="sys-1"), _v(5, system="sys-1")])
    kept = select_expired_versions(s, TENANT, RetentionPolicy(versions_days=365), NOW)
    assert [k.id for k in kept] == [str(s.versions[1][0])]
    dropped = select_expired_versions(s, TENANT, RetentionPolicy(versions_days=365, keep_baseline=False), NOW)
    assert {d.id for d in dropped} == {str(base[0]), str(s.versions[1][0])}


def test_latest_per_system_is_protected_even_when_archived_and_old():
    a_new, a_old = _v(400, system="A"), _v(500, system="A")
    b_new, b_old = _v(450, system="B"), _v(900, system="B")
    s = _Session([a_new, a_old, b_new, b_old])
    got = {g.id for g in select_expired_versions(s, TENANT, RetentionPolicy(versions_days=365), NOW)}
    assert got == {str(a_old[0]), str(b_old[0])}
    got2 = {g.id for g in select_expired_versions(
        s, TENANT, RetentionPolicy(versions_days=365, keep_latest_per_system=2), NOW)}
    assert got2 == set()
    got0 = {g.id for g in select_expired_versions(
        s, TENANT, RetentionPolicy(versions_days=365, keep_latest_per_system=0), NOW)}
    assert got0 == {str(v[0]) for v in (a_new, a_old, b_new, b_old)}


def test_uploads_count_as_one_system():
    up_new, up_old, sys_old = _v(400), _v(500), _v(500, system="S")
    s = _Session([up_new, up_old, sys_old, _v(1, system="S")])
    got = {g.id for g in select_expired_versions(s, TENANT, RetentionPolicy(versions_days=365), NOW)}
    assert got == {str(up_old[0]), str(sys_old[0])}


def test_string_true_metadata_counts():
    v = (uuid.uuid4(), "r", NOW - timedelta(days=400), {"archived": "true"}, "complete")
    s = _Session([v, _v(1)])
    assert [g.id for g in select_expired_versions(s, TENANT, RetentionPolicy(versions_days=365), NOW)] == [str(v[0])]


def test_policy_validation_bounds():
    with pytest.raises(ValueError):
        RetentionPolicy(versions_days=0)
    with pytest.raises(ValueError):
        RetentionPolicy(audit_days=7)  # audit rows keep at least 30 days
    with pytest.raises(ValueError):
        RetentionPolicy(keep_latest_per_system=-1)


def test_enforcement_needs_flag_and_a_week_of_dry_runs():
    assert enforcement(None, NOW, flag_enabled=True) == {"flag_enabled": True, "dry_run_until": None, "enforced": False}
    recent = NOW - timedelta(days=DRY_RUN_DAYS - 1)
    assert enforcement(recent, NOW, flag_enabled=True)["enforced"] is False
    old = NOW - timedelta(days=DRY_RUN_DAYS)
    e = enforcement(old, NOW, flag_enabled=True)
    assert e["enforced"] is True and e["dry_run_until"] == old + timedelta(days=DRY_RUN_DAYS)
    assert enforcement(old, NOW, flag_enabled=False)["enforced"] is False
