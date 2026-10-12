"""Report, PDF, xlsx and template output never contains the middle dot (U+00B7)."""
from __future__ import annotations

from pathlib import Path

from api.services.pdf_reports import _scope_label

ROOT = Path(__file__).resolve().parent.parent
DOT = "·"


def test_scope_label_has_no_middle_dot():
    assert DOT not in _scope_label("Tenant", {"name": "ECC PRD", "client": "100", "sid": "PRD"})
    assert DOT not in _scope_label("Tenant", None)


def test_report_sources_and_templates_have_no_middle_dot():
    files = sorted((ROOT / "templates").glob("*.html"))
    files += [ROOT / "api/services" / n for n in ("pdf_reports.py", "branded_xlsx.py", "workbook_report.py",
                                                  "insights_aggregate.py")]
    assert files
    bad = [f.name for f in files if f.exists() and DOT in f.read_text(encoding="utf-8")]
    assert not bad, bad
