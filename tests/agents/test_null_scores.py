"""Modules with no evaluated checks (None score) and None counts must not crash aggregation."""

from unittest.mock import patch

from agents.narrator import _compute_key_metrics
from agents.report_agent import _compute_overall_score, report_node


def test_overall_score_excludes_unmeasured_modules() -> None:
    scores = {"a": {"score": 80.0}, "b": {"score": None}, "c": {"score": 60.0}}
    assert _compute_overall_score(scores) == 70.0
    assert _compute_overall_score({"a": {"score": None}}) == 0.0


def test_key_metrics_tolerate_none_counts_and_rates() -> None:
    findings = [
        {"module": "a", "affected_count": None, "total_count": None, "pass_rate": None},
        {"module": "a", "affected_count": 5, "total_count": 10, "pass_rate": 50.0},
    ]
    m = _compute_key_metrics(findings, {"a": {"composite_score": None}, "b": {"composite_score": 90.0}})
    assert m["total_affected_records"] == 5
    assert m["avg_pass_rate"] == 50.0
    assert m["dqs_composite_avg"] == 90.0


def test_report_node_with_unmeasured_module() -> None:
    state = {
        "version_id": "v", "tenant_id": "t", "module_names": ["a", "b"],
        "findings_summary": [{"module": "a", "severity": "high", "affected_count": None, "pass_rate": None}],
        "dqs_scores": {"a": {"composite_score": 75.0, "critical_count": None}, "b": {"composite_score": None}},
        "readiness_scores": {"a": {"score": 75.0, "status": "conditional"},
                             "b": {"score": None, "status": "conditional"}},
        "root_causes": [], "remediations": {},
    }
    with patch("agents.report_agent.get_llm_safe", return_value=None):
        report = report_node(state)["report"]
    assert report["migration_readiness"]["overall_score"] == 75.0
    assert report["overall_dqs"]["composite"] == 75.0
    assert report["modules"][1]["readiness_score"] is None
    assert report["modules"][0]["critical_count"] == 0
