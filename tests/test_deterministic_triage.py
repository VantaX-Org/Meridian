"""Tests for the deterministic triage fast path."""

from __future__ import annotations

from workers.tasks.ai_triage import deterministic_triage


def test_contract_breach_always_escalates():
    result = deterministic_triage({"item_type": "contract_breach", "source_metadata": {}})
    assert result is not None
    rec, conf = result
    assert rec.startswith("escalate")
    assert conf >= 0.9


def test_merge_decision_high_score_auto_approves():
    result = deterministic_triage(
        {
            "item_type": "merge_decision",
            "source_metadata": {"total_score": 0.99, "auto_action": None},
        }
    )
    assert result is not None
    rec, conf = result
    assert rec.startswith("approve")


def test_merge_decision_low_score_rejects():
    result = deterministic_triage(
        {
            "item_type": "merge_decision",
            "source_metadata": {"total_score": 0.20, "auto_action": None},
        }
    )
    assert result is not None
    rec, _ = result
    assert rec.startswith("reject")


def test_merge_decision_uncertain_band_returns_none():
    result = deterministic_triage(
        {
            "item_type": "merge_decision",
            "source_metadata": {"total_score": 0.60, "auto_action": None},
        }
    )
    assert result is None  # → LLM fallback


def test_exception_critical_escalates():
    result = deterministic_triage(
        {"item_type": "exception", "source_metadata": {"severity": "critical"}}
    )
    assert result is not None
    rec, _ = result
    assert rec.startswith("escalate")


def test_golden_record_low_confidence_escalates():
    result = deterministic_triage(
        {
            "item_type": "golden_record_review",
            "source_metadata": {"overall_confidence": 0.20, "record_status": "candidate"},
        }
    )
    assert result is not None
    rec, _ = result
    assert rec.startswith("escalate")
