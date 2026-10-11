"""exists_check against a large target table must not build one Python object per
target key: a multi-million-row MARC turned the key set and the isin lookup into
gigabytes of resident memory on an EINE-grain rule."""

import tracemalloc
from types import SimpleNamespace

import pandas as pd

from checks.runner import _with_targets
from checks.types.exists_check import ExistsCheck

RULE: dict = {
    "id": "T1", "check_class": "exists_check", "field": "EINE.WERKS", "grain": "EINE",
    "fields": ["EINA.MATNR", "EINE.WERKS"], "target_table": "MARC",
    "target_fields": ["MATNR", "WERKS"], "severity": "high",
}


def _frames(marc: pd.DataFrame) -> SimpleNamespace:
    return SimpleNamespace(frames={"MARC": marc}, incomplete=set(), partial=set())


def test_large_target_is_not_materialised_as_python_objects() -> None:
    n = 300_000
    marc = pd.DataFrame({"MARC.MATNR": [f"{i:018d}" for i in range(n)],
                         "MARC.WERKS": ["1000"] * n}, dtype="string")
    grain = pd.DataFrame({"EINA.MATNR": [f"{i:018d}" for i in range(0, 4000, 2)],
                          "EINE.WERKS": ["1000", "2000"] * 1000}, dtype="string")
    tracemalloc.start()
    try:
        resolved = _with_targets(RULE, _frames(marc))
        assert isinstance(resolved, dict)
        ev = ExistsCheck(resolved).evaluate(grain)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert int(ev.failing.sum()) == 1000  # every WERKS 2000 row is missing in MARC
    assert ev.details["target_records"] == n
    assert peak < 8_000_000, f"Python heap peaked at {peak / 1e6:.1f} MB for {n} target keys"


def test_semantics_match_key_set_lookup() -> None:
    marc = pd.DataFrame({"MARC.MATNR": ["A", " B ", "A", "C", None],
                         "MARC.WERKS": ["1", "1", "1", "2", "1"]}, dtype="string")
    grain = pd.DataFrame({"EINA.MATNR": ["A", "B", "C", "D", "", None, "A "],
                          "EINE.WERKS": ["1", "1", "1", "1", "1", "1", "1"]}, dtype="string")
    resolved = _with_targets(RULE, _frames(marc))
    assert isinstance(resolved, dict)
    ev = ExistsCheck(resolved).evaluate(grain)
    assert ev.population.tolist() == [True, True, True, True, False, False, True]
    assert ev.failing.tolist() == [False, False, True, True, False, False, False]
    assert ev.details["target_records"] == 4  # A|1, B|1, C|2, |1 — duplicates counted once
    neg = ExistsCheck({**resolved, "negate": True}).evaluate(grain)
    assert neg.failing.tolist() == [True, True, False, False, False, False, True]
    none = ExistsCheck(dict(RULE)).evaluate(grain)  # no target values: every populated key is missing
    assert none.failing.tolist() == [True, True, True, True, False, False, True]
    assert none.details["target_records"] == 0
