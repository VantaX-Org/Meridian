"""HQ / tenant rule governance applied to YAML checks."""

from checks.overrides import apply


def test_disable_and_reseverity_only_known_ids():
    rules = [{"id": "BP001", "severity": "high"}, {"id": "BP002", "severity": "low"}, {"id": "BP003"}]
    out = apply(rules, {"BP001": {"enabled": False}, "BP002": {"enabled": True, "severity": "critical"},
                        "HQ999": {"enabled": True}})
    assert [r["id"] for r in out] == ["BP002", "BP003"]
    assert out[0]["severity"] == "critical"
    assert rules[1]["severity"] == "low"  # YAML rule dict not mutated


def test_no_overrides_is_identity():
    rules = [{"id": "X"}]
    assert apply(rules, {}) is rules
