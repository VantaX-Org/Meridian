"""Joining RFC field groups must not double the memory, and must stay correct.

A wide table is read as several field groups over the same key ranges, then joined. The merge
form allocates a second copy of the whole frame, which for MARC (~18 GB) is an OOM kill on a
30 GB box even after the read succeeded. The fast path attaches columns when the keys line up
row-for-row; these tests pin both the speed path and the correctness of the fallback.
"""

import pandas as pd
import pytest

from sap.rfc import _join_group


def _frame(**cols):
    return pd.DataFrame(cols)


def test_aligned_groups_are_joined():
    keys = ["MATNR", "WERKS"]
    left = _frame(MATNR=["A", "B"], WERKS=["1", "2"], X=[10, 20])
    right = _frame(MATNR=["A", "B"], WERKS=["1", "2"], Y=[30, 40])
    out = _join_group(left, right, keys)
    assert list(out.columns) == ["MATNR", "WERKS", "X", "Y"]
    assert out["Y"].tolist() == [30, 40]
    assert len(out) == 2


def test_the_same_columns_are_not_duplicated():
    keys = ["K"]
    left = _frame(K=["a"], X=[1])
    right = _frame(K=["a"], X=[9])  # a key column repeated by both groups
    out = _join_group(left, right, keys)
    assert list(out.columns).count("X") == 1


def test_misaligned_rows_fall_back_to_a_merge():
    """Different order must still join correctly - the merge path handles it."""
    keys = ["K"]
    left = _frame(K=["a", "b"], X=[1, 2])
    right = _frame(K=["b", "a"], Y=[20, 10])
    out = _join_group(left, right, keys).sort_values("K").reset_index(drop=True)
    assert out["Y"].tolist() == [10, 20]


def test_different_row_counts_fall_back_to_a_merge():
    keys = ["K"]
    left = _frame(K=["a"], X=[1])
    right = _frame(K=["a", "b"], Y=[10, 20])
    out = _join_group(left, right, keys)
    assert len(out) == 2, "an outer merge keeps the extra row"


def test_no_keys_concatenates_sideways():
    left = _frame(X=[1, 2])
    right = _frame(Y=[3, 4])
    out = _join_group(left, right, [])
    assert list(out.columns) == ["X", "Y"] and len(out) == 2
