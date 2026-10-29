"""Tenant theming: the deterministic checks behind GET/PUT /api/v1/settings/theme and the public GET /api/v1/theme.

Accent contrast (WCAG 2.x relative luminance): the accent is the colour of primary buttons, links and focus rings,
so it must reach 4.5:1 against the light sheet (white) and, in dark mode, against the dark ground. No single colour
can do both: 4.5:1 on white needs a relative luminance of at most 0.183, 4.5:1 on the dark ground (#0F1420) at
least 0.207. So, as the design tokens already do (--m-accent #2563EB light, #7FA8FF dark), the theme carries two
values: ``accent`` (checked against white) and ``accent_dark`` (checked against the dark ground). When no
``accent_dark`` is given it is derived from ``accent`` by mixing it toward white in 5 % steps until it passes.

Logos: PNG or SVG, at most LOGO_MAX_BYTES, checked by magic bytes (PNG signature; SVG an XML document whose root is
<svg>) and, for SVG, refused when it carries anything that can run or fetch (script, event handlers, foreignObject,
external references). The bytes are stored in object storage under ``branding/<tenant>/`` and served by the API
with a sandboxing Content-Security-Policy.
"""
from __future__ import annotations

import re
from typing import Optional

WHITE = "#FFFFFF"
DARK_GROUND = "#0F1420"  # frontend/design/tokens.css [data-theme="dark"] --m-canvas
MIN_CONTRAST = 4.5
PRODUCT_NAME_MAX = 40
LOGO_MAX_BYTES = 512 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

_HEX = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
# Anything in an SVG that can execute or load another resource.
_SVG_FORBIDDEN = re.compile(
    rb"<\s*script|<\s*foreignobject|<\s*iframe|<\s*embed|<\s*object|\son[a-z]+\s*=|javascript:|data:text/html"
    rb"|<!entity|<!doctype|(?:xlink:)?href\s*=\s*[\"']\s*(?!#)|@import|url\(\s*[\"']?\s*(?!#)",
    re.IGNORECASE,
)


class ThemeError(ValueError):
    """A theme value fails a check; the message is the sentence for the 422."""


def normalise_hex(value: str) -> str:
    """'#2563eb' / '2563EB' / '#26e' -> '#2563EB'. ThemeError when it is not a hex colour."""
    m = _HEX.match((value or "").strip())
    if not m:
        raise ThemeError("Use a hex colour such as #2563EB")
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + h.upper()


def _channel(c: int) -> float:
    s = c / 255
    return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4


def luminance(hex_colour: str) -> float:
    h = normalise_hex(hex_colour)[1:]
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def contrast(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _mix(hex_colour: str, toward: str, t: float) -> str:
    a, b = normalise_hex(hex_colour)[1:], normalise_hex(toward)[1:]
    out = []
    for i in (0, 2, 4):
        x, y = int(a[i:i + 2], 16), int(b[i:i + 2], 16)
        out.append(round(x + (y - x) * t))
    return "#" + "".join(f"{v:02X}" for v in out)


def derive_dark_accent(accent: str) -> str:
    """The first 5 % step of ``accent`` mixed toward white that reaches MIN_CONTRAST on the dark ground."""
    for step in range(21):
        candidate = _mix(accent, WHITE, step / 20)
        if contrast(candidate, DARK_GROUND) >= MIN_CONTRAST:
            return candidate
    return WHITE  # unreachable: white on the dark ground is about 18:1


def check_accent(accent: str, accent_dark: Optional[str] = None) -> dict:
    """{accent, accent_dark, contrast: {on_white, on_dark}} or ThemeError naming the failing pair."""
    light = normalise_hex(accent)
    on_white = contrast(light, WHITE)
    if on_white < MIN_CONTRAST:
        raise ThemeError(f"The accent {light} has {on_white:.2f}:1 contrast against white; it needs at least "
                         f"{MIN_CONTRAST}:1. Choose a darker colour.")
    dark = normalise_hex(accent_dark) if accent_dark else derive_dark_accent(light)
    on_dark = contrast(dark, DARK_GROUND)
    if on_dark < MIN_CONTRAST:
        raise ThemeError(f"The dark-mode accent {dark} has {on_dark:.2f}:1 contrast against the dark ground "
                         f"{DARK_GROUND}; it needs at least {MIN_CONTRAST}:1. Choose a lighter colour.")
    return {"accent": light, "accent_dark": dark,
            "contrast": {"on_white": round(on_white, 2), "on_dark": round(on_dark, 2)}}


def check_product_name(name: Optional[str]) -> Optional[str]:
    if name is None:
        return None
    clean = " ".join(name.split())
    if not clean:
        return None
    if len(clean) > PRODUCT_NAME_MAX:
        raise ThemeError(f"Keep the product name to {PRODUCT_NAME_MAX} characters")
    if any(ch in clean for ch in "<>"):
        raise ThemeError("The product name cannot contain < or >")
    return clean


def sniff_logo(content: bytes) -> str:
    """'png' or 'svg' by magic bytes; ThemeError for anything else, an oversize file or an unsafe SVG."""
    if not content:
        raise ThemeError("The file is empty")
    if len(content) > LOGO_MAX_BYTES:
        raise ThemeError(f"The logo is larger than {LOGO_MAX_BYTES // 1024} KB")
    if content.startswith(PNG_MAGIC):
        return "png"
    head = content[:1024].lstrip(b"\xef\xbb\xbf").lstrip()
    if head.startswith((b"<?xml", b"<svg", b"<!--")):
        if b"\x00" in content:
            raise ThemeError("The file is not a PNG or SVG image")
        if not re.search(rb"<svg[\s>]", content[:4096], re.IGNORECASE):
            raise ThemeError("The file is not a PNG or SVG image")
        if _SVG_FORBIDDEN.search(content):
            raise ThemeError("The SVG contains scripts, event handlers or external references; export a plain SVG")
        return "svg"
    raise ThemeError("The file is not a PNG or SVG image")


CONTENT_TYPES = {"png": "image/png", "svg": "image/svg+xml"}
