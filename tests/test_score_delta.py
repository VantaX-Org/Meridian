"""Score-delta decomposition: contributions sum to the stored composite change; narrative numbers are verified."""
from api.services.score_delta import SUM_TOLERANCE, decompose, narrative, template_narrative, verify
from api.services.scoring import score_module
from checks.base import CheckResult, pass_rate_of


def _r(cid: str, dim: str, sev: str, affected: int, total: int = 1000) -> CheckResult:
    return CheckResult(check_id=cid, module="material_master", field="MARA.X", severity=sev, dimension=dim,
                       passed=affected == 0, affected_count=affected, total_count=total,
                       pass_rate=pass_rate_of(total, affected), message="", details={})


def _run(results: list[CheckResult]) -> tuple[list[dict], dict]:
    return ([{"check_id": r.check_id, "severity": r.severity, "dimension": r.dimension, "affected_count": r.affected_count,
              "total_count": r.total_count, "pass_rate": r.pass_rate} for r in results],
            score_module(results, {}, module="material_master").model_dump())


def _decompose(a: list[CheckResult], b: list[CheckResult]) -> dict:
    (ra, sa), (rb, sb) = _run(a), _run(b)
    return decompose(ra, rb, sa, sb)


BASE = [_r("MM001", "completeness", "high", 100), _r("MM002", "accuracy", "medium", 50),
        _r("MM003", "validity", "low", 10), _r("MM004", "uniqueness", "medium", 0)]


def test_sum_equals_delta_for_rule_changes():
    after = [_r("MM001", "completeness", "high", 20), _r("MM002", "accuracy", "medium", 200),
             _r("MM003", "validity", "low", 10, total=2000), _r("MM004", "uniqueness", "medium", 0)]
    d = _decompose(BASE, after)
    assert abs(d["sum"] - d["delta"]) <= SUM_TOLERANCE and d["within_tolerance"] and d["reproduced"]
    kinds = {c["kind"] for c in d["contributions"]}
    assert {"failing_records", "record_count"} <= kinds
    mm1 = next(c for c in d["contributions"] if c["check_id"] == "MM001")
    assert mm1["points"] > 0 and mm1["dimension"] == "completeness"


def test_new_and_removed_rules():
    after = [BASE[0], BASE[1], _r("MM009", "accuracy", "high", 400), _r("MM004", "uniqueness", "medium", 0)]  # MM003 gone
    d = _decompose(BASE, after)
    by = {c["check_id"]: c for c in d["contributions"] if c["check_id"]}
    assert by["MM009"]["kind"] == "new_rule" and by["MM009"]["points"] < 0
    assert by["MM003"]["kind"] == "removed_rule"
    assert abs(d["sum"] - d["delta"]) <= SUM_TOLERANCE and d["within_tolerance"]


def test_cap_case():
    ok = [_r(f"MM1{i}", d, "medium", 0) for i, d in enumerate(["completeness"] * 5 + ["accuracy"] * 5)]
    before = [_r("MM001", "completeness", "critical", 0)] + ok
    after = [_r("MM001", "completeness", "critical", 30)] + ok  # 3% of records: over tolerance, caps at 85
    (ra, sa), (rb, sb) = _run(before), _run(after)
    assert sb["capped"] and sb["raw_score"] != sb["composite_score"]
    d = decompose(ra, rb, sa, sb)
    cap = [c for c in d["contributions"] if c["kind"] == "cap"]
    assert cap and cap[0]["points"] == round((sb["composite_score"] - sb["raw_score"]) - (sa["composite_score"] - sa["raw_score"]), 2)
    assert abs(d["sum"] - d["delta"]) <= SUM_TOLERANCE


def test_unscored_side_is_none():
    (ra, sa) = _run(BASE)
    assert decompose(ra, [], sa, {"composite_score": None, "raw_score": None}) is None


def test_narrative_drops_sentences_with_foreign_numbers():
    after = [_r("MM001", "completeness", "high", 20)] + BASE[1:]
    d = _decompose(BASE, after)
    names = {"MM001": "Material description missing"}
    top = d["contributions"][0]
    good = f"MM001 raised the score by {abs(top['points']):.2f} points."
    bad = "MM001 raised the score by 77.35 points."
    keep, dropped = verify([good, bad, "Score is from 4 sources."], d, names, "Material master")
    assert keep == [good] and dropped == 2
    assert narrative(d, names, "Material master", [bad])["source"] == "template"  # nothing survived
    n = narrative(d, names, "Material master", [good])
    assert n["source"] == "ai" and n["sentences"] == [good]
    # the template passes its own verification
    t = template_narrative(d, names, "Material master")
    assert verify(t, d, names, "Material master") == (t, 0)


def test_each_run_is_weighted_under_its_own_stored_scoring_config():
    from api.services.score_delta import run_scoring
    from api.services.scoring import scoring_config

    cfg_a = scoring_config({})
    cfg_b = scoring_config({"completeness": 0.6, "accuracy": 0.1, "validity": 0.1, "uniqueness": 0.1,
                            "consistency": 0.05, "timeliness": 0.05})
    assert scoring_config(run_scoring(cfg_b)) == cfg_b  # the stored config round-trips
    assert run_scoring(None, {"x": 1}) == {"x": 1}       # a run stored before the config falls back
    rows, sa = _run(BASE)
    sb = score_module(BASE, run_scoring(cfg_b), module="material_master").model_dump()
    assert sa["composite_score"] != sb["composite_score"]
    d = decompose(rows, rows, sa, sb, run_scoring(cfg_a), run_scoring(cfg_b))
    # same findings, new weights: the move is reweighting, never a records change
    assert not [c for c in d["contributions"] if c["kind"] in ("failing_records", "record_count", "unexplained")]
    assert d["within_tolerance"] and d["reproduced"]


def test_rule_set_change_is_flagged():
    from api.services.score_delta import rule_set_change

    ra, _ = _run(BASE)
    rb, _ = _run(BASE[1:] + [_r("MM009", "validity", "low", 0)])
    assert rule_set_change("fp1", "fp1", ra, ra) == {"rules_changed": False, "rules_added": 0, "rules_removed": 0,
                                                    "logic_changed": []}
    assert rule_set_change("fp1", "fp2", ra, ra)["rules_changed"] is True  # same ids, different logic or version
    assert rule_set_change("fp1", "fp1", ra, rb) == {"rules_changed": True, "rules_added": 1, "rules_removed": 1,
                                                    "logic_changed": []}
    assert rule_set_change(None, "fp2", ra, ra)["rules_changed"] is False  # unknown fingerprint is not a change


def test_rule_logic_change_is_named_per_rule():
    from api.services.score_delta import rule_set_change

    ra, _ = _run(BASE)
    a = [{**r, "rule_hash": "h1"} for r in ra]
    b = [{**r, "rule_hash": "h2" if r["check_id"] == ra[0]["check_id"] else "h1"} for r in ra]
    out = rule_set_change("fp1", "fp1", a, b)
    assert out["rules_changed"] is True
    assert out["logic_changed"] == [{"check_id": ra[0]["check_id"], "hash_before": "h1", "hash_after": "h2"}]
    # a run stored before results recorded the hash: no rule is named, and no change is claimed
    assert rule_set_change("fp1", "fp1", ra, b) == {"rules_changed": False, "rules_added": 0, "rules_removed": 0,
                                                    "logic_changed": []}
