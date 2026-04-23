"""Tests for the `applies_when` rule predicate (SAP field-determination).

A rule can declare `applies_when: {field: allowed_values}` to scope the
check to records matching all listed conditions. total_count and pass_rate
reflect the scoped population, not the full extract.

Covers:
- pandas path via checks.runner.apply_context
- pandas + YAML-runner integration
- polars path via _apply_context_lf (if polars installed)
- engine parity
"""

from __future__ import annotations

import pandas as pd
import pytest

from checks.runner import apply_context


# ---------------------------------------------------------------------------
# apply_context (pandas) — unit tests
# ---------------------------------------------------------------------------


def _make_df() -> pd.DataFrame:
    """4 materials with mixed types; MARA.SERNR mandatory only for serialized."""
    return pd.DataFrame({
        "MARA.MATNR": ["M001", "M002", "M003", "M004"],
        "MARA.MTART": ["FERT", "ROH", "HALB", "DIEN"],
        "MARA.SERNR": ["SN-1", None, None, None],
    })


def test_no_context_returns_df_unchanged():
    df = _make_df()
    out = apply_context(df, None)
    assert len(out) == 4
    out = apply_context(df, {})
    assert len(out) == 4


def test_single_condition_filters():
    df = _make_df()
    out = apply_context(df, {"MARA.MTART": ["FERT", "HALB"]})
    assert len(out) == 2
    assert set(out["MARA.MATNR"]) == {"M001", "M003"}


def test_multi_condition_is_anded():
    df = _make_df()
    out = apply_context(df, {
        "MARA.MTART": ["FERT", "HALB", "ROH"],
        "MARA.MATNR": ["M001", "M002"],
    })
    assert len(out) == 2
    assert set(out["MARA.MATNR"]) == {"M001", "M002"}


def test_missing_context_field_returns_empty():
    """Field not in extract — applied_context returns 0 rows so the
    runner treats the rule as not applicable to this extract."""
    df = _make_df()
    out = apply_context(df, {"MARA.NONEXISTENT": ["X"]})
    assert len(out) == 0


def test_values_coerced_to_string():
    """Rule authors can list allowed values as ints; extract values may
    be str-typed — comparison is string-based via `str(v)`."""
    df = pd.DataFrame({
        "BU_TYPE": ["1", "2", "3", "4"],
    })
    # Integer allowed list matches string-typed column after str() coercion
    out = apply_context(df, {"BU_TYPE": [1, 2]})
    assert len(out) == 2
    assert set(out["BU_TYPE"]) == {"1", "2"}


# ---------------------------------------------------------------------------
# Runner integration — a null_check with applies_when gets the scoped
# total_count, not the full-extract total_count.
# ---------------------------------------------------------------------------


def test_runner_respects_applies_when(tmp_path, monkeypatch):
    """Load a synthetic YAML rule with applies_when; verify total_count
    reflects only matching rows."""
    import yaml
    from checks.runner import RULES_DIR, run_checks

    # Write a minimal module YAML into the real rules dir under a scratch name
    fake_module = "_test_applies_when"
    yaml_path = RULES_DIR / "ecc" / f"{fake_module}.yaml"
    try:
        yaml_path.write_text(yaml.dump({
            "module": fake_module,
            "rules": [
                {
                    "id": "TAW001",
                    "field": "MARA.SERNR",
                    "check_class": "null_check",
                    "severity": "high",
                    "dimension": "completeness",
                    "message": "SERNR required for serialized materials",
                    "threshold": 100.0,
                    "applies_when": {"MARA.MTART": ["FERT", "HALB"]},
                },
            ],
        }))

        df = pd.DataFrame({
            "MARA.MATNR": ["M001", "M002", "M003", "M004"],
            "MARA.MTART": ["FERT", "ROH", "HALB", "DIEN"],
            "MARA.SERNR": ["SN-1", None, None, None],
        })

        # Force pandas engine so we exercise the runner path
        monkeypatch.setenv("CHECK_ENGINE", "pandas")
        results = run_checks(fake_module, df, tenant_id="test")

        # Exactly one result for the one rule
        assert len(results) == 1
        r = results[0]
        # Scoped population: 2 rows (MTART in FERT, HALB)
        assert r.total_count == 2, f"total_count should reflect scoped population, got {r.total_count}"
        # Of those 2, M001 has SERNR=SN-1 (populated), M003 has SERNR=None (null) — 1 failing
        assert r.affected_count == 1
        assert r.pass_rate == 50.0
    finally:
        if yaml_path.exists():
            yaml_path.unlink()


# ---------------------------------------------------------------------------
# Polars parity — both engines produce identical total_count / pass_rate
# when applies_when is in effect.
# ---------------------------------------------------------------------------

from checks.polars_engine import POLARS_AVAILABLE


@pytest.mark.skipif(not POLARS_AVAILABLE, reason="polars not installed")
def test_polars_applies_when_parity():
    """Both engines must agree on scoped total_count and pass_rate."""
    from checks.polars_engine import run_checks_polars_df
    from checks.types.null_check import NullCheck

    df = pd.DataFrame({
        "MARA.MATNR": [f"M{i:03d}" for i in range(100)],
        "MARA.MTART": (["FERT"] * 25) + (["HALB"] * 25) + (["ROH"] * 25) + (["DIEN"] * 25),
        # Null in 10 of 50 scoped records, 0 in others
        "MARA.SERNR": (
            (["SN"] * 20) + ([None] * 5)    # FERT: 5 nulls
            + (["SN"] * 20) + ([None] * 5)  # HALB: 5 nulls
            + (["SN"] * 50)                 # ROH + DIEN: fully populated
        ),
    })

    rule = {
        "id": "TAW002",
        "module": "test",
        "field": "MARA.SERNR",
        "check_class": "null_check",
        "severity": "high",
        "dimension": "completeness",
        "message": "SERNR required for serialized",
        "threshold": 100.0,
        "applies_when": {"MARA.MTART": ["FERT", "HALB"]},
    }

    # Pandas path
    from checks.runner import apply_context
    scoped_df = apply_context(df, rule["applies_when"])
    pandas_result = NullCheck(rule).run(scoped_df)

    # Polars path
    polars_results = run_checks_polars_df(df, "test", [dict(rule)])
    assert len(polars_results) == 1
    polars_result = polars_results[0]

    assert pandas_result.total_count == polars_result["total_count"] == 50
    assert pandas_result.affected_count == polars_result["affected_count"] == 10
    assert pandas_result.pass_rate == polars_result["pass_rate"] == 80.0


@pytest.mark.skipif(not POLARS_AVAILABLE, reason="polars not installed")
def test_polars_missing_context_field_skips():
    """applies_when references a field not in the extract — rule is skipped."""
    from checks.polars_engine import run_checks_polars_df

    df = pd.DataFrame({
        "MARA.MATNR": ["M001"],
        "MARA.SERNR": ["SN-1"],
        # MARA.MTART intentionally absent
    })

    rule = {
        "id": "TAW003",
        "module": "test",
        "field": "MARA.SERNR",
        "check_class": "null_check",
        "severity": "high",
        "dimension": "completeness",
        "threshold": 100.0,
        "applies_when": {"MARA.MTART": ["FERT"]},
    }

    results = run_checks_polars_df(df, "test", [dict(rule)])
    assert results == [], "rule with missing applies_when field should be skipped entirely"
