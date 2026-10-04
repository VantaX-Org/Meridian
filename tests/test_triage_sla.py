"""Pure triage logic: rule matching order, team strategies, business-hours calendar, SLA deadlines,
pause shifting, request validation."""

from datetime import UTC, date, datetime, time, timedelta

import pytest
from pydantic import ValidationError

from api.routes.triage import BulkIn, RuleIn, SettingsIn, TeamPatch
from api.services.triage import (Calendar, Team, choose, deadlines, first_match, org_values, pick_policy, plan,
                                 rule_matches, shift)

U1, U2, U3, LEAD, FB = "u1", "u2", "u3", "lead", "fallback"


def dt(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC) if "+" not in s else datetime.fromisoformat(s)


# ── matching ──────────────────────────────────────────────────────────────────


def test_org_values_from_record_key():
    assert org_values("BUKRS=1000|LIFNR=42|WERKS=P1") == {"company_code": "1000", "plant": "P1"}
    assert org_values("MATNR=7") == {}
    assert org_values(None) == {}


def test_rule_matches_criteria():
    item = {"module": "accounts_payable", "check_id": "AP-1", "severity": "high", "dimension": "completeness",
            "company_code": "1000"}
    assert rule_matches({}, item)
    assert rule_matches({"module": ["Accounts_Payable"], "severity": ["high", "critical"]}, item)
    assert not rule_matches({"severity": ["critical"]}, item)
    assert rule_matches({"company_code": ["1000", "2000"]}, item)
    # item without the attribute never matches a criterion on it
    assert not rule_matches({"plant": ["P1"]}, item)
    assert rule_matches({"check_id": "AP-1"}, item)  # scalar accepted


def test_first_match_respects_order():
    rules = [{"id": "r1", "match": {"severity": ["critical"]}},
             {"id": "r2", "match": {"module": ["fi_gl"]}},
             {"id": "r3", "match": {}}]
    assert first_match(rules, {"module": "fi_gl", "severity": "critical"})["id"] == "r1"
    assert first_match(rules, {"module": "fi_gl", "severity": "low"})["id"] == "r2"
    assert first_match(rules, {"module": "mm", "severity": "low"})["id"] == "r3"
    assert first_match(rules[:2], {"module": "mm", "severity": "low"}) is None


# ── strategies ────────────────────────────────────────────────────────────────


def test_round_robin_cycles_sorted_members_and_persists_cursor():
    t = Team("t", "round_robin", [U3, U1, U2], cursor=1)
    picks = [choose(t, {U1, U2, U3}, {}) for _ in range(4)]
    assert picks == [U2, U3, U1, U2]
    assert t.cursor == 5


def test_least_loaded_picks_lowest_then_id():
    t = Team("t", "least_loaded", [U1, U2, U3])
    assert choose(t, {U1, U2, U3}, {U1: 3, U2: 1, U3: 1}) == U2


def test_inactive_members_skipped_then_lead():
    t = Team("t", "round_robin", [U1, U2], lead=LEAD)
    assert choose(t, {U2, LEAD}, {}) == U2
    assert choose(t, {LEAD}, {}) == LEAD
    assert choose(t, set(), {}) is None


def test_plan_routes_rules_teams_and_fallback():
    rules = [{"id": "r-user", "match": {"severity": ["critical"]}, "assign_user_id": U3},
             {"id": "r-team", "match": {"module": ["ap"]}, "assign_team_id": "t"},
             {"id": "r-gone", "match": {"module": ["sd"]}, "assign_user_id": "deleted-user"}]
    teams = {"t": Team("t", "least_loaded", [U1, U2])}
    items = [{"id": "a", "severity": "critical", "module": "ap"},
             {"id": "b", "severity": "low", "module": "ap"},
             {"id": "c", "severity": "low", "module": "ap"},
             {"id": "d", "severity": "low", "module": "sd"},
             {"id": "e", "severity": "low", "module": "mm"}]
    load = {U1: 1}
    out = plan(items, rules, teams, {U1, U2, U3, FB}, load, FB)
    assert out == [("a", U3, None, "r-user"),
                   ("b", U2, "t", "r-team"),   # U2 had 0 open, U1 had 1
                   ("c", U1, "t", "r-team"),   # now 1 / 1 → lowest id
                   ("d", FB, None, "r-gone"),  # inactive target → fallback
                   ("e", FB, None, None)]      # no rule → fallback
    assert load == {U1: 2, U2: 1, U3: 1, FB: 2}
    # no fallback: unmatched items stay unassigned
    assert plan([{"id": "x", "module": "mm"}], [], {}, {U1}, {}, None) == []


# ── calendar ──────────────────────────────────────────────────────────────────

CAL = Calendar("UTC", (1, 2, 3, 4, 5), time(8), time(17))  # 9h days


def test_calendar_rejects_bad_config():
    with pytest.raises(ValueError):
        Calendar(work_days=())
    with pytest.raises(ValueError):
        Calendar(start=time(17), end=time(8))
    with pytest.raises(Exception):
        Calendar(tz="Mars/Olympus")


def test_add_within_day_and_overnight():
    mon10 = dt("2026-10-05T10:00:00")  # Monday
    assert CAL.add(mon10, 3600) == dt("2026-10-05T11:00:00")
    assert CAL.add(mon10, 8 * 3600) == dt("2026-10-06T09:00:00")  # 7h Mon + 1h Tue


def test_add_before_open_and_after_close():
    assert CAL.add(dt("2026-10-05T06:00:00"), 60) == dt("2026-10-05T08:01:00")
    assert CAL.add(dt("2026-10-05T18:00:00"), 60) == dt("2026-10-06T08:01:00")


def test_add_skips_weekend():
    fri16 = dt("2026-10-09T16:00:00")
    assert CAL.add(fri16, 2 * 3600) == dt("2026-10-12T09:00:00")  # 1h Fri + 1h Mon
    sat = dt("2026-10-10T12:00:00")
    assert CAL.add(sat, 0) == dt("2026-10-12T08:00:00")


def test_add_skips_holidays():
    cal = Calendar("UTC", (1, 2, 3, 4, 5), time(8), time(17), frozenset({date(2026, 10, 12)}))
    assert cal.add(dt("2026-10-09T16:00:00"), 2 * 3600) == dt("2026-10-13T09:00:00")


def test_timezone_and_dst():
    # Johannesburg UTC+2, no DST: 08:00 local = 06:00 UTC
    jhb = Calendar("Africa/Johannesburg")
    assert jhb.add(dt("2026-10-05T05:00:00"), 3600) == dt("2026-10-05T07:00:00")
    # Berlin: last day of CEST is Sat 2026-10-24; Fri 08:00 = 06:00 UTC, Mon 08:00 = 07:00 UTC (CET)
    ber = Calendar("Europe/Berlin")
    fri = dt("2026-10-23T14:00:00")  # 16:00 local
    assert ber.add(fri, 2 * 3600) == dt("2026-10-26T08:00:00")  # 1h Fri + 1h Mon from 07:00 UTC


def test_between_counts_only_working_time():
    assert CAL.between(dt("2026-10-09T16:00:00"), dt("2026-10-12T09:00:00")) == 2 * 3600
    assert CAL.between(dt("2026-10-10T00:00:00"), dt("2026-10-11T23:00:00")) == 0
    assert CAL.between(dt("2026-10-12T09:00:00"), dt("2026-10-12T08:00:00")) == 0
    a = dt("2026-10-05T07:13:00")
    for secs in (1, 3600, 9 * 3600, 50 * 3600):
        assert CAL.between(a, CAL.add(a, secs)) == secs


# ── deadlines + pause ─────────────────────────────────────────────────────────


def test_deadlines_wall_clock_and_business_hours():
    start = dt("2026-10-09T16:00:00")  # Friday
    pol = {"ack_minutes": 60, "resolve_minutes": 600, "at_risk_pct": 50, "business_hours": False}
    d = deadlines(start, pol, CAL)
    assert d["ack_due_at"] == start + timedelta(hours=1)
    assert d["ack_risk_at"] == start + timedelta(minutes=30)
    assert d["due_at"] == start + timedelta(hours=10)
    assert d["risk_at"] == start + timedelta(hours=5)
    d = deadlines(start, {**pol, "business_hours": True}, CAL)
    assert d["ack_due_at"] == dt("2026-10-09T17:00:00")
    assert d["due_at"] == dt("2026-10-12T17:00:00")  # 1h Fri + 9h Mon (end of day)
    assert deadlines(start, {**pol, "ack_minutes": None}, None)["ack_due_at"] is None


def test_pick_policy_precedence():
    pols = {("high", None): {"id": "sev"}, ("high", "fi_gl"): {"id": "mod"}}
    assert pick_policy(pols, "high", "fi_gl")["id"] == "mod"
    assert pick_policy(pols, "high", "mm")["id"] == "sev"
    d = pick_policy(pols, "critical", "mm")
    assert d["id"] is None and d["resolve_minutes"] == 1440


def test_shift_after_pause():
    paused, now = dt("2026-10-05T10:00:00"), dt("2026-10-05T15:00:00")
    due = dt("2026-10-05T12:00:00")
    assert shift(due, paused, now, None) == dt("2026-10-05T17:00:00")
    assert shift(due, paused, now, CAL) == dt("2026-10-05T17:00:00")  # 2h of working time left
    assert shift(dt("2026-10-05T09:00:00"), paused, now, None) == dt("2026-10-05T09:00:00")  # already past
    assert shift(None, paused, now, None) is None


# ── request validation ────────────────────────────────────────────────────────


def test_rule_needs_exactly_one_target_and_known_keys():
    RuleIn(name="r", assign_user_id="00000000-0000-0000-0000-000000000001")
    with pytest.raises(ValidationError):
        RuleIn(name="r")
    with pytest.raises(ValidationError):
        RuleIn(name="r", assign_user_id="00000000-0000-0000-0000-000000000001",
               assign_team_id="00000000-0000-0000-0000-000000000002")
    with pytest.raises(ValidationError):
        RuleIn(name="r", assign_user_id="00000000-0000-0000-0000-000000000001", match={"vendor": ["x"]})
    with pytest.raises(ValidationError):
        RuleIn(name="r", assign_user_id="00000000-0000-0000-0000-000000000001", match={"severity": ["urgent"]})


def test_settings_validation():
    SettingsIn(timezone="Africa/Johannesburg", work_days=[1, 2, 3, 4, 5, 6])
    for bad in ({"timezone": "Nowhere/City"}, {"work_days": [0]}, {"work_start": "18:00", "work_end": "09:00"}):
        with pytest.raises(ValidationError):
            SettingsIn(**bad)


def test_bulk_validation():
    ids = ["00000000-0000-0000-0000-000000000001"]
    with pytest.raises(ValidationError):
        BulkIn(kind="issue", ids=ids, action="snooze", reason="later", until=datetime.now(UTC) - timedelta(hours=1))
    with pytest.raises(ValidationError):
        BulkIn(kind="issue", ids=ids, action="snooze", until=datetime.now(UTC) + timedelta(hours=1))
    with pytest.raises(ValidationError):
        BulkIn(kind="issue", ids=ids, action="assign")
    with pytest.raises(ValidationError):
        BulkIn(kind="queue", ids=ids, action="priority", priority=9)
    BulkIn(kind="queue", ids=ids, action="snooze", reason="vendor on leave", until=datetime.now(UTC) + timedelta(1))


def test_team_patch_rejects_explicit_null():
    assert TeamPatch().model_dump(exclude_unset=True) == {}
    assert TeamPatch(lead_user_id=None).lead_user_id is None
    for field in ("name", "strategy"):
        with pytest.raises(ValidationError):
            TeamPatch(**{field: None})
