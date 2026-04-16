"""Tests for the centralised prompt library."""

from agents.prompts import (
    ANALYST_SYSTEM,
    ANALYST_USER_TEMPLATE,
    REMEDIATION_SYSTEM,
    REMEDIATION_USER_TEMPLATE,
    READINESS_SYSTEM,
    READINESS_USER_TEMPLATE,
    REPORT_EXECUTIVE_SUMMARY_PROMPT,
)


ALL_PROMPTS = [
    ANALYST_SYSTEM,
    ANALYST_USER_TEMPLATE,
    REMEDIATION_SYSTEM,
    REMEDIATION_USER_TEMPLATE,
    READINESS_SYSTEM,
    READINESS_USER_TEMPLATE,
    REPORT_EXECUTIVE_SUMMARY_PROMPT,
]


def test_all_prompts_non_empty():
    """Every prompt constant must be a non-empty string."""
    for prompt in ALL_PROMPTS:
        assert isinstance(prompt, str)
        assert len(prompt.strip()) > 0


def test_analyst_system_requires_json():
    assert "respond only with valid json" in ANALYST_SYSTEM.lower()


def test_remediation_system_mentions_cross_finding():
    assert "cross-finding" in REMEDIATION_SYSTEM.lower()


def test_report_prompt_mentions_board_level():
    assert "board-level" in REPORT_EXECUTIVE_SUMMARY_PROMPT


def test_no_prompt_contains_raw_data_references():
    """No prompt should reference raw SAP data — the LLM must never see it."""
    forbidden = ["dataframe", "raw data", "raw rows"]
    for prompt in ALL_PROMPTS:
        lower = prompt.lower()
        for word in forbidden:
            assert word not in lower, f"Prompt contains forbidden term '{word}'"
