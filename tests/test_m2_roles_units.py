"""Step 6c, the pure parts of the role capability audit (no database): who hears about what, the escalation chain's
rules, wave gates, workload balancing, the configuration bundle diff, the extraction dry run, delegations, the
relationship map and the steward assignment template."""
from __future__ import annotations

from datetime import date

from api.services import balance, collab, config_bundle, delegation, escalation, extraction_dry_run, stewardship, wave_gate


def test_subscriptions_default_on_and_respect_a_choice():
    assert collab.wants("comment", None) is True
    assert collab.wants("comment", False) is False
    assert collab.wants("nonsense", True) is False


def test_mention_tokens_are_handles_not_email_addresses():
    assert collab.mention_tokens("Ask @a.naidoo and @t.mokoena. Mail me at x@example.com, @a.naidoo again") == ["a.naidoo", "t.mokoena"]


def test_run_events_finished_dropped_and_new_breach():
    cur = {"material_master": {"composite_score": 70.0, "critical_breaches": ["MM014", "MM031"], "capped": True},
           "fi_gl": {"composite_score": 93.4}}
    prev = {"material_master": {"composite_score": 72.5, "critical_breaches": ["MM014"], "capped": True}}
    ev = collab.run_events(cur, prev)
    kinds = [(e["module"], e["event"]) for e in ev]
    assert ("fi_gl", "run_finished") in kinds and ("material_master", "run_finished") in kinds
    drop = next(e for e in ev if e["event"] == "score_dropped")
    assert drop["delta"] == -2.5
    assert [e["check_id"] for e in ev if e["event"] == "critical_breach"] == ["MM031"]


def test_link_for_targets():
    assert collab.link_for("object", "sys-1:material_master") == "/v2/o/sys-1/material_master"
    assert collab.link_for("record", "material_master:MATNR=1") == "/v2?open=record:material_master:MATNR=1"


def test_escalation_chain_rules():
    ok = [{"level": 1, "after_minutes": 0, "target": "team_lead"}, {"level": 2, "after_minutes": 60, "target": "user", "user_id": "u"}]
    assert escalation.validate_chain(ok) == []
    assert escalation.validate_chain([{"level": 2, "after_minutes": 0, "target": "fallback"}])
    assert escalation.validate_chain([{"level": 1, "after_minutes": 60, "target": "fallback"},
                                      {"level": 2, "after_minutes": 60, "target": "fallback"}])
    assert escalation.validate_chain([{"level": 1, "after_minutes": 0, "target": "user"}])
    assert escalation.target_of({"target": "team_lead"}, "t1", {"t1": "lead"}, "fb") == "lead"
    assert escalation.target_of({"target": "team_lead"}, "t2", {"t1": "lead"}, "fb") == "fb"


def test_wave_gate_checks():
    wave = {"modules": ["material_master", "fi_gl"], "source_system_id": None}
    cells = [{"system_id": "s", "module": "material_master", "score": 70.0, "breaches": ["MM014"], "critical_over_tolerance": 2},
             {"system_id": "s", "module": "fi_gl", "score": 93.4, "breaches": []}]
    contracts = [{"name": "MM to S/4", "status": "active", "producer": "material_master", "consumer": "S/4", "latest_compliant": False}]
    out = wave_gate.gate_checks({"min_score": 85, "zero_criticals": True, "contracts_met": True}, wave, cells, contracts)
    assert out["passed"] is False and [c["passed"] for c in out["checks"]] == [False, False, False]
    assert "below 85.0: material_master" in out["checks"][0]["detail"]
    assert wave_gate.gate_checks({"min_score": None, "zero_criticals": False}, wave, cells, contracts) == {"passed": True, "checks": []}
    unmeasured = wave_gate.gate_checks({"min_score": 50}, {"modules": ["hcm"]}, cells, [])
    assert unmeasured["checks"][0]["detail"] == "not measured: hcm"


def test_balance_owner_mode_evens_counts_and_hands_out_unassigned_first():
    items = [{"id": f"i{n}", "module": "mm", "assigned_to": "a"} for n in range(8)] + [{"id": "u1", "module": "bp", "assigned_to": None}]
    plan = balance.plan(items, ["a", "b", "c"], "owner")
    assert plan["before"] == {"a": 8, "b": 0, "c": 0}
    assert max(plan["after"].values()) - min(plan["after"].values()) <= 1
    assert sum(plan["after"].values()) == 9 and plan["moved"] == 6
    assert plan == balance.plan(list(reversed(items)), ["c", "b", "a"], "owner")  # deterministic


def test_balance_object_mode_keeps_objects_whole():
    items = ([{"id": f"m{n}", "module": "mm", "assigned_to": "a"} for n in range(4)]
             + [{"id": f"p{n}", "module": "pur", "assigned_to": "a"} for n in range(4)])
    plan = balance.plan(items, ["a", "b"], "object")
    assert plan["after"] == {"a": 4, "b": 4}
    assert [(m["module"], m["count"]) for m in plan["moves"]] in ([("mm", 4)], [("pur", 4)])


def test_balance_by_template_slices():
    items = [{"id": "1", "module": "material_master", "record_key": "MATNR=1|WERKS=3000", "assigned_to": "a"},
             {"id": "2", "module": "material_master", "record_key": "MATNR=2|WERKS=1000", "assigned_to": "a"}]
    plan = balance.by_template(items, ["a", "b"], {("material_master", "3000"): "b"}, {"material_master": "plant"})
    assert plan["moves"] == [{"from": "a", "to": "b", "module": "material_master", "count": 1, "issue_ids": ["1"]}]


def test_config_bundle_diff_is_additive():
    current = {"waves": [{"name": "Wave 1", "modules": ["fi_gl"]}], "settings": {"dqs_weights": {"a": 1}}}
    incoming = {"waves": [{"name": "Wave 1", "modules": ["fi_gl", "controlling"]}, {"name": "Wave 2", "modules": []}],
                "settings": {"dqs_weights": {"a": 1}}}
    d = config_bundle.diff(current, incoming)
    assert d["sections"]["waves"]["add"] == 1 and d["sections"]["waves"]["change"] == 1
    assert d["sections"]["settings"]["same"] == 1
    assert d["totals"] == {"add": 1, "change": 1, "same": 1, "kept": 0}
    assert config_bundle.validate({"format": "x"}) and not config_bundle.validate(
        {"format": config_bundle.FORMAT, "version": 1, "sections": {}})


def test_dry_run_plan_and_throughput():
    objects = [{"object": "material_master", "tables": ["MARA", "MARC"]}, {"object": "bp", "tables": ["BUT000"]}]
    p = extraction_dry_run.plan(objects, ["material_master"], {"MARA": 10000}, None)
    assert p["tables"] == [{"table": "MARA", "objects": ["material_master"], "rows": 10000},
                           {"table": "MARC", "objects": ["material_master"], "rows": None}]
    assert p["total_rows"] == 10000 and p["unknown_tables"] == 1 and p["rate_basis"] == "assumed" and p["seconds"] == 2
    jobs = [{"kind": "extraction", "status": "completed", "system_id": "s", "rows_done": 1000, "started_at": 0, "finished_at": 10},
            {"kind": "extraction", "status": "failed", "system_id": "s", "rows_done": 1, "started_at": 0, "finished_at": 10}]
    assert extraction_dry_run.throughput(jobs, "s") == 100.0


def test_delegation_states():
    d = {"starts_on": "2026-10-19", "ends_on": "2026-10-30", "revoked_at": None}
    assert delegation.active_on(d, date(2026, 10, 20)) and not delegation.active_on(d, date(2026, 11, 1))
    assert delegation.state_of(d, date(2026, 10, 1)) == "scheduled"
    assert delegation.state_of({**d, "revoked_at": "x"}, date(2026, 10, 20)) == "revoked"
    assert delegation.copy_title("Batch waits", "T. Mokoena") == "For T. Mokoena: Batch waits"


def test_relationships_mirror_and_fix_hint():
    rel = stewardship.relationships()
    for a, others in rel.items():
        for b, kind in others.items():
            back = rel[b][a]
            assert (kind, back) in {("upstream", "downstream"), ("downstream", "upstream"), ("shared-reference", "shared-reference")}
    assert rel["mm_purchasing"]["material_master"] == "upstream"
    hint = stewardship.fix_hint("mm_purchasing", {"material_master": 3640, "accounts_payable": 402}, lambda m: m.replace("_", " "))
    assert hint == {"module": "material_master", "failures": 3640, "sentence": "Fix material master first: 3,640 upstream failures"}
    assert stewardship.fix_hint("material_master", {}) is None


def test_template_plan_and_gaps():
    t = stewardship.default_template()
    assert stewardship.validate_template(t) == []
    assert stewardship.validate_template({"objects": {"x": {"owner_role": "", "slice": "galaxy"}}})
    t["objects"]["material_master"].update(owner_user_id="o", steward_user_id="s")
    plan = stewardship.plan_apply(t, {"plant": ["1000", "3000"]}, {}, {("material_master", "plant", "1000"): "s"},
                                  ["material_master"])
    assert plan["owners"] == [{"module": "material_master", "change": "add", "before": None, "after": "o"}]
    assert [(r["slice_value"], r["change"]) for r in plan["stewards"]] == [("1000", "same"), ("3000", "add")]
    gaps = stewardship.gaps(["material_master", "fi_gl"], t, {"plant": ["1000", "3000"]}, {"fi_gl": "p"},
                            {("material_master", "plant", "1000"): "s", ("fi_gl", "none", "*"): "s"})
    assert [(g["module"], g["gap"], g["slice_value"]) for g in gaps] == [("material_master", "no_owner", None),
                                                                          ("material_master", "no_steward", "3000")]
    assert stewardship.slice_of("MATNR=1|WERKS=3000", "plant") == "3000" and stewardship.slice_of("x", "none") is None
