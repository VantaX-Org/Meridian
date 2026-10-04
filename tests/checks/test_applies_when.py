"""Tests for the `applies_when` rule predicate (SAP field-determination).

A rule can declare `applies_when: {field: allowed_values}` to scope the
check to records matching all listed conditions. total_count and pass_rate
reflect the scoped population, not the full extract.

Covers:
- pandas path via checks.runner.apply_context
- pandas + YAML-runner integration
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


def test_older_than_days_keeps_only_old_dates():
    """`older_than_days` scopes to dates before today minus N days; blank and
    unparseable dates are out of scope."""
    old = (pd.Timestamp.now() - pd.Timedelta(days=400)).strftime("%Y%m%d")
    new = (pd.Timestamp.now() - pd.Timedelta(days=10)).strftime("%Y%m%d")
    df = pd.DataFrame({"EKKO.EBELN": ["1", "2", "3", "4"], "EKKO.BEDAT": [old, new, "", "00000000"]})
    out = apply_context(df, {"EKKO.BEDAT": {"older_than_days": 180}})
    assert out["EKKO.EBELN"].tolist() == ["1"]


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
