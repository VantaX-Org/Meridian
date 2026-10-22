"""Print colours for the PDF reports, in one place.

Python builds the inline SVG charts and cannot read ``templates/assets/report.css``, so the
values live here and are mirrored as ``:root`` custom properties in that file. A unit test
(tests/test_report_theme.py) asserts every value equals its CSS literal. Keys use underscores;
the CSS property is the same name with dashes (``ink_3`` -> ``--ink-3``). Print is always light.
Source of truth for the palette: frontend/DESIGN.md (Canvas tokens).
"""

PRINT_TOKENS: dict[str, str] = {
    # Text hues: dark enough for 4.5:1 on white and on the wash (docs: frontend/DESIGN.md section 2).
    "ink": "#1A2233",
    "ink_2": "#3F4A5C",
    "ink_3": "#5A6578",
    "line": "#E6EAF0",
    "wash": "#F4F6F8",
    "accent": "#2563EB",
    "navy": "#1E3A8A",
    "ok": "#1B7544",
    "warn": "#9A5B00",
    "high": "#A64D07",
    "bad": "#C62828",
    "cover_mark": "#7FA8FF",
    "cover_meridian": "#E8F1FF",
    "ring_track": "#EEF1F5",
    "ring_line": "#CBD2DC",
    # Vivid fills for bars, rings and trend lines. Never used for text.
    "ok_fill": "#22A06B",
    "warn_fill": "#F5A524",
    "high_fill": "#F97316",
    "bad_fill": "#E5484D",
    "accent_fill": "#3B82F6",
}


def band_colour(score: float) -> str:
    """Score ring and trend colour (vivid fill): ok from 90, warn from 75, high from 60, else bad."""
    t = PRINT_TOKENS
    return (t["ok_fill"] if score >= 90 else t["warn_fill"] if score >= 75
            else t["high_fill"] if score >= 60 else t["bad_fill"])


def band_ink(score: float) -> str:
    """The same bands as :func:`band_colour` in the dark text hue, for numerals and labels."""
    t = PRINT_TOKENS
    return t["ok"] if score >= 90 else t["warn"] if score >= 75 else t["high"] if score >= 60 else t["bad"]
