"""The store guard must measure what the write ADDS, not what the frame already is.

The frame is resident by the time a table is stored, so MemAvailable necessarily excludes it.
Checking the whole frame against current availability can only ever fail for a large table, and did:

    MARC 18333093 rows, complete=True
    ExtractionMemoryError: storing MARC needs about 17.1 GB and only 14.7 GB is available (limit 80%)

17.1 + 14.7 is simply the box's 31.8 GB. The read had succeeded; the guard then refused to write
data that was already in memory, on the grounds that it was in memory.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _store_body() -> str:
    src = (ROOT / "workers" / "tasks" / "run_extraction.py").read_text(encoding="utf-8")
    start = src.index("def store(")
    return src[start:start + 1200]


def test_the_guard_does_not_measure_the_whole_frame():
    body = _store_body()
    assert "require_memory" in body, "the write guard disappeared"
    # the old, self-defeating form: the whole frame against current availability
    assert not re.search(r"require_memory\(\s*int\(df\.memory_usage\(deep=True\)\.sum\(\)\)", body), (
        "the store guard compares the whole frame against MemAvailable, which already excludes "
        "that frame - it can only fail for large tables"
    )


def test_the_guard_measures_an_incremental_allocation():
    body = _store_body()
    assert "_per_col" in body, "the guard should size the write from one column, not the frame"
    assert "require_memory(_per_col" in body
