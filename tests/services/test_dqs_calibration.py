"""DQS calibration: severity-weighted rules (C1), severity-scaled failing share (C2),
tolerance-gated critical caps (C3), unmeasured dimensions (C4), coverage (C5), one band
set (C6), numeric zero as blank (C8) and clean records per driving object (C9)."""
import pandas as pd

from api.routes.findings import composite_dqs
from api.services.scoring import CleanRecords, readiness_status, score_all_modules, score_module
from checks.base import CheckResult
from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

DDIC = get_dictionary("ecc6")


def res(cid: str, sev: str, total: int, affected: int, dim: str = "completeness", **kw: object) -> CheckResult:
    rate = round((total - affected) / total * 100, 4) if total else 100.0
    return CheckResult(check_id=cid, module="m", field="T.F", severity=sev, dimension=dim, passed=affected == 0,
                       affected_count=affected, total_count=total, pass_rate=rate, message="", details={},
                       grain="T", **kw)


# ---- C1 / C2 -------------------------------------------------------------------------------------------

def test_small_failing_critical_outweighs_large_passing_low_rule():
    # low (w1) passes on 1M rows: r' 100; critical (w4) fails 10% of 1k: r' = 100 - 5*10 = 50
    r = score_module([res("LOW", "low", 1_000_000, 0), res("CRIT", "critical", 1_000, 100)], {})
    assert r.dimension_scores["completeness"] == 60.0
    assert r.rule_scores == {"CRIT": 50.0}
    assert r.legacy["dimension_scores"]["completeness"] > 99.9  # the old record-weighted mean hid it


def test_ddic_result_weighs_one_and_tenant_overrides_apply():
    r = score_module([res("DDIC-T-type", "critical", 100, 0), res("C", "critical", 100, 10)], {})
    assert r.dimension_scores["completeness"] == round((100 + 4 * 50) / 5, 2)
    # DDIC takes k = 1 too: a high-severity DDIC result failing 10% scores 90, not 80
    assert score_module([res("DDIC-T-type", "high", 100, 10)], {}).dimension_scores["completeness"] == 90.0
    flat = {"severity_weights": {"critical": 1}, "severity_multipliers": {"critical": 1}}
    assert score_module([res("A", "low", 100, 0), res("C", "critical", 100, 10)], flat).dimension_scores[
        "completeness"] == 95.0


# ---- C3 ------------------------------------------------------------------------------------------------

def test_invalid_severity_overrides_keep_defaults():
    from api.services.scoring import scoring_config
    cfg = scoring_config({"severity_weights": {"critical": 0, "low": -1, "high": 2},
                          "severity_multipliers": {"critical": 0.5, "high": 3}})
    assert cfg["severity_weights"]["critical"] == 4 and cfg["severity_weights"]["low"] == 1
    assert cfg["severity_weights"]["high"] == 2
    assert cfg["severity_multipliers"]["critical"] == 5 and cfg["severity_multipliers"]["high"] == 3


def test_one_row_in_a_million_does_not_cap():
    r = score_module([res("CRIT", "critical", 1_000_000, 1)], {})
    assert not r.capped and r.critical_breaches == [] and r.critical_count == 1
    assert r.composite_score > 99


def test_half_percent_caps_at_85_with_reason():
    r = score_module([res("CRIT", "critical", 1_000_000, 5_000)], {})
    assert r.capped and r.composite_score == 85.0
    assert r.cap_reason.startswith("CRIT: 0.5% of T rows")
    two = score_module([res("A", "critical", 1_000, 30), res("B", "critical", 1_000, 30, dim="validity")], {})
    assert two.composite_score == 70.0 and "2 critical failures" in two.cap_reason


# ---- C4 ------------------------------------------------------------------------------------------------

def test_unmeasured_dimension_is_not_averaged_in_at_100():
    r = score_module([res("A", "medium", 100, 20)], {})
    assert r.composite_score == 80.0 and r.dimension_coverage["accuracy"] == 0
    a = {"composite_score": 80.0, "dimension_scores": {"completeness": 80.0, "accuracy": 100.0},
         "dimension_coverage": {"completeness": 1, "accuracy": 0}, "total_checks": 1}
    b = {"composite_score": 90.0, "dimension_scores": {"completeness": 100.0, "accuracy": 90.0},
         "dimension_coverage": {"completeness": 1, "accuracy": 1}, "total_checks": 9}
    c = composite_dqs([{"a": a, "b": b}], scoring={"module_weights": {"b": 1}})
    assert c["dimension_scores"]["accuracy"] == 90.0  # module a's unmeasured 100 is skipped
    assert c["composite"] == 85.0  # module weight only, not check count


# ---- C5 ------------------------------------------------------------------------------------------------

def test_coverage_counts_skipped_and_errored_not_not_applicable():
    errored = res("E", "low", 0, 0).model_copy(update={"error": "boom"})
    out = score_all_modules([res("A", "low", 10, 0), errored], {}, {"m": {"not_evaluable": 2, "not_applicable": 5}})
    m = out["m"]
    assert m.coverage == 0.25 and m.low_confidence and m.skipped_checks == 2 and m.not_applicable_checks == 5
    assert m.composite_score == 100.0  # coverage is reported, never folded into the score
    c = composite_dqs([{"m": m.model_dump()}], scoring={})
    assert c["coverage"] == 0.25 and c["low_confidence"]


def test_module_with_no_executed_rule_is_not_measured():
    assert score_module([], {}).composite_score is None
    out = score_all_modules([res("A", "medium", 100, 20)], {}, {"m": {}, "idle": {"not_evaluable": 3}})
    assert out["idle"].composite_score is None and out["idle"].coverage == 0
    assert readiness_status(None, 0) == "conditional"  # not measured: neither a pass nor a fail
    alone = composite_dqs([{"m": out["m"].model_dump()}], scoring={})
    both = composite_dqs([{m: r.model_dump() for m, r in out.items()}], scoring={})
    assert both["composite"] == alone["composite"] == 80.0 and "idle" not in both["modules"]


def test_runner_marks_empty_population_not_applicable():
    frames = TableFrames({"MARA": pd.DataFrame({"MARA.MATNR": ["1"], "MARA.MTART": ["FERT"],
                                                "MARA.NTGEW": ["1"]})}, DDIC, module="material_master")
    rule = {"id": "T1", "field": "MARA.NTGEW", "check_class": "null_check", "severity": "low",
            "dimension": "completeness", "message": "x", "applies_when": {"MARA.MTART": ["HAWA"]}}
    rule, r = run_rule(rule, frames)
    assert r is None and rule["_skip"] == "not_applicable"


# ---- C6 ------------------------------------------------------------------------------------------------

def test_readiness_bands():
    assert readiness_status(92, 0) == "go"
    assert readiness_status(92, 1) == "conditional"
    assert readiness_status(75, 0) == "conditional"
    assert readiness_status(74.9, 0) == "no-go"
    assert readiness_status(85, 0, {"target": 80, "warning": 70}) == "go"


# ---- C8 ------------------------------------------------------------------------------------------------

def _null(field: str, values: list[str], **extra: object) -> CheckResult:
    table = field.split(".")[0]
    frames = TableFrames({table: pd.DataFrame({f"{table}.MATNR": [str(i) for i in range(len(values))],
                                               field: values})}, DDIC, module="material_master")
    _, r = run_rule({"id": "T1", "field": field, "check_class": "null_check", "severity": "low",
                     "dimension": "completeness", "message": "x", **extra}, frames)
    return r


def test_zero_is_blank_on_numeric_ddic_types():
    assert DDIC.resolve("MARA.NTGEW").type == "QUAN"
    assert _null("MARA.NTGEW", ["0", "0.000", "", "1.5"]).affected_count == 3
    assert _null("MARA.NTGEW", ["0", "", "1.5"], zero_is_blank=False).affected_count == 1
    assert _null("MARA.MATKL", ["0", "", "A"]).affected_count == 1  # CHAR: "0" is a value
    assert _null("MARA.MATKL", ["0", "", "A"], zero_is_blank=True).affected_count == 2


# ---- C9 ------------------------------------------------------------------------------------------------

def test_clean_records_from_full_failing_keys():
    r = _null("MARA.NTGEW", ["0", "1", "", "2"])
    assert list(r._all_failing_keys) == ["MATNR=0", "MATNR=2"]
    assert r.model_copy()._all_failing_keys is not None and "_all_failing_keys" not in r.model_dump()
    t = CleanRecords("MARA", ["MANDT", "MATNR"], 4)
    t.add("T1", r._all_failing_keys)
    t.add("T2", pd.Series(["MATNR=2|WERKS=1000", "MATNR=3|WERKS=1000"]))  # plant grain projects onto MARA
    t.add("T3", pd.Series(["LIFNR=9"]))  # keyed without MATNR: listed, not counted
    out = t.result()
    assert out["clean_record_pct"] == 25.0
    assert out["clean_records"]["failing_records"] == 3 and out["clean_records"]["unattributed_rules"] == ["T3"]


def test_clean_records_ceiling_reports_null(monkeypatch):
    import api.services.scoring as scoring
    monkeypatch.setattr(scoring, "CLEAN_KEY_CEILING", 2)
    t = CleanRecords("MARA", ["MATNR"], 10)
    seen: list[int] = []

    class Spy(set):
        def update(self, *xs: object) -> None:
            super().update(*xs)
            seen.append(len(self))
    t.failing = Spy()
    t.add("T1", pd.Series(["MATNR=1|WERKS=A", "MATNR=1|WERKS=B"]))  # projects to one MARA key
    t.add("T2", pd.Series(["MATNR=2", "MATNR=3", "MATNR=4"]))
    assert seen == [1]  # the second rule tripped the ceiling before any tuple reached the set
    out = t.result()
    assert out["clean_record_pct"] is None and "more than 2" in out["clean_records"]["reason"]
    assert CleanRecords(None, [], 0).result()["clean_record_pct"] is None
    overlap = CleanRecords("MARA", ["MATNR"], 10)  # rules failing the same records count once
    overlap.add("T1", pd.Series(["MATNR=1", "MATNR=2"]))
    overlap.add("T2", pd.Series(["MATNR=2", "MATNR=1"]))
    assert overlap.result()["clean_records"]["failing_records"] == 2 and overlap.reason is None
