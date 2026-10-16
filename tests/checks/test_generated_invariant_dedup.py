"""Generated invariants never duplicate a predicate the module's hand-written pack already tests.

Retiring a duplicate by editing the generated sidecar is undone by the next regeneration
(and fails the sidecar freshness gate in CI); the generator must skip it itself."""
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from generate_ddic_rules import (  # noqa: E402
    GENERATED_SUFFIX, RULES_DIR, _non_negative_rule, _predicate, derive, existing_predicates,
)


def test_an_invariant_already_in_the_pack_is_not_generated():
    rule = _non_negative_rule("CONCUR_REPORT", {"field": "TOTAL"})
    home = ("concur", "concur_expense")
    exposed = {"CONCUR_REPORT": home}

    class _Dict:
        tables: dict = {}

    import generate_ddic_rules as gen
    original = gen.canonical_invariants
    gen.canonical_invariants = lambda: [("CONCUR_REPORT", {"kind": "non_negative", "field": "TOTAL"})]
    try:
        kept = derive(_Dict(), exposed, {}, predicates={})
        skipped = derive(_Dict(), exposed, {}, predicates={home: {_predicate(rule)}})
    finally:
        gen.canonical_invariants = original
    assert [r["fail_when"] for *_, r in kept] == [rule["fail_when"]]
    assert skipped == []


def test_no_shipped_sidecar_repeats_a_hand_written_predicate():
    hand = existing_predicates()
    clashes = []
    for path in RULES_DIR.glob(f"*/*{GENERATED_SUFFIX}"):
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        home = (path.parent.name, str(doc.get("module")))
        for rule in doc.get("rules") or []:
            if rule.get("fail_when") and _predicate(rule) in hand.get(home, set()):
                clashes.append(f"{path.name}: {rule.get('id')}")
    assert clashes == []
