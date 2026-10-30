"""lifecycle and freshness rules score as timeliness (D-08).

68 enabled rules declared a dimension outside the six DAMA ones (66 ``lifecycle``, 2 ``freshness``);
``score_module`` iterated only the six, so those rules never moved a score. They now score under
timeliness without changing the six weights, and no rule may declare a dimension the scorer does
not know.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from api.services.scoring import (
    DEFAULT_WEIGHTS, DIMENSION_ALIASES, dimensions_scored_as, score_module, scoring_dimension,
)
from checks.base import CheckResult

ROOT = Path(__file__).resolve().parents[1]


def _result(check_id: str, dimension: str, pass_rate: float, severity: str = "medium") -> CheckResult:
    total = 100
    affected = int(round(total * (100 - pass_rate) / 100))
    return CheckResult(check_id=check_id, module="material_master", field="MARA.LVORM", severity=severity,
                       dimension=dimension, passed=affected == 0, affected_count=affected, total_count=total,
                       pass_rate=pass_rate, message="", details={})


def test_aliases_map_onto_timeliness_and_the_weights_stay_six() -> None:
    assert DIMENSION_ALIASES == {"lifecycle": "timeliness", "freshness": "timeliness"}
    assert scoring_dimension("lifecycle") == "timeliness"
    assert scoring_dimension("Freshness") == "timeliness"
    assert scoring_dimension("validity") == "validity"
    assert dimensions_scored_as("timeliness") == ["timeliness", "freshness", "lifecycle"]
    assert set(DEFAULT_WEIGHTS) == {"completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"}
    assert abs(sum(DEFAULT_WEIGHTS.values()) - 1.0) < 1e-9


def test_lifecycle_and_freshness_rules_count_in_the_timeliness_score() -> None:
    findings = [
        _result("MM001", "completeness", 100.0),
        _result("MM400", "lifecycle", 60.0),
        _result("MM401", "freshness", 80.0),
    ]
    r = score_module(findings, {})
    assert r.dimension_coverage["timeliness"] == 2
    assert r.dimension_scores["timeliness"] == 70.0  # two medium rules, equal weight
    assert "lifecycle" not in r.dimension_scores and "freshness" not in r.dimension_scores
    # the composite now reflects them: completeness 100 at 0.25, timeliness 70 at 0.10
    assert r.composite_score == round((100 * 0.25 + 70 * 0.10) / 0.35, 2)

    without = score_module([findings[0]], {})
    assert without.dimension_scores["timeliness"] is None
    assert without.composite_score == 100.0


def test_every_rule_declares_a_dimension_the_scorer_knows() -> None:
    known = set(DEFAULT_WEIGHTS) | set(DIMENSION_ALIASES)
    unknown: list[str] = []
    for path in sorted((ROOT / "checks" / "rules").rglob("*.yaml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict):
            continue
        for rule in doc.get("rules") or []:
            if not isinstance(rule, dict) or rule.get("enabled") is False:
                continue
            dim = rule.get("dimension")
            if dim is not None and str(dim).strip().lower() not in known:
                unknown.append(f"{path.relative_to(ROOT)} {rule.get('id')}: {dim}")
    assert unknown == []
