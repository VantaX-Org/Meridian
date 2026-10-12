"""Print colours for the PDF reports, in one place.

Python builds the inline SVG charts and cannot read ``templates/assets/report.css``, so the
values live here and are mirrored as ``:root`` custom properties in that file. A unit test
(tests/test_report_theme.py) asserts every value equals its CSS literal. Keys use underscores;
the CSS property is the same name with dashes (``ink_3`` -> ``--ink-3``). Print is always light.
Source of truth for the palette: docs/superpowers/specs/2026-10-12-ui-colour-design.md.
"""

PRINT_TOKENS: dict[str, str] = {
    "ink": "#141519",
    "ink_2": "#4A4C55",
    "ink_3": "#6A6C76",
    "line": "#E4E2DB",
    "wash": "#FAF9F6",
    "accent": "#2B4BE0",
    "navy": "#0F1430",
    "ok": "#157A3C",
    "warn": "#946200",
    "high": "#BA4A0B",
    "bad": "#B42318",
    "cover_mark": "#8DA3FF",
    "cover_meridian": "#EDEDF0",
    "ring_track": "#EFEDE8",
    "ring_line": "#CFCCC3",
}


def band_colour(score: float) -> str:
    """Score ring and trend colour: ok from 90, warn from 75, high from 60, else bad."""
    t = PRINT_TOKENS
    return t["ok"] if score >= 90 else t["warn"] if score >= 75 else t["high"] if score >= 60 else t["bad"]
