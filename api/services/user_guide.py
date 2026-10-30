"""The user guide as one PDF.

The guide's chapters are the markdown files the app's help panel shows (``frontend/docs/guide``; in the
API image they are copied to ``docs/guide``). ``index.json`` there gives the sections (``label``), the
chapter order and the titles (``chapters``), so the help panel and this PDF never disagree; the older
manifest shape (``title`` and ``pages``) is still read. The markdown subset: headings, paragraphs,
bullet and numbered lists, fenced code, and inline code, bold and links. A link to another chapter
becomes a link inside the PDF; a link to an app page is printed as its label.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Optional

from markupsafe import Markup, escape

_ROOT = Path(__file__).resolve().parents[2]
_CANDIDATES = (_ROOT / "frontend" / "docs" / "guide", _ROOT / "docs" / "guide")
_INLINE = re.compile(r"(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))")
_CHAPTER_LINK = re.compile(r"^/docs\?page=([\w-]+)$")


def guide_dir() -> Path:
    """The directory holding ``index.json`` and the chapters. FileNotFoundError when neither place has it."""
    for d in _CANDIDATES:
        if (d / "index.json").is_file():
            return d
    raise FileNotFoundError("user guide not found")


def manifest(d: Optional[Path] = None) -> dict:
    """The guide's index as sections of ``{"title", "pages": [{"slug", "title"}]}``, whichever shape the file uses."""
    raw = json.loads(((d or guide_dir()) / "index.json").read_text(encoding="utf-8"))
    sections = [
        {"title": s.get("title") or s.get("label") or "",
         "pages": [{"slug": p["slug"], "title": p["title"]} for p in (s.get("pages") or s.get("chapters") or [])]}
        for s in raw.get("sections", [])
    ]
    return {"title": raw.get("title"), "sections": sections}


def _inline(text: str) -> Markup:
    out: list[str] = []
    last = 0
    for m in _INLINE.finditer(text):
        out.append(str(escape(text[last:m.start()])))
        tok = m.group(0)
        if tok.startswith("`"):
            out.append(f'<code class="mono">{escape(tok[1:-1])}</code>')
        elif tok.startswith("**"):
            out.append(f"<strong>{escape(tok[2:-2])}</strong>")
        else:
            label, href = re.match(r"^\[([^\]]+)\]\(([^)]+)\)$", tok).groups()
            chapter = _CHAPTER_LINK.match(href)
            out.append(f'<a href="#{escape(chapter.group(1))}">{escape(label)}</a>' if chapter else str(escape(label)))
        last = m.end()
    out.append(str(escape(text[last:])))
    return Markup("".join(out))


def to_html(src: str, slug: str) -> Markup:
    """One chapter's markdown as HTML. The ``#`` title becomes the chapter's h1, anchored at ``slug``."""
    lines = src.replace("\r\n", "\n").split("\n")
    html: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("```"):
            body = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1
            html.append(f'<pre class="code">{escape(chr(10).join(body))}</pre>')
            continue
        h = re.match(r"^(#{1,3})\s+(.*)$", line)
        if h:
            level = len(h.group(1))
            anchor = f' id="{escape(slug)}"' if level == 1 else ""
            html.append(f"<h{level}{anchor}>{_inline(h.group(2).strip())}</h{level}>")
            i += 1
            continue
        bullet, numbered = re.compile(r"^[-*]\s+"), re.compile(r"^\d+\.\s+")
        if bullet.match(line) or numbered.match(line):
            ordered = bool(numbered.match(line))
            marker = numbered if ordered else bullet
            items = []
            while i < len(lines) and marker.match(lines[i]):
                items.append(f"<li>{_inline(marker.sub('', lines[i]).strip())}</li>")
                i += 1
            tag = "ol" if ordered else "ul"
            html.append(f"<{tag}>{''.join(items)}</{tag}>")
            continue
        para = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,3}\s|```|[-*]\s|\d+\.\s)", lines[i]):
            para.append(lines[i].strip())
            i += 1
        html.append(f"<p>{_inline(' '.join(para))}</p>")
    return Markup("\n".join(html))


def context(d: Optional[Path] = None, *, app_version: str = "", generated_at: Optional[datetime] = None) -> dict:
    """Everything the user_guide.html template needs: the cover fields, the contents and the chapters."""
    from api.services.pdf_reports import fmt_dt

    d = d or guide_dir()
    m = manifest(d)
    now = generated_at or datetime.now(timezone.utc)
    sections = []
    for s in m["sections"]:
        chapters = []
        for p in s["pages"]:
            f = d / f"{p['slug']}.md"
            if f.is_file():
                chapters.append({**p, "html": to_html(f.read_text(encoding="utf-8"), p["slug"])})
        if chapters:
            sections.append({"title": s["title"], "chapters": chapters})
    count = sum(len(s["chapters"]) for s in sections)
    return {
        "title": m.get("title") or "Meridian user guide", "eyebrow": "User guide", "cover": True,
        "subtitle": "How to use every part of Meridian", "scope_label": "",
        "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Version", app_version or "—"), ("Chapters", str(count)), ("Generated", fmt_dt(now))],
        "sections": sections,
    }


def _fingerprint(d: Path) -> tuple:
    return tuple(sorted((f.name, f.stat().st_mtime_ns) for f in d.iterdir() if f.is_file()))


@lru_cache(maxsize=1)
def _pdf_for(d: str, fingerprint: tuple, app_version: str) -> bytes:  # noqa: ARG001 - fingerprint keys the cache
    from api.services.pdf_reports import render

    return render("user_guide.html", context(Path(d), app_version=app_version))


def build_pdf() -> bytes:
    """The guide as PDF bytes; rebuilt only when a chapter or the version changes."""
    from api.services.pdf_reports import _app_version

    d = guide_dir()
    return _pdf_for(str(d), _fingerprint(d), _app_version())
