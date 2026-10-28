"""The ``discovery_due`` Action centre kind (api/services/attention.py) against a real Postgres.

One system with five process discovery schedules; only the one whose latest finished run is older than its cadence
allows (1.5 intervals, never under 2 hours) fires:

  ptp   daily, last completed run 3 days ago            stale: fires
  otc   daily, last completed run 1 hour ago            fresh
  hcm   daily, paused, last run 9 days ago              paused: a pause is a decision
  p2d   daily, never ran                                due, not stale
  o2c   daily, 3 days ago completed, then a failed run  discovery_failed owns that case
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from api.services import attention
from tests.test_attention_pg import (  # noqa: F401 - fixtures
    by_kind, collected, owner, stubs, with_session)

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

NOW = datetime.now(timezone.utc)
ago = lambda **kw: NOW - timedelta(**kw)  # noqa: E731
DAILY = "0 2 * * *"


def _run(c, tid, sid, l1, status, at):
    c.execute(text("INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status, stats, started_at, "
                   "finished_at) VALUES (:t, :s, :l, 'full', :st, '{}'::jsonb, :at, :at)"),
              {"t": tid, "s": sid, "l": l1, "st": status, "at": at})


@pytest.fixture
def seeded(owner, stubs):
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'ERP prod')"),
                  {"s": sid, "t": tid})
        for l1, active in (("ptp", True), ("otc", True), ("hcm", False), ("p2d", True), ("o2c", True)):
            c.execute(text("INSERT INTO process_discovery_schedules (tenant_id, system_id, l1, schedule_cron, active, "
                           "next_run_at) VALUES (:t, :s, :l, :c, :a, :n)"),
                      {"t": tid, "s": sid, "l": l1, "c": DAILY, "a": active, "n": NOW + timedelta(hours=10)})
        _run(c, tid, sid, "ptp", "completed", ago(days=3, hours=1))
        _run(c, tid, sid, "otc", "completed", ago(hours=1))
        _run(c, tid, sid, "hcm", "completed", ago(days=9))
        _run(c, tid, sid, "o2c", "completed", ago(days=3))
        _run(c, tid, sid, "o2c", "failed", ago(hours=2))
    return {"tid": tid, "sid": sid}


def test_only_a_stale_active_schedule_fires(owner, seeded):
    items = by_kind(collected(owner, seeded["tid"]))
    (due,) = items["discovery_due"]
    assert (due["kind"], due["tier"], due["severity"], due["required_action"]) == (
        "discovery_due", 3, "medium", "run_process_discovery")
    assert due["count"] == 1 and due["system_id"] == seeded["sid"] and due["system_name"] == "ERP prod"
    assert due["href"] == f"/process/runs?system={seeded['sid']}"
    assert due["title"] == "Process discovery on ERP prod has not run on schedule"
    assert "PTP" in due["detail"] and "3 days ago" in due["detail"]
    assert due["action_label"] == "Run discovery"
    # the failed latest run is the existing kind's job
    assert [i["count"] for i in items["discovery_failed"]] == [1]


def test_nothing_without_schedules(owner, stubs):
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
    assert "discovery_due" not in by_kind(collected(owner, tid))


def test_kind_is_registered_in_tier_three():
    assert attention.KINDS["discovery_due"][:2] == (3, "run_process_discovery")
