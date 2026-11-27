"""With no LLM (Tier-2 Ollama dropped), the report's executive summary must reflect
the run's own numbers — not a fixed generic sentence that ignores them.

When the bundled Ollama is removed, `get_llm_safe()` yields the no-op provider and
`safe_invoke` returns None. The report still computes status, score and finding
counts deterministically; the executive summary must be built from those, so dropping
the model costs no information (it used to collapse to one static string).
"""

from __future__ import annotations

from agents.report_agent import _generate_executive_summary, _DETERMINISTIC_SUMMARY


def _state() -> dict:
    return {
        "version_id": "v1",
        "tenant_id": "t1",
        "module_names": ["material_master", "business_partner"],
        "findings_summary": [
            {"severity": "critical"},
            {"severity": "critical"},
            {"severity": "high"},
            {"severity": "low"},
        ],
        "readiness_scores": {
            "material_master": {"status": "no-go", "score": 61.0},
            "business_partner": {"status": "conditional", "score": 78.0},
        },
        "dqs_scores": {},
    }


def test_executive_summary_without_llm_reflects_the_run():
    out = _generate_executive_summary(None, _state())

    assert out != _DETERMINISTIC_SUMMARY, "must not fall back to the generic static sentence"
    assert "2" in out, "the two critical findings must be stated"
    assert "4" in out, "the total finding count must be stated"
    assert "blocked" in out.lower(), "the no-go overall status must be stated"
    assert "module" in out.lower()
