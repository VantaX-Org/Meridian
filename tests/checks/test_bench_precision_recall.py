"""Gate on the committed per-rule precision/recall benchmark (checks/benchmark/precision_recall.json).

Regenerate with ``python scripts/bench_precision_recall.py`` after changing a rule.
"""

from __future__ import annotations

import json

from api.routes.rule_depth import _accuracy
from checks.runner import module_rules
from scripts.bench_precision_recall import MODULES, OUT, run

# rule_id -> reason it may score below 1.0 on synthetic data. Empty: every benchmarked rule is exact.
ALLOWLIST: dict[str, str] = {}

DATA = json.loads(OUT.read_text())


def test_every_benchmarked_rule_is_exact():
    bad = {r["rule_id"]: (r["precision"], r["recall"], r.get("error"))
           for r in DATA["rules"] if r["benchmarkable"] and (r["precision"] < 1 or r["recall"] < 1)}
    assert not set(bad) - set(ALLOWLIST), bad
    assert all(reason.strip() for reason in ALLOWLIST.values())


def test_benchmark_covers_the_current_rule_set():
    for m in MODULES:
        ids = {r["id"] for r in module_rules(m) if r.get("enabled", True)}
        assert {r["rule_id"] for r in DATA["rules"] if r["module"] == m} == ids, f"{m}: rerun the benchmark"
        assert DATA["modules"][m]["rules"] == len(ids)


def test_committed_results_reproduce():
    # one module re-run end to end (the full run takes minutes); the others are pinned by the rule-set check
    fresh = run(("sd_customer_master",))
    assert fresh["rules"] == [r for r in DATA["rules"] if r["module"] == "sd_customer_master"]
    assert fresh["modules"]["sd_customer_master"]["benchmarked"] > 0


def test_endpoint_serves_benchmarked_rules_only():
    a = _accuracy()
    assert len(a.rules) == sum(s["benchmarked"] for s in DATA["modules"].values())
    assert {m.module for m in a.modules} == set(MODULES)
