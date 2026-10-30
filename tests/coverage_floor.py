#!/usr/bin/env python3
"""Fail when Python line coverage falls below the floor (PC-8).

    python tests/coverage_floor.py coverage.xml            # the floor below
    python tests/coverage_floor.py coverage.xml --floor 40

Reads the Cobertura XML that `pytest --cov ... --cov-report=xml` or `coverage xml` writes (root attribute
``line-rate``) and exits 1 when the total line coverage of api, workers, checks and sap is below the floor.
The floor is the number measured on a representative shard minus 2 points (tests/README.md); raise it when
coverage rises, never lower it to make a build pass.
"""
from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# 54.9% measured 2026-10-30 on CI shard 1/6 (PYTEST_SHARD=1/6, 3,029 tests) over api, workers, checks and sap,
# minus 2 points; see tests/README.md.
FLOOR = 52.9


def line_coverage(xml_path: Path) -> float:
    """Total line coverage in percent from a Cobertura report."""
    root = ET.parse(xml_path).getroot()
    rate = root.get("line-rate")
    if rate is None:
        raise ValueError(f"{xml_path} has no line-rate: not a Cobertura coverage report")
    return float(rate) * 100.0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("report", type=Path, help="coverage.xml (Cobertura)")
    p.add_argument("--floor", type=float, default=FLOOR, help=f"minimum line coverage in percent (default {FLOOR})")
    a = p.parse_args(argv)
    try:
        pct = line_coverage(a.report)
    except (OSError, ET.ParseError, ValueError) as e:
        print(f"coverage floor: cannot read {a.report}: {e}", file=sys.stderr)
        return 2
    if pct + 1e-9 < a.floor:
        print(f"coverage floor: {pct:.1f}% is below the floor of {a.floor:.1f}%", file=sys.stderr)
        return 1
    print(f"coverage floor: {pct:.1f}% (floor {a.floor:.1f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
