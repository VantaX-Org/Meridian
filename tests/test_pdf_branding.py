"""Wave 11 report branding: every PDF template's cover, running header and footer."""

from __future__ import annotations

from pathlib import Path

import pytest

from api.services import pdf_reports as pr

weasyprint = pytest.importorskip("weasyprint")

NAMES = ["analysis", "extraction", "cleaning", "comparison", "executive", "object", "record"]


def _html(name: str) -> str:
    from scripts.render_report_previews import contexts

    template, ctx = contexts()[name]
    return pr._env().get_template(template).render(**ctx)


@pytest.mark.parametrize("name", NAMES)
def test_cover_header_footer_markup(name):
    html = _html(name)
    assert 'class="cover-band"' in html and "#7FA8FF" in html and "#2563EB" in html  # mark in cover-mark, meridian line in the accent
    assert 'class="cover-title"' in html and "cover-eyebrow" in html and 'class="cover-meta"' in html
    assert "assets/brand/mark-mono.svg" in html  # running header mark
    assert "Confidential" in html and "stays inside your network" in html
    assert "Generated " in html  # footer left


@pytest.mark.parametrize("name", NAMES)
def test_first_page_renders_as_cover(name):
    from scripts.render_report_previews import contexts

    template, ctx = contexts()[name]
    html = pr._env().get_template(template).render(**ctx)
    doc = weasyprint.HTML(string=html, base_url=pr.TEMPLATE_DIR).render()
    assert len(doc.pages) >= 2
    assert doc.pages[0]._page_box.page_type.name == "cover"
    assert doc.pages[1]._page_box.page_type.name == ""


def test_score_ring_only_with_dqs():
    assert "cover-ring" in _html("analysis")


def test_css_tokens_and_fonts():
    css = (Path(pr.TEMPLATE_DIR) / "assets" / "report.css").read_text()
    for token in ("#1A2233", "#3F4A5C", "#5A6578", "#E6EAF0", "#F4F6F8", "#2563EB", "#1B7544", "#9A5B00", "#A64D07", "#C62828",
                  "#22A06B", "#F5A524", "#F97316", "#E5484D", "#3B82F6"):
        assert token in css
    assert "Instrument Sans" in css and "Instrument Serif" not in css and "Public Sans" not in css
    for f in ("InstrumentSans-400", "InstrumentSans-500", "InstrumentSans-600"):
        assert (Path(pr.TEMPLATE_DIR) / "assets" / "fonts" / f"{f}.woff2").exists()


def _ring_html(score, capped):
    from scripts.render_report_previews import contexts

    template, ctx = contexts()["analysis"]
    ctx = {**ctx, "overall": {**ctx["overall"], "composite": score, "capped": capped}}
    return pr._env().get_template(template).render(**ctx)


def test_cover_ring_is_270_degree_arc_banded_with_cap_value():
    html = _ring_html(85, True)
    assert html.count("A44 44 0 1 1 18.89 18.89") == 2 and "<circle" not in html.split("cover-ring")[1].split("</svg>")[0]
    assert "#EEF1F5" in html and "ring-meridian" in html
    assert "stroke=\"#F5A524\"" in html  # 85 is in the medium band (vivid fill)
    assert "Capped at 85" in html
    assert "Capped at 95" not in _ring_html(95, False) and 'stroke="#22A06B"' in _ring_html(95, False)
    assert 'stroke="#E5484D"' in _ring_html(40, False)


def test_status_marks_are_shapes_and_header_mark_is_5mm():
    css = (Path(pr.TEMPLATE_DIR) / "assets" / "report.css").read_text()
    assert ".st.ok::before { background: transparent" in css and "rotate(45deg)" in css
    assert ".st.bad::before { background: var(--bad-fill); border-radius: 0" in css
    assert 'width="5mm" height="5mm"' in (Path(pr.TEMPLATE_DIR) / "assets" / "brand" / "mark-mono.svg").read_text()
    assert (Path(pr.TEMPLATE_DIR) / "assets" / "fonts" / "OFL.txt").exists()
