"""Each result records the hash of the rule logic that produced it (checks/runner.logic_hash)."""

import pandas as pd
import yaml

from checks.runner import logic_hash


def test_hash_ignores_key_order_and_yaml_whitespace():
    a = yaml.safe_load("id: T001\ncheck_class: null_check\nfield: TAB.FLD\nseverity: high\n")
    b = yaml.safe_load("severity:   high\nfield:    TAB.FLD\n\ncheck_class: null_check\nid: T001\n")
    assert logic_hash(a) == logic_hash(b)
    assert len(logic_hash(a)) == 16


def test_hash_moves_with_the_logic_and_ignores_runner_keys():
    rule = {"id": "T001", "check_class": "null_check", "field": "TAB.FLD", "severity": "high"}
    assert logic_hash(rule) != logic_hash({**rule, "severity": "low"})
    assert logic_hash(rule) == logic_hash({**rule, "_cost": {"x": 1}, "_skip": "not_applicable"})


def test_every_result_carries_its_rule_hash(monkeypatch):
    import checks.runner as runner

    rules = [{"id": "T001", "check_class": "null_check", "field": "TAB.FLD", "severity": "medium",
              "dimension": "completeness", "message": "FLD is blank"}]
    monkeypatch.setattr(runner, "module_rules", lambda m: [dict(r) for r in rules])
    monkeypatch.setattr(runner, "module_config", lambda m: {"module": "synthetic"})
    df = pd.DataFrame({"TAB.FLD": ["a", None, "b"], "TAB.KEY": ["1", "2", "3"]})
    results = runner.run_checks("synthetic", df, "tenant")
    assert results, "the synthetic rule produced no result"
    assert [r.details["rule_hash"] for r in results] == [logic_hash(rules[0])]
    # a governance override changes the logic that ran, so the recorded hash moves with it
    tuned = runner.run_checks("synthetic", df, "tenant", overrides={"T001": {"severity": "high"}})
    assert [r.details["rule_hash"] for r in tuned] == [logic_hash({**rules[0], "severity": "high"})]
