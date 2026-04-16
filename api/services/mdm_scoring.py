"""MDM Health Score — deterministic composite formula.

MDM Health Score (0–100) = (
    golden_record_coverage_pct * 0.40
  + avg_match_confidence       * 0.30
  + steward_sla_compliance_pct * 0.20
  + source_consistency_pct     * 0.10
) * 100

All inputs are fractions in [0.0, 1.0]. Output is clamped to [0, 100].
This is pure Python — no LLM involvement.
"""


def compute_mdm_health_score(
    golden_record_coverage_pct: float,
    avg_match_confidence: float,
    steward_sla_compliance_pct: float,
    source_consistency_pct: float,
) -> float:
    """Compute the MDM Health Score from the four component metrics.

    Args:
        golden_record_coverage_pct: Fraction of SAP objects with a promoted golden record (0–1).
        avg_match_confidence: Average confidence of auto-merged records this period (0–1).
        steward_sla_compliance_pct: Fraction of stewardship queue items resolved within SLA (0–1).
        source_consistency_pct: Fraction of fields where all source systems agree with golden (0–1).

    Returns:
        Composite MDM Health Score in [0, 100].
    """
    raw = (
        golden_record_coverage_pct * 0.40
        + avg_match_confidence * 0.30
        + steward_sla_compliance_pct * 0.20
        + source_consistency_pct * 0.10
    ) * 100

    return max(0.0, min(100.0, round(raw, 2)))
