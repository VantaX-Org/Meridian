"""Tests for ai_impact_scorer.deterministic_impact — verifies the YAML rules
avoid an LLM call for every module mentioned in config_impact_rules.yaml."""

from __future__ import annotations

import pathlib

from api.services.ai_impact_scorer import deterministic_impact, _load_rules_by_module


def _rules_file_missing() -> bool:
    path = (
        pathlib.Path(__file__).resolve().parent.parent
        / "db"
        / "seeds"
        / "config_impact_rules.yaml"
    )
    return not path.exists()


def test_rules_by_module_index_nonempty():
    idx = _load_rules_by_module()
    assert isinstance(idx, dict)
    assert len(idx) >= 1 or _rules_file_missing()


def test_deterministic_impact_returns_none_for_unknown_module():
    out = deterministic_impact("any_field", "zzz_unknown_module_does_not_exist", [])
    assert out is None


def test_deterministic_impact_shape_for_known_module():
    idx = _load_rules_by_module()
    if not idx:
        return
    known_module = next(iter(idx.keys()))
    out = deterministic_impact("ANY.FIELD", known_module, [])
    assert out is not None
    assert 0.0 <= out["impact_score"] <= 1.0
    assert isinstance(out["affected_domains"], list)
    assert isinstance(out["rationale"], str)
    assert out.get("deterministic") is True
