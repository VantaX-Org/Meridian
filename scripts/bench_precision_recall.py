"""Precision/recall benchmark: Meridian's rules against a dataset with known defects.

The synthetic generators in tests/fixtures/synthetic_sap_data.py inject a *deterministic*
set of defects (seeded), so the ground truth — which (rule, record) pairs must be flagged —
is known exactly and independently of the engine. Running the rules and comparing their
failures against that ground truth yields per-rule precision, recall and F1, which is the
claim behind "largest *test-proven* SAP rule library".

    python scripts/bench_precision_recall.py [--rows 2000]

Only null_check and regex_check rules are asserted here: their truth is a pure function of
the injected value and the rule's own predicate, so the comparison is exact. Domain and
referential rules depend on the live configuration snapshot and are measured separately.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd  # noqa: E402

from checks.runner import run_checks  # noqa: E402
from sap.ddic import get_dictionary  # noqa: E402
from tests.checks.rule_proofs import _failing_rows  # noqa: E402
from tests.fixtures.synthetic_sap_data import generate_business_partner  # noqa: E402

D = get_dictionary("s4hana")


def _ground_truth(n: int) -> dict[str, set[int]]:
    """rule_id -> the row indices that generator's seeded injection must flag."""
    dirty = int(n * 0.15)
    idx = range(n)
    return {
        # bucket 0: name_org1 missing
        "BP043": {i for i in idx if i < dirty and i % 10 == 0},
        # bucket 1: BU_TYPE (BUT000.TYPE) missing
        "BP003": {i for i in idx if i < dirty and i % 10 == 1},
        # bucket 2..5: PARTNER "BADPARTNER{i}" — >10 chars
        "BP002": {i for i in idx if i < dirty and i % 10 in (2, 3, 4, 5)},
        # bucket 2: country missing
        "BP019": {i for i in idx if i < dirty and i % 10 == 2},
        # bucket 3: city missing
        "BP020": {i for i in idx if i < dirty and i % 10 == 3},
        # bucket 4: post code missing
        "BP021": {i for i in idx if i < dirty and i % 10 == 4},
        # bucket 5: PARTNER_GUID "not-a-uuid"
        "BP010": {i for i in idx if i < dirty and i % 10 == 5},
        # bucket 6,7: SMTP_ADDR missing
        "BP017": {i for i in idx if i < dirty and i % 10 in (6, 7)},
        # bucket 7: BU_SORT1 missing
        "BP011": {i for i in idx if i < dirty and i % 10 == 7},
        # bucket 8: SMTP_ADDR "bad-email-N"
        "BP018": {i for i in idx if i < dirty and i % 10 == 8},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", type=int, default=2000)
    args = ap.parse_args()

    df = generate_business_partner(args.rows)
    results = run_checks("business_partner", df, "bench")
    predicted = {
        r.check_id: _failing_rows(r, df, D)
        for r in results
        if not r.error and r.check_id in _ground_truth(args.rows)
    }
    truth = _ground_truth(args.rows)

    tp = fp = fn = 0
    rows: list[tuple[str, float, float, float, int, int, int]] = []
    for rule_id, expected in truth.items():
        got = predicted.get(rule_id, set())
        tp_, fp_, fn_ = len(got & expected), len(got - expected), len(expected - got)
        prec = tp_ / len(got) if got else 1.0
        rec = tp_ / len(expected) if expected else 1.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        tp, fp, fn = tp + tp_, fp + fp_, fn + fn_
        rows.append((rule_id, round(prec, 4), round(rec, 4), round(f1, 4), tp_, fp_, fn_))

    print(f"{'rule':7s} {'precision':>9s} {'recall':>7s} {'f1':>7s} {'tp':>6s} {'fp':>6s} {'fn':>6s}")
    for r in sorted(rows):
        print(f"{r[0]:7s} {r[1]:>9.3f} {r[2]:>7.3f} {r[3]:>7.3f} {r[4]:>6d} {r[5]:>6d} {r[6]:>6d}")

    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f = 2 * p * r / (p + r) if (p + r) else 0.0
    print(f"\n{'TOTAL':7s} {p:>9.3f} {r:>7.3f} {f:>7.3f} {tp:>6d} {fp:>6d} {fn:>6d}")
    print(f"\n{len(truth)} rule types, {args.rows} records, {tp + fp} flagged, "
          f"{tp + fn} true defects")


if __name__ == "__main__":
    main()
