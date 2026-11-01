"""checks/self_tune.py: exclusions from the stewards' false positives, never a guessed column."""

from checks.self_tune import merge_exclusions, propose, resolve_column

RULE = {"id": "MM142", "field": "MARC.DISMM", "grain": "MARC", "severity": "high",
        "applies_when": {"MARC.WERKS": {"populated": True}}}


def _issues(spec: dict[str, tuple[int, int]]) -> list[tuple[str, str]]:
    """{werks: (false positives, real)} -> reviewed issues keyed MATNR=n|WERKS=werks."""
    out, n = [], 0
    for werks, (fp, real) in spec.items():
        for verdict, count in (("false_positive", fp), ("real", real)):
            for _ in range(count):
                n += 1
                out.append((f"MATNR={n}|WERKS={werks}", verdict))
    return out


def test_exclusion_found_and_merged_with_existing_applies_when():
    p = propose("MM142", RULE, {"note": "kept"}, _issues({"1000": (8, 0), "2000": (1, 20)}))
    assert p["kind"] == "exclude"
    assert [(e["column"], e["value"]) for e in p["exclusions"]] == [("MARC.WERKS", "1000")]
    assert p["body"] == {"note": "kept", "applies_when": {"MARC.WERKS": {"populated": True, "not_in": ["1000"]}}}
    assert p["precision_before"] < 0.9 <= p["precision_after"]
    assert (p["fp_removed"], p["real_lost"], p["records_excluded"]) == (8, 0, 8)


def test_real_heavy_value_never_excluded():
    # 2000 is 90% false positive but holds 2 of the rule's 10 real issues (20% > MAX_REAL_SHARE)
    p = propose("MM142", {**RULE, "severity": "low"}, {}, _issues({"2000": (18, 2), "3000": (0, 8)}))
    assert p["kind"] == "severity" and p["exclusions"] == []


def test_unresolvable_field_is_skipped():
    rule = {"id": "X1", "field": "MARA.MEINS", "severity": "medium"}  # never names a WERKS column
    assert resolve_column(rule, "WERKS") is None
    assert resolve_column({"fields": ["MARC.WERKS", "T001W.WERKS"], "grain": "MARC"}, "WERKS") == "MARC.WERKS"
    assert resolve_column({"fields": ["MARD.WERKS", "T001W.WERKS"]}, "WERKS") is None
    p = propose("X1", rule, {}, _issues({"1000": (8, 0), "2000": (1, 20)}))
    assert p is None  # precision 0.69: above the downgrade floor, no resolvable pattern


def test_severity_fallback_when_no_pattern_and_precision_very_low():
    p = propose("X1", {"field": "MARA.MEINS", "severity": "critical"}, {}, _issues({"1000": (6, 4), "2000": (6, 4)}))
    assert p["kind"] == "severity" and p["body"] == {"severity": "high"} and p["severity_to"] == "high"
    assert propose("X1", {"field": "MARA.MEINS", "severity": "info"}, {}, _issues({"1000": (12, 8)})) is None


def test_merge_keeps_other_conditions():
    aw = {"MARC.WERKS": {"not_in": ["9000"]}, "MARA.MTART": ["FERT", "HALB"]}
    assert merge_exclusions(aw, {"MARC.WERKS": ["1000"], "MARA.MTART": ["HALB"], "MARC.LGORT": ["0001"]}) == {
        "MARC.WERKS": {"not_in": ["9000", "1000"]}, "MARA.MTART": ["FERT"], "MARC.LGORT": {"not_in": ["0001"]}}


def test_rule_at_target_or_unrated_needs_nothing():
    assert propose("MM142", RULE, {}, _issues({"1000": (1, 20)})) is None
    assert propose("MM142", RULE, {}, _issues({"1000": (5, 0)})) is None
