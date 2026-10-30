"""tests/coverage_floor.py reads a Cobertura report and fails below the floor."""
from pathlib import Path

from tests.coverage_floor import line_coverage, main


def _report(tmp_path: Path, rate: str) -> Path:
    p = tmp_path / "coverage.xml"
    p.write_text(f'<?xml version="1.0" ?><coverage line-rate="{rate}" branch-rate="0" version="7"></coverage>')
    return p


def test_reads_the_line_rate_as_percent(tmp_path):
    assert round(line_coverage(_report(tmp_path, "0.4321")), 2) == 43.21


def test_passes_at_or_above_and_fails_below_the_floor(tmp_path, capsys):
    r = _report(tmp_path, "0.40")
    assert main([str(r), "--floor", "40"]) == 0
    assert main([str(r), "--floor", "40.1"]) == 1
    assert "below the floor" in capsys.readouterr().err


def test_an_unreadable_report_is_an_error_not_a_pass(tmp_path):
    assert main([str(tmp_path / "missing.xml"), "--floor", "1"]) == 2
    bad = tmp_path / "bad.xml"
    bad.write_text("<coverage/>")
    assert main([str(bad), "--floor", "1"]) == 2
