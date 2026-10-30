"""sap/policy_packs.yaml stays true to the rule catalogue: every listed rule exists, is enabled and checks a field of
its class, and every enabled catalogue rule that checks a class field is listed (the list is complete)."""
from __future__ import annotations

from api.services import policy_packs as pp


def _fields(rule: dict) -> set[str]:
    out = set()
    for k in ("field", "fields"):
        v = rule.get(k)
        if isinstance(v, str):
            out.add(v.upper())
        elif isinstance(v, list):
            out |= {x.upper() for x in v if isinstance(x, str)}
    return out


def test_packs_match_the_catalogue():
    from checks.rule_reconciler import load_all_rules

    rules = {str(r.get("id")): r for r in load_all_rules() if r.get("enabled", True) is not False}
    by_field: dict[str, set[str]] = {}
    for rid, r in rules.items():
        for f in _fields(r):
            by_field.setdefault(f, set()).add(rid)
    problems = []
    for p in pp.catalogue():
        assert p["authority"] and "://" not in p["authority"]
        seen: set[str] = set()
        for c in p["classes"]:
            assert c["id"] not in seen and c["authority"] and "://" not in c["authority"], (p["id"], c["id"])
            seen.add(c["id"])
            expected = sorted({rid for f in c["fields"] for rid in by_field.get(f, set())})
            if sorted(c["rules"]) != expected:
                problems.append((p["id"], c["id"], sorted(set(c["rules"]) ^ set(expected))))
    assert problems == []


def test_no_middle_dot_in_packs():
    assert "·" not in pp.PACKS_FILE.read_text(encoding="utf-8")
