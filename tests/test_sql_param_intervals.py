"""No async SQL may build an interval by concatenating a bound parameter with a string.

The API runs on asyncpg, which type-checks every parameter: ``(:days || ' days')::interval``
sends an int where the concatenation needs text and fails with

    invalid input for query argument $2: 56 (expected str, got int)

Under psycopg2 the same SQL works, which is why this survived: the workers use the sync driver,
so only the async path broke and only in production. It made ``GET /api/v1/analytics/mdm-health``
return 500 on every call on a pilot deployment.

``make_interval(days => :days)`` takes the int directly. ``(:days)::text || ' days'`` also works.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
# api/ is the async (asyncpg) surface. workers/ is psycopg2 and is not covered here.
ASYNC_SOURCES = sorted((ROOT / "api").rglob("*.py"))
# a bound parameter concatenated with a quoted literal inside SQL text
PATTERN = re.compile(r":\w+\s*\|\|")  # :param || '...'
CAST_PATTERN = re.compile(r":\w+\)?::text\s*\|\|")  # explicitly cast first: safe


def _sql_texts(path: Path) -> list[str]:
    """The SQL-looking strings of a module (triple-quoted blocks and text("...") args)."""
    src = path.read_text(encoding="utf-8")
    return [m.group(0) for m in re.finditer(r'(?:"""|\'\'\')(.*?)(?:"""|\'\'\')|text\(\s*(?:"""|"|\')(.*?)(?:"""|"|\')',
                                            src, re.S)]


@pytest.mark.parametrize("path", ASYNC_SOURCES, ids=lambda p: p.name)
def test_no_string_concatenation_of_a_bound_parameter(path: Path) -> None:
    offenders = []
    for block in _sql_texts(path):
        for line in block.splitlines():
            # a `--` comment explaining the bug is not the bug
            code = line.split("--", 1)[0]
            if PATTERN.search(code) and not CAST_PATTERN.search(code):
                offenders.append(line.strip())
    assert not offenders, (
        f"{path.name}: a bound parameter is concatenated with a literal in SQL. asyncpg "
        f"type-checks it and an int parameter fails ('expected str, got int'). Use "
        f"make_interval(days => :n) or cast with :n::text. Offending lines:\n  "
        + "\n  ".join(offenders)
    )


def test_the_guard_would_catch_the_original_bug() -> None:
    """Guard the guard: the exact line that broke mdm-health is still detected."""
    bad = "AND snapshot_date > now() - (:days || ' days')::interval"
    assert PATTERN.search(bad) and not CAST_PATTERN.search(bad)
    good = "AND snapshot_date > now() - make_interval(days => :days)"
    assert not PATTERN.search(good)
    also_good = "AND snapshot_date > now() - (:days::text || ' days')::interval"
    assert CAST_PATTERN.search(also_good)
