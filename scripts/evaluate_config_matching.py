"""Evaluate config matching agent accuracy against generated test datasets.

Usage:
    python scripts/evaluate_config_matching.py
    python scripts/evaluate_config_matching.py --module business_partner
"""

import argparse
import json
import pathlib
import sys
from dataclasses import dataclass, asdict

import pandas as pd

# Ensure project root is importable
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from agents.config_matching import config_matching_node
from agents.state import AgentState
from checks.base import CheckResult
from checks.runner import run_checks

BASE_DIR = pathlib.Path(__file__).parent.parent / "Test Files" / "config_matching"
GROUND_TRUTH_PATH = BASE_DIR / "ground_truth.json"

TENANT_ID = "test-tenant"


@dataclass
class EvalResult:
    module: str
    dataset_type: str  # "config_deviation" | "data_errors"
    deviation_pct: float
    error_pct: float
    ambiguous_pct: float
    total_classifications: int
    passed: bool
    failure_reason: str


def _check_results_to_findings(results: list[CheckResult], module: str) -> list[dict]:
    """Convert check results to the findings_summary format expected by AgentState."""
    findings = []
    for r in results:
        if r.passed:
            continue  # Only failing checks are interesting for config matching
        findings.append({
            "check_id": r.check_id,
            "module": module,
            "severity": r.severity,
            "dimension": r.dimension,
            "affected_count": r.affected_count,
            "total_count": r.total_count,
            "pass_rate": r.pass_rate,
            "message": r.message,
            "field": r.field,
            "value_fix_map": r.value_fix_map,
        })
    return findings


def _classify_counts(config_matches: list[dict]) -> tuple[int, int, int]:
    """Return (data_errors, config_deviations, ambiguous) counts from matches."""
    data_errors = sum(1 for m in config_matches if m.get("classification") == "data_error")
    deviations = sum(1 for m in config_matches if m.get("classification") == "config_deviation")
    ambiguous = sum(1 for m in config_matches if m.get("classification") == "ambiguous")
    return data_errors, deviations, ambiguous


def evaluate_file(
    csv_path: pathlib.Path,
    module: str,
    gt_entry: dict,
) -> EvalResult:
    """Run the full pipeline on one test CSV and compare against ground truth."""
    dataset_type = gt_entry["expected_majority_classification"]

    # 1. Load CSV
    df = pd.read_csv(csv_path)

    # 2. Run deterministic checks
    try:
        check_results = run_checks(module, df, TENANT_ID)
    except Exception as exc:
        return EvalResult(
            module=module,
            dataset_type=dataset_type,
            deviation_pct=0.0,
            error_pct=0.0,
            ambiguous_pct=0.0,
            total_classifications=0,
            passed=False,
            failure_reason=f"run_checks failed: {exc}",
        )

    # 3. Build minimal AgentState
    findings = _check_results_to_findings(check_results, module)

    if not findings:
        return EvalResult(
            module=module,
            dataset_type=dataset_type,
            deviation_pct=0.0,
            error_pct=0.0,
            ambiguous_pct=0.0,
            total_classifications=0,
            passed=False,
            failure_reason="No failing checks — cannot classify (check runner found no issues)",
        )

    state: AgentState = {
        "version_id": "eval-run",
        "tenant_id": TENANT_ID,
        "module_names": [module],
        "findings_summary": findings,
        "dqs_scores": {},
        "root_causes": [],
        "remediations": {},
        "readiness_scores": {},
        "report": None,
        "config_matches": [],
        "config_match_summary": {},
        "error": None,
    }

    # 4. Call config matching node
    try:
        result = config_matching_node(state)
    except Exception as exc:
        return EvalResult(
            module=module,
            dataset_type=dataset_type,
            deviation_pct=0.0,
            error_pct=0.0,
            ambiguous_pct=0.0,
            total_classifications=0,
            passed=False,
            failure_reason=f"config_matching_node failed: {exc}",
        )

    if result.get("error"):
        return EvalResult(
            module=module,
            dataset_type=dataset_type,
            deviation_pct=0.0,
            error_pct=0.0,
            ambiguous_pct=0.0,
            total_classifications=0,
            passed=False,
            failure_reason=f"config_matching_node returned error: {result['error']}",
        )

    config_matches = result.get("config_matches", [])
    total = len(config_matches)

    if total == 0:
        return EvalResult(
            module=module,
            dataset_type=dataset_type,
            deviation_pct=0.0,
            error_pct=0.0,
            ambiguous_pct=0.0,
            total_classifications=0,
            passed=False,
            failure_reason="config_matching_node returned 0 classifications",
        )

    data_errors, deviations, ambiguous = _classify_counts(config_matches)
    dev_pct = round(deviations / total * 100, 1)
    err_pct = round(data_errors / total * 100, 1)
    amb_pct = round(ambiguous / total * 100, 1)

    # 5. Compare against thresholds
    passed = True
    failure_reason = ""

    if dataset_type == "config_deviation":
        min_dev = gt_entry.get("expected_config_deviation_min_pct", 75)
        max_err = gt_entry.get("expected_data_error_max_pct", 10)
        if dev_pct < min_dev:
            passed = False
            failure_reason = f"deviation% {dev_pct}% < required {min_dev}%"
        elif err_pct > max_err:
            passed = False
            failure_reason = f"error% {err_pct}% > max allowed {max_err}%"
    elif dataset_type == "data_error":
        min_err = gt_entry.get("expected_data_error_min_pct", 70)
        max_dev = gt_entry.get("expected_config_deviation_max_pct", 10)
        if err_pct < min_err:
            passed = False
            failure_reason = f"error% {err_pct}% < required {min_err}%"
        elif dev_pct > max_dev:
            passed = False
            failure_reason = f"deviation% {dev_pct}% > max allowed {max_dev}%"

    return EvalResult(
        module=module,
        dataset_type=dataset_type,
        deviation_pct=dev_pct,
        error_pct=err_pct,
        ambiguous_pct=amb_pct,
        total_classifications=total,
        passed=passed,
        failure_reason=failure_reason,
    )


def _find_module_for_key(gt_key: str) -> str:
    """Extract module name from a ground truth key like 'ecc/business_partner_config_deviation'."""
    # key is "{category}/{module}_{type}"
    part = gt_key.split("/", 1)[1]  # e.g. "business_partner_config_deviation"
    for suffix in ("_config_deviation", "_data_errors"):
        if part.endswith(suffix):
            return part[: -len(suffix)]
    return part


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate config matching agent accuracy")
    parser.add_argument(
        "--module",
        default=None,
        help="Evaluate only this module (e.g. business_partner). Omit to evaluate all.",
    )
    args = parser.parse_args()

    if not GROUND_TRUTH_PATH.exists():
        print(f"ERROR: ground_truth.json not found at {GROUND_TRUTH_PATH}")
        print("Run scripts/generate_config_test_data.py first.")
        sys.exit(1)

    with open(GROUND_TRUTH_PATH) as f:
        ground_truth: dict = json.load(f)

    results: list[EvalResult] = []

    keys = sorted(ground_truth.keys())
    if args.module:
        keys = [k for k in keys if _find_module_for_key(k) == args.module]
        if not keys:
            print(f"ERROR: No ground truth entries found for module '{args.module}'")
            sys.exit(1)

    for gt_key in keys:
        gt_entry = ground_truth[gt_key]
        csv_path = BASE_DIR / gt_entry["file"]
        module = _find_module_for_key(gt_key)

        if not csv_path.exists():
            results.append(EvalResult(
                module=module,
                dataset_type=gt_entry["expected_majority_classification"],
                deviation_pct=0.0,
                error_pct=0.0,
                ambiguous_pct=0.0,
                total_classifications=0,
                passed=False,
                failure_reason=f"CSV not found: {csv_path}",
            ))
            continue

        print(f"  Evaluating {gt_key} ...", flush=True)
        result = evaluate_file(csv_path, module, gt_entry)
        results.append(result)

    # Print results table
    col_w = [30, 17, 12, 8, 12, 10]
    headers = ["Module", "Type", "Deviation%", "Error%", "Ambiguous%", "PASS/FAIL"]
    sep = "  ".join("-" * w for w in col_w)

    print()
    print("  ".join(h.ljust(w) for h, w in zip(headers, col_w)))
    print(sep)

    passed_count = 0
    failed_count = 0

    for r in results:
        status = "PASS" if r.passed else f"FAIL ({r.failure_reason})"
        row = [
            r.module,
            r.dataset_type,
            f"{r.deviation_pct}%",
            f"{r.error_pct}%",
            f"{r.ambiguous_pct}%",
            status,
        ]
        print("  ".join(str(v).ljust(w) for v, w in zip(row, col_w)))
        if r.passed:
            passed_count += 1
        else:
            failed_count += 1

    print(sep)
    total = passed_count + failed_count
    accuracy = round(passed_count / total * 100, 1) if total else 0.0
    print(f"\nOverall accuracy: {passed_count}/{total} ({accuracy}%)")
    print(f"  PASS: {passed_count}   FAIL: {failed_count}")
    print()


if __name__ == "__main__":
    main()
