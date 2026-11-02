"""docs/field-coverage/*.md must match what scripts/field_coverage.py generates."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_field_coverage_docs_up_to_date():
    result = subprocess.run(
        [sys.executable, "scripts/field_coverage.py", "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        "Field-coverage docs are stale; run `python scripts/field_coverage.py`.\n"
        + result.stdout
        + result.stderr
    )
