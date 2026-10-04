"""Merge explainability: explanation math, comparators, survivorship reasons, graph, dry-run."""

from datetime import datetime, timezone

import pytest

from api.services.mdm_merge import fuse
from api.services.merge_explain import (
    band_for,
    cluster_graph,
    drop_blocked_pairs,
    dry_run_tuning,
    explain_pair,
    mask_value,
    pair_key,
    survive_cluster,
)
from api.services.survivorship import FieldContribution, apply_most_frequent
from sap.deterministic.normalize import normalize_business_name

RULES = [
    {"field": "NAME_ORG1", "match_type": "name_legal", "weight": 3, "threshold": 0.9},
    {"field": "STREET", "match_type": "address_tokens", "weight": 1, "threshold": 0.5},
    {"field": "STCD1", "match_type": "tax_exact", "weight": 2, "threshold": 1.0},
    {"field": "TEL_NUMBER", "match_type": "phone_e164", "weight": 1, "threshold": 0.9},
    {"field": "BANKN", "match_type": "bank_exact", "weight": 1, "threshold": 1.0},
]


def test_contributions_sum_to_total_and_band():
    a = {"NAME_ORG1": "Acme (Pty) Ltd", "STREET": "12 Main Road", "STCD1": "4123-456-789",
         "TEL_NUMBER": "+27 11 555 0100", "BANKN": "000123456789"}
    b = {"NAME_ORG1": "ACME", "STREET": "Main Road 12", "STCD1": "4123456789",
         "TEL_NUMBER": "011 555 0100", "BANKN": "123456789"}
    ex = explain_pair(RULES, a, b)
    sims = {x["field"]: x["similarity"] for x in ex["attributes"]}
    assert sims == {"NAME_ORG1": 1.0, "STREET": 1.0, "STCD1": 1.0, "TEL_NUMBER": 0.9, "BANKN": 1.0}
    assert sum(x["contribution"] for x in ex["attributes"]) == pytest.approx(ex["total"], abs=1e-3)
    assert ex["total"] == pytest.approx((3 + 1 + 2 + 0.9 + 1) / 8, abs=1e-4)
    assert ex["band"] == "auto_merge" and ex["auto_action"] == "merged"
    assert ">= auto_merge" in ex["fired"]
    assert ex["rules_failed"] == [] and len(ex["rules_met"]) == 5


def test_sensitive_values_masked_in_explanation():
    ex = explain_pair(RULES[2:3] + RULES[4:], {"STCD1": "ZA4123456789", "BANKN": "62001234"},
                      {"STCD1": "ZA4123456789", "BANKN": "62001234"})
    for x in ex["attributes"]:
        assert x["masked"] is True
        assert "4123456789" not in x["value_a"] and x["value_a"].endswith(x["value_a"][-4:])
    assert mask_value("BANKN", "62001234") == "••••1234"
    assert mask_value("NAME_ORG1", "Acme Trading") == "A••• T••••••"
    assert mask_value("BU_GROUP", "BP01") == "BP01"


def test_missing_values_skipped_and_weight_renormalised():
    ex = explain_pair(RULES[:3], {"NAME_ORG1": "Acme", "STCD1": ""}, {"NAME_ORG1": "Acme", "STCD1": "1"})
    skipped = {x["field"]: x["reason"] for x in ex["attributes"] if x["skipped"]}
    assert skipped == {"STREET": "missing_value", "STCD1": "missing_value"}
    assert ex["weight_total"] == 3 and ex["total"] == 1.0


def test_bands_and_constraints_override():
    assert band_for(0.95) == "auto_merge" and band_for(0.5) == "steward_review" and band_for(0.29) == "auto_dismiss"
    a, b = {"NAME_ORG1": "Acme"}, {"NAME_ORG1": "Acme"}
    assert explain_pair(RULES[:1], a, b, constraint="do_not_match")["auto_action"] == "dismissed"
    far = explain_pair(RULES[:1], a, {"NAME_ORG1": "Zebra Holdings"}, constraint="always_match")
    assert far["auto_action"] == "merged" and "always_match" in far["fired"]
    mid = explain_pair(RULES[:1], a, {"NAME_ORG1": "Acme"}, auto_merge=1.01, review_floor=0.3)
    assert mid["band"] == "steward_review" and "review_floor" in mid["fired"]


def test_legal_form_normalisation_and_legacy_comparators():
    assert normalize_business_name("Acme (Pty) Ltd") == normalize_business_name("ACME") == "acme"
    assert normalize_business_name("Müller GmbH") == normalize_business_name("Muller")
    ex = explain_pair([{"field": "X", "match_type": "exact", "weight": 1, "threshold": None},
                       {"field": "Y", "match_type": "bogus", "weight": 1, "threshold": None}],
                      {"X": "a", "Y": "b"}, {"X": "A ", "Y": "b"})
    assert ex["attributes"][0]["similarity"] == 1.0
    assert ex["attributes"][1]["reason"] == "unknown_comparator"


def test_phone_and_address_comparators():
    ex = explain_pair(RULES[1:2] + RULES[3:4], {"STREET": "1 High St", "TEL_NUMBER": "0027115550100"},
                      {"STREET": "1 Low St", "TEL_NUMBER": "+27115550100"})
    sims = {x["field"]: x["similarity"] for x in ex["attributes"]}
    assert sims["TEL_NUMBER"] == 1.0  # 00 prefix == +
    assert sims["STREET"] == pytest.approx(2 / 4)


# ── survivorship ─────────────────────────────────────────────────────────────


def _m(key, fields, day=1, src=None):
    return {"key": key, "fields": fields, "extracted_at": datetime(2026, 1, day, tzinfo=timezone.utc),
            "source_system": src}


def test_default_survivorship_equals_fuse():
    s, m = {"NAME_ORG1": "Acme", "BU_GROUP": ""}, {"NAME_ORG1": "ACME Ltd", "BU_GROUP": "BP01", "TAXNUM": "ZA1"}
    fused, _, _ = fuse(s, m, {}, "200", {"TAXNUM": "ZA9"})
    res = survive_cluster([_m("100", s), _m("200", m)], overrides={"TAXNUM": "ZA9"})
    assert {k: v for k, v in fused.items() if v} == res["fields"]
    ex = res["explanation"]
    assert ex["NAME_ORG1"]["winner_key"] == "100" and ex["NAME_ORG1"]["rule"] == "source_priority"
    assert ex["NAME_ORG1"]["losers"][0]["reason"] == "lower source priority (rank 2)"
    assert ex["BU_GROUP"]["winner_key"] == "200"
    assert ex["BU_GROUP"]["losers"] == [{"key": "100", "value": "", "reason": "blank"}]
    assert ex["TAXNUM"]["rule"] == "steward_override"
    assert {l["key"]: l["reason"] for l in ex["TAXNUM"]["losers"]} == {"100": "blank", "200": "overridden by steward"}


def test_survivorship_rule_reasons():
    members = [_m("A", {"CITY1": "Durban", "BU_GROUP": "X", "SORT1": "", "LAND1": "ZA"}, day=1),
               _m("B", {"CITY1": "Durbn", "BU_GROUP": "Y", "SORT1": "s", "LAND1": "ZA"}, day=3),
               _m("C", {"CITY1": "Durban", "BU_GROUP": "Z", "SORT1": "t", "LAND1": "NA"}, day=2)]
    rules = {"CITY1": {"rule_type": "most_frequent"}, "BU_GROUP": {"rule_type": "most_recent"},
             "SORT1": {"rule_type": "most_complete"}}
    res = survive_cluster(members, rules)
    ex = res["explanation"]
    assert res["fields"]["CITY1"] == "Durban" and ex["CITY1"]["rule"] == "most_frequent"
    assert {l["key"]: l["reason"] for l in ex["CITY1"]["losers"]}["B"] == "minority value (1 of 3)"
    assert res["fields"]["BU_GROUP"] == "Y"
    assert {l["key"]: l["reason"] for l in ex["BU_GROUP"]["losers"]}["A"].startswith("older (2026-01-01")
    assert ex["SORT1"]["rule"] == "most_complete"
    assert ex["LAND1"]["rule"] == "source_priority" and ex["LAND1"]["winner_key"] == "A"
    assert {l["key"]: l["reason"] for l in ex["LAND1"]["losers"]} == {
        "B": "same value as winner", "C": "lower source priority (rank 3)"}


def test_most_frequent_tie_falls_back_to_source_priority():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert apply_most_frequent([FieldContribution("x", "A", t), FieldContribution("y", "B", t)]) is None
    res = survive_cluster([_m("A", {"F": "x"}), _m("B", {"F": "y"})], {"F": {"rule_type": "most_frequent"}})
    assert res["fields"]["F"] == "x" and res["explanation"]["F"]["rule"] == "source_priority (most_frequent undecided)"


def test_trusted_source_maps_to_member_source_system():
    res = survive_cluster([_m("A", {"F": "a"}, src="ECC"), _m("B", {"F": "b"}, src="S4")],
                          {"F": {"rule_type": "trusted_source", "trusted_sources": ["S4"]}})
    assert res["fields"]["F"] == "b" and res["explanation"]["F"]["winner_key"] == "B"


def test_unmerge_recompute_both_sides():
    """Splitting B out: the remaining cluster loses B's values, B gets its own values back."""
    a, b, c = _m("A", {"F": "", "G": "a"}), _m("B", {"F": "b", "G": "b"}), _m("C", {"F": "c"})
    whole = survive_cluster([a, b, c])["fields"]
    assert whole == {"F": "b", "G": "a"}
    left = survive_cluster([a, c])["fields"]
    assert left == {"F": "c", "G": "a"}
    assert survive_cluster([b])["fields"] == {"F": "b", "G": "b"}


# ── graph, constraints, dry-run ──────────────────────────────────────────────


def test_weak_chain_flagged():
    pairs = [{"a": "1", "b": "2", "total": 0.97}, {"a": "2", "b": "3", "total": 0.96},
             {"a": "1", "b": "3", "total": 0.4}, {"a": "3", "b": "4", "total": 0.5, "steward_decision": "accept"}]
    g = cluster_graph(["1", "2", "3", "4"], pairs, {pair_key("2", "4"): "do_not_match"})
    chains = {(w["a"], w["via"], w["b"]): w["reason"] for w in g["weak_chains"]}
    assert chains[("1", "2", "3")] == "direct_score_below_threshold"
    assert chains[("2", "3", "4")] == "do_not_match"
    assert {n["key"]: n["degree"] for n in g["nodes"]} == {"1": 1, "2": 2, "3": 2, "4": 1}


def test_always_match_edge_added_and_do_not_match_blocks():
    g = cluster_graph(["1", "2", "3"], [{"a": "1", "b": "2", "total": 0.99}],
                      {("1", "2"): "do_not_match", ("2", "3"): "always_match"})
    by = {(e["source"], e["target"]): e for e in g["edges"]}
    assert by[("1", "2")]["linked"] is False and by[("2", "3")]["linked"] is True


def test_drop_blocked_pairs_survives_rerun():
    cands = [{"category": "dedup", "record_key": "200|100"}, {"category": "dedup", "record_key": "100|300"},
             {"category": "null_fill", "record_key": "200|100"}]
    kept = drop_blocked_pairs(cands, {pair_key("100", "200")})
    assert [c["record_key"] for c in kept] == ["100|300", "200|100"]
    # second rerun with the same constraint gives the same answer (idempotent)
    assert drop_blocked_pairs(kept, {pair_key("100", "200")}) == kept


def _p(a, b, action, sims, w=None, decided=None):
    return {"a": a, "b": b, "auto_action": action, "steward_decision": decided,
            "explanation": {"attributes": [{"field": f, "similarity": s, "weight": (w or {}).get(f, 1)}
                                           for f, s in sims.items()]}}


def test_dry_run_reports_merge_and_split_without_applying():
    pairs = [_p("1", "2", "merged", {"N": 1.0, "T": 0.9}),         # stays linked
             _p("2", "3", "merged", {"N": 0.9, "T": 0.9}),         # unlinked by a higher threshold
             _p("4", "5", "queued", {"N": 1.0, "T": 0.96}),        # newly linked by weighting N
             _p("5", "6", "queued", {"N": 1.0, "T": 0.0}),          # 10/11 < 0.95: stays unlinked
             _p("6", "7", "merged", {"N": 0.5}, decided="reject")]  # steward reject wins
    res = dry_run_tuning(pairs, {"N": 10}, auto_merge=0.95, review_floor=0.3)
    assert res["applied"] is False and res["pairs"] == 5
    assert res["pairs_unlinked"] == 1 and res["pairs_newly_linked"] == 1
    assert res["clusters_before"] == 1 and res["clusters_after"] == 2
    assert res["clusters_that_would_split"] == 1 and res["clusters_that_would_merge"] == 1
    assert res["band_moves"] == {"auto_merge->steward_review": 2, "steward_review->auto_merge": 1}


def test_dry_run_constraints_win():
    pairs = [_p("1", "2", "dismissed", {"N": 0.1}), _p("3", "4", "merged", {"N": 1.0})]
    res = dry_run_tuning(pairs, {}, constraints={("1", "2"): "always_match", ("3", "4"): "do_not_match"})
    assert res["clusters_before"] == res["clusters_after"] == 1
    assert res["pairs_newly_linked"] == res["pairs_unlinked"] == 0


def test_weak_chain_without_direct_score():
    g = cluster_graph(["1", "2", "3"], [{"a": "1", "b": "2", "total": 0.97}, {"a": "2", "b": "3", "total": 0.97}])
    assert [(w["a"], w["via"], w["b"], w["reason"]) for w in g["weak_chains"]] == [("1", "2", "3", "no_direct_score")]
