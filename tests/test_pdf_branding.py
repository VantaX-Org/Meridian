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
    assert 'class="cover-band"' in html and "#8DA3FF" in html and "#EDEDF0" in html
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
    for token in ("#141519", "#4A4C55", "#6F717B", "#E4E2DB", "#FAF9F6", "#2B4BE0", "#157A3C", "#946200", "#BA4A0B", "#B42318"):
        assert token in css
    assert "Instrument Sans" in css and "Instrument Serif" in css and "Public Sans" not in css
    for f in ("InstrumentSans-400", "InstrumentSans-500", "InstrumentSans-600", "InstrumentSerif-400"):
        assert (Path(pr.TEMPLATE_DIR) / "assets" / "fonts" / f"{f}.woff2").exists()
