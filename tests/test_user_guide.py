"""The user guide PDF: the markdown subset it renders, the chapter order from index.json, and the PDF."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from api.services import user_guide as ug


def test_markdown_subset_matches_the_app_renderer():
    html = str(ug.to_html(
        "# Runs\n\nA run is `MM003` & **Compare**, see [rules](/docs?page=rules), [runs](/runs) or [x](https://e.com).\n\n"
        "- a\n- b\n\n1. one\n2. two\n\n```\nsudo bash scripts/update.sh\n```\n", "runs"))
    assert '<h1 id="runs">Runs</h1>' in html
    assert '<code class="mono">MM003</code> &amp; <strong>Compare</strong>' in html
    # a chapter link stays a link inside the PDF; an app route and an outside link print as their label
    assert '<a href="#rules">rules</a>, runs or x.' in html
    assert "<ul><li>a</li><li>b</li></ul>" in html and "<ol><li>one</li><li>two</li></ol>" in html
    assert '<pre class="code">sudo bash scripts/update.sh</pre>' in html
    assert "<script" not in str(ug.to_html("<script>alert(1)</script>", "x"))


# Markdown in the guide's folder that is a reference, not a chapter: the table of old addresses and where they go.
NOT_CHAPTERS = {"redirects"}


def test_every_chapter_in_the_manifest_has_a_file_and_only_those():
    d = ug.guide_dir()
    assert d.name == "guide", d  # the guide of the one interface, not the retired user guide
    m = ug.manifest(d)
    slugs = [p["slug"] for s in m["sections"] for p in s["pages"]]
    assert len(slugs) == len(set(slugs))
    assert sorted(f.stem for f in d.glob("*.md") if f.stem not in NOT_CHAPTERS) == sorted(slugs)
    for s in m["sections"]:
        for p in s["pages"]:
            first = (d / f"{p['slug']}.md").read_text(encoding="utf-8").splitlines()[0]
            assert first == f"# {p['title']}", p["slug"]


def test_the_guide_index_shape_is_read_as_sections_of_pages(tmp_path: Path):
    (tmp_path / "index.json").write_text(json.dumps({"title": "Guide", "sections": [
        {"id": "screens", "label": "The screens", "chapters": [{"slug": "one", "title": "One", "summary": "s", "video": "v"}]}]}))
    assert ug.manifest(tmp_path) == {"title": "Guide", "sections": [{"title": "The screens", "pages": [{"slug": "one", "title": "One"}]}]}


def test_context_follows_the_manifest_and_skips_missing_chapters(tmp_path: Path):
    (tmp_path / "index.json").write_text(json.dumps({"title": "Guide", "sections": [
        {"title": "A", "pages": [{"slug": "one", "title": "One"}, {"slug": "gone", "title": "Gone"}]},
        {"title": "B", "pages": [{"slug": "gone2", "title": "Gone"}]}]}))
    (tmp_path / "one.md").write_text("# One\n\nBody.\n")
    ctx = ug.context(tmp_path, app_version="v1", generated_at=datetime(2026, 10, 23, tzinfo=timezone.utc))
    assert [(s["title"], [c["slug"] for c in s["chapters"]]) for s in ctx["sections"]] == [("A", ["one"])]
    assert ctx["title"] == "Guide" and dict(ctx["meta"])["Chapters"] == "1" and dict(ctx["meta"])["Version"] == "v1"


def test_the_whole_guide_renders_to_pdf():
    pytest.importorskip("weasyprint")
    ctx = ug.context(app_version="test")
    from api.services.pdf_reports import _env, render

    html = _env().get_template("user_guide.html").render(**ctx)
    for s in ctx["sections"]:
        for c in s["chapters"]:
            assert f'href="#{c["slug"]}"' in html and f'id="{c["slug"]}"' in html
    assert render("user_guide.html", ctx).startswith(b"%PDF")


def test_route_serves_the_pdf_and_says_when_the_guide_is_missing(monkeypatch):
    from fastapi import HTTPException

    from api.routes import user_guide as route

    monkeypatch.setattr(ug, "build_pdf", lambda: b"%PDF-1.7 test")
    r = asyncio.run(route.user_guide_pdf(tenant=None))
    assert r.body == b"%PDF-1.7 test" and r.media_type == "application/pdf"
    assert 'filename="meridian_user_guide.pdf"' in r.headers["content-disposition"]

    def missing():
        raise FileNotFoundError

    monkeypatch.setattr(ug, "build_pdf", missing)
    with pytest.raises(HTTPException) as e:
        asyncio.run(route.user_guide_pdf(tenant=None))
    assert e.value.status_code == 404
