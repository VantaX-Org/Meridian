"""Tests for cross-module consistency rules (Procure-to-Pay, etc.).

Exercises checks/cross_module.py: the join_extracts helper, single-rule
execution, batch execution, and the edge cases (missing module, missing
join key, zero-row join).
"""

from __future__ import annotations

import pandas as pd
import pytest

from checks.cross_module import (
    discover_cross_module_rules,
    join_extracts,
    run_cross_module_check,
    run_cross_module_checks,
    run_cross_module_on_prejoined,
)


# ---------------------------------------------------------------------------
# join_extracts
# ---------------------------------------------------------------------------


def _p2p_fixture():
    """Three POs, two vendors. Vendor LFA001 has ZTERM=0001; LFA002 has 0003.
    PO 1 (LFA001) has matching 0001; PO 2 (LFA001) has drifted 0009; PO 3
    (LFA002) has matching 0003. Expected: 1 failing row (PO 2)."""
    ekko = pd.DataFrame({
        "EBELN": ["4500001", "4500002", "4500003"],
        "LIFNR": ["LFA001", "LFA001", "LFA002"],
        "ZTERM": ["0001", "0009", "0003"],
        "WAERS": ["ZAR", "ZAR", "USD"],
    })
    lfa1 = pd.DataFrame({
        "LIFNR": ["LFA001", "LFA002"],
        "ZTERM": ["0001", "0003"],
        "WAERS": ["ZAR", "USD"],
    })
    return {"mm_purchasing": ekko, "accounts_payable": lfa1}


def test_join_extracts_basic():
    df_map = _p2p_fixture()
    joined = join_extracts(
        df_map,
        sources=[
            {"module": "mm_purchasing", "alias": "EKKO"},
            {"module": "accounts_payable", "alias": "LFA1"},
        ],
        join_on=[{"left": "LIFNR", "right": "LIFNR"}],
    )
    assert joined is not None
    assert len(joined) == 3
    # pandas suffixes collisions — ZTERM_x (from EKKO) and ZTERM_y (from LFA1)
    assert "ZTERM_x" in joined.columns
    assert "ZTERM_y" in joined.columns


def test_join_missing_module_returns_none():
    df_map = {"mm_purchasing": pd.DataFrame({"LIFNR": ["X"]})}
    joined = join_extracts(
        df_map,
        sources=[
            {"module": "mm_purchasing"},
            {"module": "accounts_payable"},
        ],
        join_on=[{"left": "LIFNR", "right": "LIFNR"}],
    )
    assert joined is None


def test_join_spec_count_mismatch_returns_none():
    df_map = _p2p_fixture()
    joined = join_extracts(
        df_map,
        sources=[{"module": "mm_purchasing"}, {"module": "accounts_payable"}],
        join_on=[],  # zero specs for 2 sources — wrong
    )
    assert joined is None


def test_join_missing_key_returns_none():
    df_map = _p2p_fixture()
    joined = join_extracts(
        df_map,
        sources=[
            {"module": "mm_purchasing"},
            {"module": "accounts_payable"},
        ],
        join_on=[{"left": "NONEXISTENT", "right": "LIFNR"}],
    )
    assert joined is None


# ---------------------------------------------------------------------------
# run_cross_module_check — P2P rule example
# ---------------------------------------------------------------------------


def test_cross_module_check_p2p_terms_mismatch():
    """The XP2P001 pattern — PO terms must match vendor-master terms."""
    df_map = _p2p_fixture()
    rule = {
        "id": "XP2P001",
        "check_class": "cross_field_check",
        "field": "EKKO.ZTERM",
        "sources": [
            {"module": "mm_purchasing", "alias": "EKKO"},
            {"module": "accounts_payable", "alias": "LFA1"},
        ],
        "join_on": [{"left": "LIFNR", "right": "LIFNR"}],
        "condition": "ZTERM_x == ZTERM_y",
        "severity": "medium",
        "dimension": "consistency",
        "threshold": 100.0,
    }
    result = run_cross_module_check(rule, df_map)
    assert result is not None
    # 3 joined rows, 1 (PO 2) fails the condition
    assert result.total_count == 3
    assert result.affected_count == 1
    assert result.pass_rate == pytest.approx(66.67, abs=0.1)
    # Cross-module marker carried on details
    assert result.details["cross_module"] is True
    assert set(result.details["sources"]) == {"mm_purchasing", "accounts_payable"}


def test_cross_module_check_missing_source_skips():
    df_map = {"mm_purchasing": pd.DataFrame({"LIFNR": ["X"], "ZTERM": ["0001"]})}
    rule = {
        "id": "XP2P001",
        "check_class": "cross_field_check",
        "sources": [
            {"module": "mm_purchasing"},
            {"module": "accounts_payable"},
        ],
        "join_on": [{"left": "LIFNR", "right": "LIFNR"}],
        "condition": "ZTERM_x == ZTERM_y",
    }
    result = run_cross_module_check(rule, df_map)
    assert result is None


def test_cross_module_check_wrong_class_rejected():
    """Only cross_field_check is supported; a null_check cross-module rule
    must be rejected (would give surprising semantics otherwise)."""
    df_map = _p2p_fixture()
    rule = {
        "id": "XP2P-BAD",
        "check_class": "null_check",  # unsupported in cross-module
        "sources": [
            {"module": "mm_purchasing"},
            {"module": "accounts_payable"},
        ],
        "join_on": [{"left": "LIFNR", "right": "LIFNR"}],
    }
    result = run_cross_module_check(rule, df_map)
    assert result is None


# ---------------------------------------------------------------------------
# Pre-joined single-df path — how the worker actually invokes this
# ---------------------------------------------------------------------------


def test_prejoined_p2p_tax_code_presence():
    """When the extract is pre-joined (one df with columns from multiple
    tables), a cross-module rule should evaluate against the df directly."""
    df = pd.DataFrame({
        "BELNR": ["100000001", "100000002", "100000003"],
        "BUZEI": [1, 1, 1],
        "LIFNR": ["LFA001", "LFA001", "LFA002"],
        "MWSKZ": ["V1", None, "V2"],
    })
    rule = {
        "id": "XP2P003",
        "check_class": "cross_field_check",
        "field": "BSEG.MWSKZ",
        "sources": [{"module": "fi_gl"}, {"module": "accounts_payable"}],
        "condition": "MWSKZ.notna() & (MWSKZ != '')",
        "severity": "high",
        "dimension": "consistency",
        "threshold": 100.0,
    }
    result = run_cross_module_on_prejoined(rule, df)
    assert result is not None
    assert result.total_count == 3
    assert result.affected_count == 1  # the None row
    assert result.details["mode"] == "prejoined"


def test_prejoined_skips_when_columns_missing():
    df = pd.DataFrame({"LIFNR": ["LFA001"]})  # MWSKZ intentionally missing
    rule = {
        "id": "XP2P003",
        "check_class": "cross_field_check",
        "sources": [{"module": "fi_gl"}, {"module": "accounts_payable"}],
        "condition": "MWSKZ.notna()",
    }
    result = run_cross_module_on_prejoined(rule, df)
    assert result is None


def test_discover_cross_module_rules_loads_p2p():
    """The shipped p2p.yaml pack must be discoverable."""
    rules = discover_cross_module_rules()
    ids = {r.get("id") for r in rules}
    # At minimum, our seed P2P rules should be present
    assert "XP2P001" in ids
    assert "XP2P003" in ids
    # Every rule should have the module stamp
    assert all(r.get("module") for r in rules)


def test_run_cross_module_checks_filters_inapplicable():
    """Given a batch of rules and a partial df_map, only rules whose sources
    are all present should return results."""
    df_map = _p2p_fixture()
    rules = [
        {
            "id": "XP2P-RUN",
            "check_class": "cross_field_check",
            "field": "EKKO.ZTERM",
            "sources": [{"module": "mm_purchasing"}, {"module": "accounts_payable"}],
            "join_on": [{"left": "LIFNR", "right": "LIFNR"}],
            "condition": "ZTERM_x == ZTERM_y",
            "severity": "medium",
            "dimension": "consistency",
            "threshold": 100.0,
        },
        {
            "id": "XP2P-SKIP",
            "check_class": "cross_field_check",
            "sources": [{"module": "mm_purchasing"}, {"module": "fi_gl"}],  # fi_gl missing
            "join_on": [{"left": "EBELN", "right": "EBELN"}],
            "condition": "True",
        },
    ]
    results = run_cross_module_checks(rules, df_map)
    assert len(results) == 1
    assert results[0].check_id == "XP2P-RUN"
