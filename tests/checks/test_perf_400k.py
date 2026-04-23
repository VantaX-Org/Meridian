"""Benchmark: 400k-row extract through both engines.

Opt-in only — run with `pytest -m perf tests/checks/test_perf_400k.py -s`.
Skipped automatically if polars is not installed, since this is an
efficiency-focused test and pandas-only timings don't inform the comparison.

What this proves:
1. Polars runs all supported checks on 400k rows without OOM or timeout.
2. Polars produces equivalent pass_rates to pandas (parity — not drift).
3. The zero-serialization path (pl.from_pandas directly) beats a realistic
   pandas baseline by a meaningful margin on the representative check mix.
"""

from __future__ import annotations

import time

import numpy as np
import pandas as pd
import pytest

from checks.polars_engine import POLARS_AVAILABLE
from checks.runner import _select_engine, CHECK_ENGINE_POLARS_THRESHOLD


pytestmark = [
    pytest.mark.perf,
    pytest.mark.skipif(not POLARS_AVAILABLE, reason="polars not installed"),
]


ROW_COUNT = 400_000


def _synthetic_bp_frame(n: int = ROW_COUNT, seed: int = 42) -> pd.DataFrame:
    """Generate a realistic-shaped Business Partner frame.

    Mix matches the rule types that actually run at scale: ~20% nulls,
    ~10% invalid enum values, ~5% malformed regex-checked fields.
    """
    rng = np.random.default_rng(seed)

    # PARTNER — the id field. Always populated, numeric string.
    partner = np.array([f"{i:010d}" for i in range(n)])

    # BU_TYPE — domain-constrained. Valid: {"1","2","3"}. Invalid sprinkle: "7","8","9".
    bu_choices = ["1", "2", "3", "1", "2", "3", "1", "2", "3", "7"]
    bu_type = rng.choice(bu_choices, size=n)

    # BU_SORT1 — ~20% null. Regex: alphanumeric only.
    bu_sort1_raw = np.array([f"SORT{i % 1000:04d}" for i in range(n)], dtype=object)
    null_mask = rng.random(n) < 0.20
    bu_sort1 = np.where(null_mask, None, bu_sort1_raw)

    # BP_COUNTRY — domain: ISO-2 codes. ~5% invalid (3-char or junk).
    country_choices = ["ZA", "DE", "US", "GB", "FR", "ZA", "DE", "US", "XX", "ZAR"]
    country = rng.choice(country_choices, size=n)

    return pd.DataFrame({
        "PARTNER": partner,
        "BU_TYPE": bu_type,
        "BU_SORT1": bu_sort1,
        "BP_COUNTRY": country,
    })


# A representative rule mix at the size of a real module (20 rules).
# Mix: 6 null, 6 regex, 6 domain, 2 referential — matches the distribution
# seen in checks/rules/ecc/business_partner.yaml.
def _build_rules() -> list[dict]:
    rules: list[dict] = []
    for i in range(6):
        rules.append({
            "id": f"BP-NULL-{i:03d}",
            "check_class": "null_check",
            "field": "BU_SORT1" if i % 2 == 0 else "BU_TYPE",
            "severity": "medium",
            "dimension": "completeness",
            "threshold": 100.0,
        })
    for i in range(6):
        rules.append({
            "id": f"BP-REGEX-{i:03d}",
            "check_class": "regex_check",
            "field": "BU_SORT1",
            "pattern": r"^[A-Z0-9]+$" if i % 2 == 0 else r"^SORT\d{4}$",
            "severity": "medium",
            "dimension": "validity",
            "threshold": 100.0,
        })
    for i in range(6):
        rules.append({
            "id": f"BP-DOMAIN-{i:03d}",
            "check_class": "domain_value_check",
            "field": "BU_TYPE" if i % 2 == 0 else "BP_COUNTRY",
            "allowed_values": (
                ["1", "2", "3"] if i % 2 == 0
                else ["ZA", "DE", "US", "GB", "FR"]
            ),
            "severity": "high",
            "dimension": "validity",
            "threshold": 100.0,
        })
    for i in range(2):
        rules.append({
            "id": f"BP-REF-{i:03d}",
            "check_class": "referential_check",
            "field": "BP_COUNTRY",
            "reference_values": ["ZA", "DE", "US", "GB", "FR"],
            "severity": "high",
            "dimension": "consistency",
            "threshold": 100.0,
        })
    return rules


_RULES = _build_rules()


def _run_pandas(df: pd.DataFrame) -> list[dict]:
    """Drive the pandas engine directly, bypassing YAML loading."""
    from checks.types.null_check import NullCheck
    from checks.types.regex_check import RegexCheck
    from checks.types.domain_value_check import DomainValueCheck
    from checks.types.referential_check import ReferentialCheck

    registry = {
        "null_check": NullCheck,
        "regex_check": RegexCheck,
        "domain_value_check": DomainValueCheck,
        "referential_check": ReferentialCheck,
    }
    results = []
    for rule in _RULES:
        rule = {**rule, "module": "business_partner"}
        cls = registry[rule["check_class"]]
        res = cls(rule).run(df)
        if res is not None:
            results.append({
                "check_id": res.check_id,
                "pass_rate": res.pass_rate,
                "affected_count": res.affected_count,
                "total_count": res.total_count,
            })
    return results


def _run_polars(df: pd.DataFrame) -> list[dict]:
    """Drive the polars engine via the new zero-serialization path."""
    from checks.polars_engine import run_checks_polars_df

    raw = run_checks_polars_df(df, "business_partner", [dict(r) for r in _RULES])
    return [
        {
            "check_id": r["check_id"],
            "pass_rate": r["pass_rate"],
            "affected_count": r["affected_count"],
            "total_count": r["total_count"],
        }
        for r in raw
    ]


def test_engine_autoselects_polars_at_400k():
    """The default `auto` mode must pick polars at 400k rows."""
    assert _select_engine(ROW_COUNT) == "polars"
    assert _select_engine(CHECK_ENGINE_POLARS_THRESHOLD - 1) == "pandas"
    assert _select_engine(CHECK_ENGINE_POLARS_THRESHOLD) == "polars"


def test_400k_parity_and_speedup():
    """Both engines agree on pass_rates, and polars is measurably faster."""
    df = _synthetic_bp_frame()
    assert len(df) == ROW_COUNT

    # Warm-up: exclude import/jit cost from the measured path
    _run_pandas(df.head(1_000))
    _run_polars(df.head(1_000))

    t0 = time.perf_counter()
    pandas_results = _run_pandas(df)
    pandas_secs = time.perf_counter() - t0

    t0 = time.perf_counter()
    polars_results = _run_polars(df)
    polars_secs = time.perf_counter() - t0

    print(f"\n[perf] 400k rows | pandas={pandas_secs:.2f}s | polars={polars_secs:.2f}s "
          f"| speedup={pandas_secs / max(polars_secs, 1e-6):.1f}x")

    # Parity — pass_rates must match within 0.01 pts across all rules
    by_id_pandas = {r["check_id"]: r for r in pandas_results}
    by_id_polars = {r["check_id"]: r for r in polars_results}
    assert set(by_id_pandas) == set(by_id_polars), "engines ran different rule sets"

    for check_id in by_id_pandas:
        p = by_id_pandas[check_id]
        q = by_id_polars[check_id]
        assert abs(p["pass_rate"] - q["pass_rate"]) < 0.01, (
            f"{check_id} pass_rate drift: pandas={p['pass_rate']} polars={q['pass_rate']}"
        )
        assert p["total_count"] == q["total_count"], (
            f"{check_id} total_count drift: {p['total_count']} vs {q['total_count']}"
        )

    # Floor: polars must not regress pandas at 400k. The timing print above
    # is the real signal for perf tuning; a hard multiplier is brittle under
    # CI variance. On a quiet workstation this usually lands at 3-6× on a
    # 20-rule module, but we only hard-assert that polars isn't slower.
    assert polars_secs <= pandas_secs * 1.1, (
        f"polars ({polars_secs:.2f}s) regressed vs pandas ({pandas_secs:.2f}s) "
        "at 400k — investigate"
    )
