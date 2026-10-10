"""Wave readiness report: xlsx sheets, PDF render, SAST filter. Pure: no database."""

import io
from datetime import datetime, timezone

import pytest

from api.routes.migration import _stream
from api.services import pdf_reports as pr
from api.services.migration.cockpit import readiness_report_context, readiness_report_sheets

COCKPIT = {
    "wave": {"name": "Wave 1", "stage": "mock1", "target_date": "2027-03-01", "min_readiness": 95.0,
             "min_dqs": None, "signed_off_at": None},
    "run_id": "r2", "source_version_id": "v1", "dest_system_type": "s4hana",
    "verdict": "at_risk", "score": 97.0, "records_total": 100, "records_blocked": 3,
    "objects": [{"module": "accounts_payable", "label": "BP supplier", "verdict": "at_risk", "score": 94.0,
                 "records": 50, "records_blocked": 3, "blocker_count": 3, "dqs": 72.0}],
    "trend": [{"run_id": "r1", "completed_at": datetime(2026, 10, 7, 8, tzinfo=timezone.utc), "score": 80.0},
              {"run_id": "r2", "completed_at": datetime(2026, 10, 10, 8, tzinfo=timezone.utc), "score": 97.0}],
    "blockers": [{"module": "accounts_payable", "label": "BP supplier", "gap_type": "value_unmapped",
                  "field": "BUT000.BU_GROUP", "severity": "critical", "records": 3, "gaps": 3}],
}


def test_sast_filter():
    assert pr.fmt_sast(datetime(2026, 1, 3, 0, 0, tzinfo=timezone.utc)) == "3 Jan 2026, 02:00 SAST"
    assert pr.fmt_sast(None) == "—"


def test_xlsx_sheets():
    sheets = readiness_report_sheets(COCKPIT)
    assert list(sheets) == ["Summary", "Objects", "Blockers", "Trend"]
    assert sheets["Objects"].iloc[0]["Object"] == "BP supplier"
    assert sheets["Blockers"].iloc[0]["Records"] == 3
    assert sheets["Trend"].iloc[1]["Completed (SAST)"] == "10 Oct 2026, 10:00 SAST"


def test_pdf_renders():
    pytest.importorskip("weasyprint")
    ctx = readiness_report_context(COCKPIT, "Demo", datetime(2026, 10, 10, 12, tzinfo=timezone.utc))
    assert ctx["title"] == "Migration readiness: Wave 1"
    pdf = pr.render("migration_readiness_report.html", ctx)
    assert pdf.startswith(b"%PDF")


def test_empty_wave_renders():
    pytest.importorskip("weasyprint")
    empty = {**COCKPIT, "run_id": None, "score": None, "verdict": "no_go", "objects": [], "trend": [], "blockers": []}
    pdf = pr.render("migration_readiness_report.html", readiness_report_context(empty, "Demo", None))
    assert pdf.startswith(b"%PDF")


def test_stream_sanitises_filename():
    """A wave name with an em dash and a semicolon must not break Content-Disposition or
    require non-latin-1 encoding (final review I2)."""
    name = f"migration_readiness_Cutover—Wave; 1".replace(" ", "_")
    resp = _stream(b"data", "application/pdf", f"{name}.pdf")
    disposition = resp.headers["content-disposition"]
    disposition.encode("latin-1")  # must not raise
    assert ";" not in disposition.split("filename=", 1)[1]
    assert disposition == "attachment; filename=migration_readiness_Cutover_Wave__1.pdf"


def test_no_go_verdict_renders_bad_class():
    empty = {**COCKPIT, "run_id": None, "score": None, "verdict": "no_go", "objects": [], "trend": [], "blockers": []}
    ctx = readiness_report_context(empty, "Demo", None)
    html = pr._env().get_template("migration_readiness_report.html").render(**ctx)
    assert 'class="st bad"' in html
