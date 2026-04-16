"""Statistical anomaly detection on incoming sync batch.

Does NOT call LLM — uses null rates, value distribution, row count delta.
Reads: sync_profiles.ai_anomaly_baseline
Writes: sync_runs.ai_quality_score (0.0-1.0), sync_runs.anomaly_flags (jsonb)
Called by: run_sync.py immediately after data extraction.
"""

import json
import logging
from typing import Any

import pandas as pd

logger = logging.getLogger("meridian.ai_sync_quality")

MAX_ANOMALY_FLAGS = 10


def compute_sync_quality(
    df: pd.DataFrame,
    baseline: dict[str, Any] | None,
) -> tuple[float, list[dict[str, Any]]]:
    """Compute anomaly score for a sync batch against the established baseline.

    Returns (quality_score, anomaly_flags) where:
      - quality_score: 0.0 (worst) to 1.0 (best)
      - anomaly_flags: list of up to MAX_ANOMALY_FLAGS anomaly descriptions
    """
    if df.empty:
        return 0.0, [{"type": "empty_batch", "detail": "Sync returned zero rows"}]

    anomaly_flags: list[dict[str, Any]] = []
    penalties: list[float] = []

    current_stats = _compute_batch_stats(df)

    if baseline is None:
        # No baseline yet — first run. Score is neutral (0.8), store stats as baseline.
        return 0.8, [{"type": "no_baseline", "detail": "First sync — baseline will be established"}]

    # 1. Row count delta
    baseline_rows = baseline.get("row_count", 0)
    current_rows = len(df)
    if baseline_rows > 0:
        row_delta_pct = abs(current_rows - baseline_rows) / baseline_rows
        if row_delta_pct > 0.5:
            penalties.append(0.15)
            anomaly_flags.append({
                "type": "row_count_anomaly",
                "detail": f"Row count changed by {row_delta_pct:.0%} (baseline: {baseline_rows}, current: {current_rows})",
                "severity": "high" if row_delta_pct > 1.0 else "medium",
            })
        elif row_delta_pct > 0.2:
            penalties.append(0.05)
            anomaly_flags.append({
                "type": "row_count_drift",
                "detail": f"Row count changed by {row_delta_pct:.0%}",
                "severity": "low",
            })

    # 2. Null rate anomaly per column
    baseline_null_rates = baseline.get("null_rates", {})
    for col, current_rate in current_stats["null_rates"].items():
        baseline_rate = baseline_null_rates.get(col)
        if baseline_rate is not None:
            delta = current_rate - baseline_rate
            if delta > 0.2:
                penalties.append(0.1)
                anomaly_flags.append({
                    "type": "null_rate_spike",
                    "detail": f"Column '{col}' null rate increased from {baseline_rate:.1%} to {current_rate:.1%}",
                    "column": col,
                    "severity": "high",
                })
            elif delta > 0.1:
                penalties.append(0.03)
                anomaly_flags.append({
                    "type": "null_rate_drift",
                    "detail": f"Column '{col}' null rate increased from {baseline_rate:.1%} to {current_rate:.1%}",
                    "column": col,
                    "severity": "low",
                })

    # 3. Value distribution — cardinality shift
    baseline_cardinality = baseline.get("cardinality", {})
    for col, current_card in current_stats["cardinality"].items():
        baseline_card = baseline_cardinality.get(col)
        if baseline_card is not None and baseline_card > 0:
            card_delta_pct = abs(current_card - baseline_card) / baseline_card
            if card_delta_pct > 1.0:
                penalties.append(0.08)
                anomaly_flags.append({
                    "type": "cardinality_anomaly",
                    "detail": f"Column '{col}' distinct values changed by {card_delta_pct:.0%}",
                    "column": col,
                    "severity": "medium",
                })

    # 4. Missing columns from baseline
    baseline_columns = set(baseline.get("columns", []))
    current_columns = set(df.columns)
    missing = baseline_columns - current_columns
    if missing:
        penalties.append(0.2)
        anomaly_flags.append({
            "type": "missing_columns",
            "detail": f"Columns missing from extraction: {', '.join(sorted(missing))}",
            "severity": "critical",
        })

    new_cols = current_columns - baseline_columns
    if new_cols:
        anomaly_flags.append({
            "type": "new_columns",
            "detail": f"New columns detected: {', '.join(sorted(new_cols))}",
            "severity": "info",
        })

    # Compute final score
    total_penalty = min(sum(penalties), 1.0)
    quality_score = round(1.0 - total_penalty, 3)

    # Truncate flags to max
    anomaly_flags = anomaly_flags[:MAX_ANOMALY_FLAGS]

    return quality_score, anomaly_flags


def build_baseline(df: pd.DataFrame) -> dict[str, Any]:
    """Build a baseline stats snapshot from a DataFrame for future comparisons."""
    stats = _compute_batch_stats(df)
    stats["row_count"] = len(df)
    stats["columns"] = list(df.columns)
    return stats


def _compute_batch_stats(df: pd.DataFrame) -> dict[str, Any]:
    """Compute null rates and cardinality for all columns."""
    row_count = len(df)
    null_rates: dict[str, float] = {}
    cardinality: dict[str, int] = {}

    for col in df.columns:
        null_rates[col] = float(df[col].isna().sum() / row_count) if row_count > 0 else 0.0
        cardinality[col] = int(df[col].nunique())

    return {
        "null_rates": null_rates,
        "cardinality": cardinality,
    }
