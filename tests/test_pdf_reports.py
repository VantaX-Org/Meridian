"""Deterministic PDF reports: every report renders, and the comparison numbers are right."""

from __future__ import annotations

import pytest

from api.services import pdf_reports as pr
from tests import pdf_fixtures as fx

weasyprint = pytest.importorskip("weasyprint")


@pytest.mark.parametrize("name", ["analysis", "extraction", "cleaning", "comparison", "executive"])
def test_every_report_renders(name):
    from scripts.render_report_previews import contexts

    template, ctx = contexts()[name]
    pdf = pr.render(template, ctx)
    assert pdf.startswith(b"%PDF") and len(pdf) > 10_000


def test_empty_inputs_render():
    """A run with no findings, coverage or cleaning activity still renders, with reasons."""
    v = {"id": "6f1c2a10-0000-4000-8000-0000000000ff", "label": None, "status": "complete",
         "run_at": fx.GENERATED, "dqs_summary": {}, "metadata": {}}
    kw = {"tenant_name": fx.TENANT, "generated_at": fx.GENERATED}
    assert pr.render("analysis_report.html", pr.analysis_context(v, [], **kw)).startswith(b"%PDF")
    assert pr.render("extraction_report.html", pr.extraction_context(v, **kw)).startswith(b"%PDF")
    assert pr.render("cleaning_report.html", pr.cleaning_context({}, **kw)).startswith(b"%PDF")
    assert pr.render("comparison_report.html",
                     pr.comparison_context(v, v, [], [], record_diff=None, **kw)).startswith(b"%PDF")


def test_summary_body_empty_states():
    """T17: an empty run shows the dashed .empty block in each of the three
    shared Summary sections, not blank space."""
    v = {"id": "6f1c2a10-0000-4000-8000-0000000000ff", "label": None, "status": "complete",
         "run_at": fx.GENERATED, "dqs_summary": {}, "metadata": {}}
    kw = {"tenant_name": fx.TENANT, "generated_at": fx.GENERATED}
    html = pr._env().get_template("analysis_report.html").render(**pr.analysis_context(v, [], **kw))
    assert "This run has no data quality score to summarise." in html
    assert "No dimension was measured in this run." in html
    assert "No check found failing records in this run." in html


def test_summary_body_shows_score_and_findings_when_present():
    ctx = pr.analysis_context(fx.V2, fx.FINDINGS2, tenant_name=fx.TENANT, system=fx.SYSTEM,
                              generated_at=fx.GENERATED, previous_dqs=50.0)
    html = pr._env().get_template("analysis_report.html").render(**ctx)
    assert "Change since previous run" in html
    assert "Data quality score (DQS)" in html
    assert ctx["previous_dqs"]["composite"] == 50.0


def test_check_changes():
    ch = pr.check_changes(fx.FINDINGS1, fx.FINDINGS2)
    ids = {k: [r["check_id"] for r in v] for k, v in ch.items()}
    assert ids["new"] == ["AP014"]
    assert sorted(ids["resolved"]) == ["AP005", "BP009"]
    assert sorted(ids["persisting"]) == ["AP002", "AP010", "BP001", "BP004", "MM003", "MM011"]
    assert sorted(ids["not_comparable"]) == ["GL003", "MM020"]
    by_id = {r["check_id"]: r for v in ch.values() for r in v}
    assert by_id["BP004"]["change"] == 2_200 - 5_410
    assert by_id["MM003"]["change"] == 11_420 - 9_800
    assert by_id["AP014"]["change"] == 85
    assert "change" not in by_id["GL003"]


def test_module_deltas():
    d = pr.module_deltas(fx.V1["dqs_summary"], fx.V2["dqs_summary"])
    assert d["business_partner"]["dqs_change"] == round(83.9 - 74.2, 2)
    assert d["material_master"]["dqs_change"] == round(84.1 - 86.0, 2)
    assert d["business_partner"]["dimensions"]["completeness"]["change"] == 13.0
    assert d["fi_gl"]["v1_score"] == 0  # same shape as /versions/compare for a module new in v2


def test_comparison_figures():
    c = pr.comparison_context(fx.V1, fx.V2, fx.FINDINGS1, fx.FINDINGS2, record_diff=fx.RECORD_DIFF,
                              tenant_name=fx.TENANT, generated_at=fx.GENERATED)
    assert c["change"] == round(c["o2"]["composite"] - c["o1"]["composite"], 1)
    # Record totals only count checks that ran cleanly in both runs (MM020 is excluded).
    assert c["rec"]["totals"] == {"new": 112 + 40 + 1_900 + 85, "resolved": 2_187 + 3_250 + 280,
                                  "persisting": 933 + 2_160 + 9_520}
    assert c["rec"]["excluded"] == 1
    dims = {d["name"]: d for d in c["dims"]}
    assert dims["timeliness"]["change"] is None  # measured by no check in either run
    assert dims["completeness"]["change"] == round(dims["completeness"]["v2"] - dims["completeness"]["v1"], 1)


def test_unmeasured_dimension_is_not_100():
    assert pr.dimension_scores(fx.V2["dqs_summary"])["timeliness"] is None


def test_server_addresses_are_redacted():
    assert pr.redact("failed at host 192.0.2.10:3300") == "failed at host [server]"
    ctx = pr.extraction_context(fx.V2, tenant_name=fx.TENANT, generated_at=fx.GENERATED)
    html = pr._env().get_template("extraction_report.html").render(**ctx)
    assert "192.0.2.10" not in html and "[server]" in html


def test_cover_has_mark():
    ctx = pr.analysis_context(fx.V2, fx.FINDINGS2, tenant_name=fx.TENANT, system=fx.SYSTEM, generated_at=fx.GENERATED)
    html = pr._env().get_template("analysis_report.html").render(**ctx)
    assert "<svg" in html or "mark-light.svg" in html
    assert "Meridian" in html


def test_timestamps_are_sast():
    # GENERATED is 09:30 UTC -> 11:30 SAST (UTC+2, no DST).
    assert pr.fmt_dt(fx.GENERATED) == "4 Oct 2026, 11:30 SAST"
    ctx = pr.analysis_context(fx.V2, fx.FINDINGS2, tenant_name=fx.TENANT, system=fx.SYSTEM, generated_at=fx.GENERATED)
    assert ctx["generated_sast"] == "4 Oct 2026, 11:30 SAST"
    html = pr._env().get_template("analysis_report.html").render(**ctx)
    assert "11:30 SAST" in html
