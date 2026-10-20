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


# ── the memory guard: fail cleanly rather than be OOM-killed ───────────────────────────────────
def test_the_guard_refuses_an_allocation_that_would_not_fit(monkeypatch):
    """An OOM kill is SIGKILL: no finally, no close(), so SAP locks the user on dangling sessions."""
    from sap.rfc import ExtractionMemoryError, require_memory

    monkeypatch.setattr("sap.rfc.available_memory_bytes", lambda: 2 * 1024**3)  # 2 GB free
    with pytest.raises(ExtractionMemoryError) as exc:
        require_memory(10 * 1024**3, "storing MARC")
    assert "lock the user" in str(exc.value)
    assert "MARC" in str(exc.value)


def test_the_guard_allows_an_allocation_that_fits(monkeypatch):
    from sap.rfc import require_memory

    monkeypatch.setattr("sap.rfc.available_memory_bytes", lambda: 20 * 1024**3)
    require_memory(5 * 1024**3, "storing MARC")  # must not raise


def test_the_guard_does_not_block_when_memory_is_unknown(monkeypatch):
    """No /proc/meminfo (macOS, a stripped image): never block an extraction over it."""
    from sap.rfc import require_memory

    monkeypatch.setattr("sap.rfc.available_memory_bytes", lambda: None)
    require_memory(10**18, "anything")  # must not raise


def test_the_join_checks_memory_before_the_fallback_copy(monkeypatch):
    """The fallback merge allocates a second whole frame - that check must come first."""
    from sap.rfc import ExtractionMemoryError

    monkeypatch.setattr("sap.rfc.available_memory_bytes", lambda: 1)  # nothing available
    left = pd.DataFrame({"K": ["a", "b"], "X": [1, 2]})
    right = pd.DataFrame({"K": ["b", "a"], "Y": [20, 10]})  # misaligned -> fallback path
    with pytest.raises(ExtractionMemoryError):
        _join_group(left, right, ["K"])


def test_the_aligned_path_does_not_copy_the_columns():
    """The joined frame must share its data with the inputs, not copy it.

    Assigning columns one at a time into `merged` makes pandas consolidate blocks on each
    assignment, copying the whole frame repeatedly. On MARC (18.3M rows) that is what pushed an
    18 GB frame past a 30 GB box. Views keep the peak at roughly one frame.
    """
    import numpy as np

    keys = ["K"]
    left = pd.DataFrame({"K": ["a", "b"], "X": [1, 2]})
    right = pd.DataFrame({"K": ["a", "b"], "Y": [3, 4]})
    out = _join_group(left, right, keys)
    assert out["X"].to_numpy().base is not None or np.shares_memory(out["X"].to_numpy(),
                                                                   left["X"].to_numpy()), \
        "the joined column should be a view of the input, not a copy"


def test_the_marc_baseline_size_is_allowed(monkeypatch):
    """17.1 GB against 30 GB available must pass - it was refused by 2% at the old 55%.

    The guard stopped a viable material_master baseline because its threshold still assumed the
    double-frame copy that the write and join fixes removed.
    """
    from sap.rfc import require_memory

    monkeypatch.setattr("sap.rfc.available_memory_bytes", lambda: 30 * 1024**3)
    require_memory(int(17.1e9), "storing MARC")  # must not raise


def test_something_that_genuinely_cannot_fit_is_still_refused(monkeypatch):
    from sap.rfc import ExtractionMemoryError, require_memory

    monkeypatch.setattr("sap.rfc.available_memory_bytes", lambda: 30 * 1024**3)
    with pytest.raises(ExtractionMemoryError):
        require_memory(int(26e9), "impossible")
